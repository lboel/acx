// Embedding + real LanceDB materialization. The materialization test is skipped
// unless the optional pylance venv is present (tools/lance/.venv).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { REPO_ROOT, SAMPLE_PACKAGE_DIR } from '../src/paths.mjs'
import { embed, embedMemory, DIM, ENGINE_ID } from '../src/embed.mjs'
import { Cartridge } from '../src/container.mjs'
import { generateSigningKey } from '../src/sign.mjs'
import { exportPackageToCartridge } from '../src/export.mjs'
import { evaluateTrust, emptyTrustRegistry } from '../src/trust.mjs'

test('local-hash-128 embed is 128-dim, deterministic, and L2-normalized', () => {
  const v = embed('build a partitioned airflow dag with snowflake')
  assert.equal(v.length, DIM)
  assert.equal(ENGINE_ID, 'local-hash-128')
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  assert.ok(Math.abs(norm - 1) < 1e-9, `norm ${norm} not ~1`)
  assert.deepEqual(embed('same text'), embed('same text'))
  assert.notDeepEqual(embed('alpha'), embed('beta'))
})

test('empty text embeds to an all-zero vector', () => {
  assert.deepEqual(embed(''), new Array(DIM).fill(0))
})

const PY = join(REPO_ROOT, 'tools', 'lance', '.venv', 'bin', 'python')
test('materializes a genuine LanceDB dataset into the SAVE zone without breaking the ROM signature',
  { skip: existsSync(PY) ? false : 'pylance venv not installed (tools/lance/.venv)' }, async () => {
    const { materializeLance } = await import('../tools/materialize-lance.mjs')
    const out = join(tmpdir(), `acx-lance-test-${randomBytes(5).toString('hex')}.acx`)
    const key = generateSigningKey()
    exportPackageToCartridge({ packageDir: SAMPLE_PACKAGE_DIR, outPath: out, key, publisherId: 'io.github.test', installationSalt: randomBytes(32) })

    // ROM verifies before
    let c = Cartridge.open(out, { readonly: true })
    const before = evaluateTrust(c, { registry: emptyTrustRegistry() }).trust
    c.close()
    assert.ok(before !== 'tampered')

    const r = materializeLance(out, {})
    assert.ok(r.rows >= 1)
    assert.match(r.vectorType, /fixed_size_list.*128/)
    assert.ok(existsSync(r.standalone))
    // a genuine Lance dataset has _versions / data
    assert.ok(existsSync(join(r.standalone, 'data')) && existsSync(join(r.standalone, '_versions')))

    // embedded in the cartridge + ROM signature still intact
    c = Cartridge.open(out, { readonly: true })
    const files = c.listFiles('save/vectors/memories.lance/')
    assert.ok(files.length >= 1, 'lance files embedded in SAVE zone')
    assert.equal(c.getMeta('acx.lance_present'), 'true')
    const after = evaluateTrust(c, { registry: emptyTrustRegistry() })
    c.close()
    assert.notEqual(after.trust, 'tampered') // SAVE-zone add MUST NOT break the ROM signature

    rmSync(out, { force: true })
    rmSync(out.replace(/\.acx$/, '') + '.memories.lance', { recursive: true, force: true })
    rmSync(out + '.key.pem', { force: true })
  })
