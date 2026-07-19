#!/usr/bin/env node
// Deterministically build registry/index.json from verified, immutable ACX
// artifacts. The generated index is discovery metadata, never a substitute for
// local verification of the signed artifact bytes.

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentGraphCard, validatePublishableAgentGraph, verifyAgentGraph } from '../src/agent-graph.mjs'
import { validatePublishableWorkflow } from '../src/cal.mjs'
import { Cartridge } from '../src/container.mjs'
import { resolveCartridgeEvidence } from '../src/level/resolution.mjs'
import { validatePackageSpec } from '../src/packagespec.mjs'
import {
  loadRegistryStatus,
  registryStatusFor,
  statusIdentityKey,
} from '../src/registry-status.mjs'
import { registryPolicyIssues } from '../src/share.mjs'
import { emptyTrustRegistry, evaluateTrust, loadTrustRegistry } from '../src/trust.mjs'
import { verifyWorkflow, workflowCard } from '../src/workflow.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(args) {
  const options = { registryRoot: join(ROOT, 'registry'), quiet: false }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--quiet') {
      options.quiet = true
      continue
    }
    if (argument === '--registry') {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error('--registry requires a directory')
      options.registryRoot = resolve(value)
      continue
    }
    throw new Error(`unknown registry index option '${argument}'`)
  }
  return options
}

const CLI_OPTIONS = parseArgs(process.argv.slice(2))
const REGISTRY = CLI_OPTIONS.registryRoot
const CARTRIDGES = join(REGISTRY, 'cartridges')
const WORKFLOWS = join(REGISTRY, 'cals')
const GRAPHS = join(REGISTRY, 'graphs')
const TEMPLATES = join(REGISTRY, 'templates')
const PUBLISHER_SEGMENT_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9][a-z0-9-]*$/
const ID_RE = /^[a-z][a-z0-9._-]{0,127}$/
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

function posixPath(root, path) {
  return relative(root, path).replaceAll('\\', '/')
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`)
  }
}

function jsonArray(value) {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function registryTrust() {
  const path = join(REGISTRY, 'trust-registry.json')
  try {
    return existsSync(path) ? loadTrustRegistry(path) : emptyTrustRegistry()
  } catch {
    return emptyTrustRegistry()
  }
}

function registryStatus() {
  const path = join(REGISTRY, 'status.json')
  if (!existsSync(path)) {
    return {
      document: {
        schemaVersion: 'acx.registry-status/1',
        updatedAt: '1970-01-01T00:00:00.000Z',
        entries: [],
      },
      byIdentity: new Map(),
    }
  }
  return loadRegistryStatus(path)
}

function findFiles(root, suffix) {
  const files = []
  if (!existsSync(root)) return files
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) {
      files.push({ path, unsafe: 'symbolic links are forbidden' })
    } else if (entry.isDirectory()) {
      files.push(...findFiles(path, suffix))
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      files.push({ path, unsafe: null })
    }
  }
  return files
}

function parseSemver(value) {
  const match = SEMVER_RE.exec(value || '')
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? null,
  }
}

function comparePrerelease(left, right) {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index] == null) return -1
    if (right[index] == null) return 1
    if (left[index] === right[index]) continue
    const leftNumeric = /^\d+$/.test(left[index])
    const rightNumeric = /^\d+$/.test(right[index])
    if (leftNumeric && rightNumeric) return Number(left[index]) - Number(right[index])
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return left[index].localeCompare(right[index])
  }
  return 0
}

export function compareSemver(left, right) {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (!a || !b) throw new Error(`cannot compare invalid SemVer '${!a ? left : right}'`)
  return a.major - b.major
    || a.minor - b.minor
    || a.patch - b.patch
    || comparePrerelease(a.prerelease, b.prerelease)
}

function markLatest(entries) {
  const groups = new Map()
  for (const entry of entries) {
    const key = `${entry.publisher}\u0000${entry.id}`
    const current = groups.get(key)
    if (!current || compareSemver(entry.version, current.version) > 0) groups.set(key, entry)
  }
  for (const entry of entries) {
    entry.latest = groups.get(`${entry.publisher}\u0000${entry.id}`) === entry
  }
}

function lifecycleFor(ledger, artifactType, entry) {
  return registryStatusFor(ledger, {
    artifactType,
    publisherId: entry.publisher,
    id: entry.id,
    version: entry.version ?? undefined,
    digest: entry.digest,
  })
}

function cartridgeSaveZoneCounts(cart) {
  return {
    memory: Number(cart.db.prepare("SELECT COUNT(*) n FROM memory WHERE zone='save'").get().n || 0),
    files: Number(cart.db.prepare("SELECT COUNT(*) n FROM sqlar WHERE name GLOB 'save/*'").get().n || 0),
    objects: Number(cart.db.prepare("SELECT COUNT(*) n FROM objects WHERE zone='save'").get().n || 0),
    vectors: Number(cart.db.prepare("SELECT COUNT(*) n FROM vectors WHERE zone='save'").get().n || 0),
  }
}

function summarizeCartridge(path, trustRegistry, statusLedger) {
  const cart = Cartridge.open(path, { readonly: true })
  try {
    const meta = cart.allMeta()
    const verification = evaluateTrust(cart, { registry: trustRegistry })
    const packageSpec = validatePackageSpec(cart)
    const evidence = resolveCartridgeEvidence(cart)
    const save = cartridgeSaveZoneCounts(cart)
    const saveTotal = Object.values(save).reduce((sum, count) => sum + count, 0)
    const pathParts = posixPath(CARTRIDGES, path).split('/')
    const [pathPublisher, pathId, pathVersion, filename] = pathParts
    const relativePath = posixPath(REGISTRY, path)
    const publisher = meta['acx.publisher_id']
    const id = meta['acx.artifact_id']
    const version = meta['acx.artifact_version']
    const cartridgeIdentityConsistent = String(meta['acx.cartridge_id'] || '').startsWith(`${publisher}/${id}@`)
    const expected = `cartridges/${publisher}/${id}/${version}/cartridge.acx`
    const canonicalPath = pathParts.length === 4
      && filename === 'cartridge.acx'
      && pathPublisher === publisher
      && pathId === id
      && pathVersion === version
      && relativePath === expected
      && PUBLISHER_SEGMENT_RE.test(publisher || '')
      && /^[a-z][a-z0-9-]{0,63}$/.test(id || '')
      && SEMVER_RE.test(version || '')
      && cartridgeIdentityConsistent
    const capabilities = evidence.capabilities
      .filter((item) => item.capability)
      .map((item) => ({
        taskType: item.capability.taskType,
        stack: item.capability.stack || [],
        domain: item.capability.domain || null,
        claimedVerified: item.claimedVerified,
        verified: item.verified,
        verificationState: item.verificationState,
      }))
    const entry = {
      _sourceTimestamp: meta['acx.created_at'],
      id,
      slug: `${publisher}__${id}`,
      path: relativePath,
      name: meta['acx.agent_name'],
      publisher,
      role: meta['acx.role'],
      provider: meta['acx.provider'],
      model: meta['acx.model'],
      version,
      description: meta['acx.description']
        || `A portable ${(meta['acx.role'] || 'agent').replaceAll('_', ' ')} cartridge.`,
      license: meta['acx.license'] || null,
      authors: jsonArray(meta['acx.authors']),
      tags: jsonArray(meta['acx.tags']),
      homepage: meta['acx.homepage'] || null,
      trust: verification.trust,
      trustStatus: verification.status,
      specClean: packageSpec.ok,
      romHash: meta['acx.rom_manifest_hash'],
      digest: meta['acx.rom_manifest_hash'],
      bytes: statSync(path).size,
      capabilities,
      level: evidence.level.proven
        ? {
            acxLevel: evidence.level.acxLevel,
            careerTier: evidence.level.tier,
            boundToRom: evidence.level.boundToRom,
            proven: true,
            verificationState: evidence.level.verificationState,
          }
        : null,
      levelClaim: {
        acxLevel: evidence.level.claimedAcxLevel,
        careerTier: evidence.level.claimedTier,
        verificationState: evidence.level.verificationState,
      },
    }
    entry.registryStatus = lifecycleFor(statusLedger, 'agent', entry)
    return {
      entry,
      accepted: canonicalPath
        && verification.trust !== 'tampered'
        && verification.trust !== 'legacy'
        && verification.status !== 'invalid'
        && packageSpec.ok
        && saveTotal === 0,
      reason: !id || !/^[a-z][a-z0-9-]{0,63}$/.test(id)
        ? 'missing or invalid ROM-bound acx.artifact_id'
        : !version || !SEMVER_RE.test(version)
          ? 'missing or invalid ROM-bound acx.artifact_version'
          : !cartridgeIdentityConsistent
            ? 'ROM-bound acx.cartridge_id conflicts with publisher/artifact identity'
          : !canonicalPath
              ? `non-canonical cartridge path (expected ${expected})`
              : !packageSpec.ok
                ? `unclean package: ${packageSpec.issues.join('; ')}`
                : saveTotal > 0
                  ? `public registry cartridges must be ROM-only; SAVE zone contains data (${Object.entries(save).map(([kind, count]) => `${kind}=${count}`).join(', ')})`
                  : verification.summary,
    }
  } finally {
    cart.close()
  }
}

function summarizeWorkflow(path, trustRegistry, statusLedger) {
  const workflow = readJson(path, posixPath(REGISTRY, path))
  const profileIssues = validatePublishableWorkflow(workflow)
  const verification = verifyWorkflow(workflow, { registry: trustRegistry })
  const card = workflowCard(workflow, verification)
  const expected = `cals/${verification.publisherId}/${card.id}/${card.version}.cal.json`
  const relativePath = posixPath(REGISTRY, path)
  const entry = {
    _sourceTimestamp: workflow.integrity?.signedAt,
    path: relativePath,
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
    lineage: card.lineage,
    publishable: profileIssues.length === 0,
    signed: card.signed,
  }
  entry.registryStatus = lifecycleFor(statusLedger, 'workflow', entry)
  const issues = [...verification.issues, ...profileIssues]
  if (relativePath !== expected) issues.push(`non-canonical workflow path (expected ${expected})`)
  return {
    entry,
    accepted: verification.ok && verification.signed && profileIssues.length === 0 && relativePath === expected,
    issues,
  }
}

function summarizeAgentGraph(path, trustRegistry, statusLedger) {
  const graph = readJson(path, posixPath(REGISTRY, path))
  const profileIssues = validatePublishableAgentGraph(graph)
  const verification = verifyAgentGraph(graph, { registry: trustRegistry })
  const card = agentGraphCard(graph, verification)
  const expected = `graphs/${verification.publisherId}/${card.id}/${card.version}.agent-graph.json`
  const relativePath = posixPath(REGISTRY, path)
  const entry = {
    _sourceTimestamp: graph.integrity?.signedAt,
    path: relativePath,
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
    lineage: card.lineage,
    publishable: profileIssues.length === 0,
    signed: card.signed,
  }
  entry.registryStatus = lifecycleFor(statusLedger, 'agent-graph', entry)
  const issues = [...verification.issues, ...profileIssues]
  if (relativePath !== expected) issues.push(`non-canonical Agent Graph path (expected ${expected})`)
  return {
    entry,
    accepted: verification.ok && verification.signed && profileIssues.length === 0 && relativePath === expected,
    issues,
  }
}

function templateEntries() {
  if (!existsSync(TEMPLATES)) return []
  const entries = []
  for (const directory of readdirSync(TEMPLATES, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!directory.isDirectory() || directory.isSymbolicLink() || !ID_RE.test(directory.name)) continue
    const root = join(TEMPLATES, directory.name)
    const manifestPath = join(root, 'manifest.json')
    if (!existsSync(manifestPath) || lstatSync(manifestPath).isSymbolicLink()) continue
    const manifest = readJson(manifestPath, `templates/${directory.name}/manifest.json`)
    const files = findFiles(root, '').filter((file) => !file.unsafe && lstatSync(file.path).isFile())
    const displayName = /^TODO\b/i.test(manifest.name || '')
      ? directory.name.split(/[-_]/).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')
      : manifest.name || directory.name
    entries.push({
      id: directory.name,
      version: manifest.packageVersion || manifest.schemaVersion || null,
      name: displayName,
      description: 'An editable ACX starter package. Inspect and personalize every file before export.',
      license: 'Apache-2.0',
      tags: ['agent', 'portable', 'starter', 'template'],
      publisher: 'ACX community',
      path: `templates/${directory.name}/manifest.json`,
      fileCount: files.length,
      files: files.map((file) => posixPath(root, file.path)).sort(),
      signed: false,
      trust: 'unsigned',
      trustStatus: 'warning',
    })
  }
  return entries
}

function duplicateCoordinate(entries, type, rejected) {
  const seen = new Map()
  for (const entry of entries) {
    const coordinate = `${entry.publisher}\u0000${entry.id}\u0000${entry.version ?? ''}`
    const earlier = seen.get(coordinate)
    if (earlier) {
      rejected.push({
        type,
        path: entry.path,
        reason: `duplicate immutable coordinate also present at ${earlier}`,
      })
    } else {
      seen.set(coordinate, entry.path)
    }
  }
}

function resolveGraphDependencies(graphs, workflows, rejected) {
  const workflowsByCoordinate = new Map(
    workflows.map((workflow) => [
      `${workflow.publisher}\u0000${workflow.id}\u0000${workflow.version}`,
      workflow,
    ]),
  )
  for (const graph of graphs) {
    graph.dependencies = graph.loops
      .filter((loop) => loop.kind === 'acx-workflow')
      .map((loop) => {
        const coordinate = `${loop.workflowPublisherId}\u0000${loop.workflowId}\u0000${loop.workflowVersion}`
        const workflow = workflowsByCoordinate.get(coordinate)
        const status = !workflow ? 'missing' : workflow.digest === loop.digest ? 'resolved' : 'digest-mismatch'
        const dependency = {
          loopId: loop.id,
          artifactType: 'workflow',
          publisherId: loop.workflowPublisherId,
          id: loop.workflowId,
          version: loop.workflowVersion,
          digest: loop.digest,
          status,
          path: workflow?.path ?? null,
          registryStatus: workflow?.registryStatus?.status ?? null,
        }
        if (status !== 'resolved') {
          rejected.push({
            type: 'agent-graph',
            path: graph.path,
            reason: `loop '${loop.id}' workflow dependency is ${status}`,
          })
        }
        return dependency
      })
    graph.dependenciesResolved = graph.dependencies.every((dependency) => dependency.status === 'resolved')
  }
}

function publicEntry(entry) {
  const { _sourceTimestamp: _timestamp, ...output } = entry
  return output
}

const trustRegistry = registryTrust()
const statusLedger = registryStatus()
const rejected = registryPolicyIssues(REGISTRY).map((reason) => ({
  type: 'policy',
  path: reason.split(':', 1)[0],
  reason,
}))
const sourceTimestamps = [statusLedger.document.updatedAt]
const acceptedIdentityKeys = new Set()

const cartridges = []
for (const file of findFiles(CARTRIDGES, '.acx')) {
  if (file.unsafe) {
    rejected.push({ type: 'agent', path: posixPath(REGISTRY, file.path), reason: file.unsafe })
    continue
  }
  const summary = summarizeCartridge(file.path, trustRegistry, statusLedger)
  if (!summary.accepted) {
    rejected.push({ type: 'agent', path: summary.entry.path, reason: summary.reason })
    continue
  }
  cartridges.push(summary.entry)
  if (summary.entry._sourceTimestamp) sourceTimestamps.push(summary.entry._sourceTimestamp)
  acceptedIdentityKeys.add(statusIdentityKey({
    artifactType: 'agent',
    publisherId: summary.entry.publisher,
    id: summary.entry.id,
    version: summary.entry.version,
    digest: summary.entry.digest,
  }))
}
duplicateCoordinate(cartridges, 'agent', rejected)
markLatest(cartridges)
cartridges.sort((a, b) =>
  (b.level?.acxLevel ?? -1) - (a.level?.acxLevel ?? -1)
  || a.name.localeCompare(b.name)
  || a.publisher.localeCompare(b.publisher)
  || a.id.localeCompare(b.id)
  || compareSemver(b.version, a.version))

const workflows = []
for (const file of findFiles(WORKFLOWS, '.cal.json')) {
  if (file.unsafe) {
    rejected.push({ type: 'workflow', path: posixPath(REGISTRY, file.path), reason: file.unsafe })
    continue
  }
  const summary = summarizeWorkflow(file.path, trustRegistry, statusLedger)
  if (!summary.accepted) {
    rejected.push({
      type: 'workflow',
      path: summary.entry.path,
      reason: summary.issues.join('; ') || 'workflow was not accepted',
    })
    continue
  }
  workflows.push(summary.entry)
  if (summary.entry._sourceTimestamp) sourceTimestamps.push(summary.entry._sourceTimestamp)
  acceptedIdentityKeys.add(statusIdentityKey({
    artifactType: 'workflow',
    publisherId: summary.entry.publisher,
    id: summary.entry.id,
    version: summary.entry.version,
    digest: summary.entry.digest,
  }))
}
duplicateCoordinate(workflows, 'workflow', rejected)
markLatest(workflows)
workflows.sort((a, b) =>
  a.publisher.localeCompare(b.publisher)
  || a.id.localeCompare(b.id)
  || compareSemver(b.version, a.version))

const agentGraphs = []
for (const file of findFiles(GRAPHS, '.agent-graph.json')) {
  if (file.unsafe) {
    rejected.push({ type: 'agent-graph', path: posixPath(REGISTRY, file.path), reason: file.unsafe })
    continue
  }
  const summary = summarizeAgentGraph(file.path, trustRegistry, statusLedger)
  if (!summary.accepted) {
    rejected.push({
      type: 'agent-graph',
      path: summary.entry.path,
      reason: summary.issues.join('; ') || 'Agent Graph was not accepted',
    })
    continue
  }
  agentGraphs.push(summary.entry)
  if (summary.entry._sourceTimestamp) sourceTimestamps.push(summary.entry._sourceTimestamp)
  acceptedIdentityKeys.add(statusIdentityKey({
    artifactType: 'agent-graph',
    publisherId: summary.entry.publisher,
    id: summary.entry.id,
    version: summary.entry.version,
    digest: summary.entry.digest,
  }))
}
duplicateCoordinate(agentGraphs, 'agent-graph', rejected)
markLatest(agentGraphs)
agentGraphs.sort((a, b) =>
  a.publisher.localeCompare(b.publisher)
  || a.id.localeCompare(b.id)
  || compareSemver(b.version, a.version))
resolveGraphDependencies(agentGraphs, workflows, rejected)

for (const status of statusLedger.document.entries) {
  if (!acceptedIdentityKeys.has(statusIdentityKey(status.artifact))) {
    rejected.push({
      type: 'status',
      path: 'status.json',
      reason: `status entry targets an artifact not present with the exact digest: ${status.artifact.publisherId}/${status.artifact.id}`,
    })
  }
  if (status.successor && !acceptedIdentityKeys.has(statusIdentityKey(status.successor))) {
    rejected.push({
      type: 'status',
      path: 'status.json',
      reason: `status successor is not present with the exact immutable identity and digest: ${status.successor.publisherId}/${status.successor.id}@${status.successor.version}`,
    })
  }
}

const templates = templateEntries()
const generatedAt = sourceTimestamps
  .filter((value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)))
  .sort((a, b) => Date.parse(a) - Date.parse(b))
  .at(-1) || '1970-01-01T00:00:00.000Z'
const index = {
  schemaVersion: 'acx.registry-index/1',
  generatedAt,
  artifactCount: cartridges.length + workflows.length + agentGraphs.length + templates.length,
  count: cartridges.length,
  cartridges: cartridges.map(publicEntry),
  workflowCount: workflows.length,
  workflows: workflows.map(publicEntry),
  agentGraphCount: agentGraphs.length,
  agentGraphs: agentGraphs.map(publicEntry),
  templateCount: templates.length,
  templates,
}

if (rejected.length) {
  console.error(`\nREJECTED ${rejected.length} registry issue(s):`)
  for (const item of rejected) console.error(`  ✗ ${item.path} [${item.type}] ${item.reason}`)
  process.exitCode = 1
} else {
  writeFileSync(join(REGISTRY, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
  if (!CLI_OPTIONS.quiet) {
    console.log(`indexed ${cartridges.length} cartridge(s), ${workflows.length} workflow(s), ${agentGraphs.length} Agent Graph(s), and ${templates.length} template(s)`)
    for (const entry of cartridges) {
      const level = entry.level ? `${entry.level.careerTier} Lv.${entry.level.acxLevel}` : 'unresolved'
      console.log(`  agent       ${entry.publisher}/${entry.id}@${entry.version} trust=${entry.trust} level=${level}`)
    }
    for (const entry of workflows) {
      console.log(`  workflow    ${entry.publisher}/${entry.id}@${entry.version} trust=${entry.trust}`)
    }
    for (const entry of agentGraphs) {
      console.log(`  agent-graph ${entry.publisher}/${entry.id}@${entry.version} dependencies=${entry.dependenciesResolved ? 'resolved' : 'INVALID'}`)
    }
  }
}
