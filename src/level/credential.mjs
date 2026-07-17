// W3C Verifiable Credential 2.0 + Open Badges 3.0 level credential (SPEC §10.1).
// Secured with a DataIntegrityProof, cryptosuite eddsa-jcs-2022 (JCS-based; no RDF dep).
import { sign as edSign, verify as edVerify, createPublicKey, createHash } from 'node:crypto'
import { jcs } from '../canonical.mjs'

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export function base58btc(bytes) {
  let n = 0n
  for (const b of bytes) n = n * 256n + BigInt(b)
  let out = ''
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n }
  for (const b of bytes) { if (b === 0) out = '1' + out; else break }
  return out
}
export function base58btcDecode(str) {
  let n = 0n
  for (const ch of str) { const i = ALPHABET.indexOf(ch); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i) }
  const bytes = []
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n }
  for (const ch of str) { if (ch === '1') bytes.unshift(0); else break }
  return Buffer.from(bytes)
}

function sha256(buf) { return createHash('sha256').update(buf).digest() }

/**
 * Build an unsigned LevelCredential (VC 2.0 / OB 3.0).
 */
export function buildLevelCredential({ issuerDid, subjectId, romDigest, benchmark, rating, level, evidence, statusListUrl, statusIndex, validFrom }) {
  return {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json',
      'https://acx.dev/ns/level/v1',
    ],
    type: ['VerifiableCredential', 'OpenBadgeCredential'],
    issuer: { id: issuerDid, type: ['Profile'] },
    validFrom: validFrom ?? new Date().toISOString(),
    credentialSubject: {
      type: ['AchievementSubject'],
      id: subjectId,
      achievement: {
        id: `https://acx.dev/achievement/${benchmark.id}/${benchmark.version}`,
        type: ['Achievement'],
        name: `ACX Level — ${benchmark.name}`,
        criteria: { narrative: `Independently re-executed on a sealed held-out slice of ${benchmark.name} (${benchmark.version}); TrueSkill conservative rating R=mu-3sigma gated at sigma<1.5 over >=30 games.` },
        resultDescription: [
          { id: 'career-tier', type: ['ResultDescription'], name: 'Career Tier', resultType: 'RubricCriterionLevel' },
          { id: 'rating', type: ['ResultDescription'], name: 'Conservative rating (0-50)', resultType: 'ScaledScore' },
          { id: 'passrate', type: ['ResultDescription'], name: 'Held-out pass@1', resultType: 'Percent' },
        ],
      },
      result: [{
        type: ['Result'],
        achievedLevel: level.careerTier,
        'acx:ratingMu': round(rating.mu),
        'acx:ratingSigma': round(rating.sigma),
        'acx:gamesPlayed': rating.gamesPlayed,
        'acx:acxLevel': level.acxLevel,
        'acx:careerTier': level.careerTier,
        'acx:passRate': round(rating.passRate),
        'acx:cartridgeRomDigest': romDigest,
        'acx:benchmarkId': benchmark.id,
        'acx:benchmarkVersion': benchmark.version,
        'acx:benchmarkDigest': benchmark.digest,
        'acx:heldOutSliceDigest': benchmark.heldOutSliceDigest,
      }],
    },
    evidence: evidence ?? [],
    credentialStatus: {
      id: `${statusListUrl}#${statusIndex}`,
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: String(statusIndex),
      statusListCredential: statusListUrl,
    },
  }
}

function round(x) { return Math.round(x * 1000) / 1000 }

/** Sign a credential with eddsa-jcs-2022, returning the credential with a proof. */
export function signCredential(credential, { privateKey, verificationMethod, created }) {
  const proofOptions = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created: created ?? new Date().toISOString(),
    verificationMethod,
    proofPurpose: 'assertionMethod',
  }
  const hashData = Buffer.concat([sha256(Buffer.from(jcs(proofOptions), 'utf8')), sha256(Buffer.from(jcs(credential), 'utf8'))])
  const sig = edSign(null, hashData, privateKey)
  return { ...credential, proof: { ...proofOptions, proofValue: 'z' + base58btc(sig) } }
}

/** Verify a credential's DataIntegrity proof. Returns { ok, reason }. */
export function verifyCredentialProof(vc, publicKeyPemOrObj) {
  try {
    const { proof, ...doc } = vc
    if (!proof || proof.cryptosuite !== 'eddsa-jcs-2022') return { ok: false, reason: 'unsupported/missing proof' }
    const { proofValue, ...proofOptions } = proof
    if (!proofValue?.startsWith('z')) return { ok: false, reason: 'proofValue not multibase base58btc' }
    const sig = base58btcDecode(proofValue.slice(1))
    const hashData = Buffer.concat([sha256(Buffer.from(jcs(proofOptions), 'utf8')), sha256(Buffer.from(jcs(doc), 'utf8'))])
    const pub = typeof publicKeyPemOrObj === 'string' ? createPublicKey(publicKeyPemOrObj) : publicKeyPemOrObj
    const ok = edVerify(null, hashData, pub, sig)
    return ok ? { ok: true } : { ok: false, reason: 'signature verification failed' }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}

/**
 * Full credential verification per SPEC §10.1 policy:
 * proof valid, issuer != subject controller (no self-issuance), gating satisfied,
 * ROM digest binding matches, not revoked.
 */
export function verifyLevelCredential(vc, { issuerPublicKeyPem, expectedRomDigest, sigmaMax = 1.5, minGames = 30, revoked = false }) {
  const issues = []
  const proof = verifyCredentialProof(vc, issuerPublicKeyPem)
  if (!proof.ok) issues.push('proof: ' + proof.reason)
  const issuerId = vc.issuer?.id
  const subjectId = vc.credentialSubject?.id
  if (issuerId && subjectId && issuerId === subjectId) issues.push('self-issuance rejected (issuer == subject)')
  const res = vc.credentialSubject?.result?.[0] ?? {}
  if ((res['acx:ratingSigma'] ?? 99) >= sigmaMax) issues.push(`sigma ${res['acx:ratingSigma']} >= ${sigmaMax}`)
  if ((res['acx:gamesPlayed'] ?? 0) < minGames) issues.push(`gamesPlayed ${res['acx:gamesPlayed']} < ${minGames}`)
  if (expectedRomDigest && res['acx:cartridgeRomDigest'] !== expectedRomDigest) issues.push('ROM digest binding mismatch')
  if (revoked) issues.push('credential revoked (status bit set)')
  return { ok: issues.length === 0, issues, result: res }
}
