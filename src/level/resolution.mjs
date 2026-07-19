// Fail-closed resolution of embedded level credentials and capability evidence.
//
// An embedded VC is only a claim until a caller explicitly resolves BOTH the
// issuer verification key and current revocation status. This module is the
// single place where public card/catalog projections turn those claims into
// effective, verified values.
import { verifyLevelCredential } from './credential.mjs'

function record(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function claimFrom(vc) {
  const result = record(vc?.credentialSubject?.result?.[0])
    ? vc.credentialSubject.result[0]
    : null
  return {
    result,
    acxLevel: finiteNumber(result?.['acx:acxLevel']) ? result['acx:acxLevel'] : null,
    careerTier: typeof result?.['acx:careerTier'] === 'string' ? result['acx:careerTier'] : null,
    mu: finiteNumber(result?.['acx:ratingMu']) ? result['acx:ratingMu'] : null,
    sigma: finiteNumber(result?.['acx:ratingSigma']) ? result['acx:ratingSigma'] : null,
    games: Number.isInteger(result?.['acx:gamesPlayed']) ? result['acx:gamesPlayed'] : null,
    benchmark: typeof result?.['acx:benchmarkId'] === 'string' ? result['acx:benchmarkId'] : null,
    romDigest: typeof result?.['acx:cartridgeRomDigest'] === 'string' ? result['acx:cartridgeRomDigest'] : null,
  }
}

function resolverValue(resolver, keys, request) {
  if (typeof resolver === 'function') return resolver(request)
  if (resolver instanceof Map) {
    for (const key of keys) if (key != null && resolver.has(key)) return resolver.get(key)
    return undefined
  }
  if (record(resolver)) {
    for (const key of keys) if (key != null && Object.hasOwn(resolver, key)) return resolver[key]
  }
  return undefined
}

function normalizeIssuerKey(value) {
  if (typeof value === 'string') return { resolved: true, key: value, issuerId: null }
  if (value && typeof value === 'object' && typeof value.type === 'string' && typeof value.export === 'function') {
    return { resolved: true, key: value, issuerId: null }
  }
  if (!record(value) || value.resolved === false) {
    return { resolved: false, reason: value?.reason || 'issuer verification key was not resolved' }
  }
  const key = value.publicKeyPem ?? value.publicKey ?? value.key
  if (!key) return { resolved: false, reason: value.reason || 'issuer verification key was not resolved' }
  return { resolved: true, key, issuerId: value.issuerId ?? null }
}

function normalizeRevocation(value) {
  if (typeof value === 'boolean') return { resolved: true, revoked: value }
  if (!record(value) || value.resolved === false) {
    return { resolved: false, reason: value?.reason || 'credential revocation status was not resolved' }
  }
  if (typeof value.revoked === 'boolean') return { resolved: true, revoked: value.revoked }
  if (value.status === 'good' || value.status === 'active' || value.status === 'valid') {
    return { resolved: true, revoked: false }
  }
  if (value.status === 'revoked') return { resolved: true, revoked: true }
  return { resolved: false, reason: value.reason || 'credential revocation status was not resolved' }
}

function attestationReferences(attestation, vc) {
  return [...new Set([
    attestation?.att_id,
    vc?.id,
    vc?.credentialStatus?.id,
  ].filter((value) => typeof value === 'string' && value.length > 0))]
}

function unresolvedResult({ attestationId = null, vc = null, issues = [] } = {}) {
  const claim = claimFrom(vc)
  return {
    attestationId,
    references: attestationReferences({ att_id: attestationId }, vc),
    credential: vc,
    issuerId: vc?.issuer?.id ?? null,
    verificationMethod: vc?.proof?.verificationMethod ?? null,
    verificationState: 'unresolved',
    proven: false,
    revoked: null,
    boundToRom: false,
    issues,
    ...claim,
  }
}

/**
 * Resolve one embedded LevelCredential.
 *
 * Supported explicit resolver inputs:
 * - `resolveIssuerKey(request)` / `issuerKeyResolver(request)` returning a PEM,
 *   KeyObject, or `{ publicKeyPem }`; or `issuerKeys` as a Map/object keyed by
 *   proof verificationMethod or issuer id.
 * - `resolveRevocation(request)` / `revocationResolver(request)` returning a
 *   boolean or `{ resolved: true, revoked }`; or `revocations` as a Map/object
 *   keyed by credential-status id/list URL.
 *
 * Without both results this function intentionally returns `unresolved`.
 */
export function resolveLevelCredentialEvidence(vc, {
  expectedRomDigest = null,
  attestation = null,
  resolveIssuerKey = null,
  issuerKeyResolver = null,
  issuerKeys = null,
  resolveRevocation = null,
  revocationResolver = null,
  revocations = null,
  sigmaMax = 1.5,
  minGames = 30,
} = {}) {
  const attestationId = attestation?.att_id ?? null
  if (!record(vc)) return unresolvedResult({ attestationId, issues: ['embedded credential is not an object'] })

  const base = unresolvedResult({ attestationId, vc })
  const issuerId = typeof vc.issuer?.id === 'string' ? vc.issuer.id : null
  const verificationMethod = typeof vc.proof?.verificationMethod === 'string'
    ? vc.proof.verificationMethod
    : null
  if (!issuerId || !verificationMethod) {
    return { ...base, verificationState: 'invalid', issues: ['credential needs issuer.id and proof.verificationMethod'] }
  }
  if (verificationMethod !== issuerId && !verificationMethod.startsWith(`${issuerId}#`)) {
    return { ...base, verificationState: 'invalid', issues: ['proof verificationMethod is not controlled by credential issuer'] }
  }

  const issuerRequest = { issuerId, verificationMethod, credential: vc, attestation }
  const rawIssuer = resolverValue(resolveIssuerKey ?? issuerKeyResolver ?? issuerKeys,
    [verificationMethod, issuerId], issuerRequest)
  const issuer = normalizeIssuerKey(rawIssuer)
  if (!issuer.resolved) return { ...base, issues: [issuer.reason] }
  if (issuer.issuerId != null && issuer.issuerId !== issuerId) {
    return { ...base, verificationState: 'invalid', issues: ['resolved issuer key identity does not match credential issuer'] }
  }

  const statusId = vc.credentialStatus?.id ?? null
  const statusListCredential = vc.credentialStatus?.statusListCredential ?? attestation?.status_url ?? null
  const revocationRequest = {
    credential: vc,
    attestation,
    issuerId,
    status: vc.credentialStatus ?? null,
    statusId,
    statusListCredential,
  }
  const rawRevocation = resolverValue(resolveRevocation ?? revocationResolver ?? revocations,
    [statusId, statusListCredential, attestationId], revocationRequest)
  const revocation = normalizeRevocation(rawRevocation)
  if (!revocation.resolved) return { ...base, issues: [revocation.reason] }

  const verification = verifyLevelCredential(vc, {
    issuerPublicKeyPem: issuer.key,
    expectedRomDigest,
    sigmaMax,
    minGames,
    revoked: revocation.revoked,
  })
  const boundToRom = expectedRomDigest != null && base.romDigest === expectedRomDigest
  if (!verification.ok) {
    return {
      ...base,
      verificationState: revocation.revoked ? 'revoked' : 'invalid',
      revoked: revocation.revoked,
      boundToRom,
      issues: verification.issues,
    }
  }
  return {
    ...base,
    verificationState: 'verified',
    proven: true,
    revoked: false,
    boundToRom,
    issues: [],
  }
}

function invalidAttestation(attestation, reason) {
  return {
    ...unresolvedResult({ attestationId: attestation?.att_id, issues: [reason] }),
    references: attestationReferences(attestation, null),
    verificationState: 'invalid',
  }
}

function stateRank(state) {
  return { verified: 4, revoked: 3, invalid: 2, unresolved: 1 }[state] ?? 0
}

/** Resolve a capability's public verification status from referenced evidence. */
export function resolveCapabilityEvidence(capability, attestationResolutions = []) {
  const claimedVerified = capability?.proficiency?.verified === true
  const evidenceRefs = Array.isArray(capability?.evidenceRefs) ? capability.evidenceRefs : []
  const levelRefs = evidenceRefs.filter((ref) => ref?.kind === 'level-attestation' && typeof ref.ref === 'string')
  const matches = []
  for (const evidence of levelRefs) {
    const resolution = attestationResolutions.find((candidate) => candidate.references?.includes(evidence.ref))
    if (resolution) matches.push({ evidenceRef: evidence.ref, resolution })
  }
  const verifiedMatch = matches.find((match) => match.resolution.proven)
  if (verifiedMatch) {
    return {
      claimedVerified,
      verified: true,
      verificationState: 'verified',
      resolvedEvidenceRef: verifiedMatch.evidenceRef,
      issues: [],
    }
  }
  const strongest = matches.sort((a, b) => stateRank(b.resolution.verificationState) - stateRank(a.resolution.verificationState))[0]
  return {
    claimedVerified,
    verified: false,
    verificationState: strongest?.resolution.verificationState ?? 'unresolved',
    resolvedEvidenceRef: null,
    issues: strongest?.resolution.issues ?? (levelRefs.length
      ? ['referenced level attestation did not resolve']
      : ['no level-attestation evidence reference']),
  }
}

/**
 * Resolve all embedded VC evidence once and project safe level/capability state.
 * The default is deliberately unresolved; callers must inject live resolvers.
 */
export function resolveCartridgeEvidence(cart, options = {}) {
  const expectedRomDigest = cart.getMeta('acx.rom_manifest_hash')
  const rows = cart.db.prepare("SELECT att_id,type,subject_oid,document,status_url,created_at FROM attestations WHERE type='vc-2.0' ORDER BY created_at,att_id").all()
  const attestations = rows.map((attestation) => {
    let vc
    try {
      vc = JSON.parse(attestation.document)
    } catch (error) {
      return invalidAttestation(attestation, `credential JSON cannot be read: ${error.message}`)
    }
    const resolved = resolveLevelCredentialEvidence(vc, { ...options, expectedRomDigest, attestation })
    return { ...resolved, references: attestationReferences(attestation, vc) }
  })

  const proven = attestations.filter((item) => item.proven)
    .sort((a, b) => (b.acxLevel ?? -1) - (a.acxLevel ?? -1))[0] ?? null
  const claimed = [...attestations]
    .filter((item) => item.acxLevel != null || item.careerTier != null)
    .sort((a, b) => (b.acxLevel ?? -1) - (a.acxLevel ?? -1))[0] ?? null
  const strongest = [...attestations]
    .sort((a, b) => stateRank(b.verificationState) - stateRank(a.verificationState))[0] ?? null
  const selected = proven ?? claimed ?? strongest
  const level = {
    tier: proven?.careerTier ?? null,
    acxLevel: proven?.acxLevel ?? 0,
    claimedTier: claimed?.careerTier ?? null,
    claimedAcxLevel: claimed?.acxLevel ?? null,
    mu: proven?.mu ?? null,
    sigma: proven?.sigma ?? null,
    games: proven?.games ?? null,
    benchmark: proven?.benchmark ?? null,
    proven: Boolean(proven),
    boundToRom: Boolean(proven?.boundToRom),
    attestationId: selected?.attestationId ?? null,
    verificationState: proven ? 'verified' : (selected?.verificationState ?? 'unresolved'),
    issues: proven ? [] : (selected?.issues ?? ['no embedded level credential resolved']),
  }

  const capabilityRows = cart.db.prepare('SELECT id,json FROM capabilities ORDER BY id').all()
  const capabilities = capabilityRows.map((row) => {
    let capability
    try {
      capability = JSON.parse(row.json)
    } catch (error) {
      return {
        id: row.id,
        capability: null,
        claimedVerified: false,
        verified: false,
        verificationState: 'invalid',
        resolvedEvidenceRef: null,
        issues: [`capability JSON cannot be read: ${error.message}`],
      }
    }
    return { id: row.id, capability, ...resolveCapabilityEvidence(capability, attestations) }
  })

  return { level, capabilities, attestations }
}
