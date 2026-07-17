// SPEC §12 conformance MUST-items exercised against the reference implementation.
// Run: node --experimental-sqlite --test test/
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

import { jcs, oidJcs, oidRaw, sha256Hex } from '../src/canonical.mjs'
import { Cartridge, APPLICATION_ID, USER_VERSION, zoneOf } from '../src/container.mjs'
import { buildRomManifest, buildStatement, signEnvelope, verifyEnvelope, generateSigningKey, keyIdFromPublicKey, keyIdFromPem, PAYLOAD_TYPE } from '../src/sign.mjs'
import { evaluateTrust, emptyTrustRegistry, loadTrustRegistry } from '../src/trust.mjs'
import { scrub } from '../src/scrub.mjs'
import { stripToRom } from '../src/strip.mjs'
import { insertMemory, codebaseFingerprint, canonicalRepoIdentity } from '../src/memory.mjs'
import { deriveSkillIndex } from '../src/assemble.mjs'
import { buildSignedCartridge, trustedRegistry, tmpAcxPath, cleanup } from './helpers.mjs'

after(cleanup)

// ── §12.1 — file identity: application_id @68, user_version @60 ──────────────
test('§12.1 header bytes: application_id at offset 68, user_version at offset 60', () => {
  const { cart, path } = buildSignedCartridge()
  cart.close()
  const buf = readFileSync(path)
  assert.equal(buf.readUInt32BE(68), APPLICATION_ID, 'application_id must be at byte offset 68')
  assert.equal(buf.readUInt32BE(68), 1094932529)
  assert.equal(buf.readUInt32BE(60), USER_VERSION, 'user_version must be at byte offset 60')
  assert.equal(buf.readUInt32BE(60), 16777472)
})

test('§12.1 Cartridge.open rejects a non-.acx file (wrong application_id)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acx-neg-'))
  const p = join(dir, 'plain.sqlite')
  // create a plain sqlite DB with no application_id
  const c = Cartridge.create(p)
  c.db.exec('PRAGMA application_id = 0;')
  c.close()
  assert.throws(() => Cartridge.open(p), /not an .acx cartridge/)
})

// ── §12.2 — zoning by rom/ save/ prefix ─────────────────────────────────────
test('§12.2 sqlar names must be zone-prefixed; zoneOf classifies rom/save', () => {
  assert.equal(zoneOf('rom/skills/x/SKILL.md'), 'rom')
  assert.equal(zoneOf('save/notes/y.md'), 'save')
  assert.throws(() => zoneOf('skills/x/SKILL.md'), /zone-prefixed/)
})

// ── JCS determinism + content-address stability ─────────────────────────────
test('JCS is independent of key insertion order', () => {
  assert.equal(jcs({ b: 1, a: 2, c: 3 }), jcs({ c: 3, a: 2, b: 1 }))
  assert.equal(jcs({ b: 1, a: 2, c: 3 }), '{"a":2,"b":1,"c":3}')
  // nested + arrays preserved, keys sorted at every level
  assert.equal(jcs({ z: { y: 1, x: 2 }, a: [3, { q: 1, p: 2 }] }), '{"a":[3,{"p":2,"q":1}],"z":{"x":2,"y":1}}')
})

test('oidJcs is key-order independent; oidRaw is byte-stable', () => {
  assert.equal(oidJcs({ a: 1, b: 2 }), oidJcs({ b: 2, a: 1 }))
  assert.notEqual(oidJcs({ a: 1 }), oidJcs({ a: 2 }))
  assert.equal(oidRaw(Buffer.from('hello')), 'sha256:' + sha256Hex(Buffer.from('hello')))
  assert.match(oidRaw(Buffer.from('x')), /^sha256:[0-9a-f]{64}$/)
})

// ── §12.3 — ROM manifest hash reproducibility + DSSE round-trip + tamper ─────
test('§12.3 ROM manifest hash is reproducible from the same ROM objects', () => {
  const { cart } = buildSignedCartridge()
  const m1 = buildRomManifest(cart)
  const m2 = buildRomManifest(cart)
  assert.equal(m1.manifestHash, m2.manifestHash)
  assert.match(m1.manifestHash, /^sha256:[0-9a-f]{64}$/)
  // canonical form is JCS of the sorted list
  assert.equal(m1.canonical, jcs(m1.list))
  assert.equal(m1.manifestHash, cart.getMeta('acx.rom_manifest_hash'))
  cart.close()
})

test('§12.3 DSSE/in-toto sign+verify round-trip; keyid form; subject.digest = manifest_hash', () => {
  const key = generateSigningKey()
  assert.match(key.keyid, /^ed25519:[0-9a-f]{64}$/)
  assert.equal(key.keyid, keyIdFromPublicKey(key.publicKey))
  assert.equal(key.keyid, keyIdFromPem(key.publicKeyPem))

  const manifestHashHex = sha256Hex(Buffer.from('rom-manifest-fixture'))
  const stmt = buildStatement({ manifestHashHex, publisherId: 'io.github.acxtest', embeddingEngine: { id: 'local-hash-128', dim: 128 }, signedAt: '2026-01-01T00:00:00Z', cartridgeId: 'io.github.acxtest/x@1' })
  assert.equal(stmt.subject[0].digest.sha256, manifestHashHex)
  assert.equal(stmt._type, 'https://in-toto.io/Statement/v1')

  const env = signEnvelope(stmt, key)
  assert.equal(env.payloadType, PAYLOAD_TYPE)
  const v = verifyEnvelope(env, key.publicKeyPem)
  assert.equal(v.ok, true, v.reason)
  assert.equal(v.statement.subject[0].digest.sha256, manifestHashHex)
})

test('§12.3 tamper: mutating the signed payload fails DSSE verification', () => {
  const key = generateSigningKey()
  const stmt = buildStatement({ manifestHashHex: sha256Hex(Buffer.from('a')), publisherId: 'p', embeddingEngine: {}, signedAt: 't', cartridgeId: 'c' })
  const env = signEnvelope(stmt, key)
  // flip a byte in the base64 payload
  const bad = { ...env, payload: Buffer.from(jcs({ ...stmt, predicate: { ...stmt.predicate, publisherId: 'attacker' } }), 'utf8').toString('base64') }
  const v = verifyEnvelope(bad, key.publicKeyPem)
  assert.equal(v.ok, false)
})

test('§12.3 tamper: verifying with the wrong public key fails', () => {
  const key = generateSigningKey()
  const other = generateSigningKey()
  const stmt = buildStatement({ manifestHashHex: sha256Hex(Buffer.from('a')), publisherId: 'p', embeddingEngine: {}, signedAt: 't', cartridgeId: 'c' })
  const env = signEnvelope(stmt, key)
  assert.equal(verifyEnvelope(env, other.publicKeyPem).ok, false)
})

// ── §12.4/§12.5/§12.6 — trust taxonomy ──────────────────────────────────────
test('§12.6 trust: unsigned cartridge -> legacy', () => {
  const path = tmpAcxPath()
  const cart = Cartridge.create(path)
  cart.putFile('rom/knowledge/x.md', Buffer.from('hi'))
  const v = evaluateTrust(cart, { registry: emptyTrustRegistry() })
  assert.equal(v.trust, 'legacy')
  assert.equal(v.status, 'warning')
  cart.close()
})

test('§12.6 trust: valid signature + unknown signer -> portable', () => {
  const { cart } = buildSignedCartridge()
  const v = evaluateTrust(cart, { registry: emptyTrustRegistry() })
  assert.equal(v.trust, 'portable')
  assert.equal(v.status, 'warning')
  cart.close()
})

test('§12.6 trust: valid signature + registered signer -> trusted', () => {
  const { cart, key, publisherId } = buildSignedCartridge()
  const v = evaluateTrust(cart, { registry: trustedRegistry(key, publisherId) })
  assert.equal(v.trust, 'trusted')
  assert.equal(v.status, 'verified')
  assert.equal(v.keyId, key.keyid)
  cart.close()
})

test('§12.6 trust: signer is our own local key -> local', () => {
  const { cart, key, publisherId } = buildSignedCartridge()
  const v = evaluateTrust(cart, { registry: trustedRegistry(key, publisherId), localKeyId: key.keyid })
  assert.equal(v.trust, 'local')
  assert.equal(v.status, 'verified')
  cart.close()
})

test('§12.6 trust: mutated ROM object after signing -> tampered', () => {
  const { cart, key, publisherId } = buildSignedCartridge()
  cart.db.prepare("UPDATE objects SET oid='sha256:deadbeef' WHERE source_ref LIKE 'capability:%'").run()
  const v = evaluateTrust(cart, { registry: trustedRegistry(key, publisherId), localKeyId: key.keyid })
  assert.equal(v.trust, 'tampered')
  assert.equal(v.status, 'invalid')
  cart.close()
})

// ── §12.4 — trust registry must not carry private keys ──────────────────────
test('§12.4 loadTrustRegistry refuses private key material', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acx-reg-'))
  const good = join(dir, 'good.json')
  const bad = join(dir, 'bad.json')
  const key = generateSigningKey()
  const entry = { keyid: key.keyid, publisherId: 'p', algorithm: 'ed25519', publicKeyPem: key.publicKeyPem, status: 'active' }
  writeFileSync(good, JSON.stringify({ schemaVersion: 'acx.trust-registry/1', keys: [entry] }))
  writeFileSync(bad, JSON.stringify({ schemaVersion: 'acx.trust-registry/1', keys: [{ ...entry, publicKeyPem: key.privateKeyPem }] }))
  const reg = loadTrustRegistry(good)
  assert.equal(reg.byKeyId.get(key.keyid).publisherId, 'p')
  assert.throws(() => loadTrustRegistry(bad), /private key material/)
})

// ── §12.8 — scrub gate (fail-closed) ────────────────────────────────────────
test('§12.8 scrub blocks an AWS access key', () => {
  const r = scrub([{ field: 'memory:1.summary', text: 'creds AKIAIOSFODNN7EXAMPLE here' }])
  assert.equal(r.blocked, true)
  assert.ok(r.findings.some((f) => f.ruleId === 'aws-access-key'))
})

test('§12.8 scrub blocks a PEM private key', () => {
  const r = scrub([{ field: 'sqlar:rom/x.md', text: '-----BEGIN PRIVATE KEY-----\nMIIB...\n-----END PRIVATE KEY-----' }])
  assert.equal(r.blocked, true)
  assert.ok(r.findings.some((f) => f.ruleId === 'pem-private-key'))
})

test('§12.8 scrub blocks a GitHub token', () => {
  const r = scrub([{ field: 'memory:1.title', text: 'token ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8' }])
  assert.equal(r.blocked, true)
  assert.ok(r.findings.some((f) => f.ruleId === 'github-token'))
})

test('§12.8 scrub passes clean input', () => {
  const r = scrub([{ field: 'memory:1.summary', text: 'Refactored the payment reconciliation loop for clarity.' }])
  assert.equal(r.blocked, false)
})

// ── §3.4 — strip-to-ROM hash equality ───────────────────────────────────────
test('§3.4 strip-to-ROM: manifest hash equal when only SAVE rows are removed', () => {
  const { cart } = buildSignedCartridge()
  const before = cart.getMeta('acx.rom_manifest_hash')
  // add SAVE-zone content AFTER signing (field learning)
  cart.putFile('save/notes/n1.md', Buffer.from('field note'))
  insertMemory(cart, {
    id: 'save-mem-1', portable: false, repoId: null,
    codebaseFingerprint: codebaseFingerprint(randomBytes(32), canonicalRepoIdentity({ originUrl: 'https://github.com/acme/app.git' })),
    title: 'local finding', summary: 'local', sourceType: 'knowledge',
    timestamp: '2026-02-02T00:00:00Z', impact: 'neutral', xpAwarded: 1, tags: ['x'],
  })
  assert.equal(cart.db.prepare("SELECT count(*) c FROM objects WHERE zone='save'").get().c > 0, true)
  const proof = stripToRom(cart)
  assert.equal(proof.before, before)
  assert.equal(proof.equal, true, `strip mutated ROM: ${proof.before} != ${proof.after}`)
  assert.equal(cart.db.prepare("SELECT count(*) c FROM memory WHERE zone='save'").get().c, 0)
  cart.close()
})

// ── §12.7 — skills wholly in ROM; derivable index; content_sha256 matches ───
test('§12.7 sqlar skills are extractable byte-for-byte and index content_sha256 matches', () => {
  const { cart } = buildSignedCartridge()
  const name = 'rom/skills/demo-skill/SKILL.md'
  const bytes = cart.getFile(name)
  assert.ok(bytes && bytes.length > 0)
  assert.match(bytes.toString('utf8'), /^---\nname: demo-skill/)
  deriveSkillIndex(cart)
  const row = cart.db.prepare('SELECT name,description,sqlar_path,content_sha256,schema_version FROM acx_skill').get()
  assert.equal(row.name, 'demo-skill')
  assert.equal(row.sqlar_path, name)
  assert.equal(row.schema_version, 'acx.skill/1')
  assert.equal(row.content_sha256, sha256Hex(bytes), 'acx_skill.content_sha256 must match SKILL.md bytes')
  cart.close()
})
