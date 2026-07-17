// Load a cartridge: verify it, install its skill bundles as real Agent Skills,
// and render a "card" with class (role), level (proven/declared) and moves.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { Cartridge } from './container.mjs'
import { evaluateTrust, emptyTrustRegistry, loadTrustRegistry } from './trust.mjs'

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

/** Read a cartridge's card data (no side effects). */
export function readCard(cart, registryPath) {
  const meta = cart.allMeta()
  const reg = registryPath ? loadTrustRegistry(registryPath) : emptyTrustRegistry()
  const v = evaluateTrust(cart, { registry: reg })
  const caps = cart.db.prepare('SELECT json FROM capabilities').all()
    .map((r) => JSON.parse(r.json)).map((c) => ({ taskType: c.taskType, verified: !!c.proficiency?.verified }))
  const skills = cart.db.prepare('SELECT name, sqlar_path FROM acx_skill ORDER BY name').all()
  // provable level from a bound attestation, else declared
  let level = { tier: null, acxLevel: Number(meta['acx.declared_level'] || 0), proven: false, boundToRom: false }
  for (const a of cart.db.prepare("SELECT document FROM attestations WHERE type='vc-2.0'").all()) {
    const res = JSON.parse(a.document).credentialSubject?.result?.[0]
    if (res) {
      level = { tier: res['acx:careerTier'], acxLevel: res['acx:acxLevel'], proven: true,
        boundToRom: res['acx:cartridgeRomDigest'] === meta['acx.rom_manifest_hash'] }
      break
    }
  }
  return {
    name: meta['acx.agent_name'] || 'Unknown', role: meta['acx.role'] || 'engineer',
    class: classForRole(meta['acx.role']), publisher: meta['acx.publisher_id'] || 'unknown',
    provider: meta['acx.provider'] || '', model: meta['acx.model'] || '',
    trust: v.trust, trustStatus: v.status, trustSummary: v.summary,
    level, moves: caps, skills, romHash: meta['acx.rom_manifest_hash'],
  }
}

/** Extract every rom/skills/<name>/ tree into skillsDir/<name>/ as usable Agent Skills. */
export function installSkills(cart, skillsDir) {
  const installed = []
  for (const name of cart.listFiles('rom/skills/')) {
    const rel = name.slice('rom/skills/'.length) // <skill>/SKILL.md, <skill>/references/...
    const dest = join(skillsDir, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, cart.getFile(name))
    if (rel.endsWith('/SKILL.md')) installed.push(rel.slice(0, -('/SKILL.md'.length)))
  }
  return installed
}

/**
 * Load a cartridge end to end.
 * @returns {{ card, installed: string[], skillsDir: string, refused: boolean }}
 */
export function loadCartridge(file, { skillsDir = DEFAULT_SKILLS_DIR, install = true, registryPath = null } = {}) {
  const cart = Cartridge.open(file, { readonly: true })
  try {
    const card = readCard(cart, registryPath)
    // refuse to install a tampered cartridge
    if (card.trust === 'tampered' || card.trustStatus === 'invalid') {
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
    : `Lv.${card.level.acxLevel} · declared (unproven)`
  const moves = card.moves.length ? card.moves.map((m) => m.taskType + (m.verified ? '*' : '')).join(', ') : '—'
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
