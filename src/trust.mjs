// Trust registry (public keys only) + taxonomy evaluation (SPEC §4.4, §4.5).
import { readFileSync } from 'node:fs'
import { keyIdFromPem, verifyEnvelope, buildRomManifest } from './sign.mjs'

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
  const byKeyId = new Map()
  for (const k of reg.keys ?? []) byKeyId.set(k.keyid, k)
  return { raw: reg, byKeyId }
}

export function emptyTrustRegistry() {
  return { raw: { schemaVersion: 'acx.trust-registry/1', keys: [] }, byKeyId: new Map() }
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
  if (registryEntry.notAfter && nowTs > registryEntry.notAfter) {
    return { status: 'warning', trust: 'portable', summary: 'Signer key expired.', ...sig, issues: ['key expired'] }
  }
  if (registryEntry.notBefore && signedAt && signedAt < registryEntry.notBefore) {
    return { status: 'warning', trust: 'portable', summary: 'Signed before key validity window.', ...sig, issues: ['signed before notBefore'] }
  }
  if (!registryEntry.namespaceProof) {
    return { status: 'warning', trust: 'portable', summary: 'Signer namespace not proven.', ...sig, issues: ['namespace proof missing'] }
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
