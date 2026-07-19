import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
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
import { REPO_ROOT } from '../src/paths.mjs'

const AGENT = join(REPO_ROOT, 'registry', 'cartridges', 'io.github.ridgeworks', 'ada-ridge', 'cartridge.acx')
const WORKFLOW = join(REPO_ROOT, 'registry', 'cals', 'research-council.cal.json')
const AGENT_GRAPH_EXAMPLE = join(REPO_ROOT, 'examples', 'product-delivery.agent-graph.json')

function registryDir() {
  return mkdtempSync(join(tmpdir(), 'acx-share-'))
}

function signedGraphPath(directory) {
  const source = join(directory, 'product-delivery.agent-graph.json')
  const graph = JSON.parse(readFileSync(AGENT_GRAPH_EXAMPLE, 'utf8'))
  const signed = signAgentGraph(graph, generateSigningKey(), {
    publisherId: 'io.github.lboel',
    signedAt: '2026-07-19T12:00:00.000Z',
  })
  writeFileSync(source, JSON.stringify(signed, null, 2) + '\n')
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
    () => prepareAgentShare(AGENT, {
      registryRoot: root,
      publisherId: 'io.github.attacker',
      slug: 'ada-ridge',
    }),
    /does not match signed publisher/,
  )
})

test('share workflow preserves signed bytes and renders a reviewable PR body', () => {
  const root = registryDir()
  const plan = prepareWorkflowShare(WORKFLOW, { registryRoot: root })
  assert.equal(plan.publisher, 'io.github.lboel')
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
  assert.equal(readFileSync(plan.destination).equals(readFileSync(source)), true)
  const body = sharePullRequestBody(plan)
  assert.match(body, /\[ \] No task payloads or private knowledge contents are embedded/)
  assert.match(body, /No secret-like metadata or local home path was detected/)
  assert.match(body, /grants no tools or runtime permissions/)
})

test('share accepts signed sub-namespace publishers for path-independent graph artifacts', () => {
  const root = registryDir()
  const source = join(root, 'product-delivery.agent-graph.json')
  const graph = JSON.parse(readFileSync(AGENT_GRAPH_EXAMPLE, 'utf8'))
  const signed = signAgentGraph(graph, generateSigningKey(), {
    publisherId: 'io.github.lboel/product',
    signedAt: '2026-07-19T12:00:00.000Z',
  })
  writeFileSync(source, JSON.stringify(signed, null, 2) + '\n')
  const plan = prepareAgentGraphShare(source, { registryRoot: root })
  assert.equal(plan.publisher, 'io.github.lboel/product')
  assert.equal(plan.destination, join(root, 'graphs', 'product-delivery.agent-graph.json'))
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
  assert.equal(existsSync(join(outside, 'product-delivery.agent-graph.json')), false)
})

test('share preparation is idempotent and registry policy rejects private keys', () => {
  const root = registryDir()
  const first = prepareWorkflowShare(WORKFLOW, { registryRoot: root })
  const second = prepareWorkflowShare(WORKFLOW, { registryRoot: root })
  assert.equal(first.changed, true)
  assert.equal(second.changed, false)

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
