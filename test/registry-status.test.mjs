import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  activeRegistryStatus,
  registryStatusFor,
  statusIdentityKey,
  validateRegistryStatus,
} from '../src/registry-status.mjs'

function identity(overrides = {}) {
  return {
    artifactType: 'workflow',
    publisherId: 'io.github.acxtest',
    id: 'review-and-ship',
    version: '1.0.0',
    digest: `sha256:${'a'.repeat(64)}`,
    ...overrides,
  }
}

test('registry status accepts an empty public ledger', () => {
  assert.deepEqual(validateRegistryStatus({
    schemaVersion: 'acx.registry-status/1',
    updatedAt: '2026-07-19T12:00:00.000Z',
    entries: [],
  }), [])
})

test('registry status resolves immutable identities without changing cryptographic trust', () => {
  const artifact = identity()
  const entry = {
    artifact,
    status: 'superseded',
    reason: 'A bounded replacement fixes the original completion contract.',
    recordedAt: '2026-07-19T12:00:00.000Z',
    successor: identity({ version: '2.0.0', digest: `sha256:${'b'.repeat(64)}` }),
  }
  const ledger = { byIdentity: new Map([[statusIdentityKey(artifact), entry]]) }
  assert.equal(registryStatusFor(ledger, artifact).status, 'superseded')
  assert.deepEqual(registryStatusFor(ledger, identity({ version: '3.0.0' })), activeRegistryStatus())
})

test('registry status rejects duplicate identities, insecure advisories, and missing successors', () => {
  const artifact = identity()
  const document = {
    schemaVersion: 'acx.registry-status/1',
    updatedAt: 'not-a-date',
    entries: [
      {
        artifact,
        status: 'superseded',
        reason: 'Too short',
        recordedAt: '2026-07-19T12:00:00.000Z',
        advisory: 'http://example.test/advisory',
      },
      {
        artifact,
        status: 'deprecated',
        reason: 'This duplicate entry must be rejected by the ledger validator.',
        recordedAt: '2026-07-19T12:00:00.000Z',
      },
    ],
  }
  const issues = validateRegistryStatus(document)
  assert.ok(issues.some((issue) => issue.includes('updatedAt')))
  assert.ok(issues.some((issue) => issue.includes('successor is required')))
  assert.ok(issues.some((issue) => issue.includes('absolute https')))
  assert.ok(issues.some((issue) => issue.includes('duplicates an earlier')))
})

test('registry status requires SemVer for agent identities too', () => {
  const document = {
    schemaVersion: 'acx.registry-status/1',
    updatedAt: '2026-07-19T12:00:00.000Z',
    entries: [{
      artifact: identity({ artifactType: 'agent', version: undefined }),
      status: 'deprecated',
      reason: 'This agent release must be addressed by its exact immutable coordinate.',
      recordedAt: '2026-07-19T12:00:00.000Z',
    }],
  }
  assert.ok(validateRegistryStatus(document).some((issue) => issue.includes('version is required')))
  document.entries[0].artifact.version = '1.0.0-01'
  assert.ok(validateRegistryStatus(document).some((issue) => issue.includes('version is required')))
})

test('registry status successor keeps the artifact type and changes coordinate', () => {
  const target = identity()
  const document = {
    schemaVersion: 'acx.registry-status/1',
    updatedAt: '2026-07-19T12:00:00.000Z',
    entries: [{
      artifact: target,
      status: 'superseded',
      reason: 'A different immutable release is required to replace this artifact.',
      recordedAt: '2026-07-19T12:00:00.000Z',
      successor: identity({
        artifactType: 'agent-graph',
        digest: `sha256:${'b'.repeat(64)}`,
      }),
    }, {
      artifact: identity({ version: '2.0.0', digest: `sha256:${'c'.repeat(64)}` }),
      status: 'superseded',
      reason: 'A different immutable release is required to replace this artifact.',
      recordedAt: '2026-07-19T12:00:00.000Z',
      successor: identity({ version: '2.0.0', digest: `sha256:${'d'.repeat(64)}` }),
    }],
  }
  const issues = validateRegistryStatus(document)
  assert.ok(issues.some((issue) => issue.includes('artifactType must match')))
  assert.ok(issues.some((issue) => issue.includes('different immutable coordinate')))
})
