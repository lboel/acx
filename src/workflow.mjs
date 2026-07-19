// Shareable ACX workflows: canonical digest + DSSE/in-toto signing.
// The top-level `integrity` block is excluded from canonicalization, exactly as
// an A2A AgentCard excludes its signatures field. The remaining CAL document is
// RFC 8785/JCS canonicalized and addressed by sha256.
import { jcs, sha256Hex } from './canonical.mjs'
import { keyIdFromPem, signEnvelope, verifyEnvelope } from './sign.mjs'
import { emptyTrustRegistry, trustedRegistryEntryIssues } from './trust.mjs'

export const WORKFLOW_SCHEMA_VERSION = 'acx.cal/1'
export const WORKFLOW_SIGNATURE_VERSION = 'acx.workflow-signature/1'
export const WORKFLOW_PREDICATE_TYPE = 'https://acx.dev/attestation/workflow/v1'
export const WORKFLOW_MEDIA_TYPE = 'application/vnd.acx.workflow.v1+json'

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/
const KEYID_RE = /^ed25519:[0-9a-f]{64}$/
const PUBLISHER_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9][a-z0-9-]*(?:[./][a-z0-9][a-z0-9._-]*)*$/
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function exactKeys(value, keys) {
  return value != null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
}

export function unsignedWorkflow(cal) {
  if (!cal || typeof cal !== 'object' || Array.isArray(cal)) throw new Error('workflow must be a JSON object')
  const { integrity: _integrity, ...document } = cal
  return document
}

export function workflowDigest(cal) {
  const canonical = jcs(unsignedWorkflow(cal))
  const digestHex = sha256Hex(Buffer.from(canonical, 'utf8'))
  return { canonical, digestHex, digest: 'sha256:' + digestHex }
}

function workflowSubject(cal) {
  return `urn:acx:workflow:${cal.id}@${cal.version || 'unversioned'}`
}

export function buildWorkflowStatement(cal, { publisherId, signedAt }) {
  const { digestHex, digest } = workflowDigest(cal)
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: workflowSubject(cal), digest: { sha256: digestHex } }],
    predicateType: WORKFLOW_PREDICATE_TYPE,
    predicate: {
      acxSchemaVersion: cal.schemaVersion,
      workflowId: cal.id,
      workflowVersion: cal.version ?? null,
      publisherId,
      workflowDigest: digest,
      signedAt,
      participants: cal.participants?.length ?? 0,
      nodes: cal.nodes?.length ?? 0,
    },
  }
}

export function signWorkflow(cal, key, { publisherId, signedAt = new Date().toISOString() } = {}) {
  if (!PUBLISHER_RE.test(publisherId || '')) throw new Error('publisherId must be a reverse-DNS identifier')
  if (!key?.privateKey || !key?.keyid || !key?.publicKeyPem) throw new Error('an Ed25519 signing key is required')
  const document = unsignedWorkflow(cal)
  const { digest } = workflowDigest(document)
  const envelope = signEnvelope(buildWorkflowStatement(document, { publisherId, signedAt }), key)
  return {
    ...document,
    integrity: {
      schemaVersion: WORKFLOW_SIGNATURE_VERSION,
      digest,
      publisherId,
      keyid: key.keyid,
      publicKeyPem: key.publicKeyPem,
      signedAt,
      envelope,
    },
  }
}

function result(overrides = {}) {
  return {
    ok: false,
    signed: false,
    status: 'invalid',
    trust: 'tampered',
    digest: null,
    publisherId: null,
    keyid: null,
    issues: [],
    ...overrides,
  }
}

/** Verify the workflow digest, DSSE signature, in-toto binding, and publisher trust. */
export function verifyWorkflow(cal, { registry = emptyTrustRegistry(), now = new Date().toISOString() } = {}) {
  let actual
  try { actual = workflowDigest(cal) } catch (error) {
    return result({ issues: [error.message] })
  }
  const integrity = cal?.integrity
  if (!integrity) {
    return result({
      ok: true,
      status: 'warning',
      trust: 'unsigned',
      digest: actual.digest,
      issues: ['workflow has no integrity signature'],
    })
  }

  const base = {
    signed: true,
    digest: actual.digest,
    publisherId: integrity.publisherId ?? null,
    keyid: integrity.keyid ?? null,
  }
  if (!exactKeys(integrity, ['schemaVersion', 'digest', 'publisherId', 'keyid', 'publicKeyPem', 'signedAt', 'envelope'])) {
    return result({ ...base, issues: ['integrity must contain exactly the acx.workflow-signature/1 fields'] })
  }
  if (integrity.schemaVersion !== WORKFLOW_SIGNATURE_VERSION) {
    return result({ ...base, issues: [`unexpected integrity schemaVersion ${integrity.schemaVersion}`] })
  }
  if (!PUBLISHER_RE.test(integrity.publisherId || '')) {
    return result({ ...base, issues: ['publisherId must be a reverse-DNS identifier'] })
  }
  if (!KEYID_RE.test(integrity.keyid || '')) {
    return result({ ...base, issues: ['keyid must identify an Ed25519 public key'] })
  }
  if (!RFC3339_RE.test(integrity.signedAt || '') || Number.isNaN(Date.parse(integrity.signedAt))) {
    return result({ ...base, issues: ['signedAt must be an RFC 3339 date-time'] })
  }
  if (!DIGEST_RE.test(integrity.digest || '') || integrity.digest !== actual.digest) {
    return result({ ...base, issues: [`workflow digest mismatch: signed ${integrity.digest || 'missing'}, computed ${actual.digest}`] })
  }
  if (!exactKeys(integrity.envelope, ['payloadType', 'payload', 'signatures'])
      || !Array.isArray(integrity.envelope.signatures)
      || integrity.envelope.signatures.length !== 1
      || !exactKeys(integrity.envelope.signatures[0], ['keyid', 'sig'])) {
    return result({ ...base, issues: ['DSSE envelope must contain exactly payloadType, payload, and one clean signature'] })
  }
  let inlineKeyId
  try { inlineKeyId = keyIdFromPem(integrity.publicKeyPem) } catch (error) {
    return result({ ...base, issues: [`invalid public key: ${error.message}`] })
  }
  const envelopeKeyId = integrity.envelope?.signatures?.[0]?.keyid
  if (inlineKeyId !== integrity.keyid || envelopeKeyId !== integrity.keyid) {
    return result({ ...base, issues: ['keyid does not match the public key and DSSE signature'] })
  }

  const registryEntry = registry.byKeyId.get(integrity.keyid)
  if (registryEntry?.publicKeyPem) {
    let registryKeyId
    try { registryKeyId = keyIdFromPem(registryEntry.publicKeyPem) } catch (error) {
      return result({ ...base, issues: [`invalid registry public key: ${error.message}`] })
    }
    if (registryKeyId !== integrity.keyid) {
      return result({ ...base, issues: ['registry public key does not match the signed keyid'] })
    }
  }
  const publicKeyPem = registryEntry?.publicKeyPem ?? integrity.publicKeyPem
  const verified = verifyEnvelope(integrity.envelope, publicKeyPem)
  if (!verified.ok) return result({ ...base, issues: [verified.reason] })

  const statement = verified.statement
  const expected = {
    statementType: 'https://in-toto.io/Statement/v1',
    subject: actual.digest.slice('sha256:'.length),
    name: workflowSubject(cal),
    predicateType: WORKFLOW_PREDICATE_TYPE,
    acxSchemaVersion: cal.schemaVersion,
    workflowId: cal.id,
    workflowVersion: cal.version ?? null,
    workflowDigest: actual.digest,
    publisherId: integrity.publisherId,
    signedAt: integrity.signedAt,
    participants: cal.participants?.length ?? 0,
    nodes: cal.nodes?.length ?? 0,
  }
  const observed = {
    statementType: statement?._type,
    subject: statement?.subject?.[0]?.digest?.sha256,
    name: statement?.subject?.[0]?.name,
    predicateType: statement?.predicateType,
    acxSchemaVersion: statement?.predicate?.acxSchemaVersion,
    workflowId: statement?.predicate?.workflowId,
    workflowVersion: statement?.predicate?.workflowVersion ?? null,
    workflowDigest: statement?.predicate?.workflowDigest,
    publisherId: statement?.predicate?.publisherId,
    signedAt: statement?.predicate?.signedAt,
    participants: statement?.predicate?.participants,
    nodes: statement?.predicate?.nodes,
  }
  if (!Array.isArray(statement?.subject) || statement.subject.length !== 1) {
    return result({ ...base, issues: ['in-toto Statement must contain exactly one workflow subject'] })
  }
  const bindingIssues = Object.entries(expected)
    .filter(([key, value]) => observed[key] !== value)
    .map(([key, value]) => `${key} binding mismatch: expected ${JSON.stringify(value)}, got ${JSON.stringify(observed[key])}`)
  if (bindingIssues.length) return result({ ...base, issues: bindingIssues })

  if (!registryEntry) {
    return result({ ...base, ok: true, status: 'verified', trust: 'portable', issues: ['signer keyid not in trust registry'] })
  }
  if (registryEntry.publisherId !== integrity.publisherId) {
    return result({ ...base, issues: ['registry publisherId does not match signed publisherId'] })
  }
  if (registryEntry.status === 'revoked' && registryEntry.revocationReason === 'key-compromise') {
    return result({ ...base, issues: ['signer key revoked due to key compromise'] })
  }
  const eligibilityIssues = trustedRegistryEntryIssues(registryEntry, {
    publisherId: integrity.publisherId,
    signedAt: integrity.signedAt,
    now,
  })
  if (eligibilityIssues.length) {
    return result({ ...base, ok: true, status: 'warning', trust: 'portable', issues: eligibilityIssues })
  }
  return result({ ...base, ok: true, status: 'verified', trust: 'trusted', issues: [] })
}

export function workflowCard(cal, verification = verifyWorkflow(cal)) {
  const capabilities = [...new Set((cal.nodes || []).flatMap((node) => node.requires?.capabilities || []))].sort()
  return {
    id: cal.id,
    version: cal.version ?? null,
    name: cal.name || cal.id,
    description: cal.description || '',
    license: cal.license || null,
    tags: cal.tags || [],
    participants: (cal.participants || []).map((participant) => ({
      alias: participant.alias,
      bind: participant.bind,
      role: participant.slot?.role ?? null,
      romDigest: participant.romDigest ?? null,
    })),
    participantCount: cal.participants?.length ?? 0,
    nodeCount: cal.nodes?.length ?? 0,
    capabilities,
    digest: verification.digest,
    signed: verification.signed,
    publisher: verification.publisherId,
    trust: verification.trust,
    status: verification.status,
  }
}
