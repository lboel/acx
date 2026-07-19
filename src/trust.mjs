// Trust registry (public keys only) + taxonomy evaluation (SPEC §4.4, §4.5).
import { readFileSync } from 'node:fs'
import { keyIdFromPem, verifyEnvelope, buildRomManifest } from './sign.mjs'

const TRUST_REGISTRY_SCHEMA_VERSION = 'acx.trust-registry/1'
const KEYID_RE = /^ed25519:[0-9a-f]{64}$/
const PUBLISHER_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9][a-z0-9-]*(?:[./][a-z0-9][a-z0-9._-]*)*$/
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function record(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, keys) {
  return record(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
}

function unknownKeys(value, allowed) {
  if (!record(value)) return []
  return Object.keys(value).filter((key) => !allowed.includes(key))
}

function validDateTime(value) {
  return typeof value === 'string' && RFC3339_RE.test(value) && !Number.isNaN(Date.parse(value))
}

/** Validate the registry's recorded namespace-verification evidence shape. */
export function namespaceProofIssues(proof, { publisherId = null, now = null } = {}) {
  if (!record(proof)) return ['namespace proof must be an object']
  const bindingIssues = []
  if (validDateTime(proof.verifiedAt) && validDateTime(now) && Date.parse(proof.verifiedAt) > Date.parse(now)) {
    bindingIssues.push('namespace proof verifiedAt is in the future')
  }
  const githubOwner = typeof publisherId === 'string'
    ? publisherId.match(/^io\.github\.([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:[./]|$)/)?.[1]
    : null
  if (githubOwner && proof.method !== 'github-oidc') {
    bindingIssues.push('io.github publisher namespace requires a github-oidc proof')
  } else if (publisherId && !githubOwner && proof.method !== 'dns-txt') {
    bindingIssues.push('non-GitHub publisher namespace requires a dns-txt proof')
  }
  if (proof.method === 'dns-txt') {
    const issues = exactKeys(proof, ['method', 'txtRecord', 'verifiedAt'])
      ? []
      : ['dns-txt namespace proof must contain exactly method, txtRecord, and verifiedAt']
    if (typeof proof.txtRecord !== 'string' || !proof.txtRecord.startsWith('_acx-challenge.')) {
      issues.push('dns-txt namespace proof needs an _acx-challenge TXT record')
    }
    if (publisherId && !githubOwner && typeof proof.txtRecord === 'string') {
      const publisherRoot = publisherId.split('/')[0]
      const expectedRecord = `_acx-challenge.${publisherRoot.split('.').reverse().join('.')}`
      if (proof.txtRecord !== expectedRecord) issues.push(`dns-txt record does not bind publisher namespace ${publisherRoot}`)
    }
    if (!validDateTime(proof.verifiedAt)) issues.push('namespace proof verifiedAt must be RFC 3339')
    return [...issues, ...bindingIssues]
  }
  if (proof.method === 'github-oidc') {
    const issues = exactKeys(proof, ['method', 'oidcSubject', 'oidcIssuer', 'verifiedAt'])
      ? []
      : ['github-oidc namespace proof must contain exactly method, oidcSubject, oidcIssuer, and verifiedAt']
    if (typeof proof.oidcSubject !== 'string' || !proof.oidcSubject.startsWith('repo:')) {
      issues.push('github-oidc namespace proof needs a repository subject')
    }
    if (githubOwner && typeof proof.oidcSubject === 'string' && !proof.oidcSubject.startsWith(`repo:${githubOwner}/`)) {
      issues.push(`github-oidc subject does not bind io.github.${githubOwner}`)
    }
    if (proof.oidcIssuer !== 'https://token.actions.githubusercontent.com') {
      issues.push('github-oidc namespace proof has an unexpected issuer')
    }
    if (!validDateTime(proof.verifiedAt)) issues.push('namespace proof verifiedAt must be RFC 3339')
    return [...issues, ...bindingIssues]
  }
  return ['namespace proof method must be dns-txt or github-oidc', ...bindingIssues]
}

/**
 * Return every reason a registry entry is ineligible for `trusted`.
 * Signature verification remains valid and therefore degrades to `portable`.
 */
export function trustedRegistryEntryIssues(entry, { publisherId, signedAt, now = new Date().toISOString() } = {}) {
  if (!record(entry)) return ['trust registry entry must be an object']
  const issues = []
  const extras = unknownKeys(entry, [
    'keyid', 'publisherId', 'algorithm', 'publicKeyPem', 'status',
    'notBefore', 'notAfter', 'rotatedFrom', 'rotatedTo',
    'revokedAt', 'revocationReason', 'namespaceProof',
  ])
  if (extras.length) issues.push(`trust registry entry contains unknown field ${extras[0]}`)
  if (entry.status !== 'active') issues.push(`signer key status is ${entry.status ?? 'missing'}, not active`)
  if (entry.algorithm !== 'ed25519') issues.push('signer algorithm is not ed25519')
  if (publisherId != null && entry.publisherId !== publisherId) issues.push('registry publisherId does not match signed publisherId')
  if (!validDateTime(entry.notBefore)) issues.push('registry notBefore must be RFC 3339')
  if (!validDateTime(entry.notAfter)) issues.push('registry notAfter must be RFC 3339')
  if (validDateTime(entry.notBefore) && validDateTime(entry.notAfter) && Date.parse(entry.notBefore) > Date.parse(entry.notAfter)) {
    issues.push('registry key validity window is inverted')
  }
  if (signedAt != null && !validDateTime(signedAt)) {
    issues.push('signedAt must be RFC 3339')
  } else if (validDateTime(signedAt)) {
    if (validDateTime(entry.notBefore) && Date.parse(signedAt) < Date.parse(entry.notBefore)) issues.push('artifact signed before key validity window')
    if (validDateTime(entry.notAfter) && Date.parse(signedAt) > Date.parse(entry.notAfter)) issues.push('artifact signed after key validity window')
  }
  if (!validDateTime(now)) {
    issues.push('verification time must be RFC 3339')
  } else if (validDateTime(entry.notAfter) && Date.parse(now) > Date.parse(entry.notAfter)) {
    issues.push('signer key expired')
  }
  issues.push(...namespaceProofIssues(entry.namespaceProof, { publisherId, now }))
  return [...new Set(issues)]
}

/**
 * Load a public-keys-only trust registry.
 * Shape: { schemaVersion, keys: [{ keyid, publisherId, algorithm, publicKeyPem,
 *   status, notBefore, notAfter, namespaceProof, revokedAt, revocationReason }] }
 */
export function loadTrustRegistry(path) {
  const reg = JSON.parse(readFileSync(path, 'utf8'))
  // Guard: a trust registry MUST NOT contain private key material (SPEC §4.4).
  const asText = JSON.stringify(reg)
  if (/PRIVATE KEY/.test(asText)) throw new Error('trust registry contains private key material — refusing to load')
  if (!record(reg) || reg.schemaVersion !== TRUST_REGISTRY_SCHEMA_VERSION || !Array.isArray(reg.keys)) {
    throw new Error(`trust registry must be a ${TRUST_REGISTRY_SCHEMA_VERSION} object with a keys array`)
  }
  const registryUnknown = unknownKeys(reg, ['schemaVersion', 'registryId', 'updatedAt', 'keys'])
  if (registryUnknown.length) throw new Error(`trust registry contains unknown field ${registryUnknown[0]}`)
  if (reg.registryId != null && typeof reg.registryId !== 'string') throw new Error('trust registry registryId must be a string')
  if (reg.updatedAt != null && !validDateTime(reg.updatedAt)) throw new Error('trust registry updatedAt must be RFC 3339')
  const byKeyId = new Map()
  for (const [index, k] of reg.keys.entries()) {
    if (!record(k)) throw new Error(`trust registry key[${index}] must be an object`)
    const keyUnknown = unknownKeys(k, [
      'keyid', 'publisherId', 'algorithm', 'publicKeyPem', 'status',
      'notBefore', 'notAfter', 'rotatedFrom', 'rotatedTo',
      'revokedAt', 'revocationReason', 'namespaceProof',
    ])
    if (keyUnknown.length) throw new Error(`trust registry key[${index}] contains unknown field ${keyUnknown[0]}`)
    if (!KEYID_RE.test(k.keyid || '')) throw new Error(`trust registry key[${index}].keyid is invalid`)
    if (byKeyId.has(k.keyid)) throw new Error(`trust registry contains duplicate keyid ${k.keyid}`)
    if (!PUBLISHER_RE.test(k.publisherId || '')) throw new Error(`trust registry key[${index}].publisherId is invalid`)
    if (!['active', 'revoked', 'expired'].includes(k.status)) throw new Error(`trust registry key[${index}].status is invalid`)
    if (k.algorithm !== 'ed25519') throw new Error(`trust registry key[${index}].algorithm must be ed25519`)
    if (!validDateTime(k.notBefore) || !validDateTime(k.notAfter)) throw new Error(`trust registry key[${index}] needs RFC 3339 notBefore and notAfter`)
    if (k.rotatedFrom != null && typeof k.rotatedFrom !== 'string') throw new Error(`trust registry key[${index}].rotatedFrom must be a string or null`)
    if (k.rotatedTo != null && typeof k.rotatedTo !== 'string') throw new Error(`trust registry key[${index}].rotatedTo must be a string or null`)
    if (k.revokedAt != null && !validDateTime(k.revokedAt)) throw new Error(`trust registry key[${index}].revokedAt must be RFC 3339 or null`)
    if (k.revocationReason != null && !['key-compromise', 'superseded', 'retired'].includes(k.revocationReason)) {
      throw new Error(`trust registry key[${index}].revocationReason is invalid`)
    }
    if (namespaceProofIssues(k.namespaceProof, { publisherId: k.publisherId, now: new Date().toISOString() }).length) {
      throw new Error(`trust registry key[${index}] has an invalid namespace proof`)
    }
    let inlineKeyId
    try {
      inlineKeyId = keyIdFromPem(k.publicKeyPem)
    } catch (error) {
      throw new Error(`trust registry key[${index}].publicKeyPem is invalid: ${error.message}`)
    }
    if (inlineKeyId !== k.keyid) throw new Error(`trust registry key[${index}].publicKeyPem does not match keyid`)
    byKeyId.set(k.keyid, k)
  }
  return { raw: reg, byKeyId }
}

export function emptyTrustRegistry() {
  return { raw: { schemaVersion: TRUST_REGISTRY_SCHEMA_VERSION, keys: [] }, byKeyId: new Map() }
}

/**
 * Evaluate the trust taxonomy in the SPEC §4.5 order:
 * tampered -> legacy -> portable -> trusted -> local.
 * @returns {import('../schemas').AgentPackageVerification-like}
 */
export function evaluateTrust(cartridge, { registry = emptyTrustRegistry(), localKeyId = null, now = null } = {}) {
  const nowTs = now ?? new Date().toISOString()
  const sigRow = cartridge.db.prepare("SELECT * FROM signatures WHERE target='rom-manifest' ORDER BY created_at DESC").get()
  const romManifest = buildRomManifest(cartridge)

  const base = { signerInstanceId: null, signerInstanceLabel: null, keyId: null, signedAt: null }

  if (!sigRow) {
    return { status: 'warning', trust: 'legacy', summary: 'Unsigned cartridge (no DSSE envelope).', ...base, issues: ['Missing rom-manifest signature'] }
  }

  const envelope = JSON.parse(sigRow.envelope)
  const keyid = envelope.signatures?.[0]?.keyid ?? sigRow.keyid
  const registryEntry = registry.byKeyId.get(keyid)

  // 0. tampered — any ROM object whose live content diverges from its registered
  //    address (SPEC §3.3). This catches content edits that leave objects.oid stale.
  if (romManifest.mismatches.length) {
    return { status: 'invalid', trust: 'tampered', summary: 'ROM content diverges from signed manifest (object hash mismatch).', ...base, keyId: keyid, issues: romManifest.mismatches.map((m) => `${m.sourceRef}: ${m.reason}`) }
  }

  // 1. Obtain the verification key (registry preferred; column for self-contained verify).
  const pubPem = registryEntry?.publicKeyPem ?? sigRow.public_key_pem ?? null
  let verified = { ok: false, reason: 'no public key available' }
  if (pubPem) verified = verifyEnvelope(envelope, pubPem)

  if (!verified.ok && pubPem) {
    return { status: 'invalid', trust: 'tampered', summary: 'DSSE verification failed.', ...base, keyId: keyid, issues: [verified.reason] }
  }
  if (!verified.ok && !pubPem) {
    // No key available: we MUST NOT claim the signature is valid (SPEC §4.5 intent).
    return { status: 'warning', trust: 'portable', summary: 'Signature present but UNVERIFIED (no public key available).', ...base, keyId: keyid, issues: ['no public key to verify signature'] }
  }
  const statement = verified.statement
  const subjectDigest = statement?.subject?.[0]?.digest?.sha256
  if (subjectDigest && subjectDigest !== romManifest.manifestHashHex) {
    return { status: 'invalid', trust: 'tampered', summary: 'ROM manifest hash mismatch (content changed after signing).', ...base, keyId: keyid, issues: [`subject.digest ${subjectDigest} != recomputed ${romManifest.manifestHashHex}`] }
  }
  if (sigRow.manifest_hash !== romManifest.manifestHash) {
    return { status: 'invalid', trust: 'tampered', summary: 'Recorded manifest hash differs from recomputed ROM.', ...base, keyId: keyid, issues: [`recorded ${sigRow.manifest_hash} != recomputed ${romManifest.manifestHash}`] }
  }

  const signedAt = statement?.predicate?.signedAt ?? sigRow.created_at
  const publisherId = statement?.predicate?.publisherId ?? null
  const sig = { ...base, signerInstanceLabel: publisherId, keyId: keyid, signedAt }

  // 2. legacy handled above (no sig). 3/4/5:
  if (!registryEntry) {
    return { status: 'warning', trust: 'portable', summary: 'Signature valid but signer not in trust registry.', ...sig, issues: ['Signer keyid not in trust registry'] }
  }
  // key lifecycle checks (§4.4)
  if (registryEntry.status === 'revoked') {
    if (registryEntry.revocationReason === 'key-compromise') {
      return { status: 'invalid', trust: 'tampered', summary: 'Signer key is compromised (revoked).', ...sig, issues: ['key-compromise revocation'] }
    }
    if (registryEntry.revokedAt && signedAt && signedAt < registryEntry.revokedAt) {
      // signed before revocation for a non-compromise reason -> downgrade to portable
      return { status: 'warning', trust: 'portable', summary: 'Signer key later revoked (non-compromise); signed before revocation.', ...sig, issues: ['key revoked after signing'] }
    }
    return { status: 'warning', trust: 'portable', summary: 'Signer key revoked.', ...sig, issues: ['key revoked'] }
  }
  const eligibilityIssues = trustedRegistryEntryIssues(registryEntry, { publisherId, signedAt, now: nowTs })
  if (eligibilityIssues.length) {
    return { status: 'warning', trust: 'portable', summary: 'Signer registry entry is not eligible for trusted status.', ...sig, issues: eligibilityIssues }
  }

  if (localKeyId && keyid === localKeyId) {
    return { status: 'verified', trust: 'local', summary: 'Signed by this instance.', ...sig, issues: [] }
  }
  return { status: 'verified', trust: 'trusted', summary: `Signed by trusted publisher ${publisherId ?? registryEntry.publisherId}.`, ...sig, issues: [] }
}

function extractInlinePem(sigRow) {
  // Reference impl convenience: allow an inline public key alongside the envelope
  // for self-contained verification demos (a real deployment uses the registry).
  try {
    const env = JSON.parse(sigRow.envelope)
    return env._acxInlinePublicKeyPem ?? null
  } catch {
    return null
  }
}

export { keyIdFromPem }
