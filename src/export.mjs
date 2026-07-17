// Export an AGENTIBUS agent-package directory into a single-file .acx cartridge.
import { readFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Cartridge } from './container.mjs'
import { insertMemory, codebaseFingerprint, canonicalRepoIdentity } from './memory.mjs'
import { buildCapability, defaultHarnessRequirements, defaultLoopContextPolicy, toPurl } from './builders.mjs'
import { putCapability, bindRomMeta, deriveSkillIndex, scrubOrThrow, finalizeAndSign } from './assemble.mjs'
import { emitPackageSpec } from './packagespec.mjs'
import { emitCalSkillSet } from './cal.mjs'

const KNOWLEDGE_FILES = ['IDENTITY.md', 'SKILLS.md', 'MEMORY.md', 'CAREER.md', 'EQUIPMENT.md', 'LEARNING_PATH.md', 'EXCHANGE.md', 'STYLE.md']

/**
 * @param {object} opts
 * @param {string} opts.packageDir   AGENTIBUS agent-package directory
 * @param {string} opts.outPath      target .acx path
 * @param {object} opts.key          signing key from generateSigningKey()
 * @param {string} opts.publisherId  reverse-DNS publisher id
 * @param {Buffer|string} opts.installationSalt  >=256-bit org secret
 * @param {boolean} [opts.includeFieldLearned]   default false (quarantine)
 * @param {object[]} [opts.extraCapabilities]    additional CapabilityRecord seeds
 */
export function exportPackageToCartridge(opts) {
  const { packageDir, outPath, key, publisherId, installationSalt, includeFieldLearned = false, extraCapabilities = [] } = opts
  const manifest = JSON.parse(readFileSync(join(packageDir, 'manifest.json'), 'utf8'))
  const records = existsSync(join(packageDir, 'memory-records.json'))
    ? JSON.parse(readFileSync(join(packageDir, 'memory-records.json'), 'utf8'))
    : []

  const embeddingEngine = { id: manifest.vectorEngine ?? 'local-hash-128', dim: 128 }
  const cartridgeId = `${publisherId}/${slug(manifest.name)}@${randomUUID()}`

  if (existsSync(outPath)) unlinkSync(outPath)
  const cart = Cartridge.create(outPath)
  const forbidLiterals = []

  cart.tx(() => {
    // ---- cartridge meta -------------------------------------------------
    cart.setMeta('acx.spec_version', '0.1')
    cart.setMeta('acx.cartridge_id', cartridgeId)
    cart.setMeta('acx.created_at', manifest.exportedAt ?? new Date().toISOString())
    cart.setMeta('acx.embedding_engine', JSON.stringify(embeddingEngine))
    cart.setMeta('acx.vec0_format', '1')
    cart.setMeta('acx.publisher_id', publisherId)
    cart.setMeta('acx.agent_name', manifest.name)
    cart.setMeta('acx.provider', manifest.provider ?? 'custom')
    cart.setMeta('acx.model', manifest.model ?? '')
    cart.setMeta('acx.role', manifest.role ?? 'fullstack_dev')
    cart.setMeta('acx.declared_level', String(manifest.level ?? 0))

    // ---- knowledge markdown (ROM) --------------------------------------
    for (const f of KNOWLEDGE_FILES) {
      const p = join(packageDir, f)
      if (existsSync(p)) cart.putFile('rom/knowledge/' + f, readFileSync(p))
    }

    // ---- a real SKILL.md so the skill layer is exercised ---------------
    const skillName = 'expertise-' + slug(manifest.role ?? 'engineering')
    cart.putFile(`rom/skills/${skillName}/SKILL.md`, Buffer.from(buildSkillMd(skillName, manifest), 'utf8'))

    // ---- memory partition ----------------------------------------------
    const domain = roleToDomain(manifest.role)
    for (const r of records) {
      // Every record's original repo IDENTIFIERS become forbidden literals so a
      // leaked slug in any text field is caught by the scrub gate (SPEC §7.5).
      // repoId is always identifier-like; labels only when slug-shaped (no spaces,
      // has a hyphen/underscore/digit) so benign display labels are not flagged.
      if (r.repoId && String(r.repoId).trim()) forbidLiterals.push(String(r.repoId))
      for (const lit of [r.repoLabel, r.projectLabel]) {
        const s = String(lit ?? '')
        if (s.length >= 4 && !/\s/.test(s) && /[-_0-9]/.test(s)) forbidLiterals.push(s)
      }
      // Only null/undefined repoId is transferable; a present (even empty) repoId is codebase-bound.
      const isFieldLearned = r.repoId != null && String(r.repoId) !== ''
      if (isFieldLearned) {
        if (!includeFieldLearned) continue // quarantine by default (§7.4)
        const cbf = codebaseFingerprint(installationSalt, canonicalRepoIdentity({ originUrl: 'repo://' + r.repoId }))
        insertMemory(cart, { ...normalizeArtifact(r), portable: false, repoId: null, repoLabel: 'field-learned', projectLabel: 'field-learned', codebaseFingerprint: cbf, foreign: true })
      } else {
        insertMemory(cart, { ...normalizeArtifact(r), portable: true, repoId: null, repoLabel: 'portable-core', projectLabel: 'portable-core', codebaseFingerprint: null })
      }
    }

    // ---- capabilities (self-declared unless attested later) ------------
    const techStack = manifest.techStack ?? []
    const caps = [
      buildCapability({ taskType: 'implement-feature', stack: techStack, domain, lastDemonstratedAt: manifest.exportedAt }),
      ...extraCapabilities,
    ]
    for (const c of caps) putCapability(cart, c)

    // ---- ROM policy docs -----------------------------------------------
    cart.putFile('rom/manifest/harness-requirements.json', Buffer.from(JSON.stringify(defaultHarnessRequirements(), null, 2), 'utf8'))
    cart.putFile('rom/policy/loop-context-policy.json', Buffer.from(JSON.stringify(defaultLoopContextPolicy({ embeddingEngineId: embeddingEngine.id }), null, 2), 'utf8'))

    // ---- derived index + integrity binding -----------------------------
    deriveSkillIndex(cart)

    // ---- CAL participation declaration (ROM-signed) --------------------
    emitCalSkillSet(cart)

    // ---- clean package spec + normative LanceDB memory schema (ROM-signed) ---
    // after deriveSkillIndex + emitCalSkillSet so the spec's artifact counts are accurate
    emitPackageSpec(cart)

    bindRomMeta(cart, ['acx.spec_version', 'acx.cartridge_id', 'acx.created_at', 'acx.embedding_engine', 'acx.publisher_id', 'acx.agent_name', 'acx.role'])

    // ---- scrub gate (fail-closed) --------------------------------------
    scrubOrThrow(cart, { forbidLiterals })

    // ---- sign ROM ------------------------------------------------------
    finalizeAndSign(cart, key, { publisherId, embeddingEngine, signedAt: manifest.exportedAt, provenanceInstanceId: manifest.originInstanceId })
  })

  return { cart, cartridgeId }
}

function normalizeArtifact(r) {
  return {
    id: r.id,
    title: r.title ?? '',
    summary: r.summary ?? '',
    sourceType: r.sourceType ?? 'knowledge',
    markdownPath: 'knowledge/' + (r.id ?? 'entry') + '.md',
    timestamp: r.timestamp ?? new Date(0).toISOString(),
    impact: r.impact ?? 'neutral',
    xpAwarded: r.xpAwarded ?? 0,
    tags: r.tags ?? [],
    origin: r.origin ?? 'native',
  }
}

function roleToDomain(role) {
  if (['frontend_dev', 'designer', 'ux_researcher'].includes(role)) return 'frontend'
  if (['backend_dev', 'fullstack_dev'].includes(role)) return 'backend'
  if (['devops_engineer', 'security_expert'].includes(role)) return 'infrastructure'
  if (['qa_engineer'].includes(role)) return 'testing'
  if (['architect', 'cto', 'lead_developer'].includes(role)) return 'architecture'
  if (['product_owner', 'product_expert'].includes(role)) return 'product'
  return 'backend'
}

function buildSkillMd(name, manifest) {
  const desc = `Specialized ${manifest.role ?? 'engineering'} expertise on ${(manifest.techStack ?? []).join(', ') || 'general stacks'}. Use when a task matches this agent's demonstrated domain.`
  return `---
name: ${name}
description: ${desc.slice(0, 1024)}
license: Apache-2.0
metadata:
  version: 1.0.0
---

# ${manifest.name} — ${manifest.role ?? 'engineer'}

Portable, codebase-agnostic expertise exported from AGENTIBUS.

## When to use
${desc}

## Stack
${(manifest.techStack ?? []).map((t) => `- ${t} (${toPurl(t)})`).join('\n') || '- general'}
`
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
