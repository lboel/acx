// RFC 8785 JSON Canonicalization Scheme (JCS) + content-addressing helpers.
// Deterministic, dependency-free. Used for every signed object so that
// re-verification is independent of physical byte layout (SPEC §3.3).
import { createHash, createHmac } from 'node:crypto'

/**
 * Serialize a value to RFC 8785 canonical JSON.
 * - Object keys sorted by UTF-16 code unit (JS default sort on the code points
 *   that make up the key), emitted without insignificant whitespace.
 * - Numbers use the ECMAScript Number-to-String (JSON.stringify) form, which
 *   for our integer-only payloads is exact. Non-finite numbers are rejected.
 * - Strings use JSON string escaping (JSON.stringify), which matches JCS for
 *   the minimal escape set.
 */
export function jcs(value) {
  return serialize(value)
}

function serialize(v) {
  if (v === null) return 'null'
  const t = typeof v
  if (t === 'boolean') return v ? 'true' : 'false'
  if (t === 'number') {
    if (!Number.isFinite(v)) throw new Error('JCS: non-finite number')
    return JSON.stringify(v)
  }
  if (t === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(serialize).join(',') + ']'
  if (t === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort(compareCodeUnits)
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + serialize(v[k])).join(',') + '}'
  }
  throw new Error(`JCS: unsupported type ${t}`)
}

// RFC 8785 sorts by UTF-16 code units. JS default string comparison already
// compares by UTF-16 code unit, so this is a stable, spec-correct comparator.
function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Lowercase hex SHA-256 of a Buffer/string. */
export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex')
}

/** Content-address a raw byte payload: "sha256:"+hex. */
export function oidRaw(bytes) {
  return 'sha256:' + sha256Hex(bytes)
}

/** Content-address a JSON value via its JCS canonical form: "sha256:"+hex. */
export function oidJcs(value) {
  return 'sha256:' + sha256Hex(Buffer.from(jcs(value), 'utf8'))
}

/** sha1 hex (used only for the legacy artifactFingerprint, SPEC §7.3). */
export function sha1Hex(input) {
  return createHash('sha1').update(input).digest('hex')
}

/** HMAC-SHA-256 hex (codebase fingerprint, SPEC §7.2). */
export function hmacSha256Hex(key, msg) {
  return createHmac('sha256', key).update(msg).digest('hex')
}
