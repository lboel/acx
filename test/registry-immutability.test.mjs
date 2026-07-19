import test from 'node:test'
import assert from 'node:assert/strict'
import {
  immutableViolations,
  isImmutableRegistryPath,
  parseNameStatusZ,
} from '../tools/check-registry-immutability.mjs'

test('registry immutability recognizes only canonical signed artifact coordinates', () => {
  assert.equal(
    isImmutableRegistryPath('registry/cartridges/io.github.example/reviewer/1.2.3/cartridge.acx'),
    true,
  )
  assert.equal(
    isImmutableRegistryPath('registry/cals/io.github.example/ship-it/1.2.3-rc.1.cal.json'),
    true,
  )
  assert.equal(
    isImmutableRegistryPath('registry/graphs/io.github.example/product-delivery/1.2.3+build.7.agent-graph.json'),
    true,
  )
  assert.equal(
    isImmutableRegistryPath('registry/cals/io.github.example/team/ship-it/1.2.3.cal.json'),
    true,
  )
  assert.equal(
    isImmutableRegistryPath('registry/graphs/io.github.example/product/product-delivery/1.2.3.agent-graph.json'),
    true,
  )
  assert.equal(
    isImmutableRegistryPath('registry/cartridges/io.github.example/reviewer/cartridge.acx'),
    false,
  )
  assert.equal(
    isImmutableRegistryPath('registry/cartridges/io.github.example/reviewer/1.2.3/README.md'),
    false,
  )
  assert.equal(isImmutableRegistryPath('registry/status.json'), false)
})

test('registry immutability allows additions but refuses rewrites, deletion, and rename sources', () => {
  const changes = [
    {
      status: 'A',
      path: 'registry/cartridges/io.github.example/new-agent/1.0.0/cartridge.acx',
    },
    {
      status: 'M',
      path: 'registry/cals/io.github.example/ship-it/1.0.0.cal.json',
    },
    {
      status: 'D',
      path: 'registry/graphs/io.github.example/team/1.0.0.agent-graph.json',
    },
    {
      status: 'M',
      path: 'registry/index.json',
    },
  ]
  assert.deepEqual(immutableViolations(changes), [changes[1], changes[2]])
})

test('registry immutability parses NUL-delimited git output under a monorepo prefix', () => {
  const parsed = parseNameStatusZ(
    [
      'M',
      'agent-cartridge/registry/cals/io.github.example/ship-it/1.0.0.cal.json',
      'A',
      'agent-cartridge/registry/cals/io.github.example/ship-it/2.0.0.cal.json',
      '',
    ].join('\0'),
    'agent-cartridge/',
  )
  assert.deepEqual(parsed, [
    { status: 'M', path: 'registry/cals/io.github.example/ship-it/1.0.0.cal.json' },
    { status: 'A', path: 'registry/cals/io.github.example/ship-it/2.0.0.cal.json' },
  ])
})
