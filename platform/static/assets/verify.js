/*
 * Browser-side verification for portable ACX JSON artifacts.
 *
 * This module intentionally verifies only the cryptographic facts carried by a
 * workflow or Agent Graph: RFC 8785/JCS digest, Ed25519 key identity, DSSE
 * signature, and in-toto field bindings. An inline public key cannot prove that
 * its holder controls the claimed publisher namespace. Namespace trust requires
 * an ACX trust registry or another out-of-band proof.
 *
 * SQLite-based .acx cartridges are deliberately not parsed in the browser.
 * Verify those with the zero-dependency CLI: `acx verify FILE.acx`.
 */

const TEXT_ENCODER = new TextEncoder()
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true })

const PAYLOAD_TYPE = 'application/vnd.in-toto+json'
const STATEMENT_TYPE = 'https://in-toto.io/Statement/v1'
const WORKFLOW_SCHEMA = 'acx.cal/1'
const WORKFLOW_INTEGRITY_SCHEMA = 'acx.workflow-signature/1'
const WORKFLOW_PREDICATE = 'https://acx.dev/attestation/workflow/v1'
const GRAPH_SCHEMA = 'acx.agent-graph/1'
const GRAPH_INTEGRITY_SCHEMA = 'acx.agent-graph-signature/1'
const GRAPH_PREDICATE = 'https://acx.dev/attestation/agent-graph/v1'

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/
const KEYID_RE = /^ed25519:[0-9a-f]{64}$/
const PUBLISHER_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9][a-z0-9-]*(?:[./][a-z0-9][a-z0-9._-]*)*$/
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, keys) {
  if (!record(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function serializeJcs(value) {
  if (value === null) return 'null'
  const type = typeof value
  if (type === 'boolean') return value ? 'true' : 'false'
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS does not allow non-finite numbers')
    return JSON.stringify(value)
  }
  if (type === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(serializeJcs).join(',')}]`
  if (type === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeJcs(value[key])}`)
      .join(',')}}`
  }
  throw new TypeError(`JCS does not support ${type}`)
}

/** RFC 8785 JSON Canonicalization Scheme for JSON-compatible values. */
export function jcs(value) {
  return serializeJcs(value)
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function cryptoApi() {
  if (!globalThis.crypto?.subtle) throw new Error('WebCrypto is unavailable in this browser')
  return globalThis.crypto
}

/** Lowercase SHA-256 hex for a string or Uint8Array. */
export async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? TEXT_ENCODER.encode(value) : value
  if (!(bytes instanceof Uint8Array)) throw new TypeError('sha256Hex expects a string or Uint8Array')
  return bytesToHex(new Uint8Array(await cryptoApi().subtle.digest('SHA-256', bytes)))
}

function decodeBase64(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${label} is not canonical base64`)
  }
  let binary
  try {
    binary = globalThis.atob(value)
  } catch {
    throw new Error(`${label} is not valid base64`)
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function pemToSpki(pem) {
  if (typeof pem !== 'string') throw new Error('publicKeyPem must be a PEM string')
  const match = pem.match(/^-----BEGIN PUBLIC KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END PUBLIC KEY-----\r?\n?$/)
  if (!match) throw new Error('publicKeyPem must contain one SPKI PUBLIC KEY')
  return decodeBase64(match[1].replace(/[\r\n]/g, ''), 'publicKeyPem')
}

function concatBytes(...arrays) {
  const length = arrays.reduce((sum, bytes) => sum + bytes.length, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const bytes of arrays) {
    output.set(bytes, offset)
    offset += bytes.length
  }
  return output
}

/** DSSE Pre-Authentication Encoding. */
export function pae(payloadType, payloadBytes) {
  const typeBytes = TEXT_ENCODER.encode(payloadType)
  return concatBytes(
    TEXT_ENCODER.encode(`DSSEv1 ${typeBytes.length} `),
    typeBytes,
    TEXT_ENCODER.encode(` ${payloadBytes.length} `),
    payloadBytes,
  )
}

function unsignedDocument(document) {
  if (!record(document)) throw new Error('artifact must be a JSON object')
  const output = {}
  for (const [key, value] of Object.entries(document)) {
    if (key !== 'integrity') output[key] = value
  }
  return output
}

function artifactProfile(document) {
  if (document?.schemaVersion === WORKFLOW_SCHEMA) {
    return {
      type: 'workflow',
      integritySchema: WORKFLOW_INTEGRITY_SCHEMA,
      predicateType: WORKFLOW_PREDICATE,
      subjectName: `urn:acx:workflow:${document.id}@${document.version || 'unversioned'}`,
      bindingFields: {
        acxSchemaVersion: document.schemaVersion,
        workflowId: document.id,
        workflowVersion: document.version ?? null,
        publisherId: document.integrity?.publisherId,
        workflowDigest: document.integrity?.digest,
        signedAt: document.integrity?.signedAt,
        participants: document.participants?.length ?? 0,
        nodes: document.nodes?.length ?? 0,
      },
    }
  }
  if (document?.schemaVersion === GRAPH_SCHEMA) {
    return {
      type: 'agent-graph',
      integritySchema: GRAPH_INTEGRITY_SCHEMA,
      predicateType: GRAPH_PREDICATE,
      subjectName: `urn:acx:agent-graph:${document.id}@${document.version || 'unversioned'}`,
      bindingFields: {
        acxSchemaVersion: document.schemaVersion,
        agentGraphId: document.id,
        agentGraphVersion: document.version ?? null,
        publisherId: document.integrity?.publisherId,
        agentGraphDigest: document.integrity?.digest,
        signedAt: document.integrity?.signedAt,
        actors: document.actors?.length ?? 0,
        knowledgeModules: document.knowledge?.length ?? 0,
        routes: document.routes?.length ?? 0,
        loops: document.loops?.length ?? 0,
        convergencePoints: document.convergence?.length ?? 0,
      },
    }
  }
  throw new Error(`unsupported JSON artifact schemaVersion: ${String(document?.schemaVersion ?? 'missing')}`)
}

function verificationResult(overrides = {}) {
  return {
    ok: false,
    signed: false,
    status: 'invalid',
    trust: 'tampered',
    publisherNamespaceTrusted: false,
    type: null,
    digest: null,
    publisherId: null,
    keyid: null,
    issues: [],
    ...overrides,
  }
}

function bindingIssues(statement, profile, digestHex) {
  const issues = []
  if (!record(statement)) return ['DSSE payload is not a JSON object']
  if (statement._type !== STATEMENT_TYPE) issues.push('in-toto statement type does not match')
  if (statement.predicateType !== profile.predicateType) issues.push('in-toto predicate type does not match')
  if (!Array.isArray(statement.subject) || statement.subject.length !== 1) {
    issues.push('in-toto Statement must contain exactly one subject')
  } else {
    if (statement.subject[0]?.name !== profile.subjectName) issues.push('in-toto subject name does not match')
    if (statement.subject[0]?.digest?.sha256 !== digestHex) issues.push('in-toto subject digest does not match')
  }
  if (!record(statement.predicate)) {
    issues.push('in-toto predicate must be an object')
    return issues
  }
  for (const [key, expected] of Object.entries(profile.bindingFields)) {
    if (statement.predicate[key] !== expected) issues.push(`in-toto ${key} binding does not match`)
  }
  return issues
}

/**
 * Verify a signed ACX workflow or Agent Graph with the inline Ed25519 key.
 *
 * A successful result is `trust: "portable"`, never `trust: "trusted"`.
 * The browser has authenticated bytes to a key, but has not established that
 * the key controls `publisherId`.
 */
export async function verifyArtifact(document) {
  let profile
  let canonical
  let digestHex
  try {
    profile = artifactProfile(document)
    canonical = jcs(unsignedDocument(document))
    digestHex = await sha256Hex(canonical)
  } catch (error) {
    return verificationResult({ issues: [error.message] })
  }

  const digest = `sha256:${digestHex}`
  const integrity = document.integrity
  const base = {
    type: profile.type,
    digest,
    publisherId: integrity?.publisherId ?? null,
    keyid: integrity?.keyid ?? null,
  }
  if (!integrity) {
    return verificationResult({
      ...base,
      ok: true,
      status: 'warning',
      trust: 'unsigned',
      issues: ['Artifact has no integrity signature.'],
    })
  }
  const signedBase = { ...base, signed: true }

  if (!exactKeys(integrity, [
    'schemaVersion', 'digest', 'publisherId', 'keyid', 'publicKeyPem', 'signedAt', 'envelope',
  ])) {
    return verificationResult({ ...signedBase, issues: ['integrity contains missing or unknown fields'] })
  }
  if (integrity.schemaVersion !== profile.integritySchema) {
    return verificationResult({ ...signedBase, issues: ['integrity schemaVersion does not match the artifact type'] })
  }
  if (!DIGEST_RE.test(integrity.digest || '') || integrity.digest !== digest) {
    return verificationResult({ ...signedBase, issues: [`digest mismatch: computed ${digest}`] })
  }
  if (!PUBLISHER_RE.test(integrity.publisherId || '')) {
    return verificationResult({ ...signedBase, issues: ['publisherId is not a valid reverse-DNS identifier'] })
  }
  if (!KEYID_RE.test(integrity.keyid || '')) {
    return verificationResult({ ...signedBase, issues: ['keyid is not a valid Ed25519 key identifier'] })
  }
  if (!RFC3339_RE.test(integrity.signedAt || '') || Number.isNaN(Date.parse(integrity.signedAt))) {
    return verificationResult({ ...signedBase, issues: ['signedAt is not an RFC 3339 date-time'] })
  }

  const envelope = integrity.envelope
  if (!exactKeys(envelope, ['payloadType', 'payload', 'signatures'])
      || envelope.payloadType !== PAYLOAD_TYPE
      || !Array.isArray(envelope.signatures)
      || envelope.signatures.length !== 1
      || !exactKeys(envelope.signatures[0], ['keyid', 'sig'])) {
    return verificationResult({ ...signedBase, issues: ['DSSE envelope shape is invalid'] })
  }
  if (envelope.signatures[0].keyid !== integrity.keyid) {
    return verificationResult({ ...signedBase, issues: ['DSSE signature keyid does not match integrity.keyid'] })
  }

  try {
    const spki = pemToSpki(integrity.publicKeyPem)
    const computedKeyId = `ed25519:${await sha256Hex(spki)}`
    if (computedKeyId !== integrity.keyid) {
      return verificationResult({ ...signedBase, issues: ['inline public key does not match integrity.keyid'] })
    }
    const payloadBytes = decodeBase64(envelope.payload, 'DSSE payload')
    const signatureBytes = decodeBase64(envelope.signatures[0].sig, 'DSSE signature')
    const publicKey = await cryptoApi().subtle.importKey(
      'spki',
      spki,
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    const signatureValid = await cryptoApi().subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      signatureBytes,
      pae(envelope.payloadType, payloadBytes),
    )
    if (!signatureValid) {
      return verificationResult({ ...signedBase, issues: ['DSSE Ed25519 signature verification failed'] })
    }
    const statement = JSON.parse(TEXT_DECODER.decode(payloadBytes))
    const issues = bindingIssues(statement, profile, digestHex)
    if (issues.length) return verificationResult({ ...signedBase, issues })
  } catch (error) {
    return verificationResult({ ...signedBase, issues: [`verification failed: ${error.message}`] })
  }

  return verificationResult({
    ...signedBase,
    ok: true,
    status: 'verified',
    trust: 'portable',
    issues: [
      'Signature and bindings are valid for the inline key. Publisher namespace ownership is not proven in this browser.',
    ],
  })
}

/**
 * Bind a successful portable verification to the exact registry card the user
 * selected. Signature validity alone is insufficient: a different, validly
 * signed artifact must never be presented as the selected coordinate.
 */
export function registryCoordinateIssues(document, result, expected) {
  if (!record(expected)) return ['selected registry coordinate is missing']
  const issues = []
  if (!['workflow', 'agent-graph'].includes(expected.type)) {
    issues.push(`selected registry artifact type '${String(expected.type)}' is not browser-verifiable`)
  }
  if (result?.type !== expected.type) {
    issues.push(`artifact type mismatch: selected ${expected.type}, received ${String(result?.type)}`)
  }
  if (document?.id !== expected.id) {
    issues.push(`artifact id mismatch: selected ${expected.id}, received ${String(document?.id)}`)
  }
  if ((document?.version ?? null) !== (expected.version ?? null)) {
    issues.push(`artifact version mismatch: selected ${String(expected.version)}, received ${String(document?.version)}`)
  }
  if (result?.publisherId !== expected.publisher) {
    issues.push(`publisher mismatch: selected ${expected.publisher}, received ${String(result?.publisherId)}`)
  }
  if (!DIGEST_RE.test(expected.digest || '')) {
    issues.push('selected registry coordinate has no canonical sha256 digest')
  } else if (result?.digest !== expected.digest) {
    issues.push(`digest mismatch: selected ${expected.digest}, received ${String(result?.digest)}`)
  }
  return issues
}
