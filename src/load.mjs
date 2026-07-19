// Load a cartridge: verify it, install its skill bundles as real Agent Skills,
// and render a "card" with class (role), level (proven/declared) and moves.
import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, relative, resolve, sep } from 'node:path'
import { Cartridge } from './container.mjs'
import { evaluateTrust, emptyTrustRegistry, loadTrustRegistry } from './trust.mjs'
import { resolveCartridgeEvidence } from './level/resolution.mjs'
import { validatePackageSpec, validPackagePath } from './packagespec.mjs'

// Role -> friendly job class (RPG-style archetype). Neutral, no franchise.
export const ROLE_CLASS = {
  lead_developer: 'Lead Engineer', frontend_dev: 'Interface Artisan', backend_dev: 'Backend Engineer',
  fullstack_dev: 'Full-Stack Generalist', devops_engineer: 'Pipeline Wright', designer: 'Design Smith',
  qa_engineer: 'Quality Sentinel', product_owner: 'Product Strategist', tech_writer: 'Loremaster',
  security_expert: 'Security Sentinel', architect: 'Systems Architect', cto: 'Chief Architect',
  tenx_engineer: 'Prime Engineer', mentor: 'Mentor', marketing_strategist: 'Growth Strategist',
  product_expert: 'Product Sage', ux_researcher: 'UX Researcher', business_analyst: 'Analyst',
  content_creator: 'Content Smith', hr_manager: 'People Lead',
}
export function classForRole(role) { return ROLE_CLASS[role] || 'Engineer' }

export const DEFAULT_SKILLS_DIR = join(homedir(), '.claude', 'skills')

function readOptions(registryPathOrOptions, resolutionOptions) {
  if (registryPathOrOptions && typeof registryPathOrOptions === 'object') {
    return {
      registryPath: registryPathOrOptions.registryPath ?? null,
      resolution: registryPathOrOptions.resolution ?? registryPathOrOptions,
    }
  }
  return { registryPath: registryPathOrOptions ?? null, resolution: resolutionOptions ?? {} }
}

/**
 * Read a cartridge's card data (no side effects).
 *
 * Embedded credentials and `proficiency.verified` values remain claims unless
 * explicit issuer-key and revocation resolvers are supplied. Supported forms:
 * `readCard(cart, registryPath, resolutionOptions)` or `readCard(cart, options)`.
 */
export function readCard(cart, registryPathOrOptions = null, resolutionOptions = {}) {
  const meta = cart.allMeta()
  const options = readOptions(registryPathOrOptions, resolutionOptions)
  const evidence = resolveCartridgeEvidence(cart, options.resolution)
  const capabilityResolution = new Map(evidence.capabilities.map((item) => [item.id, item]))
  const reg = options.registryPath ? loadTrustRegistry(options.registryPath) : emptyTrustRegistry()
  const v = evaluateTrust(cart, { registry: reg })
  const caps = evidence.capabilities.filter((item) => item.capability).map((item) => {
    const c = item.capability
    const resolved = capabilityResolution.get(item.id)
    return {
      taskType: c.taskType,
      stack: c.stack || [],
      domain: c.domain || null,
      claimedVerified: c.proficiency?.verified === true,
      verified: resolved?.verified === true,
      verificationState: resolved?.verificationState ?? 'unresolved',
      evidenceRef: resolved?.resolvedEvidenceRef ?? null,
    }
  })
  const skills = cart.db.prepare('SELECT name, sqlar_path FROM acx_skill ORDER BY name').all()
  const declaredAcxLevel = Number(meta['acx.declared_level'] || 0)
  const level = {
    ...evidence.level,
    declaredAcxLevel,
    claimedAcxLevel: evidence.level.claimedAcxLevel ?? declaredAcxLevel,
    claimSource: evidence.level.claimedAcxLevel != null ? 'embedded-credential' : 'publisher-declaration',
  }
  const discovery = {
    id: meta['acx.artifact_id'] || null,
    version: meta['acx.artifact_version'] || null,
    description: meta['acx.description'] || '',
    license: meta['acx.license'] || null,
    authors: safeJsonArray(meta['acx.authors']),
    tags: safeJsonArray(meta['acx.tags']),
    homepage: meta['acx.homepage'] || null,
  }
  return {
    id: discovery.id,
    name: meta['acx.agent_name'] || 'Unknown', role: meta['acx.role'] || 'engineer',
    class: classForRole(meta['acx.role']), publisher: meta['acx.publisher_id'] || 'unknown',
    provider: meta['acx.provider'] || '', model: meta['acx.model'] || '',
    trust: v.trust, trustStatus: v.status, trustSummary: v.summary,
    level, moves: caps, skills, romHash: meta['acx.rom_manifest_hash'], discovery,
  }
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Extract every rom/skills/<name>/ tree into skillsDir/<name>/ as usable Agent Skills. */
export function installSkills(cart, skillsDir) {
  const installed = []
  const root = resolve(skillsDir)
  if (existsSync(root) && (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())) {
    throw new Error(`skills directory must be a real directory: ${root}`)
  }
  for (const name of cart.listFiles('rom/skills/')) {
    if (!validPackagePath(name)) throw new Error(`refusing unsafe skill path '${name}'`)
    const rel = name.slice('rom/skills/'.length) // <skill>/SKILL.md, <skill>/references/...
    const segments = rel.split('/')
    if (segments.length < 2 || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new Error(`refusing unsafe skill path '${name}'`)
    }
    const dest = resolve(root, ...segments)
    const fromRoot = relative(root, dest)
    if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
      throw new Error(`refusing skill path outside the install directory: ${name}`)
    }
    let current = root
    for (const segment of fromRoot.split(sep).slice(0, -1)) {
      current = join(current, segment)
      if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
        throw new Error(`refusing symbolic-link skill destination: ${current}`)
      }
    }
    mkdirSync(dirname(dest), { recursive: true })
    if (existsSync(dest) && (!lstatSync(dest).isFile() || lstatSync(dest).isSymbolicLink())) {
      throw new Error(`refusing non-regular skill destination: ${dest}`)
    }
    writeFileSync(dest, cart.getFile(name))
    if (rel.endsWith('/SKILL.md')) installed.push(rel.slice(0, -('/SKILL.md'.length)))
  }
  return installed
}

/**
 * Load a cartridge end to end.
 * @returns {{ card, installed: string[], skillsDir: string, refused: boolean }}
 */
export function loadCartridge(file, {
  skillsDir = DEFAULT_SKILLS_DIR,
  install = true,
  registryPath = null,
  resolution = {},
} = {}) {
  const cart = Cartridge.open(file, { readonly: true })
  try {
    const card = readCard(cart, registryPath, resolution)
    const packageSpec = validatePackageSpec(cart)
    card.packageSpec = { ok: packageSpec.ok, issues: packageSpec.issues }
    // Installing skill code requires a signed, structurally clean package.
    if (
      card.trust === 'tampered'
      || card.trust === 'legacy'
      || card.trustStatus === 'invalid'
      || !packageSpec.ok
    ) {
      return { card, installed: [], skillsDir, refused: true }
    }
    const installed = install ? installSkills(cart, skillsDir) : []
    return { card, installed, skillsDir, refused: false }
  } finally {
    cart.close()
  }
}

/** Render the card as a terminal panel. */
export function renderCard(card, { installed = [], skillsDir = '' } = {}) {
  const lvl = card.level.proven
    ? `${card.level.tier} (Lv.${card.level.acxLevel}) · proven ✓${card.level.boundToRom ? ' bound to ROM' : ''}`
    : `Lv.${card.level.claimedAcxLevel ?? card.level.declaredAcxLevel ?? 0} · claimed (${card.level.verificationState || 'unresolved'})`
  const moves = card.moves.length
    ? card.moves.map((m) => m.taskType + (m.verified ? '*' : (m.claimedVerified ? ' (claimed)' : ''))).join(', ')
    : '—'
  const lines = [
    `╔══ ${card.name} ${'═'.repeat(Math.max(1, 34 - card.name.length))}╗`,
    `  Class:  ${card.class}  (${card.role})`,
    `  Level:  ${lvl}`,
    `  Trust:  ${card.trust} — ${card.trustSummary}`,
    `  Origin: ${card.publisher} · ${card.provider}/${card.model}`,
    `  Moves:  ${moves}`,
    installed.length ? `  Skills: ${installed.join(', ')} → installed to ${skillsDir}` : `  Skills: ${card.skills.map((s) => s.name).join(', ') || '—'}`,
    `╚${'═'.repeat(40)}╝`,
  ]
  return lines.join('\n')
}
