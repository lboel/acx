// Catalog layer for the Cartridge Exchange: read + verify + summarize .acx files.
// Zero-dependency; reuses the reference implementation in ../src.
import { readdirSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { Cartridge } from '../src/container.mjs'
import { evaluateTrust, emptyTrustRegistry, loadTrustRegistry } from '../src/trust.mjs'
import { resolveCartridgeEvidence } from '../src/level/resolution.mjs'
import { validatePackageSpec } from '../src/packagespec.mjs'

export const CATALOG_DIR = join(new URL('.', import.meta.url).pathname, 'catalog')
const ARTIFACT_ID_RE = /^[a-z][a-z0-9-]{0,63}$/
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

export function ensureCatalog() {
  if (!existsSync(CATALOG_DIR)) mkdirSync(CATALOG_DIR, { recursive: true })
  return CATALOG_DIR
}

function loadRegistry() {
  const p = join(CATALOG_DIR, 'trust-registry.json')
  try {
    return existsSync(p) ? loadTrustRegistry(p) : emptyTrustRegistry()
  } catch {
    return emptyTrustRegistry()
  }
}

/**
 * A gallery/detail summary of one cartridge, verification included.
 * Credential evidence is fail-closed: absent explicit issuer/revocation
 * resolvers, embedded VCs and verified proficiency bits remain claims.
 */
export function summarize(acxPath, resolutionOptions = {}) {
  const cart = Cartridge.open(acxPath, { readonly: true })
  try {
    const meta = cart.allMeta()
    const verification = evaluateTrust(cart, { registry: loadRegistry() })
    const skills = cart.db.prepare('SELECT name, description FROM acx_skill ORDER BY name').all()
    const evidence = resolveCartridgeEvidence(cart, resolutionOptions)
    const memByZone = {}
    for (const r of cart.db.prepare('SELECT zone, COUNT(*) n FROM memory GROUP BY zone').all()) memByZone[r.zone] = r.n
    const packageSpec = validatePackageSpec(cart)
    const resolvedLevel = evidence.level
    const level = resolvedLevel.proven ? {
      acxLevel: resolvedLevel.acxLevel,
      careerTier: resolvedLevel.tier,
      mu: resolvedLevel.mu,
      sigma: resolvedLevel.sigma,
      games: resolvedLevel.games,
      benchmark: resolvedLevel.benchmark,
      boundToRom: resolvedLevel.boundToRom,
      attestationId: resolvedLevel.attestationId,
      verificationState: resolvedLevel.verificationState,
    } : null

    const boundId = meta['acx.artifact_id'] || null
    const version = meta['acx.artifact_version'] || null
    const id = boundId || basename(acxPath).replace(/\.acx$/, '')
    return {
      id, path: acxPath, bytes: statSync(acxPath).size,
      name: meta['acx.agent_name'] || id,
      publisher: meta['acx.publisher_id'] || 'unknown',
      role: meta['acx.role'] || 'engineer',
      provider: meta['acx.provider'] || '', model: meta['acx.model'] || '',
      version,
      coordinateValid: ARTIFACT_ID_RE.test(boundId || '') && SEMVER_RE.test(version || ''),
      description: meta['acx.description'] || '',
      license: meta['acx.license'] || null,
      authors: safeJsonArray(meta['acx.authors']),
      tags: safeJsonArray(meta['acx.tags']),
      homepage: meta['acx.homepage'] || null,
      declaredLevel: Number(meta['acx.declared_level'] || 0),
      romHash: meta['acx.rom_manifest_hash'] || '',
      trust: verification.trust, trustStatus: verification.status, trustSummary: verification.summary,
      skills,
      capabilities: evidence.capabilities.filter((item) => item.capability).map((item) => ({
        taskType: item.capability.taskType,
        stack: item.capability.stack,
        domain: item.capability.domain,
        claimedVerified: item.claimedVerified,
        verified: item.verified,
        verificationState: item.verificationState,
      })),
      memory: memByZone,
      level,
      levelClaim: {
        acxLevel: resolvedLevel.claimedAcxLevel,
        careerTier: resolvedLevel.claimedTier,
        verificationState: resolvedLevel.verificationState,
        attestationId: resolvedLevel.attestationId,
      },
      packageSpec: { ok: packageSpec.ok, issues: packageSpec.issues },
    }
  } finally {
    cart.close()
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

/** Full catalog index (all cartridges in CATALOG_DIR). */
export function listCatalog(resolutionOptions = {}) {
  ensureCatalog()
  const out = []
  for (const f of readdirSync(CATALOG_DIR)) {
    if (!f.endsWith('.acx')) continue
    try { out.push(summarize(join(CATALOG_DIR, f), resolutionOptions)) } catch (e) { /* skip unreadable */ }
  }
  // rank: verified level desc, then trust, then name
  const trustRank = { local: 4, trusted: 3, portable: 2, legacy: 1, tampered: 0 }
  return out.sort((a, b) =>
    (b.level?.acxLevel ?? -1) - (a.level?.acxLevel ?? -1) ||
    (trustRank[b.trust] ?? 0) - (trustRank[a.trust] ?? 0) ||
    a.name.localeCompare(b.name))
}

/** Validate an uploaded cartridge before accepting it into the catalog. */
export function inspectUpload(acxPath, resolutionOptions = {}) {
  const s = summarize(acxPath, resolutionOptions)
  const trustAcceptable = s.trust !== 'tampered' && s.trustStatus !== 'invalid' && s.trust !== 'legacy'
  const acceptable = trustAcceptable && s.packageSpec.ok && s.coordinateValid
  const reasons = []
  if (!trustAcceptable) reasons.push(`${s.trust} (${s.trustSummary})`)
  if (!s.packageSpec.ok) reasons.push(`unclean package: ${s.packageSpec.issues.join('; ')}`)
  if (!s.coordinateValid) reasons.push('missing or invalid ROM-bound artifact id/version')
  return { acceptable, summary: s, reason: acceptable ? null : `rejected: ${reasons.join(' · ')}` }
}
