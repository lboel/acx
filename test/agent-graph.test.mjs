import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  agentGraphCard,
  agentGraphDigest,
  buildAgentGraphStatement,
  signAgentGraph,
  validateAgentGraphStructure,
  validatePublishableAgentGraph,
  verifyAgentGraph,
} from '../src/agent-graph.mjs'
import { generateSigningKey, signEnvelope } from '../src/sign.mjs'
import { trustedRegistry } from './helpers.mjs'

export function agentGraphFixture() {
  return {
    schemaVersion: 'acx.agent-graph/1',
    id: 'product-delivery',
    version: '1.0.0',
    name: 'Product delivery information graph',
    description: 'A reusable information architecture connecting product intent, research evidence, delivery reporting, and decisions across two agent loops.',
    license: 'Apache-2.0',
    authors: [{ name: 'ACX Test Authors' }],
    tags: ['agent-graph', 'product', 'reporting'],
    limits: {
      maxPropagationHops: 8,
      maxFanout: 8,
    },
    actors: [
      {
        id: 'product-owner',
        kind: 'agent',
        name: 'Product Owner',
        description: 'Owns product intent, priorities, and the final synthesis of loop reports.',
        selector: { roles: ['product_owner'], description: 'One agent accountable for product decisions.' },
        responsibilities: ['Keep priorities and acceptance intent current.'],
      },
      {
        id: 'developers',
        kind: 'group',
        name: 'Developer group',
        description: 'Builds the product and reports progress, risks, and blockers.',
        selector: { capabilities: ['implement-feature'] },
        cardinality: { min: 1, max: 8 },
      },
      {
        id: 'researchers',
        kind: 'group',
        name: 'Research council',
        description: 'Collects and challenges evidence before product decisions.',
        selector: { capabilities: ['research', 'fact-check'] },
      },
    ],
    knowledge: [
      {
        id: 'product-intent',
        kind: 'intent',
        name: 'Product intent',
        description: 'The outcome, audience, constraints, and priority the product should serve.',
        stewards: ['product-owner'],
        audience: ['developers', 'researchers'],
        durability: 'project',
        sensitivity: 'internal',
        freshness: { mode: 'event', description: 'Refresh whenever scope or priority changes.' },
      },
      {
        id: 'delivery-brief',
        kind: 'requirement',
        description: 'The current priority, acceptance intent, and boundaries developers should implement.',
        stewards: ['product-owner'],
        audience: ['developers'],
        durability: 'workflow',
      },
      {
        id: 'delivery-status',
        kind: 'status',
        description: 'Progress, verification results, risks, decisions needed, and blockers from delivery.',
        stewards: ['developers'],
        audience: ['product-owner'],
        durability: 'session',
      },
      {
        id: 'research-evidence',
        kind: 'evidence',
        description: 'Decision-relevant evidence, uncertainty, counterarguments, and source-quality notes.',
        stewards: ['researchers'],
        audience: ['product-owner'],
        durability: 'project',
      },
      {
        id: 'product-decision',
        kind: 'decision',
        description: 'The prioritized decision produced after research and delivery signals converge.',
        stewards: ['product-owner'],
        audience: ['developers', 'researchers'],
        durability: 'project',
      },
    ],
    routes: [
      {
        id: 'po-directs-developers',
        from: 'product-owner',
        to: ['developers'],
        intent: 'direct',
        relationship: 'directs',
        obligation: 'must',
        authority: 'delegated',
        purpose: 'Translate product intent into a clear delivery brief for the developer group.',
        success: 'Developers can state the priority, boundaries, and acceptance intent.',
        carries: ['delivery-brief'],
        returns: ['delivery-status'],
        triggers: [{
          type: 'event',
          events: ['work.requested', 'scope.changed'],
          description: 'Send when work is ready or product scope changes.',
        }],
        delivery: 'broadcast',
        acknowledgement: 'required',
        weight: 1,
        expects: {
          via: 'developers-report-po',
          withinMs: 86_400_000,
          description: 'Developers report progress or a blocker through the declared return route.',
        },
      },
      {
        id: 'po-requests-research',
        from: 'product-owner',
        to: ['researchers'],
        intent: 'request',
        obligation: 'should',
        authority: 'delegated',
        purpose: 'Frame the decision question and request evidence before prioritization.',
        carries: ['product-intent'],
        returns: ['research-evidence'],
        triggers: [{
          type: 'event',
          events: ['decision.requested', 'scope.changed'],
        }],
        expects: {
          via: 'research-advises-po',
          withinMs: 86_400_000,
        },
      },
      {
        id: 'research-advises-po',
        from: 'researchers',
        to: ['product-owner'],
        intent: 'advise',
        obligation: 'must',
        authority: 'advisory',
        purpose: 'Return evidence, uncertainty, and counterarguments to the decision steward.',
        carries: ['research-evidence'],
        triggers: [{
          type: 'event',
          events: ['loop.completed', 'decision.requested'],
        }],
      },
      {
        id: 'developers-report-po',
        from: 'developers',
        to: ['product-owner'],
        intent: 'report',
        obligation: 'must',
        authority: 'informational',
        purpose: 'Report delivery progress, verified outcomes, blockers, and decisions needed.',
        carries: ['delivery-status'],
        triggers: [{
          type: 'event',
          events: ['loop.progressed', 'loop.blocked', 'loop.completed'],
        }],
        cadence: { mode: 'event', description: 'Report at milestones, blockers, and scope changes.' },
      },
    ],
    loops: [
      {
        id: 'discovery-loop',
        kind: 'acx-workflow',
        description: 'Research and challenge evidence before a product decision.',
        workflowRef: {
          publisherId: 'io.github.lboel',
          id: 'research-council',
          version: '1.0.0',
          digest: 'sha256:3300ea74052dc7f76aa81f79cd37b269267b2f06b4ae4710480dc73d62102ed8',
        },
        actorBindings: [{ actor: 'researchers', participants: ['scout', 'skeptic', 'editor'] }],
        imports: ['product-intent'],
        exports: ['research-evidence'],
      },
      {
        id: 'delivery-loop',
        kind: 'acx-workflow',
        description: 'Design, build, and review the selected product increment.',
        workflowRef: {
          publisherId: 'io.github.lboel',
          id: 'ship-a-feature',
          version: '1.0.0',
          digest: 'sha256:588424a9ec12483ce13f28e81e9d0833777676bbd2c0c0686bbc27bb58f93dee',
        },
        actorBindings: [{ actor: 'developers', participants: ['architect', 'builder', 'reviewer'] }],
        imports: ['delivery-brief', 'product-decision'],
        exports: ['delivery-status'],
      },
    ],
    convergence: [
      {
        id: 'product-steering',
        description: 'Research and delivery signals meet before the next product priority is committed.',
        inputs: [
          { loop: 'discovery-loop', knowledge: ['research-evidence'] },
          { loop: 'delivery-loop', knowledge: ['delivery-status'] },
        ],
        steward: 'product-owner',
        contributors: ['developers', 'researchers'],
        policy: {
          mode: 'steward-synthesis',
          description: 'The Product Owner reconciles evidence, delivery reality, and product intent and records the rationale.',
        },
        outputs: ['product-decision'],
        trigger: 'When either loop reaches a decision-ready milestone or reports a material change.',
        failureMode: 'Escalate missing or contradictory evidence instead of silently choosing a priority.',
        limits: {
          maxWaitMs: 3_600_000,
          maxRounds: 2,
        },
      },
    ],
  }
}

test('acx.agent-graph/1 accepts fuzzy prose with hard reference invariants', () => {
  const graph = agentGraphFixture()
  assert.deepEqual(validateAgentGraphStructure(graph), [])
  assert.deepEqual(validatePublishableAgentGraph(graph), [])
  assert.equal(graph.routes[0].weight, 1)
  assert.equal(graph.routes[0].relationship, 'directs')
})

test('agent graph lineage is closed, signed metadata with safe parent sources', () => {
  const graph = agentGraphFixture()
  graph.lineage = {
    parents: [{
      artifactType: 'agent-graph',
      publisherId: 'io.github.upstream',
      id: 'product-delivery',
      version: '0.8.0',
      digest: `sha256:${'d'.repeat(64)}`,
      relation: 'remix',
      source: 'https://github.com/upstream/acx/blob/main/product-delivery.agent-graph.json',
    }],
  }
  assert.deepEqual(validatePublishableAgentGraph(graph), [])
  graph.lineage.parents[0].source = 'javascript:alert(1)'
  graph.lineage.parents[0].extra = true
  const issues = validateAgentGraphStructure(graph)
  assert.ok(issues.some((issue) => issue.includes('absolute HTTPS URL without credentials')))
  assert.ok(issues.some((issue) => issue.includes("unknown property 'extra'")))
})

test('agent graph signing rejects self-lineage but permits an older version', () => {
  const graph = agentGraphFixture()
  graph.lineage = {
    parents: [{
      artifactType: 'agent-graph',
      publisherId: 'io.github.acxtest',
      id: graph.id,
      version: graph.version,
      digest: `sha256:${'e'.repeat(64)}`,
      relation: 'supersedes',
    }],
  }
  const key = generateSigningKey()
  assert.throws(
    () => signAgentGraph(graph, key, { publisherId: 'io.github.acxtest' }),
    /collides with the artifact's own registry identity/,
  )
  graph.lineage.parents[0].version = '0.9.0'
  assert.doesNotThrow(() => signAgentGraph(graph, key, { publisherId: 'io.github.acxtest' }))
})

test('information cycles are valid because routes do not execute task loops', () => {
  const graph = agentGraphFixture()
  assert.ok(graph.routes.some((route) => route.from === 'product-owner' && route.to.includes('developers')))
  assert.ok(graph.routes.some((route) => route.from === 'developers' && route.to.includes('product-owner')))
  assert.deepEqual(validateAgentGraphStructure(graph), [])
})

test('knowledge modules are descriptions only and all actor/knowledge refs fail closed', () => {
  const graph = agentGraphFixture()
  graph.knowledge[0].content = 'private roadmap'
  graph.knowledge[0].stewards = ['missing-owner']
  graph.routes[0].carries = ['missing-knowledge']
  const issues = validateAgentGraphStructure(graph)
  assert.ok(issues.some((issue) => issue.includes("unknown property 'content'")))
  assert.ok(issues.some((issue) => issue.includes("unknown actor 'missing-owner'")))
  assert.ok(issues.some((issue) => issue.includes("unknown knowledge 'missing-knowledge'")))
})

test('malformed collection fields return issues instead of throwing', () => {
  const graph = agentGraphFixture()
  graph.knowledge[0].stewards = {}
  graph.knowledge[0].audience = {}
  graph.routes[0].to = {}
  graph.routes[0].carries = {}
  graph.routes[0].returns = {}
  graph.loops[0].actorBindings = {}
  graph.loops[0].imports = {}
  graph.convergence[0].inputs = {}
  graph.convergence[0].contributors = {}
  graph.convergence[0].outputs = {}
  assert.doesNotThrow(() => validateAgentGraphStructure(graph))
  const issues = validateAgentGraphStructure(graph)
  assert.ok(issues.length >= 10)
  assert.ok(issues.some((issue) => issue.includes('stewards must be an array')))
  assert.ok(issues.some((issue) => issue.includes('inputs must contain at least two loop inputs')))
})

test('discovery cards remain safe for malformed top-level collections and items', () => {
  const malformed = {
    schemaVersion: 'acx.agent-graph/1',
    actors: {},
    knowledge: [null],
    routes: [null],
    loops: [null],
    tags: {},
  }
  assert.doesNotThrow(() => agentGraphCard(malformed))
  const card = agentGraphCard(malformed)
  assert.equal(card.actorCount, 0)
  assert.deepEqual(card.knowledge, [])
  assert.deepEqual(card.intents, [])
  assert.deepEqual(card.loops, [])
})

test('periodic cadence needs an interval and fuzzy weights stay in [0,1]', () => {
  const graph = agentGraphFixture()
  graph.routes[0].cadence = { mode: 'periodic', description: 'Send a digest.' }
  graph.routes[0].weight = 1.2
  const issues = validateAgentGraphStructure(graph)
  assert.ok(issues.some((issue) => issue.includes('intervalMs is required')))
  assert.ok(issues.some((issue) => issue.includes('weight must be between 0 and 1')))
})

test('self-routes, empty cardinality, empty returns, and ambiguous loop bindings fail closed', () => {
  const graph = agentGraphFixture()
  graph.actors[0].cardinality = {}
  graph.routes[0].to = ['product-owner']
  graph.routes[0].returns = []
  graph.loops[0].actorBindings.push({ actor: 'product-owner', participants: ['scout'] })
  graph.loops[0].imports = []
  const issues = validateAgentGraphStructure(graph)
  assert.ok(issues.some((issue) => issue.includes('cardinality must declare min or max')))
  assert.ok(issues.some((issue) => issue.includes('must not route an actor to itself')))
  assert.ok(issues.some((issue) => issue.includes('returns must be non-empty')))
  assert.ok(issues.some((issue) => issue.includes("binds participant 'scout' to more than one actor")))
  assert.ok(issues.some((issue) => issue.includes('imports must be non-empty')))
})

test('route triggers are structured and returned knowledge uses an explicit reverse route', () => {
  const graph = agentGraphFixture()
  graph.routes[0].triggers = ['work-ready']
  graph.routes[1].expects.via = 'developers-report-po'
  const issues = validateAgentGraphStructure(graph)
  assert.ok(issues.some((issue) => issue.includes('triggers[0] must be an object')))
  assert.ok(issues.some((issue) => issue.includes('return route from a target back to the source')))
  assert.ok(issues.some((issue) => issue.includes("must carry returned knowledge 'research-evidence'")))
})

test('duplicate structured triggers and periodic freshness without a bound fail closed', () => {
  const graph = agentGraphFixture()
  graph.routes[0].triggers = [
    { type: 'event', events: ['scope.changed'], description: 'Refresh direction.' },
    { description: 'Refresh direction.', events: ['scope.changed'], type: 'event' },
  ]
  graph.knowledge[0].freshness = { mode: 'periodic', description: 'Keep the intent current.' }
  const issues = validateAgentGraphStructure(graph)
  assert.ok(issues.some((issue) => issue.includes('triggers must not contain duplicates')))
  assert.ok(issues.some((issue) => issue.includes('maxAgeMs is required')))
})

test('graph and convergence bounds fail closed', () => {
  const graph = agentGraphFixture()
  graph.limits.maxFanout = 0
  graph.convergence[0].limits.maxRounds = 0
  const issues = validateAgentGraphStructure(graph)
  assert.ok(issues.some((issue) => issue.includes('limits.maxFanout must be a positive integer')))
  assert.ok(issues.some((issue) => issue.includes('limits.maxRounds must be a positive integer')))
})

test('mandatory direction for the same knowledge has one acyclic source', () => {
  const graph = agentGraphFixture()
  graph.routes.push({
    id: 'developers-direct-po',
    from: 'developers',
    to: ['product-owner'],
    intent: 'direct',
    obligation: 'must',
    authority: 'delegated',
    purpose: 'Attempt to reverse the mandatory delivery authority for the same information.',
    carries: ['delivery-brief'],
    triggers: [{ type: 'manual' }],
  })
  graph.routes.push({
    id: 'research-directs-developers',
    from: 'researchers',
    to: ['developers'],
    intent: 'direct',
    obligation: 'must',
    authority: 'delegated',
    purpose: 'Attempt to create a second mandatory source for the same delivery brief.',
    carries: ['delivery-brief'],
    triggers: [{ type: 'manual' }],
  })
  const issues = validateAgentGraphStructure(graph)
  assert.ok(issues.some((issue) => issue.includes('conflicting mandatory direction')))
  assert.ok(issues.some((issue) => issue.includes('must be acyclic')))
})

test('convergence requires at least two distinct loops', () => {
  const graph = agentGraphFixture()
  graph.convergence[0].inputs[1].loop = 'discovery-loop'
  assert.ok(validateAgentGraphStructure(graph).some((issue) => issue.includes('two distinct loops')))
})

test('convergence only accepts loop exports that reach the output steward', () => {
  const graph = agentGraphFixture()
  graph.convergence[0].inputs[0].knowledge = ['product-intent']
  const issues = validateAgentGraphStructure(graph)
  assert.ok(issues.some((issue) => issue.includes("is not exported by loop 'discovery-loop'")))
  assert.ok(issues.some((issue) => issue.includes("has no route to convergence steward 'product-owner'")))
})

test('publication profile rejects incomplete discovery metadata', () => {
  const graph = agentGraphFixture()
  graph.version = 'latest'
  graph.license = 'not a license???'
  graph.tags = ['Not-Lowercase']
  graph.homepage = null
  graph.extensions = null
  graph.actors[0].name = null
  const issues = validatePublishableAgentGraph(graph)
  assert.ok(issues.some((issue) => issue.includes('SemVer')))
  assert.ok(issues.some((issue) => issue.includes('SPDX')))
  assert.ok(issues.some((issue) => issue.includes('lowercase discovery tags')))
  assert.ok(issues.some((issue) => issue.includes('agent graph.homepage must not be null')))
  assert.ok(issues.some((issue) => issue.includes('agent graph.extensions must not be null')))
  assert.ok(issues.some((issue) => issue.includes('agent graph.actors[0].name must not be null')))

  const wrongTypes = agentGraphFixture()
  wrongTypes.homepage = 42
  wrongTypes.authors = {}
  wrongTypes.tags = 'agent-graph'
  wrongTypes.integrity = {}
  const structuralIssues = validateAgentGraphStructure(wrongTypes)
  assert.ok(structuralIssues.some((issue) => issue.includes('homepage must be an absolute URI')))
  assert.ok(structuralIssues.some((issue) => issue.includes('authors must be a non-empty array')))
  assert.ok(structuralIssues.some((issue) => issue.includes('tags must be an array')))
  assert.ok(structuralIssues.some((issue) => issue.includes('integrity must contain exactly')))
})

test('publication profile requires pinned ACX loops and rejects secret-like metadata', () => {
  const graph = agentGraphFixture()
  delete graph.loops[0].workflowRef.digest
  delete graph.loops[1].workflowRef.publisherId
  graph.description += ' token ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
  const issues = validatePublishableAgentGraph(graph)
  assert.ok(issues.some((issue) => issue.includes('workflowRef.digest is required')))
  assert.ok(issues.some((issue) => issue.includes('workflowRef.publisherId is required')))
  assert.ok(issues.some((issue) => issue.includes('secret-like public metadata')))
})

test('publication rejects private extension keys and local home-path disclosure', () => {
  const graph = agentGraphFixture()
  graph.extensions = {
    'com.example': {
      content: 'Private source and transcript material.',
      credentials: { password: 'ordinaryword' },
      accessToken: 'short-value',
      clientSecret: 'short-value',
      apiTokenValue: 'short-value',
      privateKeyMaterial: 'short-value',
      knowledgeContent: 'short-value',
      checksum: `sha256:${'a'.repeat(64)}`,
    },
  }
  graph.knowledge[0].locator = {
    type: 'manual',
    description: 'Read /Users/alice/private/product-intent.md.',
  }
  const issues = validatePublishableAgentGraph(graph)
  assert.ok(issues.some((issue) => issue.includes('extensions.com.example.content uses a private-content')))
  assert.ok(issues.some((issue) => issue.includes('extensions.com.example.credentials uses a private-content')))
  assert.ok(issues.some((issue) => issue.includes('extensions.com.example.accessToken uses a private-content')))
  assert.ok(issues.some((issue) => issue.includes('extensions.com.example.clientSecret uses a private-content')))
  assert.ok(issues.some((issue) => issue.includes('extensions.com.example.apiTokenValue uses a private-content')))
  assert.ok(issues.some((issue) => issue.includes('extensions.com.example.privateKeyMaterial uses a private-content')))
  assert.ok(issues.some((issue) => issue.includes('extensions.com.example.knowledgeContent uses a private-content')))
  assert.ok(issues.some((issue) => issue.includes('high-entropy@agent-graph.extensions.com.example.checksum')))
  assert.ok(issues.some((issue) => issue.includes('exposes a local home path')))

  for (const path of ['~/private/product-intent.md', 'C:\\Users\\alice\\private\\product-intent.md']) {
    const platformGraph = agentGraphFixture()
    platformGraph.knowledge[0].locator = { type: 'manual', description: `Read ${path}.` }
    assert.ok(validatePublishableAgentGraph(platformGraph).some((issue) => issue.includes('exposes a local home path')))
  }
})

test('agent graph signing binds the canonical graph and verifies as portable', () => {
  const key = generateSigningKey()
  const graph = agentGraphFixture()
  const signed = signAgentGraph(graph, key, {
    publisherId: 'io.github.acxtest',
    signedAt: '2026-07-19T10:00:00.000Z',
  })
  const verification = verifyAgentGraph(signed)
  assert.equal(verification.ok, true)
  assert.equal(verification.signed, true)
  assert.equal(verification.trust, 'portable')
  assert.equal(signed.integrity.digest, agentGraphDigest(graph).digest)
})

test('agent graph verification rejects knowledge or identity tampering', () => {
  const key = generateSigningKey()
  const signed = signAgentGraph(agentGraphFixture(), key, {
    publisherId: 'io.github.acxtest',
    signedAt: '2026-07-19T10:00:00.000Z',
  })
  const contentTamper = structuredClone(signed)
  contentTamper.knowledge[0].description = 'Injected intent'
  assert.equal(verifyAgentGraph(contentTamper).trust, 'tampered')

  const identityTamper = structuredClone(signed)
  identityTamper.integrity.publisherId = 'io.github.attacker'
  assert.equal(verifyAgentGraph(identityTamper).trust, 'tampered')
})

test('verification rejects a correctly signed graph with an invalid publication structure', () => {
  const key = generateSigningKey()
  const invalid = agentGraphFixture()
  invalid.knowledge[0].content = 'private roadmap'
  const signed = signAgentGraph(invalid, key, {
    publisherId: 'io.github.acxtest',
    signedAt: '2026-07-19T10:00:00.000Z',
  })
  const verification = verifyAgentGraph(signed)
  assert.equal(verification.ok, false)
  assert.equal(verification.trust, 'tampered')
  assert.ok(verification.issues.some((issue) => issue.includes("unknown property 'content'")))
})

test('agent graph verification checks all in-toto count bindings', () => {
  const key = generateSigningKey()
  const signedAt = '2026-07-19T10:00:00.000Z'
  const publisherId = 'io.github.acxtest'
  const signed = signAgentGraph(agentGraphFixture(), key, { publisherId, signedAt })
  const incomplete = buildAgentGraphStatement(signed, { publisherId, signedAt })
  incomplete.predicate.routes = 99
  signed.integrity.envelope = signEnvelope(incomplete, key)
  const verification = verifyAgentGraph(signed)
  assert.equal(verification.ok, false)
  assert.ok(verification.issues.some((issue) => issue.includes('routes binding mismatch')))
})

test('namespace proof upgrades an agent graph from portable to trusted', () => {
  const key = generateSigningKey()
  const signed = signAgentGraph(agentGraphFixture(), key, {
    publisherId: 'io.github.acxtest',
    signedAt: '2026-07-19T10:00:00.000Z',
  })
  const verification = verifyAgentGraph(signed, {
    registry: trustedRegistry(key, 'io.github.acxtest'),
    now: '2026-07-19T10:00:00.000Z',
  })
  assert.equal(verification.ok, true)
  assert.equal(verification.trust, 'trusted')

  for (const mutate of [
    (entry) => { delete entry.status },
    (entry) => { entry.status = 'suspended' },
    (entry) => { entry.namespaceProof = { type: 'github-oidc' } },
    (entry) => { entry.namespaceProof.oidcSubject = 'repo:attacker/acx:ref:refs/heads/main' },
    (entry) => { delete entry.algorithm },
  ]) {
    const registry = trustedRegistry(key, 'io.github.acxtest')
    mutate(registry.byKeyId.get(key.keyid))
    const downgraded = verifyAgentGraph(signed, {
      registry,
      now: '2026-07-19T10:00:00.000Z',
    })
    assert.equal(downgraded.ok, true)
    assert.equal(downgraded.trust, 'portable')
  }

  const dnsPublisher = 'com.example.teamx'
  const dnsSigned = signAgentGraph(agentGraphFixture(), key, {
    publisherId: dnsPublisher,
    signedAt: '2026-07-19T10:00:00.000Z',
  })
  const dnsRegistry = trustedRegistry(key, dnsPublisher)
  assert.equal(verifyAgentGraph(dnsSigned, {
    registry: dnsRegistry,
    now: '2026-07-19T10:00:00.000Z',
  }).trust, 'trusted')
  dnsRegistry.byKeyId.get(key.keyid).namespaceProof = {
    method: 'github-oidc',
    oidcSubject: 'repo:attacker/acx:ref:refs/heads/main',
    oidcIssuer: 'https://token.actions.githubusercontent.com',
    verifiedAt: '2026-01-01T00:00:00Z',
  }
  assert.equal(verifyAgentGraph(dnsSigned, {
    registry: dnsRegistry,
    now: '2026-07-19T10:00:00.000Z',
  }).trust, 'portable')
})

test('agent graph card exposes a safe deterministic discovery summary', () => {
  const key = generateSigningKey()
  const signed = signAgentGraph(agentGraphFixture(), key, {
    publisherId: 'io.github.acxtest',
    signedAt: '2026-07-19T10:00:00.000Z',
  })
  const card = agentGraphCard(signed)
  assert.equal(card.actorCount, 3)
  assert.equal(card.knowledgeCount, 5)
  assert.equal(card.routeCount, 4)
  assert.equal(card.loopCount, 2)
  assert.equal(card.convergenceCount, 1)
  assert.deepEqual(card.intents, ['advise', 'direct', 'report', 'request'])
})
