// ROM integrity manifest + DSSE/in-toto signing (SPEC §3.3, §4).
import { generateKeyPairSync, sign as edSign, verify as edVerify, createPublicKey, createHash } from 'node:crypto'
import { jcs, sha256Hex, oidRaw } from './canonical.mjs'
import { SPEC_VERSION } from './container.mjs'

/**
 * Recompute an object's content address from its LIVE source per `canon`
 * (SPEC §3.3). This is the security-critical step: the signed manifest binds to
 * actual bytes, not to the self-declared objects.oid column. Returns null if the
 * source is missing.
 */
export function liveOid(cartridge, obj) {
  const { source_ref, canon } = obj
  if (source_ref.startsWith('memory:')) {
    const row = cartridge.db.prepare('SELECT payload FROM memory WHERE id=?').get(source_ref.slice('memory:'.length))
    return row ? 'sha256:' + sha256Hex(Buffer.from(row.payload, 'utf8')) : null
  }
  if (source_ref.startsWith('capability:')) {
    const row = cartridge.db.prepare('SELECT json FROM capabilities WHERE id=?').get(source_ref.slice('capability:'.length))
    return row ? 'sha256:' + sha256Hex(Buffer.from(row.json, 'utf8')) : null
  }
  if (source_ref.startsWith('cartridge:')) {
    const key = source_ref.slice('cartridge:'.length)
    const value = cartridge.getMeta(key)
    return value == null ? null : 'sha256:' + sha256Hex(Buffer.from(jcs({ key, value }), 'utf8'))
  }
  // sqlar file: hash the UNCOMPRESSED bytes (canon='raw')
  const bytes = cartridge.getFile(source_ref)
  return bytes == null ? null : oidRaw(bytes)
}

export const PAYLOAD_TYPE = 'application/vnd.in-toto+json'
export const PREDICATE_TYPE = 'https://acx.dev/attestation/cartridge/v1'
export const IN_TOTO_STATEMENT_TYPE = 'https://in-toto.io/Statement/v1'

/**
 * Build the ROM integrity manifest and its hash (SPEC §3.3).
 * Sort ROM objects ascending by (kind, source_ref) under Unicode code-point
 * order; emit [{sourceRef, oid, canon, sz}]; JCS-canonicalize; hash.
 * @returns {{ list: object[], canonical: string, manifestHashHex: string, manifestHash: string }}
 */
export function buildRomManifest(cartridge, { strict = true } = {}) {
  const rows = cartridge.romObjects().slice().sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1
    return a.source_ref < b.source_ref ? -1 : a.source_ref > b.source_ref ? 1 : 0
  })
  const mismatches = []
  const list = rows.map((r) => {
    // SPEC §3.3: the manifest MUST reflect the live content address, never the
    // self-declared objects.oid. Recompute from source; a divergence means the
    // content was mutated after the object was registered.
    const computed = liveOid(cartridge, r)
    if (computed == null) mismatches.push({ sourceRef: r.source_ref, reason: 'missing source' })
    else if (computed !== r.oid) mismatches.push({ sourceRef: r.source_ref, reason: 'oid mismatch', stored: r.oid, computed })
    return { sourceRef: r.source_ref, oid: computed ?? r.oid, canon: r.canon, sz: r.sz }
  })
  const canonical = jcs(list)
  const manifestHashHex = sha256Hex(Buffer.from(canonical, 'utf8'))
  return { list, canonical, manifestHashHex, manifestHash: 'sha256:' + manifestHashHex, mismatches }
}

/** keyid = "ed25519:"+lowercasehex(sha256(DER SubjectPublicKeyInfo)) (SPEC §4.2). */
export function keyIdFromPublicKey(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' })
  return 'ed25519:' + sha256Hex(der)
}

export function generateSigningKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKey,
    privateKey,
    keyid: keyIdFromPublicKey(publicKey),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}

/** in-toto Statement v1 whose subject digest is the ROM manifest hash. */
export function buildStatement({ manifestHashHex, publisherId, embeddingEngine, signedAt, cartridgeId, checksumHash, fileCount, provenanceInstanceId }) {
  return {
    _type: IN_TOTO_STATEMENT_TYPE,
    subject: [{ name: cartridgeId, digest: { sha256: manifestHashHex } }],
    predicateType: PREDICATE_TYPE,
    predicate: {
      acxSchemaVersion: SPEC_VERSION,
      publisherId,
      romDigest: 'sha256:' + manifestHashHex,
      manifestHash: 'sha256:' + manifestHashHex,
      checksumHash: checksumHash ?? null,
      fileCount: fileCount ?? null,
      embeddingEngine,
      signedAt,
      provenanceInstanceId: provenanceInstanceId ?? null,
    },
  }
}

// DSSE Pre-Authentication Encoding (SPEC §4.2, DSSE spec).
// PAE = "DSSEv1" SP LEN(pt) SP pt SP LEN(payload) SP payload
export function pae(payloadType, payloadBytes) {
  const pt = Buffer.from(payloadType, 'utf8')
  return Buffer.concat([
    Buffer.from('DSSEv1 ', 'ascii'),
    Buffer.from(String(pt.length) + ' ', 'ascii'),
    pt,
    Buffer.from(' ' + String(payloadBytes.length) + ' ', 'ascii'),
    payloadBytes,
  ])
}

/** Sign a Statement, returning a DSSE envelope JSON object. */
export function signEnvelope(statement, { privateKey, keyid }) {
  const payloadBytes = Buffer.from(jcs(statement), 'utf8')
  const preauth = pae(PAYLOAD_TYPE, payloadBytes)
  const sig = edSign(null, preauth, privateKey)
  return {
    payloadType: PAYLOAD_TYPE,
    payload: payloadBytes.toString('base64'),
    signatures: [{ keyid, sig: sig.toString('base64') }],
  }
}

/**
 * Verify a DSSE envelope against a public key (PEM or KeyObject).
 * Returns { ok, statement, reason }.
 */
export function verifyEnvelope(envelope, publicKeyPemOrObj) {
  try {
    if (envelope.payloadType !== PAYLOAD_TYPE) return { ok: false, reason: `unexpected payloadType ${envelope.payloadType}` }
    const payloadBytes = Buffer.from(envelope.payload, 'base64')
    const preauth = pae(envelope.payloadType, payloadBytes)
    const pub = typeof publicKeyPemOrObj === 'string' ? createPublicKey(publicKeyPemOrObj) : publicKeyPemOrObj
    const sig = envelope.signatures && envelope.signatures[0]
    if (!sig) return { ok: false, reason: 'no signature' }
    const ok = edVerify(null, preauth, pub, Buffer.from(sig.sig, 'base64'))
    if (!ok) return { ok: false, reason: 'DSSE signature verification failed' }
    const statement = JSON.parse(payloadBytes.toString('utf8'))
    return { ok: true, statement }
  } catch (e) {
    return { ok: false, reason: `envelope error: ${e.message}` }
  }
}

/** keyid for a PEM public key, for trust-registry lookup. */
export function keyIdFromPem(pem) {
  const pub = createPublicKey(pem)
  return keyIdFromPublicKey(pub)
}
