import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Cartridge } from '../src/container.mjs'
import { putCapability, finalizeAndSign } from '../src/assemble.mjs'
import { loadCartridge, readCard } from '../src/load.mjs'
import { resolveParticipants } from '../src/cal.mjs'
import { runVerification, demoDagBenchmark } from '../src/level/benchmark.mjs'
import { generateSigningKey } from '../src/sign.mjs'
import { validatePackageSpec } from '../src/packagespec.mjs'
import { inspectUpload, summarize } from '../platform/catalog.mjs'
import { REPO_ROOT } from '../src/paths.mjs'
import { buildSignedCartridge, cleanup, tmpAcxPath } from './helpers.mjs'

after(cleanup)

const REGISTRY_AGENT = `${REPO_ROOT}/registry/cartridges/io.github.ridgeworks/ada-ridge/1.0.0/cartridge.acx`

function cartridgeWithLevelEvidence() {
  const built = buildSignedCartridge()
  const { cart, key } = built
  const attestationId = 'level-trust-resolution'
  const row = cart.db.prepare('SELECT id,json FROM capabilities LIMIT 1').get()
  const capability = JSON.parse(row.json)
  capability.proficiency.verified = true
  capability.evidenceRefs = [{ kind: 'level-attestation', ref: attestationId }]
  capability.updatedAt = '2026-01-02T00:00:00Z'
  cart.db.prepare('DELETE FROM objects WHERE source_ref=?').run(`capability:${row.id}`)
  putCapability(cart, capability)
  finalizeAndSign(cart, key, {
    publisherId: built.publisherId,
    embeddingEngine: { id: 'local-hash-128', dim: 128 },
    signedAt: '2026-01-02T00:00:01Z',
  })
  const romDigest = cart.getMeta('acx.rom_manifest_hash')
  const verifierKey = generateSigningKey()
  const issuerDid = 'did:web:independent.example'
  const benchmark = demoDagBenchmark()
  const run = runVerification({
    romDigest,
    benchmark,
    competence: 35,
    drawCount: 90,
    verifierKey,
    issuerDid,
    subjectId: `urn:acx:cartridge:${cart.getMeta('acx.cartridge_id')}`,
    now: '2026-01-02T00:00:02Z',
  })
  assert.equal(run.issued, true)
  cart.db.prepare('INSERT INTO attestations(att_id,type,subject_oid,media_type,document,status_url,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(attestationId, 'vc-2.0', romDigest, 'application/vc', JSON.stringify(run.vc), run.vc.credentialStatus.statusListCredential, run.vc.validFrom)
  return { ...built, verifierKey, attestationId, level: run.level }
}

function liveResolution(verifierKey, revoked = false) {
  return {
    resolveIssuerKey: () => ({ publicKeyPem: verifierKey.publicKeyPem, issuerId: 'did:web:independent.example' }),
    resolveRevocation: () => ({ resolved: true, revoked }),
  }
}

test('embedded VC and proficiency verified bit stay claims until key and revocation both resolve', () => {
  const { cart, verifierKey, level } = cartridgeWithLevelEvidence()

  const defaultCard = readCard(cart)
  assert.equal(defaultCard.level.proven, false)
  assert.equal(defaultCard.level.acxLevel, 0, 'claimed levels must not enter staffing comparisons')
  assert.equal(defaultCard.level.claimedAcxLevel, level.acxLevel)
  assert.equal(defaultCard.level.verificationState, 'unresolved')
  assert.equal(defaultCard.moves[0].claimedVerified, true)
  assert.equal(defaultCard.moves[0].verified, false)
  assert.equal(defaultCard.moves[0].verificationState, 'unresolved')

  const keyOnly = readCard(cart, { resolveIssuerKey: () => verifierKey.publicKeyPem })
  assert.equal(keyOnly.level.proven, false)
  assert.equal(keyOnly.level.verificationState, 'unresolved')

  const resolved = readCard(cart, liveResolution(verifierKey))
  assert.equal(resolved.level.proven, true)
  assert.equal(resolved.level.acxLevel, level.acxLevel)
  assert.equal(resolved.level.verificationState, 'verified')
  assert.equal(resolved.moves[0].verified, true)
  assert.equal(resolved.moves[0].verificationState, 'verified')

  const revoked = readCard(cart, liveResolution(verifierKey, true))
  assert.equal(revoked.level.proven, false)
  assert.equal(revoked.level.acxLevel, 0)
  assert.equal(revoked.level.verificationState, 'revoked')
  assert.equal(revoked.moves[0].verified, false)
  assert.equal(revoked.moves[0].verificationState, 'revoked')
  cart.close()
})

test('minimum-level staffing cannot be satisfied by an unresolved embedded claim', () => {
  const { cart, verifierKey } = cartridgeWithLevelEvidence()
  const cal = {
    participants: [{
      alias: 'builder',
      bind: 'slot',
      slot: {
        role: 'backend_dev',
        minLevel: { acxLevel: 1 },
        capabilities: [{ taskType: 'implement-feature' }],
      },
    }],
  }
  const unresolved = { path: cart.path, card: readCard(cart) }
  assert.equal(resolveParticipants(cal, [unresolved])[0].bound, null)
  const verified = { path: cart.path, card: readCard(cart, liveResolution(verifierKey)) }
  assert.equal(resolveParticipants(cal, [verified])[0].bound, verified)
  cart.close()
})

test('exchange summaries expose claims separately and never infer proof by default', () => {
  const { cart, path, verifierKey } = cartridgeWithLevelEvidence()
  cart.close()
  const unresolved = summarize(path)
  assert.equal(unresolved.level, null)
  assert.equal(unresolved.levelClaim.verificationState, 'unresolved')
  assert.equal(unresolved.capabilities[0].claimedVerified, true)
  assert.equal(unresolved.capabilities[0].verified, false)

  const resolved = summarize(path, liveResolution(verifierKey))
  assert.equal(resolved.level.verificationState, 'verified')
  assert.equal(resolved.capabilities[0].verified, true)
})

test('package spec rejects malformed capability records and dangling evidence references', () => {
  const path = tmpAcxPath('unclean-package.acx')
  copyFileSync(REGISTRY_AGENT, path)
  const cart = Cartridge.open(path)
  putCapability(cart, {
    schemaVersion: 'acx.capability/1',
    id: 'cap-ffffffffffffffff',
    taskType: 'implement-feature',
    stack: ['not-a-purl'],
    domain: 'backend',
    proficiency: {
      scale: 'acx.proficiency/trueskill-1',
      mu: 25,
      sigma: -1,
      score: 2,
      confidence: 0.5,
      verified: true,
    },
    evidenceRefs: [{ kind: 'level-attestation', ref: 'missing-attestation' }],
    sampleCount: -1,
    lastDemonstratedAt: 'not-a-date',
    createdAt: 'not-a-date',
    updatedAt: 'not-a-date',
  })
  const result = validatePackageSpec(cart)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.includes('not a Package URL')))
  assert.ok(result.issues.some((issue) => issue.includes("missing level attestation 'missing-attestation'")))
  assert.ok(result.issues.some((issue) => issue.includes('sampleCount')))
  cart.close()
})

test('package spec rejects unknown fields, duplicate roles, and missing normative roles', () => {
  const path = tmpAcxPath('malformed-package-manifest.acx')
  copyFileSync(REGISTRY_AGENT, path)
  const cart = Cartridge.open(path)
  const spec = JSON.parse(cart.getFile('rom/package-spec.json').toString('utf8'))
  spec.unknownPolicy = 'accept-everything'
  spec.artifacts = spec.artifacts
    .filter((artifact) => artifact.role !== 'harness')
    .concat(spec.artifacts.find((artifact) => artifact.role === 'identity'))
  cart.db.prepare("DELETE FROM objects WHERE source_ref='rom/package-spec.json'").run()
  cart.putFile('rom/package-spec.json', Buffer.from(JSON.stringify(spec), 'utf8'))
  const key = generateSigningKey()
  finalizeAndSign(cart, key, {
    publisherId: cart.getMeta('acx.publisher_id'),
    embeddingEngine: JSON.parse(cart.getMeta('acx.embedding_engine')),
    signedAt: '2026-07-20T00:00:00Z',
  })

  const result = validatePackageSpec(cart)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((issue) => issue.includes("unknown field 'unknownPolicy'")))
  assert.ok(result.issues.some((issue) => issue.includes("role 'identity' is duplicated")))
  assert.ok(result.issues.some((issue) => issue.includes("missing artifact role 'harness'")))
  cart.close()
})

test('HTTP upload inspection rejects legacy and signed-but-unclean cartridges', () => {
  const legacyPath = tmpAcxPath('legacy.acx')
  const legacy = Cartridge.create(legacyPath)
  legacy.close()
  const legacyVerdict = inspectUpload(legacyPath)
  assert.equal(legacyVerdict.acceptable, false)
  assert.match(legacyVerdict.reason, /legacy/)
  assert.equal(loadCartridge(legacyPath, { install: false }).refused, true)

  const unversionedPath = tmpAcxPath('signed-unversioned.acx')
  copyFileSync(REGISTRY_AGENT, unversionedPath)
  const unversioned = Cartridge.open(unversionedPath)
  unversioned.db.prepare(
    "DELETE FROM cartridge WHERE key IN ('acx.artifact_id','acx.artifact_version')",
  ).run()
  unversioned.db.prepare(
    "DELETE FROM objects WHERE source_ref IN ('cartridge:acx.artifact_id','cartridge:acx.artifact_version')",
  ).run()
  finalizeAndSign(unversioned, generateSigningKey(), {
    publisherId: unversioned.getMeta('acx.publisher_id'),
    embeddingEngine: JSON.parse(unversioned.getMeta('acx.embedding_engine')),
    signedAt: '2026-07-20T00:00:00Z',
  })
  unversioned.close()
  const unversionedVerdict = inspectUpload(unversionedPath)
  assert.equal(unversionedVerdict.summary.trust, 'portable')
  assert.equal(unversionedVerdict.summary.packageSpec.ok, true)
  assert.equal(unversionedVerdict.acceptable, false)
  assert.match(unversionedVerdict.reason, /ROM-bound artifact id\/version/)

  const uncleanPath = tmpAcxPath('signed-unclean.acx')
  copyFileSync(REGISTRY_AGENT, uncleanPath)
  const unclean = Cartridge.open(uncleanPath)
  putCapability(unclean, { schemaVersion: 'broken', id: 'cap-eeeeeeeeeeeeeeee' })
  const key = generateSigningKey()
  finalizeAndSign(unclean, key, {
    publisherId: unclean.getMeta('acx.publisher_id'),
    embeddingEngine: JSON.parse(unclean.getMeta('acx.embedding_engine')),
    signedAt: '2026-07-20T00:00:00Z',
  })
  unclean.close()

  const uncleanVerdict = inspectUpload(uncleanPath)
  assert.equal(uncleanVerdict.summary.trust, 'portable')
  assert.equal(uncleanVerdict.acceptable, false)
  assert.match(uncleanVerdict.reason, /unclean package/)
  assert.equal(loadCartridge(uncleanPath, { install: false }).refused, true)

  assert.equal(inspectUpload(REGISTRY_AGENT).acceptable, true)
})

test('loading refuses signed package paths that could escape the skill directory', () => {
  const path = tmpAcxPath('signed-unsafe-path.acx')
  copyFileSync(REGISTRY_AGENT, path)
  const cart = Cartridge.open(path)
  cart.putFile(
    'rom/skills/../../outside/SKILL.md',
    Buffer.from('---\nname: outside\ndescription: must never install\n---\n'),
  )
  const key = generateSigningKey()
  finalizeAndSign(cart, key, {
    publisherId: cart.getMeta('acx.publisher_id'),
    embeddingEngine: JSON.parse(cart.getMeta('acx.embedding_engine')),
    signedAt: '2026-07-20T00:00:00Z',
  })
  cart.close()

  const root = mkdtempSync(join(tmpdir(), 'acx-load-safe-'))
  const skillsDir = join(root, 'skills')
  const result = loadCartridge(path, { skillsDir, install: true })
  assert.equal(result.refused, true)
  assert.ok(result.card.packageSpec.issues.some((issue) => issue.includes('sqlar path is unsafe')))
  assert.equal(existsSync(join(root, 'outside', 'SKILL.md')), false)
})
