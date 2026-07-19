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
  const discovery = discoveryMetadata(manifest, publisherId)
  const cartridgeId = `${publisherId}/${discovery.id}@${randomUUID()}`

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
    cart.setMeta('acx.artifact_id', discovery.id)
    cart.setMeta('acx.artifact_version', discovery.version)
    cart.setMeta('acx.description', discovery.description)
    cart.setMeta('acx.license', discovery.license)
    cart.setMeta('acx.authors', JSON.stringify(discovery.authors))
    cart.setMeta('acx.tags', JSON.stringify(discovery.tags))
    if (discovery.homepage) cart.setMeta('acx.homepage', discovery.homepage)

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

    bindRomMeta(cart, [
      'acx.spec_version',
      'acx.cartridge_id',
      'acx.created_at',
      'acx.embedding_engine',
      'acx.publisher_id',
      'acx.agent_name',
      'acx.provider',
      'acx.model',
      'acx.role',
      'acx.declared_level',
      'acx.artifact_id',
      'acx.artifact_version',
      'acx.description',
      'acx.license',
      'acx.authors',
      'acx.tags',
      'acx.homepage',
    ])

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

function discoveryMetadata(manifest, publisherId) {
  const id = manifest.artifactId == null ? slug(manifest.name) : String(manifest.artifactId).trim()
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) {
    throw new Error('manifest.artifactId must be a lowercase registry slug')
  }
  const version = manifest.artifactVersion ?? '1.0.0'
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(version)) {
    throw new Error('manifest.artifactVersion must be SemVer')
  }
  const role = String(manifest.role ?? 'fullstack_dev').replaceAll('_', ' ')
  const stack = Array.isArray(manifest.techStack) ? manifest.techStack.map(String).filter(Boolean) : []
  const description = String(
    manifest.description
      ?? `A portable ${role} agent${stack.length ? ` specializing in ${stack.join(', ')}` : ' for reusable agent work'}.`,
  ).trim()
  if (description.length < 20 || description.length > 500) {
    throw new Error('manifest.description must contain 20-500 characters')
  }
  const license = String(manifest.license ?? 'Apache-2.0').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9.+() -]{0,99}$/.test(license)) {
    throw new Error('manifest.license must be a compact SPDX expression')
  }
  const rawAuthors = Array.isArray(manifest.authors) && manifest.authors.length
    ? manifest.authors
    : [{ name: publisherId }]
  const authors = rawAuthors.map((author) => {
    const value = typeof author === 'string' ? { name: author } : author
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('manifest.authors entries must be names or author objects')
    }
    const name = String(value.name ?? '').trim()
    if (!name || name.length > 120) throw new Error('manifest author names must contain 1-120 characters')
    if (value.url == null) return { name }
    const url = cleanPublicUrl(value.url, 'manifest author url')
    return { name, url }
  })
  const rawTags = Array.isArray(manifest.tags) && manifest.tags.length
    ? manifest.tags
    : [manifest.role ?? 'agent', ...stack]
  const tags = [...new Set(rawTags.map((tag) => slug(tag)).filter(Boolean))].slice(0, 20)
  if (!tags.length || tags.some((tag) => tag.length > 64)) {
    throw new Error('manifest.tags must produce 1-20 lowercase discovery tags up to 64 characters')
  }
  const homepage = manifest.homepage == null ? null : cleanPublicUrl(manifest.homepage, 'manifest.homepage')
  return { id, version, description, license, authors, tags, homepage }
}

function cleanPublicUrl(value, label) {
  let url
  try {
    url = new URL(String(value))
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL`)
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${label} must be an absolute HTTP(S) URL without credentials`)
  }
  return url.href
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
