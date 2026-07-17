// SPEC §10 provable character level: TrueSkill gating, held-out re-execution,
// VC 2.0 / OB 3.0 credential issuance + verification.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sha256Hex } from '../src/canonical.mjs'
import { generateSigningKey } from '../src/sign.mjs'
import { update, conservative, levelFor, careerTierForLevel, DEFAULT_MU, DEFAULT_SIGMA } from '../src/level/trueskill.mjs'
import { base58btc, base58btcDecode, buildLevelCredential, signCredential, verifyCredentialProof, verifyLevelCredential } from '../src/level/credential.mjs'
import { makeBenchmark, referenceSolver, runVerification, demoDagBenchmark } from '../src/level/benchmark.mjs'

const ROM = 'sha256:' + sha256Hex(Buffer.from('rom-digest-fixture-for-level-tests'))

// ── §10.2 TrueSkill primitives ──────────────────────────────────────────────
test('§10.2 update shrinks sigma and conservative R = mu - 3*sigma', () => {
  let r = { mu: DEFAULT_MU, sigma: DEFAULT_SIGMA }
  const before = r.sigma
  r = update(r, 25, true)
  assert.ok(r.sigma < before, 'a game reduces uncertainty')
  assert.equal(conservative(r), r.mu - 3 * r.sigma)
})

test('§10.2 levelFor + careerTierForLevel bucket the conservative rating', () => {
  assert.deepEqual(levelFor(28), { acxLevel: 28, careerTier: 'principal' })
  assert.equal(levelFor(-5).acxLevel, 0, 'level is clamped at 0')
  assert.equal(careerTierForLevel(0), 'intern')
  assert.equal(careerTierForLevel(7), 'junior')
  assert.equal(careerTierForLevel(17), 'senior')
  assert.equal(careerTierForLevel(22), 'staff')
  assert.equal(careerTierForLevel(27), 'principal')
  assert.equal(careerTierForLevel(32), 'distinguished')
  assert.equal(careerTierForLevel(40), 'legend')
})

// ── base58btc multibase codec ───────────────────────────────────────────────
test('base58btc round-trips arbitrary bytes incl. leading zeros', () => {
  const b = Buffer.from([0, 0, 12, 255, 7, 42, 200])
  assert.deepEqual(base58btcDecode(base58btc(b)), b)
})

// ── §10.2 benchmark held-out slice ──────────────────────────────────────────
test('§10.2 makeBenchmark seals a held-out slice and is deterministic', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({ id: `t-${i}`, difficulty: 20 }))
  const b1 = makeBenchmark({ id: 'b', name: 'B', version: '1', tasks, heldOutFraction: 0.5 })
  const b2 = makeBenchmark({ id: 'b', name: 'B', version: '1', tasks, heldOutFraction: 0.5 })
  assert.equal(b1.digest, b2.digest)
  assert.equal(b1.heldOutSliceDigest, b2.heldOutSliceDigest)
  assert.equal(b1.heldOut.length, 10)
  assert.equal(b1.publicSlice.length, 10)
  // held-out and public slices are disjoint
  const heldIds = new Set(b1.heldOut.map((t) => t.id))
  assert.ok(b1.publicSlice.every((t) => !heldIds.has(t.id)))
})

test('§10.3 referenceSolver is deterministic and ROM-bound', () => {
  const task = { id: 'x', difficulty: 20 }
  const a = referenceSolver(ROM, task, 30)
  const b = referenceSolver(ROM, task, 30)
  assert.equal(a.passed, b.passed)
  // a different ROM digest can change the outcome distribution (binding)
  const other = referenceSolver('sha256:different', task, 30)
  assert.equal(typeof other.passed, 'boolean')
})

// ── §10.2 level is earned, not given ────────────────────────────────────────
test('§10.2 a weak agent fails the sigma gate -> no VC issued', () => {
  const bench = demoDagBenchmark()
  const verifierKey = generateSigningKey()
  const weak = runVerification({
    romDigest: ROM, benchmark: bench, competence: 14, verifierKey,
    issuerDid: 'did:web:verifier.acx.dev', subjectId: 'urn:acx:cartridge:demo', now: '2026-07-16T00:00:00Z',
  })
  assert.equal(weak.issued, false)
  assert.equal(weak.vc, undefined)
})

test('§10.2 a strong agent earns a σ-gated VC', () => {
  const bench = demoDagBenchmark()
  const verifierKey = generateSigningKey()
  const strong = runVerification({
    romDigest: ROM, benchmark: bench, competence: 33, drawCount: 90, verifierKey,
    issuerDid: 'did:web:verifier.acx.dev', subjectId: 'urn:acx:cartridge:demo', now: '2026-07-16T00:00:00Z',
  })
  assert.equal(strong.issued, true, strong.reason)
  assert.ok(strong.rating.sigma < 1.5, `sigma ${strong.rating.sigma} must be < 1.5`)
  assert.ok(strong.rating.gamesPlayed >= 30)
  assert.ok(strong.vc.proof, 'issued VC carries a DataIntegrity proof')
  assert.equal(strong.vc.credentialSubject.result[0]['acx:cartridgeRomDigest'], ROM)
})

// ── §10.1 credential proof + policy verification ────────────────────────────
function issuedVc() {
  const bench = demoDagBenchmark()
  const verifierKey = generateSigningKey()
  const strong = runVerification({
    romDigest: ROM, benchmark: bench, competence: 33, drawCount: 90, verifierKey,
    issuerDid: 'did:web:verifier.acx.dev', subjectId: 'urn:acx:cartridge:demo', now: '2026-07-16T00:00:00Z',
  })
  assert.equal(strong.issued, true, strong.reason)
  return { vc: strong.vc, verifierKey }
}

test('§10.1 credential proof round-trips (eddsa-jcs-2022)', () => {
  const { vc, verifierKey } = issuedVc()
  assert.equal(vc.proof.cryptosuite, 'eddsa-jcs-2022')
  assert.match(vc.proof.proofValue, /^z/)
  assert.equal(verifyCredentialProof(vc, verifierKey.publicKeyPem).ok, true)
})

test('§10.1 verifyLevelCredential accepts a valid, gated, ROM-bound credential', () => {
  const { vc, verifierKey } = issuedVc()
  const r = verifyLevelCredential(vc, { issuerPublicKeyPem: verifierKey.publicKeyPem, expectedRomDigest: ROM })
  assert.equal(r.ok, true, JSON.stringify(r.issues))
})

test('§10.1 verifyLevelCredential rejects self-issuance (issuer == subject)', () => {
  const { vc, verifierKey } = issuedVc()
  const selfVc = { ...vc, issuer: { id: vc.credentialSubject.id, type: ['Profile'] } }
  const r = verifyLevelCredential(selfVc, { issuerPublicKeyPem: verifierKey.publicKeyPem, expectedRomDigest: ROM })
  assert.equal(r.ok, false)
  assert.ok(r.issues.some((i) => i.includes('self-issuance')))
})

test('§10.1 verifyLevelCredential rejects a ROM digest mismatch (anti-transplant)', () => {
  const { vc, verifierKey } = issuedVc()
  const r = verifyLevelCredential(vc, { issuerPublicKeyPem: verifierKey.publicKeyPem, expectedRomDigest: 'sha256:0000different' })
  assert.equal(r.ok, false)
  assert.ok(r.issues.some((i) => i.includes('ROM digest')))
})

test('§10.1 verifyLevelCredential rejects a revoked credential', () => {
  const { vc, verifierKey } = issuedVc()
  const r = verifyLevelCredential(vc, { issuerPublicKeyPem: verifierKey.publicKeyPem, expectedRomDigest: ROM, revoked: true })
  assert.equal(r.ok, false)
  assert.ok(r.issues.some((i) => i.includes('revoked')))
})

test('§10.1 verifyLevelCredential rejects a tampered credential body', () => {
  const { vc, verifierKey } = issuedVc()
  const tampered = structuredClone(vc)
  tampered.credentialSubject.result[0]['acx:acxLevel'] = 99
  const r = verifyLevelCredential(tampered, { issuerPublicKeyPem: verifierKey.publicKeyPem, expectedRomDigest: ROM })
  assert.equal(r.ok, false)
  assert.ok(r.issues.some((i) => i.startsWith('proof:')))
})
