// End-to-end: export a real AGENTIBUS agent-package -> .acx, then verify the
// full conformance chain (sign -> trust -> strip -> tamper) on the artifact.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Cartridge, APPLICATION_ID } from '../src/container.mjs'
import { generateSigningKey } from '../src/sign.mjs'
import { exportPackageToCartridge } from '../src/export.mjs'
import { buildCapability } from '../src/builders.mjs'
import { evaluateTrust, emptyTrustRegistry } from '../src/trust.mjs'
import { stripToRom } from '../src/strip.mjs'
import { buildRomManifest } from '../src/sign.mjs'
import { tmpAcxPath, trustedRegistry, cleanup } from './helpers.mjs'

import { SAMPLE_PACKAGE_DIR } from '../src/paths.mjs'
const PKG = SAMPLE_PACKAGE_DIR

const key = generateSigningKey()
let OUT, cartridgeId

before(() => {
  assert.ok(existsSync(PKG), `example package must exist at ${PKG}`)
  OUT = tmpAcxPath('research-designer.acx')
  const dagCap = buildCapability({ taskType: 'build-dag', stack: ['airflow', 'snowflake', 'dbt'], domain: 'infrastructure', lastDemonstratedAt: '2026-04-03T13:35:46.190Z' })
  const res = exportPackageToCartridge({
    packageDir: PKG, outPath: OUT, key, publisherId: 'io.github.agentibus',
    installationSalt: randomBytes(32), extraCapabilities: [dagCap],
  })
  cartridgeId = res.cartridgeId
  res.cart.close()
})

after(cleanup)

test('export produces a valid .acx with ROM objects, a skill index, and capabilities', () => {
  const cart = Cartridge.open(OUT, { readonly: true })
  assert.equal(cart.db.prepare('PRAGMA application_id').get().application_id, APPLICATION_ID)
  assert.ok(cart.romObjects().length > 0)
  assert.match(cart.getMeta('acx.rom_manifest_hash'), /^sha256:[0-9a-f]{64}$/)
  const skills = cart.db.prepare('SELECT name FROM acx_skill').all().map((r) => r.name)
  assert.ok(skills.length >= 1)
  const caps = cart.db.prepare('SELECT json FROM capabilities').all().map((r) => JSON.parse(r.json))
  assert.ok(caps.some((c) => c.taskType === 'build-dag'))
  // purl normalization happened (airflow -> pkg:pypi/apache-airflow)
  const dag = caps.find((c) => c.taskType === 'build-dag')
  assert.ok(dag.stack.includes('pkg:pypi/apache-airflow'))
  cart.close()
})

test('exported cartridge id embeds the publisher + slug', () => {
  assert.match(cartridgeId, /^io\.github\.agentibus\/scenario-research-designer@/)
})

test('field-learned records are quarantined by default (no repoId leaks into ROM memory)', () => {
  const cart = Cartridge.open(OUT, { readonly: true })
  const mems = cart.db.prepare('SELECT payload FROM memory').all().map((r) => JSON.parse(r.payload))
  // memory-records.json entry has repoLabel "Company Standby" but repoId null -> portable
  for (const m of mems) {
    if (m.portable) assert.equal(m.codebaseFingerprint ?? null, null)
  }
  cart.close()
})

test('unknown-signer verification is portable; registered signer is trusted/local', () => {
  const c1 = Cartridge.open(OUT, { readonly: true })
  assert.equal(evaluateTrust(c1, { registry: emptyTrustRegistry() }).trust, 'portable')
  c1.close()

  const c2 = Cartridge.open(OUT, { readonly: true })
  const reg = trustedRegistry(key, 'io.github.agentibus')
  assert.equal(evaluateTrust(c2, { registry: reg }).trust, 'trusted')
  c2.close()

  const c3 = Cartridge.open(OUT, { readonly: true })
  assert.equal(evaluateTrust(c3, { registry: reg, localKeyId: key.keyid }).trust, 'local')
  c3.close()
})

test('strip-to-ROM on the exported cartridge preserves the manifest hash', () => {
  const STRIP = tmpAcxPath('research-designer.stripped.acx')
  copyFileSync(OUT, STRIP)
  const c = Cartridge.open(STRIP)
  const proof = stripToRom(c)
  assert.equal(proof.equal, true, `${proof.before} != ${proof.after}`)
  c.close()
})

test('a ROM tamper on the exported cartridge is detected', () => {
  const TAMPER = tmpAcxPath('research-designer.tampered.acx')
  copyFileSync(OUT, TAMPER)
  const c = Cartridge.open(TAMPER)
  c.db.prepare("UPDATE objects SET oid='sha256:deadbeef' WHERE source_ref LIKE 'capability:%' AND oid=(SELECT oid FROM objects WHERE source_ref LIKE 'capability:%' LIMIT 1)").run()
  const v = evaluateTrust(c, { registry: trustedRegistry(key, 'io.github.agentibus'), localKeyId: key.keyid })
  assert.equal(v.trust, 'tampered')
  c.close()
})

test('§7.5 scrub gate FAILS CLOSED: export is blocked when a portable record carries a secret', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acx-badpkg-'))
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    name: 'Poisoned Agent', role: 'backend_dev', techStack: ['typescript'],
    exportedAt: '2026-01-01T00:00:00.000Z', vectorEngine: 'local-hash-128',
  }))
  writeFileSync(join(dir, 'memory-records.json'), JSON.stringify([{
    id: 'leak-1', title: 'Deploy note', repoId: null, repoLabel: 'portable-core',
    summary: 'set AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE for the pipeline',
    sourceType: 'knowledge', timestamp: '2026-01-01T00:00:00Z', impact: 'neutral', xpAwarded: 0, tags: ['ops'],
  }]))
  const badOut = tmpAcxPath('poisoned.acx')
  assert.throws(
    () => exportPackageToCartridge({ packageDir: dir, outPath: badOut, key, publisherId: 'io.github.agentibus', installationSalt: randomBytes(32) }),
    /scrub gate blocked export/,
  )
})

test('rebuilding the ROM manifest from the stored objects reproduces the signed hash', () => {
  const cart = Cartridge.open(OUT, { readonly: true })
  const recomputed = buildRomManifest(cart).manifestHash
  assert.equal(recomputed, cart.getMeta('acx.rom_manifest_hash'))
  cart.close()
})
