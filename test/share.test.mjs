import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  prepareAgentShare,
  prepareWorkflowShare,
  registryPolicyIssues,
  sharePullRequestBody,
} from '../src/share.mjs'
import { REPO_ROOT } from '../src/paths.mjs'

const AGENT = join(REPO_ROOT, 'registry', 'cartridges', 'io.github.ridgeworks', 'ada-ridge', 'cartridge.acx')
const WORKFLOW = join(REPO_ROOT, 'registry', 'cals', 'research-council.cal.json')

function registryDir() {
  return mkdtempSync(join(tmpdir(), 'acx-share-'))
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
