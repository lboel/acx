// Memory partition: transferable (ROM) vs field-learned (SAVE) (SPEC §7).
import { jcs, sha1Hex, hmacSha256Hex, oidJcs } from './canonical.mjs'

const IMPACT_RANK = { negative: 3, neutral: 2, positive: 1 } // "worse impact wins"

/**
 * Canonical two-key content address (SPEC §7.3).
 * sha1 over the identity fields, EXCLUDING portable + codebaseFingerprint, so a
 * record's content address is tier-independent. Text trimmed+lowercased, tags
 * lowercased+sorted. Length 10 (the binding canonical length; live code's 12 is
 * superseded — §7.3 resolved contradiction).
 */
export function artifactFingerprint(rec) {
  const key = {
    title: String(rec.title ?? '').trim().toLowerCase(),
    summary: String(rec.summary ?? '').trim().toLowerCase(),
    sourceType: String(rec.sourceType ?? '').trim().toLowerCase(),
    repoId: rec.repoId ?? null,
    projectLabel: String(rec.projectLabel ?? '').trim().toLowerCase(),
    timestamp: rec.timestamp ?? '',
    impact: rec.impact ?? 'neutral',
    xpAwarded: rec.xpAwarded ?? 0,
    tags: [...(rec.tags ?? [])].map((t) => String(t).toLowerCase()).sort(),
  }
  return sha1Hex(Buffer.from(jcs(key), 'utf8')).slice(0, 10)
}

/**
 * Codebase fingerprint (SPEC §7.2): "cbf1_"+HMAC-SHA-256(salt, canonicalRepoIdentity)[:40].
 * NEVER contains the repo name/label. Org-scoped secret salt => non-correlatable
 * across orgs (the quarantine boundary), stable within an org.
 */
export function codebaseFingerprint(installationSalt, canonicalRepoIdentity) {
  if (!installationSalt || Buffer.byteLength(installationSalt) < 32) {
    throw new Error('installationSalt must be >= 256 bits')
  }
  return 'cbf1_' + hmacSha256Hex(installationSalt, canonicalRepoIdentity).slice(0, 40)
}

/** Normalize a git origin into a stable canonical repo identity (SPEC §7.2). */
export function canonicalRepoIdentity({ originUrl, rootCommitSha } = {}) {
  if (originUrl) {
    let u = originUrl.trim().toLowerCase()
    u = u.replace(/^[a-z0-9.+-]+:\/\//, '') // scheme
    u = u.replace(/^[^/@]+@/, '') // credentials / scp user@
    u = u.replace(/:/, '/') // scp host:path -> host/path
    u = u.replace(/\.git$/, '')
    u = u.replace(/\/+$/, '')
    return u
  }
  if (rootCommitSha) return 'commit:' + rootCommitSha.trim().toLowerCase()
  throw new Error('need originUrl or rootCommitSha')
}

/** Validate tier invariants (SPEC §7.1). Throws on malformed. */
export function validateRecord(rec) {
  if (typeof rec.portable !== 'boolean') throw new Error(`memory ${rec.id}: missing boolean 'portable'`)
  if (rec.portable) {
    if (rec.codebaseFingerprint != null) throw new Error(`memory ${rec.id}: portable=true requires codebaseFingerprint=null`)
    if (rec.repoId != null) throw new Error(`memory ${rec.id}: portable=true requires repoId=null`)
  } else {
    if (rec.codebaseFingerprint == null) throw new Error(`memory ${rec.id}: portable=false requires a codebaseFingerprint`)
  }
  return true
}

/**
 * Two-key idempotent merge (SPEC §7.3). Dedupe by id, then by artifactFingerprint.
 * Conflict resolution: longer text, worse impact, max xp, union tags, latest ts.
 */
export function mergeRecords(existing, incoming) {
  const byId = new Map()
  const byKey = new Map() // second key: fingerprint + tier + codebase (never cross the quarantine boundary, SPEC §7.4)
  const order = []
  const secondKey = (rec, fp) => `${fp}|${rec.portable ? 1 : 0}|${rec.codebaseFingerprint ?? ''}`
  const upsert = (rec) => {
    const fp = rec.artifactFingerprint ?? artifactFingerprint(rec)
    rec = { ...rec, artifactFingerprint: fp }
    const k2 = secondKey(rec, fp)
    const prevKey = byId.has(rec.id) ? rec.id : byKey.has(k2) ? byKey.get(k2) : null
    if (prevKey == null) {
      byId.set(rec.id, rec)
      byKey.set(k2, rec.id)
      order.push(rec.id)
    } else {
      byId.set(prevKey, resolveConflict(byId.get(prevKey), rec))
    }
  }
  for (const r of existing) upsert(r)
  for (const r of incoming) upsert(r)
  return order.map((id) => byId.get(id))
}

// Order-independent (commutative) conflict resolution (SPEC §7.3).
function resolveConflict(a, b) {
  if (a.portable !== b.portable || (a.codebaseFingerprint ?? null) !== (b.codebaseFingerprint ?? null)) {
    throw new Error(`refusing to merge across the tier/codebase boundary (${a.id} vs ${b.id})`)
  }
  // canonical identity = the lower id, so identity fields are order-independent
  const [x, y] = a.id <= b.id ? [a, b] : [b, a]
  const pickLonger = (f) => {
    const s1 = String(x[f] ?? ''), s2 = String(y[f] ?? '')
    if (s1.length !== s2.length) return s1.length > s2.length ? x[f] : y[f]
    return s1 <= s2 ? x[f] : y[f] // tie -> lexicographically smaller
  }
  return {
    ...x,
    title: pickLonger('title'),
    summary: pickLonger('summary'),
    impact: (IMPACT_RANK[a.impact] ?? 2) >= (IMPACT_RANK[b.impact] ?? 2) ? a.impact : b.impact,
    xpAwarded: Math.max(a.xpAwarded ?? 0, b.xpAwarded ?? 0),
    tags: [...new Set([...(a.tags ?? []), ...(b.tags ?? [])])].sort(),
    timestamp: (a.timestamp ?? '') >= (b.timestamp ?? '') ? a.timestamp : b.timestamp,
  }
}

/** Insert a validated memory record into the container. */
export function insertMemory(cartridge, rec) {
  validateRecord(rec)
  const zone = rec.portable ? 'rom' : 'save'
  const fp = artifactFingerprint(rec)
  // The canonical projection is the import source of truth (SPEC §7.6) and MUST
  // satisfy the AcxMemoryRecord schema, which requires artifactFingerprint + zone.
  const full = { ...rec, artifactFingerprint: fp, zone }
  const payload = jcs(full)
  const oid = oidJcs(full)
  cartridge.db.prepare(
    'INSERT INTO memory(id,zone,artifact_fingerprint,codebase_fingerprint,payload,oid,created_at) VALUES(?,?,?,?,?,?,?) ' +
    'ON CONFLICT(id) DO UPDATE SET zone=excluded.zone,artifact_fingerprint=excluded.artifact_fingerprint,codebase_fingerprint=excluded.codebase_fingerprint,payload=excluded.payload,oid=excluded.oid',
  ).run(rec.id, zone, fp, rec.codebaseFingerprint ?? null, payload, oid, rec.timestamp ?? new Date(0).toISOString())
  cartridge.putObject({ oid, kind: 'memory', sourceRef: 'memory:' + rec.id, canon: 'jcs-rfc8785', zone, sz: Buffer.byteLength(payload) })
  return { oid, fp, zone }
}

export function readMemory(cartridge, { zone } = {}) {
  const rows = zone
    ? cartridge.db.prepare('SELECT payload FROM memory WHERE zone=?').all(zone)
    : cartridge.db.prepare('SELECT payload FROM memory').all()
  return rows.map((r) => JSON.parse(r.payload))
}
