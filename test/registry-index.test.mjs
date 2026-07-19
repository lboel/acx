import test from 'node:test'
import assert from 'node:assert/strict'
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Cartridge } from '../src/container.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY = join(ROOT, 'registry')
const BUILDER = join(ROOT, 'tools', 'build-registry-index.mjs')
const temporaryDirectories = []

function tempDirectory(label) {
  const path = mkdtempSync(join(tmpdir(), `${label}-`))
  temporaryDirectories.push(path)
  return path
}

function build(registry = REGISTRY) {
  return spawnSync(
    process.execPath,
    ['--experimental-sqlite', BUILDER, '--registry', registry, '--quiet'],
    { cwd: ROOT, encoding: 'utf8' },
  )
}

test.after(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true })
})

test('registry index is count-consistent, immutable-path addressed, and dependency resolved', () => {
  const index = JSON.parse(readFileSync(join(REGISTRY, 'index.json'), 'utf8'))
  const schema = JSON.parse(readFileSync(join(ROOT, 'schemas', 'registry-index.schema.json'), 'utf8'))
  assert.equal(index.schemaVersion, 'acx.registry-index/1')
  assert.equal(schema.properties.schemaVersion.const, index.schemaVersion)
  assert.equal(index.count, index.cartridges.length)
  assert.equal(index.workflowCount, index.workflows.length)
  assert.equal(index.agentGraphCount, index.agentGraphs.length)
  assert.equal(index.templateCount, index.templates.length)
  assert.equal(
    index.artifactCount,
    index.cartridges.length + index.workflows.length + index.agentGraphs.length + index.templates.length,
  )
  for (const cartridge of index.cartridges) {
    assert.equal(
      cartridge.path,
      `cartridges/${cartridge.publisher}/${cartridge.id}/${cartridge.version}/cartridge.acx`,
    )
    assert.match(cartridge.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/)
    assert.equal(typeof cartridge.latest, 'boolean')
  }
  for (const workflow of index.workflows) {
    assert.equal(
      workflow.path,
      `cals/${workflow.publisher}/${workflow.id}/${workflow.version}.cal.json`,
    )
    assert.match(workflow.digest, /^sha256:[0-9a-f]{64}$/)
  }
  for (const graph of index.agentGraphs) {
    assert.equal(
      graph.path,
      `graphs/${graph.publisher}/${graph.id}/${graph.version}.agent-graph.json`,
    )
    assert.equal(graph.dependenciesResolved, true)
    assert.ok(graph.dependencies.length >= 1)
    assert.ok(graph.dependencies.every((dependency) => dependency.status === 'resolved'))
  }
})

test('registry index build is byte-stable and keeps unproven claims out of effective ranking', () => {
  const before = readFileSync(join(REGISTRY, 'index.json'))
  const result = build()
  assert.equal(result.status, 0, result.stderr)
  const after = readFileSync(join(REGISTRY, 'index.json'))
  assert.equal(after.equals(before), true)
  const index = JSON.parse(after)
  for (const cartridge of index.cartridges) {
    assert.equal(cartridge.level, null)
    assert.notEqual(cartridge.levelClaim?.verificationState, 'verified')
    assert.ok(cartridge.capabilities.every((capability) => capability.verified === false))
  }
})

test('registry index rejects an Agent Graph whose pinned workflow is absent', () => {
  const registry = join(tempDirectory('acx-registry-dependency'), 'registry')
  cpSync(REGISTRY, registry, { recursive: true })
  const dependency = join(
    registry,
    'cals',
    'io.github.lboel',
    'research-council',
    '1.0.0.cal.json',
  )
  const backup = join(tempDirectory('acx-registry-dependency-backup'), 'workflow.cal.json')
  copyFileSync(dependency, backup)
  rmSync(dependency)
  const indexBefore = readFileSync(join(registry, 'index.json'))

  const result = build(registry)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /workflow dependency is missing/)
  assert.equal(readFileSync(join(registry, 'index.json')).equals(indexBefore), true)
})

test('registry index rejects a public cartridge containing SAVE-zone state', () => {
  const registry = join(tempDirectory('acx-registry-save-zone'), 'registry')
  cpSync(REGISTRY, registry, { recursive: true })
  const index = JSON.parse(readFileSync(join(registry, 'index.json'), 'utf8'))
  const cartridgePath = join(registry, ...index.cartridges[0].path.split('/'))
  const cartridge = Cartridge.open(cartridgePath)
  cartridge.putFile('save/private/field-notes.md', Buffer.from('private field context'))
  cartridge.close()
  const indexBefore = readFileSync(join(registry, 'index.json'))

  const result = build(registry)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /must be ROM-only; SAVE zone contains data/)
  assert.equal(readFileSync(join(registry, 'index.json')).equals(indexBefore), true)
})

test('registry index rejects a versioned cartridge placed at a legacy path', () => {
  const registry = join(tempDirectory('acx-registry-legacy-path'), 'registry')
  cpSync(REGISTRY, registry, { recursive: true })
  const index = JSON.parse(readFileSync(join(registry, 'index.json'), 'utf8'))
  const entry = index.cartridges[0]
  const canonical = join(registry, ...entry.path.split('/'))
  const legacy = join(registry, 'cartridges', entry.publisher, entry.id, 'cartridge.acx')
  mkdirSync(dirname(legacy), { recursive: true })
  copyFileSync(canonical, legacy)
  rmSync(canonical)
  const indexBefore = readFileSync(join(registry, 'index.json'))

  const result = build(registry)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /non-canonical cartridge path/)
  assert.equal(readFileSync(join(registry, 'index.json')).equals(indexBefore), true)
})

test('registry index rejects a lifecycle successor that is not an accepted artifact', () => {
  const registry = join(tempDirectory('acx-registry-missing-successor'), 'registry')
  cpSync(REGISTRY, registry, { recursive: true })
  const index = JSON.parse(readFileSync(join(registry, 'index.json'), 'utf8'))
  const target = index.cartridges[0]
  writeFileSync(join(registry, 'status.json'), `${JSON.stringify({
    schemaVersion: 'acx.registry-status/1',
    updatedAt: '2026-07-19T12:00:00.000Z',
    entries: [{
      artifact: {
        artifactType: 'agent',
        publisherId: target.publisher,
        id: target.id,
        version: target.version,
        digest: target.digest,
      },
      status: 'superseded',
      reason: 'A future corrected release should replace this registry example.',
      recordedAt: '2026-07-19T12:00:00.000Z',
      successor: {
        artifactType: 'agent',
        publisherId: target.publisher,
        id: target.id,
        version: '2.0.0',
        digest: `sha256:${'f'.repeat(64)}`,
      },
    }],
  }, null, 2)}\n`)

  const result = build(registry)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /status successor is not present with the exact immutable identity and digest/)
})
