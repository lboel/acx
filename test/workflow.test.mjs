import { test } from 'node:test'
import assert from 'node:assert/strict'

import { evalCondition, lintCal, resolveParticipants, validateCalStructure, validatePublishableWorkflow } from '../src/cal.mjs'
import { generateSigningKey, signEnvelope } from '../src/sign.mjs'
import { buildWorkflowStatement, signWorkflow, verifyWorkflow, workflowDigest } from '../src/workflow.mjs'
import { trustedRegistry } from './helpers.mjs'

function fixture() {
  return {
    schemaVersion: 'acx.cal/1',
    id: 'review-and-ship',
    version: '1.0.0',
    name: 'Review and ship',
    description: 'A builder produces a change and records a verified completion artifact.',
    license: 'Apache-2.0',
    authors: [{ name: 'ACX Test Authors' }],
    tags: ['coding', 'review'],
    participants: [
      {
        alias: 'builder',
        bind: 'slot',
        slot: {
          role: 'backend_dev',
          minLevel: { careerTier: 'mid', acxLevel: 10 },
          capabilities: [{ taskType: 'implement-feature', stack: ['pkg:generic/node'] }],
        },
      },
    ],
    rac: [
      {
        id: 'code-map',
        kind: 'code-map',
        description: 'A current map of modules, boundaries, and verification commands.',
        required: true,
        check: { type: 'mcp-resource', hint: 'repo://map' },
      },
    ],
    variables: [{ name: 'review', type: 'object' }],
    limits: { maxSteps: 8, maxParallel: 1 },
    start: 'start',
    nodes: [
      { id: 'start', type: 'event', event: 'start' },
      {
        id: 'build',
        type: 'task',
        agent: 'builder',
        action: 'Implement and verify the requested change',
        requires: { capabilities: ['implement-feature'], rac: ['code-map'] },
        sideEffects: 'workspace',
        approval: 'on-request',
        completion: { type: 'verification', commands: ['test'], passIntent: 'all relevant checks pass' },
      },
      { id: 'done', type: 'event', event: 'end' },
    ],
    edges: [
      { from: 'start', to: 'build' },
      { from: 'build', to: 'done' },
    ],
  }
}

test('acx.cal/1 publish profile accepts a complete, bounded workflow', () => {
  assert.deepEqual(validateCalStructure(fixture()), [])
  assert.deepEqual(validatePublishableWorkflow(fixture()), [])
  const malformed = fixture()
  malformed.license = 'not a license???'
  malformed.tags = ['Not-Lowercase']
  malformed.extensions = { vendor: { unsafe: true } }
  const issues = validatePublishableWorkflow(malformed)
  assert.ok(issues.some((issue) => issue.includes('SPDX')))
  assert.ok(issues.some((issue) => issue.includes('lowercase discovery tags')))
  assert.ok(issues.some((issue) => issue.includes("extension namespace 'vendor'")))
})

test('workflow publication blocks secrets, private payload fields, and local home paths', () => {
  const cal = fixture()
  cal.description = 'Review with access_token=super-secret-token-value before shipping.'
  let issues = validatePublishableWorkflow(cal)
  assert.ok(issues.some((issue) => issue.includes('secret-like public metadata')))

  cal.description = fixture().description
  cal.extensions = {
    'dev.acx.test': {
      taskPayload: 'private task body',
    },
  }
  issues = validatePublishableWorkflow(cal)
  assert.ok(issues.some((issue) => issue.includes('private-content or credential-bearing key')))

  delete cal.extensions
  cal.rac[0].check.hint = '/Users/alice/private/repo/map.json'
  issues = validatePublishableWorkflow(cal)
  assert.ok(issues.some((issue) => issue.includes('local home path')))
})

test('workflow lineage is closed, digest-pinned, and safe to render as a link', () => {
  const cal = fixture()
  cal.lineage = {
    parents: [{
      artifactType: 'workflow',
      publisherId: 'io.github.upstream',
      id: 'review-and-ship',
      version: '0.9.0',
      digest: `sha256:${'a'.repeat(64)}`,
      relation: 'fork',
      source: 'https://github.com/upstream/acx/blob/main/review-and-ship.cal.json',
    }],
    note: 'Keeps the upstream review contract while changing the delivery role.',
  }
  assert.deepEqual(validatePublishableWorkflow(cal), [])

  cal.lineage.parents[0].source = 'https://user:secret@example.com/workflow.json'
  cal.lineage.parents[0].execute = 'fetch-parent'
  const issues = validateCalStructure(cal)
  assert.ok(issues.some((issue) => issue.includes('absolute HTTPS URL without credentials')))
  assert.ok(issues.some((issue) => issue.includes("unknown property 'execute'")))

  const duplicate = structuredClone(cal.lineage.parents[0])
  delete duplicate.execute
  duplicate.source = 'https://example.com/workflow.json'
  duplicate.relation = 'derived-from'
  cal.lineage.parents.push(duplicate)
  assert.ok(validateCalStructure(cal).some((issue) => issue.includes('duplicates another lineage parent')))

  cal.lineage.parents = Array.from({ length: 9 }, (_, index) => ({
    artifactType: 'workflow',
    publisherId: 'io.github.upstream',
    id: `parent-${index}`,
    digest: `sha256:${String(index).repeat(64)}`,
    relation: 'remix',
  }))
  cal.lineage.note = null
  const boundedIssues = validateCalStructure(cal)
  assert.ok(boundedIssues.some((issue) => issue.includes('1-8 parent artifacts')))
  assert.ok(boundedIssues.some((issue) => issue.includes('note must be a 1-1000 character string')))
})

test('workflow signing rejects lineage that collides with its own immutable coordinate', () => {
  const key = generateSigningKey()
  const cal = fixture()
  cal.lineage = {
    parents: [{
      artifactType: 'workflow',
      publisherId: 'io.github.acxtest',
      id: cal.id,
      version: cal.version,
      digest: `sha256:${'b'.repeat(64)}`,
      relation: 'supersedes',
    }],
  }
  assert.throws(
    () => signWorkflow(cal, key, { publisherId: 'io.github.acxtest' }),
    /collides with the artifact's own registry identity/,
  )
  cal.lineage.parents[0].version = '0.9.0'
  assert.doesNotThrow(() => signWorkflow(cal, key, { publisherId: 'io.github.acxtest' }))
})

test('CAL conditions are closed structured data and resolve declared state', () => {
  const ctx = { vars: { review: { outcome: 'completed' } }, rac: { 'code-map': { available: true } } }
  assert.equal(evalCondition({ var: 'review.outcome', op: 'eq', value: 'completed' }, ctx), true)
  assert.equal(evalCondition({ all: [{ racAvailable: 'code-map' }, { not: { var: 'review.outcome', op: 'ne', value: 'completed' } }] }, ctx), true)
  assert.equal(evalCondition({ expression: 'process.exit()' }, ctx), false)
})

test('structural linter rejects duplicates, dangling conditions, and malformed completion contracts', () => {
  const cal = fixture()
  cal.participants.push(structuredClone(cal.participants[0]))
  cal.nodes[1].completion = { type: 'verification', commands: [] }
  cal.edges[1].when = { var: 'missing.outcome', op: 'eq', value: true }
  const issues = validateCalStructure(cal)
  assert.ok(issues.some((issue) => issue.includes("duplicate participant alias 'builder'")))
  assert.ok(issues.some((issue) => issue.includes('verification completion commands must be non-empty')))
  assert.ok(issues.some((issue) => issue.includes('verification completion needs passIntent')))
  assert.ok(issues.some((issue) => issue.includes("undeclared variable 'missing'")))
})

test('structural linter rejects unknown fields and malformed objects without throwing', () => {
  const cal = fixture()
  cal.execute = 'rm -rf /'
  cal.edges[0].when = { always: true, expression: 'process.exit()' }
  cal.participants.push(null)
  cal.participants[0].slot.capabilities = {}
  cal.nodes[1].requires.rac = {}
  const issues = lintCal(cal, [], { resolve: true }).issues
  assert.ok(issues.some((issue) => issue.includes("workflow contains unknown property 'execute'")))
  assert.ok(issues.some((issue) => issue.includes("contains unknown property 'expression'")))
  assert.ok(issues.some((issue) => issue === 'participant must be an object'))
  assert.ok(issues.some((issue) => issue.includes('slot.capabilities must be an array')))
  assert.ok(issues.some((issue) => issue.includes('requires.rac must be an array')))
})

test('cyclic workflows fail closed unless limits.maxSteps bounds the loop', () => {
  const cal = fixture()
  cal.edges.push({ from: 'build', to: 'build', when: { var: 'review.outcome', op: 'ne', value: 'completed' } })
  delete cal.limits.maxSteps
  assert.ok(validateCalStructure(cal).some((issue) => issue.includes('limits.maxSteps')))
  cal.limits.maxSteps = 12
  assert.ok(!validateCalStructure(cal).some((issue) => issue.includes('limits.maxSteps')))
})

test('slot staffing checks role, proven tier/level, capability, and stack', () => {
  const cal = fixture()
  const candidate = {
    path: '/agent.acx',
    card: {
      name: 'Builder',
      role: 'backend_dev',
      level: { tier: 'senior', acxLevel: 18, proven: true },
      moves: [{ taskType: 'implement-feature', stack: ['pkg:generic/node', 'pkg:generic/postgresql'] }],
      skills: [],
    },
  }
  assert.equal(resolveParticipants(cal, [candidate])[0].bound, candidate)
  candidate.card.moves[0].stack = ['pkg:generic/python']
  assert.equal(resolveParticipants(cal, [candidate])[0].bound, null)
})

test('slot minimum level rejects high self-claims unless the level is proven', () => {
  const cal = fixture()
  const candidate = {
    path: '/claimed-agent.acx',
    card: {
      name: 'Claimed Builder',
      role: 'backend_dev',
      level: {
        tier: 'legend',
        acxLevel: 999,
        claimedAcxLevel: 999,
        proven: false,
      },
      moves: [{ taskType: 'implement-feature', stack: ['pkg:generic/node'] }],
      skills: [],
    },
  }
  assert.equal(resolveParticipants(cal, [candidate])[0].bound, null)
  candidate.card.level.proven = true
  assert.equal(resolveParticipants(cal, [candidate])[0].bound, candidate)
})

test('workflow signing binds the canonical document and verifies as portable', () => {
  const key = generateSigningKey()
  const cal = fixture()
  const signed = signWorkflow(cal, key, {
    publisherId: 'io.github.acxtest',
    signedAt: '2026-07-18T12:00:00.000Z',
  })
  const verification = verifyWorkflow(signed)
  assert.equal(verification.ok, true)
  assert.equal(verification.signed, true)
  assert.equal(verification.trust, 'portable')
  assert.equal(signed.integrity.digest, workflowDigest(cal).digest)
})

test('workflow signature covers remix lineage', () => {
  const cal = fixture()
  cal.lineage = {
    parents: [{
      artifactType: 'agent-graph',
      publisherId: 'io.github.upstream',
      id: 'delivery-team',
      version: '1.2.0',
      digest: `sha256:${'c'.repeat(64)}`,
      relation: 'derived-from',
    }],
  }
  const signed = signWorkflow(cal, generateSigningKey(), {
    publisherId: 'io.github.acxtest',
    signedAt: '2026-07-18T12:00:00.000Z',
  })
  signed.lineage.parents[0].relation = 'remix'
  assert.equal(verifyWorkflow(signed).trust, 'tampered')
})

test('workflow verification rejects content tampering and publisher-binding tampering', () => {
  const key = generateSigningKey()
  const signed = signWorkflow(fixture(), key, {
    publisherId: 'io.github.acxtest',
    signedAt: '2026-07-18T12:00:00.000Z',
  })
  const contentTamper = structuredClone(signed)
  contentTamper.nodes[1].action = 'Injected action'
  assert.equal(verifyWorkflow(contentTamper).trust, 'tampered')

  const identityTamper = structuredClone(signed)
  identityTamper.integrity.publisherId = 'io.github.attacker'
  assert.equal(verifyWorkflow(identityTamper).trust, 'tampered')
})

test('workflow verification rejects a valid signature with incomplete in-toto bindings', () => {
  const key = generateSigningKey()
  const signedAt = '2026-07-18T12:00:00.000Z'
  const publisherId = 'io.github.acxtest'
  const signed = signWorkflow(fixture(), key, { publisherId, signedAt })
  const incomplete = buildWorkflowStatement(signed, { publisherId, signedAt })
  incomplete.predicate.participants = 99
  signed.integrity.envelope = signEnvelope(incomplete, key)
  const verification = verifyWorkflow(signed)
  assert.equal(verification.ok, false)
  assert.ok(verification.issues.some((issue) => issue.includes('participants binding mismatch')))
})

test('workflow verification upgrades a namespace-proven publisher to trusted', () => {
  const key = generateSigningKey()
  const signed = signWorkflow(fixture(), key, {
    publisherId: 'io.github.acxtest',
    signedAt: '2026-07-18T12:00:00.000Z',
  })
  const verification = verifyWorkflow(signed, {
    registry: trustedRegistry(key, 'io.github.acxtest'),
    now: '2026-07-18T12:00:00.000Z',
  })
  assert.equal(verification.ok, true)
  assert.equal(verification.trust, 'trusted')
  assert.deepEqual(verification.issues, [])

  const wrongKey = generateSigningKey()
  const poisonedRegistry = trustedRegistry(key, 'io.github.acxtest')
  poisonedRegistry.byKeyId.get(key.keyid).publicKeyPem = wrongKey.publicKeyPem
  const poisoned = verifyWorkflow(signed, { registry: poisonedRegistry })
  assert.equal(poisoned.ok, false)
  assert.ok(poisoned.issues.some((issue) => issue.includes('registry public key does not match')))
})

test('workflow verification fails closed for a key-compromise revocation', () => {
  const key = generateSigningKey()
  const signed = signWorkflow(fixture(), key, {
    publisherId: 'io.github.acxtest',
    signedAt: '2026-07-18T12:00:00.000Z',
  })
  const registry = trustedRegistry(key, 'io.github.acxtest')
  const entry = registry.byKeyId.get(key.keyid)
  entry.status = 'revoked'
  entry.revocationReason = 'key-compromise'
  const verification = verifyWorkflow(signed, { registry })
  assert.equal(verification.ok, false)
  assert.equal(verification.trust, 'tampered')
})

test('workflow lint separates portable structure checks from roster readiness', () => {
  const cal = fixture()
  const portable = lintCal(cal, [], { resolve: false, publish: true })
  const ready = lintCal(cal, [], { resolve: true, publish: true })
  assert.equal(portable.ok, true)
  assert.equal(ready.ok, false)
  assert.ok(ready.issues.some((issue) => issue.includes("participant 'builder' unresolved")))
})
