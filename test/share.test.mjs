import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  prepareAgentGraphShare,
  prepareAgentShare,
  prepareWorkflowShare,
  registryPolicyIssues,
  sharePullRequestBody,
} from '../src/share.mjs'
import { signAgentGraph } from '../src/agent-graph.mjs'
import { generateSigningKey } from '../src/sign.mjs'
import { Cartridge } from '../src/container.mjs'
import { finalizeAndSign } from '../src/assemble.mjs'
import { signWorkflow } from '../src/workflow.mjs'
import { REPO_ROOT } from '../src/paths.mjs'

const AGENT = join(
  REPO_ROOT,
  'registry',
  'cartridges',
  'io.github.ridgeworks',
  'ada-ridge',
  '1.0.0',
  'cartridge.acx',
)
const WORKFLOW = join(
  REPO_ROOT,
  'registry',
  'cals',
  'io.github.lboel',
  'research-council',
  '1.0.0.cal.json',
)
const AGENT_GRAPH_EXAMPLE = join(REPO_ROOT, 'examples', 'product-delivery.agent-graph.json')

function registryDir() {
  return mkdtempSync(join(tmpdir(), 'acx-share-'))
}

function signedGraphPath(directory) {
  const source = join(directory, 'product-delivery.agent-graph.json')
  const graph = JSON.parse(readFileSync(AGENT_GRAPH_EXAMPLE, 'utf8'))
  for (const loop of graph.loops || []) {
    if (loop.kind === 'acx-workflow') loop.workflowRef.publisherId = 'io.github.lboel'
  }
  const signed = signAgentGraph(graph, generateSigningKey(), {
    publisherId: 'io.github.lboel',
    signedAt: '2026-07-19T12:00:00.000Z',
  })
  writeFileSync(source, JSON.stringify(signed, null, 2) + '\n')
  return source
}

function signedUnversionedAgentPath(directory) {
  const source = join(directory, 'signed-unversioned.acx')
  copyFileSync(AGENT, source)
  const cart = Cartridge.open(source)
  cart.db.prepare(
    "DELETE FROM cartridge WHERE key IN ('acx.artifact_id','acx.artifact_version')",
  ).run()
  cart.db.prepare(
    "DELETE FROM objects WHERE source_ref IN ('cartridge:acx.artifact_id','cartridge:acx.artifact_version')",
  ).run()
  finalizeAndSign(cart, generateSigningKey(), {
    publisherId: cart.getMeta('acx.publisher_id'),
    embeddingEngine: JSON.parse(cart.getMeta('acx.embedding_engine')),
    signedAt: '2026-07-19T12:00:00.000Z',
  })
  cart.close()
  return source
}

test('share agent prepares only the verified artifact and generated discovery card', () => {
  const root = registryDir()
  const plan = prepareAgentShare(AGENT, {
    registryRoot: root,
    publisherId: 'io.github.ridgeworks',
    slug: 'ada-ridge',
  })
  assert.equal(plan.publisher, 'io.github.ridgeworks')
  assert.equal(plan.id, 'ada-ridge')
  assert.equal(plan.version, '1.0.0')
  assert.equal(
    plan.destination,
    join(root, 'cartridges', 'io.github.ridgeworks', 'ada-ridge', '1.0.0', 'cartridge.acx'),
  )
  assert.equal(readFileSync(plan.destination).equals(readFileSync(AGENT)), true)
  assert.match(readFileSync(plan.readme, 'utf8'), /ROM digest/)
  assert.match(sharePullRequestBody(plan), /Private key is not included/)
})

test('share agent dry-run is non-mutating and refuses unsafe identity changes', () => {
  const root = registryDir()
  const dryRun = prepareAgentShare(AGENT, {
    registryRoot: root,
    slug: 'ada-ridge',
    dryRun: true,
  })
  assert.equal(dryRun.changed, true)
  assert.throws(() => readFileSync(dryRun.destination), /ENOENT/)
  assert.throws(
    () => prepareAgentShare(AGENT, { registryRoot: root, slug: '../escape' }),
    /not a safe registry identifier/,
  )
  assert.throws(
    () => prepareAgentShare(AGENT, { registryRoot: root, slug: 'different-agent' }),
    /does not match ROM-bound artifact id/,
  )
  assert.throws(
    () => prepareAgentShare(AGENT, {
      registryRoot: root,
      publisherId: 'io.github.attacker',
      slug: 'ada-ridge',
    }),
    /does not match signed publisher/,
  )
})

test('share rejects signed cartridges without ROM-bound immutable coordinates', () => {
  const root = registryDir()
  const source = signedUnversionedAgentPath(root)
  assert.throws(
    () => prepareAgentShare(source, { registryRoot: root }),
    /ROM-bound artifact id .* missing/,
  )
})

test('public agent sharing rejects every SAVE-zone payload', () => {
  const root = registryDir()
  const source = join(root, 'agent-with-save.acx')
  copyFileSync(AGENT, source)
  const cart = Cartridge.open(source)
  cart.putFile('save/private/field-notes.md', Buffer.from('private field context'))
  cart.close()
  assert.throws(
    () => prepareAgentShare(source, { registryRoot: root, slug: 'agent-with-save' }),
    /ROM-only cartridge; SAVE zone contains data/,
  )
})

test('share workflow preserves signed bytes and renders a reviewable PR body', () => {
  const root = registryDir()
  const plan = prepareWorkflowShare(WORKFLOW, { registryRoot: root })
  assert.equal(plan.publisher, 'io.github.lboel')
  assert.equal(plan.destination, join(root, 'cals', 'io.github.lboel', 'research-council', '1.0.0.cal.json'))
  assert.equal(readFileSync(plan.destination).equals(readFileSync(WORKFLOW)), true)
  const body = sharePullRequestBody(plan)
  assert.match(body, /JCS digest and DSSE\/in-toto signature verified/)
  assert.match(body, /research-council/)
})

test('share agent graph preserves signed bytes and explains its non-executing scope', () => {
  const root = registryDir()
  const source = signedGraphPath(root)
  const plan = prepareAgentGraphShare(source, { registryRoot: root })
  assert.equal(plan.publisher, 'io.github.lboel')
  assert.equal(plan.type, 'agent-graph')
  assert.equal(plan.destination, join(root, 'graphs', 'io.github.lboel', 'product-delivery', '1.0.0.agent-graph.json'))
  assert.equal(readFileSync(plan.destination).equals(readFileSync(source)), true)
  const body = sharePullRequestBody(plan)
  assert.match(body, /\[ \] No task payloads or private knowledge contents are embedded/)
  assert.match(body, /No secret-like metadata or local home path was detected/)
  assert.match(body, /### Lineage/)
  assert.match(body, /No signed parents are declared/)
  assert.match(body, /### Exact workflow dependencies/)
  assert.match(body, /io\.github\.lboel\/research-council@1\.0\.0/)
  assert.match(body, /sha256:[0-9a-f]{64}/)
  assert.match(body, /Share disposition: registry content would change/)
  assert.match(body, /grants no tools or runtime permissions/)
})

test('share accepts signed sub-namespace publishers for path-independent graph artifacts', () => {
  const root = registryDir()
  const source = join(root, 'product-delivery.agent-graph.json')
  const graph = JSON.parse(readFileSync(AGENT_GRAPH_EXAMPLE, 'utf8'))
  for (const loop of graph.loops || []) {
    if (loop.kind === 'acx-workflow') loop.workflowRef.publisherId = 'io.github.lboel'
  }
  const signed = signAgentGraph(graph, generateSigningKey(), {
    publisherId: 'io.github.lboel/product',
    signedAt: '2026-07-19T12:00:00.000Z',
  })
  writeFileSync(source, JSON.stringify(signed, null, 2) + '\n')
  const plan = prepareAgentGraphShare(source, { registryRoot: root })
  assert.equal(plan.publisher, 'io.github.lboel/product')
  assert.equal(plan.destination, join(root, 'graphs', 'io.github.lboel', 'product', 'product-delivery', '1.0.0.agent-graph.json'))
})

test('share refuses symlinked registry destinations before any outside write', () => {
  const root = registryDir()
  const outside = registryDir()
  const source = signedGraphPath(root)
  symlinkSync(outside, join(root, 'graphs'), 'dir')
  assert.throws(
    () => prepareAgentGraphShare(source, { registryRoot: root }),
    /symbolic links are forbidden/,
  )
  assert.equal(existsSync(join(outside, 'io.github.lboel', 'product-delivery', '1.0.0.agent-graph.json')), false)
})

test('versioned agent, workflow, and graph coordinates are immutable even with force', () => {
  const root = registryDir()
  prepareAgentShare(AGENT, { registryRoot: root })
  const changedAgent = join(root, 'changed-agent.acx')
  copyFileSync(AGENT, changedAgent)
  const changedCart = Cartridge.open(changedAgent)
  changedCart.db.exec('VACUUM')
  changedCart.close()
  assert.equal(readFileSync(changedAgent).equals(readFileSync(AGENT)), false)
  assert.throws(
    () => prepareAgentShare(changedAgent, { registryRoot: root, force: true }),
    /immutable registry coordinates cannot be overwritten/,
  )

  prepareWorkflowShare(WORKFLOW, { registryRoot: root })
  const workflow = JSON.parse(readFileSync(WORKFLOW, 'utf8'))
  const changedWorkflow = signWorkflow(workflow, generateSigningKey(), {
    publisherId: 'io.github.lboel',
    signedAt: '2026-07-19T12:01:00.000Z',
  })
  const workflowSource = join(root, 'changed.cal.json')
  writeFileSync(workflowSource, JSON.stringify(changedWorkflow, null, 2) + '\n')
  assert.throws(
    () => prepareWorkflowShare(workflowSource, { registryRoot: root, force: true }),
    /immutable registry coordinates cannot be overwritten/,
  )

  const graphSource = signedGraphPath(root)
  prepareAgentGraphShare(graphSource, { registryRoot: root })
  const graph = JSON.parse(readFileSync(AGENT_GRAPH_EXAMPLE, 'utf8'))
  for (const loop of graph.loops || []) {
    if (loop.kind === 'acx-workflow') loop.workflowRef.publisherId = 'io.github.lboel'
  }
  const changedGraph = signAgentGraph(graph, generateSigningKey(), {
    publisherId: 'io.github.lboel',
    signedAt: '2026-07-19T12:02:00.000Z',
  })
  const changedGraphSource = join(root, 'changed.agent-graph.json')
  writeFileSync(changedGraphSource, JSON.stringify(changedGraph, null, 2) + '\n')
  assert.throws(
    () => prepareAgentGraphShare(changedGraphSource, { registryRoot: root, force: true }),
    /immutable registry coordinates cannot be overwritten/,
  )
})

test('share preparation is idempotent and registry policy rejects private keys', () => {
  const root = registryDir()
  const first = prepareWorkflowShare(WORKFLOW, { registryRoot: root })
  const second = prepareWorkflowShare(WORKFLOW, { registryRoot: root })
  assert.equal(first.changed, true)
  assert.equal(second.changed, false)
  assert.match(sharePullRequestBody(second), /no filesystem change; compare the coordinate with the git base/)

  const safe = join(root, 'notes.md')
  writeFileSync(safe, 'Public key material is allowed when it is explicitly public.')
  assert.deepEqual(registryPolicyIssues(root), [])
  const unsafeDirectory = join(root, 'cartridges', 'io.github.example', 'agent')
  mkdirSync(unsafeDirectory, { recursive: true })
  writeFileSync(join(unsafeDirectory, 'agent.acx.key.pem'), '-----BEGIN PRIVATE KEY-----\nsecret\n')
  const policyIssues = registryPolicyIssues(root)
  assert.ok(policyIssues.some((issue) => issue.includes('secret-bearing filename')))
  assert.ok(policyIssues.some((issue) => issue.includes('private key material')))
})
