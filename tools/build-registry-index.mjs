// Build registry/index.json by verifying every pushed cartridge.
// Run in CI on every push: it REJECTS (non-zero exit) any tampered cartridge, so a
// git-based registry cannot list a cartridge whose signed ROM was altered.
//   node --experimental-sqlite tools/build-registry-index.mjs
import { readdirSync, readFileSync, existsSync, writeFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Cartridge } from '../src/container.mjs'
import { evaluateTrust, emptyTrustRegistry, loadTrustRegistry } from '../src/trust.mjs'
import { validatePackageSpec } from '../src/packagespec.mjs'
import { validatePublishableWorkflow } from '../src/cal.mjs'
import { verifyWorkflow, workflowCard } from '../src/workflow.mjs'
import {
  agentGraphCard,
  validatePublishableAgentGraph,
  verifyAgentGraph,
} from '../src/agent-graph.mjs'
import { registryPolicyIssues } from '../src/share.mjs'

const REGISTRY = join(new URL('.', import.meta.url).pathname, '..', 'registry')
const CARTRIDGES = join(REGISTRY, 'cartridges')
const WORKFLOWS = join(REGISTRY, 'cals')
const GRAPHS = join(REGISTRY, 'graphs')

function registry() {
  const p = join(REGISTRY, 'trust-registry.json')
  try { return existsSync(p) ? loadTrustRegistry(p) : emptyTrustRegistry() } catch { return emptyTrustRegistry() }
}

function findCartridges(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...findCartridges(p))
    else if (e.name.endsWith('.acx')) out.push(p)
  }
  return out
}

function findWorkflows(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...findWorkflows(p))
    else if (e.name.endsWith('.cal.json')) out.push(p)
  }
  return out
}

function findAgentGraphs(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...findAgentGraphs(p))
    else if (e.name.endsWith('.agent-graph.json')) out.push(p)
  }
  return out
}

function summarize(acxPath, reg) {
  const cart = Cartridge.open(acxPath, { readonly: true })
  try {
    const meta = cart.allMeta()
    const v = evaluateTrust(cart, { registry: reg })
    const spec = validatePackageSpec(cart)
    const caps = cart.db.prepare('SELECT json FROM capabilities').all()
      .map((r) => JSON.parse(r.json)).map((c) => ({ taskType: c.taskType, stack: c.stack, domain: c.domain, verified: !!c.proficiency?.verified }))
    let level = null
    for (const a of cart.db.prepare("SELECT document FROM attestations WHERE type='vc-2.0'").all()) {
      const res = JSON.parse(a.document).credentialSubject?.result?.[0]
      if (res) { level = { acxLevel: res['acx:acxLevel'], careerTier: res['acx:careerTier'], boundToRom: res['acx:cartridgeRomDigest'] === meta['acx.rom_manifest_hash'] }; break }
    }
    return {
      _sourceTimestamp: meta['acx.created_at'],
      slug: relative(CARTRIDGES, acxPath).replace(/\.acx$/, '').replace(/\//g, '__'),
      path: relative(REGISTRY, acxPath),
      name: meta['acx.agent_name'], publisher: meta['acx.publisher_id'], role: meta['acx.role'],
      provider: meta['acx.provider'], model: meta['acx.model'],
      trust: v.trust, trustStatus: v.status, specClean: spec.ok,
      romHash: meta['acx.rom_manifest_hash'], bytes: statSync(acxPath).size,
      capabilities: caps, level,
    }
  } finally { cart.close() }
}

function summarizeWorkflow(workflowPath, reg) {
  const workflow = JSON.parse(readFileSync(workflowPath, 'utf8'))
  const issues = validatePublishableWorkflow(workflow)
  const verification = verifyWorkflow(workflow, { registry: reg })
  const card = workflowCard(workflow, verification)
  return {
    _sourceTimestamp: workflow.integrity?.signedAt,
    path: relative(REGISTRY, workflowPath),
    id: card.id,
    version: card.version,
    name: card.name,
    description: card.description,
    license: card.license,
    tags: card.tags,
    publisher: card.publisher,
    trust: card.trust,
    trustStatus: card.status,
    digest: card.digest,
    participants: card.participants,
    participantCount: card.participantCount,
    nodeCount: card.nodeCount,
    capabilities: card.capabilities,
    publishable: issues.length === 0,
    signed: card.signed,
    issues: [...verification.issues, ...issues],
    accepted: verification.ok && verification.signed && issues.length === 0,
  }
}

function summarizeAgentGraph(graphPath, reg) {
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'))
  const issues = validatePublishableAgentGraph(graph)
  const verification = verifyAgentGraph(graph, { registry: reg })
  const card = agentGraphCard(graph, verification)
  return {
    _sourceTimestamp: graph?.integrity?.signedAt,
    path: relative(REGISTRY, graphPath),
    id: card.id,
    version: card.version,
    name: card.name,
    description: card.description,
    license: card.license,
    tags: card.tags,
    publisher: card.publisher,
    trust: card.trust,
    trustStatus: card.status,
    digest: card.digest,
    actorCount: card.actorCount,
    knowledgeCount: card.knowledgeCount,
    routeCount: card.routeCount,
    loopCount: card.loopCount,
    convergenceCount: card.convergenceCount,
    intents: card.intents,
    actors: card.actors,
    knowledge: card.knowledge,
    loops: card.loops,
    publishable: issues.length === 0,
    signed: card.signed,
    issues: [...verification.issues, ...issues],
    accepted: verification.ok && verification.signed && issues.length === 0,
  }
}

const reg = registry()
const rejected = registryPolicyIssues(REGISTRY).map((reason) => ({
  type: 'policy',
  path: reason.split(':', 1)[0],
  reason,
}))
const files = findCartridges(CARTRIDGES)
const rawEntries = []
for (const f of files) {
  const s = summarize(f, reg)
  if (s.trust === 'tampered' || s.trustStatus === 'invalid' || !s.specClean) rejected.push({ path: s.path, trust: s.trust, specClean: s.specClean })
  else rawEntries.push(s)
}
const sourceTimestamps = rawEntries.map((entry) => entry._sourceTimestamp).filter(Boolean)
const entries = rawEntries.map(({ _sourceTimestamp, ...entry }) => entry)
entries.sort((a, b) => (b.level?.acxLevel ?? -1) - (a.level?.acxLevel ?? -1) || a.name.localeCompare(b.name))

const workflowEntries = []
for (const file of findWorkflows(WORKFLOWS)) {
  const summary = summarizeWorkflow(file, reg)
  if (!summary.accepted) {
    rejected.push({ path: summary.path, trust: summary.trust, publishable: summary.publishable, type: 'workflow' })
  } else {
    const { accepted: _accepted, issues: _issues, _sourceTimestamp, ...entry } = summary
    if (_sourceTimestamp) sourceTimestamps.push(_sourceTimestamp)
    workflowEntries.push(entry)
  }
}
workflowEntries.sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version))

const agentGraphEntries = []
const seenAgentGraphIds = new Set()
const seenAgentGraphIdentities = new Set()
for (const file of findAgentGraphs(GRAPHS)) {
  const summary = summarizeAgentGraph(file, reg)
  const graphRelativePath = relative(GRAPHS, file).replaceAll('\\', '/')
  const canonicalPath = `${summary.id}.agent-graph.json`
  const identity = `${summary.id}\u0000${summary.version}\u0000${summary.digest}`
  if (graphRelativePath !== canonicalPath) {
    rejected.push({
      path: summary.path,
      trust: summary.trust,
      publishable: summary.publishable,
      type: 'agent-graph',
      reason: `non-canonical graph path (expected graphs/${canonicalPath})`,
    })
  } else if (seenAgentGraphIds.has(summary.id) || seenAgentGraphIdentities.has(identity)) {
    rejected.push({
      path: summary.path,
      trust: summary.trust,
      publishable: summary.publishable,
      type: 'agent-graph',
      reason: `duplicate Agent Graph identity '${summary.id}@${summary.version}'`,
    })
  } else if (!summary.accepted) {
    rejected.push({ path: summary.path, trust: summary.trust, publishable: summary.publishable, type: 'agent-graph' })
  } else {
    seenAgentGraphIds.add(summary.id)
    seenAgentGraphIdentities.add(identity)
    const { accepted: _accepted, issues: _issues, _sourceTimestamp, ...entry } = summary
    if (_sourceTimestamp) sourceTimestamps.push(_sourceTimestamp)
    agentGraphEntries.push(entry)
  }
}
agentGraphEntries.sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version))

const index = {
  schemaVersion: 'acx.registry-index/1',
  generatedAt: sourceTimestamps.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) || '1970-01-01T00:00:00.000Z',
  count: entries.length,
  cartridges: entries,
  workflowCount: workflowEntries.length,
  workflows: workflowEntries,
  agentGraphCount: agentGraphEntries.length,
  agentGraphs: agentGraphEntries,
}
writeFileSync(join(REGISTRY, 'index.json'), JSON.stringify(index, null, 2) + '\n')
console.log(`indexed ${entries.length} cartridge(s) -> registry/index.json`)
for (const e of entries) console.log(`  ${e.name.padEnd(16)} ${e.publisher.padEnd(24)} trust=${e.trust.padEnd(8)} level=${e.level ? e.level.careerTier + ' Lv.' + e.level.acxLevel : '—'} spec=${e.specClean ? 'clean' : 'ISSUES'}`)
console.log(`indexed ${workflowEntries.length} signed workflow(s) -> registry/index.json`)
for (const workflow of workflowEntries) console.log(`  ${workflow.id.padEnd(20)} v${workflow.version.padEnd(10)} trust=${workflow.trust.padEnd(8)} team=${workflow.participantCount} nodes=${workflow.nodeCount}`)
console.log(`indexed ${agentGraphEntries.length} signed agent graph(s) -> registry/index.json`)
for (const graph of agentGraphEntries) console.log(`  ${graph.id.padEnd(20)} v${graph.version.padEnd(10)} trust=${graph.trust.padEnd(8)} actors=${graph.actorCount} routes=${graph.routeCount} loops=${graph.loopCount}`)
if (rejected.length) {
  console.error(`\nREJECTED ${rejected.length} artifact(s) (tampered / invalid / unsigned / unclean spec):`)
  for (const r of rejected) {
    if (r.type === 'policy') console.error(`  ✗ ${r.reason}`)
    else if (r.reason) console.error(`  ✗ ${r.path}  ${r.reason}`)
    else console.error(`  ✗ ${r.path}  trust=${r.trust}${['workflow', 'agent-graph'].includes(r.type) ? ' publishable=' + r.publishable : ' specClean=' + r.specClean}`)
  }
  process.exit(1)
}
