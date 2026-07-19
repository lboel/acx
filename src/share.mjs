// Prepare signed ACX artifacts for the git registry without touching git or a
// remote. The caller remains responsible for reviewing, staging, and opening a
// pull request. This module only creates deterministic, verified PR inputs.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { Cartridge } from './container.mjs'
import { readCard } from './load.mjs'
import { validatePackageSpec } from './packagespec.mjs'
import { evaluateTrust, emptyTrustRegistry } from './trust.mjs'
import { validatePublishableWorkflow } from './cal.mjs'
import { verifyWorkflow, workflowCard } from './workflow.mjs'
import {
  agentGraphCard,
  validatePublishableAgentGraph,
  verifyAgentGraph,
} from './agent-graph.mjs'

const PUBLISHER_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9][a-z0-9-]*(?:[./][a-z0-9][a-z0-9._-]*)*$/
const PUBLISHER_SEGMENT_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9][a-z0-9-]*$/
const SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/
const GRAPH_ID_RE = /^[a-z][a-z0-9._-]{0,127}$/

function fail(message) {
  throw new Error(`share refused: ${message}`)
}

function assertSafeSegment(value, label, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(`${label} '${value || ''}' is not a safe registry identifier`)
}

function assertInside(root, destination) {
  const resolvedRoot = resolve(root)
  const resolvedDestination = resolve(destination)
  const rel = relative(resolvedRoot, resolvedDestination)
  if (!rel || rel.startsWith('..') || rel.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    fail(`destination escapes the registry root: ${destination}`)
  }
  if (existsSync(resolvedRoot) && lstatSync(resolvedRoot).isSymbolicLink()) {
    fail(`registry root must not be a symbolic link: ${resolvedRoot}`)
  }
  let current = resolvedRoot
  for (const segment of rel.split(process.platform === 'win32' ? '\\' : '/')) {
    current = join(current, segment)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      fail(`symbolic links are forbidden in registry destinations: ${current}`)
    }
  }
}

function sameBytes(a, b) {
  if (!existsSync(a) || !existsSync(b)) return false
  return readFileSync(a).equals(readFileSync(b))
}

function writeArtifact(source, destination, { registryRoot, dryRun, force }) {
  assertInside(registryRoot, destination)
  if (resolve(source) === resolve(destination)) return { changed: false, reason: 'already in canonical registry path' }
  if (existsSync(destination) && !sameBytes(source, destination) && !force) {
    fail(`${destination} already exists with different bytes; review the update and pass --force`)
  }
  if (sameBytes(source, destination)) return { changed: false, reason: 'identical artifact already present' }
  if (!dryRun) {
    mkdirSync(dirname(destination), { recursive: true })
    // Re-check after creating missing parents so an existing destination or
    // newly exposed path component cannot be followed as a symlink.
    assertInside(registryRoot, destination)
    copyFileSync(source, destination)
  }
  return { changed: true, reason: dryRun ? 'would copy verified artifact' : 'copied verified artifact' }
}

function cleanInline(value) {
  return String(value || '').replace(/[\r\n|]+/g, ' ').trim()
}

function renderAgentReadme(card) {
  const capabilities = card.moves.length
    ? card.moves.map((move) => `- \`${move.taskType}\`${move.stack.length ? ` — ${move.stack.map((item) => `\`${item}\``).join(', ')}` : ''}`).join('\n')
    : '- No capability claims declared.'
  const level = card.level.proven
    ? `${cleanInline(card.level.tier)} · Lv.${card.level.acxLevel} · ROM-bound proof`
    : `Lv.${card.level.acxLevel} · declared, not independently proven`
  return `# ${cleanInline(card.name)}

| Field | Value |
| --- | --- |
| Publisher | \`${cleanInline(card.publisher)}\` |
| Role | \`${cleanInline(card.role)}\` |
| Class | ${cleanInline(card.class)} |
| Level | ${level} |
| ROM digest | \`${cleanInline(card.romHash)}\` |
| Registry trust at submission | \`${cleanInline(card.trust)}\` |

## Capabilities

${capabilities}

## Verify before loading

\`\`\`bash
acx verify cartridge.acx
acx spec cartridge.acx
acx load cartridge.acx --print-only
\`\`\`

This card is generated from the signed cartridge. The artifact, not this README, is authoritative.
`
}

function readAgentShare(file) {
  if (!existsSync(file) || !file.endsWith('.acx')) fail('agent input must be an existing .acx file')
  const cart = Cartridge.open(file, { readonly: true })
  try {
    const verification = evaluateTrust(cart, { registry: emptyTrustRegistry() })
    if (verification.status === 'invalid' || verification.trust === 'tampered' || verification.trust === 'legacy') {
      fail(`agent is not safely shareable (${verification.trust}: ${verification.summary})`)
    }
    const packageSpec = validatePackageSpec(cart)
    if (!packageSpec.ok) fail(`agent package spec is not clean: ${packageSpec.issues.join('; ')}`)
    const card = readCard(cart)
    if (!PUBLISHER_SEGMENT_RE.test(card.publisher)) fail(`embedded publisher '${card.publisher}' is not a path-safe reverse-DNS id`)
    if (verification.signerInstanceLabel && verification.signerInstanceLabel !== card.publisher) {
      fail(`signed publisher '${verification.signerInstanceLabel}' does not match cartridge publisher '${card.publisher}'`)
    }
    return { card, verification, packageSpec }
  } finally {
    cart.close()
  }
}

function readWorkflowShare(file) {
  if (!existsSync(file) || !file.endsWith('.cal.json')) fail('workflow input must be an existing .cal.json file')
  let workflow
  try {
    workflow = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail(`workflow JSON cannot be read: ${error.message}`)
  }
  const profileIssues = validatePublishableWorkflow(workflow)
  if (profileIssues.length) fail(`workflow publication profile is invalid: ${profileIssues.join('; ')}`)
  const verification = verifyWorkflow(workflow)
  if (!verification.ok || !verification.signed) {
    fail(`workflow signature is not valid: ${verification.issues.join('; ') || 'unsigned'}`)
  }
  if (!PUBLISHER_RE.test(verification.publisherId || '')) {
    fail(`signed publisher '${verification.publisherId || ''}' is not reverse-DNS`)
  }
  return { workflow, verification, card: workflowCard(workflow, verification) }
}

function readAgentGraphShare(file) {
  if (!existsSync(file) || !file.endsWith('.agent-graph.json')) {
    fail('agent graph input must be an existing .agent-graph.json file')
  }
  let graph
  try {
    graph = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail(`agent graph JSON cannot be read: ${error.message}`)
  }
  const profileIssues = validatePublishableAgentGraph(graph)
  if (profileIssues.length) fail(`agent graph publication profile is invalid: ${profileIssues.join('; ')}`)
  const verification = verifyAgentGraph(graph)
  if (!verification.ok || !verification.signed) {
    fail(`agent graph signature is not valid: ${verification.issues.join('; ') || 'unsigned'}`)
  }
  if (!PUBLISHER_RE.test(verification.publisherId || '')) {
    fail(`signed publisher '${verification.publisherId || ''}' is not reverse-DNS`)
  }
  return { graph, verification, card: agentGraphCard(graph, verification) }
}

export function prepareAgentShare(file, {
  registryRoot,
  publisherId = null,
  slug,
  dryRun = false,
  force = false,
} = {}) {
  if (!registryRoot) fail('registryRoot is required')
  assertSafeSegment(slug, 'agent slug', SLUG_RE)
  const inspected = readAgentShare(file)
  const publisher = inspected.card.publisher
  if (publisherId && publisherId !== publisher) {
    fail(`requested publisher '${publisherId}' does not match signed publisher '${publisher}'`)
  }
  assertSafeSegment(publisher, 'publisher', PUBLISHER_SEGMENT_RE)
  const directory = join(resolve(registryRoot), 'cartridges', publisher, slug)
  const destination = join(directory, 'cartridge.acx')
  assertInside(registryRoot, destination)
  const artifact = writeArtifact(file, destination, { registryRoot, dryRun, force })
  const readme = join(directory, 'README.md')
  assertInside(registryRoot, readme)
  const readmeContent = renderAgentReadme(inspected.card)
  const readmeChanged = !existsSync(readme) || readFileSync(readme, 'utf8') !== readmeContent
  if (!dryRun && readmeChanged) {
    mkdirSync(directory, { recursive: true })
    assertInside(registryRoot, readme)
    writeFileSync(readme, readmeContent)
  }
  return {
    type: 'agent',
    source: resolve(file),
    destination,
    readme,
    changed: artifact.changed || readmeChanged,
    dryRun,
    publisher,
    slug,
    card: inspected.card,
    verification: inspected.verification,
  }
}

export function prepareWorkflowShare(file, {
  registryRoot,
  publisherId = null,
  dryRun = false,
  force = false,
} = {}) {
  if (!registryRoot) fail('registryRoot is required')
  const inspected = readWorkflowShare(file)
  const publisher = inspected.verification.publisherId
  if (publisherId && publisherId !== publisher) {
    fail(`requested publisher '${publisherId}' does not match signed publisher '${publisher}'`)
  }
  assertSafeSegment(inspected.workflow.id, 'workflow id', SLUG_RE)
  const destination = join(resolve(registryRoot), 'cals', `${inspected.workflow.id}.cal.json`)
  assertInside(registryRoot, destination)
  const artifact = writeArtifact(file, destination, { registryRoot, dryRun, force })
  return {
    type: 'workflow',
    source: resolve(file),
    destination,
    changed: artifact.changed,
    dryRun,
    publisher,
    slug: inspected.workflow.id,
    card: inspected.card,
    verification: inspected.verification,
  }
}

export function prepareAgentGraphShare(file, {
  registryRoot,
  publisherId = null,
  dryRun = false,
  force = false,
} = {}) {
  if (!registryRoot) fail('registryRoot is required')
  const inspected = readAgentGraphShare(file)
  const publisher = inspected.verification.publisherId
  if (publisherId && publisherId !== publisher) {
    fail(`requested publisher '${publisherId}' does not match signed publisher '${publisher}'`)
  }
  assertSafeSegment(inspected.graph.id, 'agent graph id', GRAPH_ID_RE)
  const destination = join(resolve(registryRoot), 'graphs', `${inspected.graph.id}.agent-graph.json`)
  assertInside(registryRoot, destination)
  const artifact = writeArtifact(file, destination, { registryRoot, dryRun, force })
  return {
    type: 'agent-graph',
    source: resolve(file),
    destination,
    changed: artifact.changed,
    dryRun,
    publisher,
    slug: inspected.graph.id,
    card: inspected.card,
    verification: inspected.verification,
  }
}

export function sharePullRequestBody(plan) {
  if (plan.type === 'agent') {
    const card = plan.card
    return `## Share ACX agent: ${cleanInline(card.name)}

- Publisher: \`${cleanInline(plan.publisher)}\`
- Role: \`${cleanInline(card.role)}\`
- ROM digest: \`${cleanInline(card.romHash)}\`
- Signature trust before registry review: \`${cleanInline(card.trust)}\`
- Capabilities: ${card.moves.map((move) => `\`${cleanInline(move.taskType)}\``).join(', ') || 'none declared'}

### Verification

- [x] Signature and live ROM bytes verified
- [x] Package specification is clean
- [x] Private key is not included
- [ ] Registry index regenerated
- [ ] Conformance suite passes

The signed \`.acx\` artifact is authoritative; generated discovery metadata is review convenience only.
`
  }
  if (plan.type === 'agent-graph') {
    const card = plan.card
    return `## Share ACX Agent Graph: ${cleanInline(card.name)}

- Graph id: \`${cleanInline(card.id)}\`
- Publisher: \`${cleanInline(plan.publisher)}\`
- Version: \`${cleanInline(card.version)}\`
- Graph digest: \`${cleanInline(card.digest)}\`
- Actors: ${card.actorCount}
- Knowledge modules: ${card.knowledgeCount}
- Communication routes: ${card.routeCount}
- Bound loops: ${card.loopCount}
- Convergence points: ${card.convergenceCount}
- Tags: ${card.tags.map((tag) => `\`${cleanInline(tag)}\``).join(', ') || 'none'}

### Verification

- [x] Publication profile and graph invariants are valid
- [x] JCS digest and DSSE/in-toto signature verified
- [x] Signed publisher claim is cryptographically bound (namespace ownership still requires trust proof/review)
- [x] No secret-like metadata or local home path was detected
- [x] Private key is not included
- [ ] No task payloads or private knowledge contents are embedded (human review)
- [ ] Registry index regenerated
- [ ] Conformance suite passes

The signed \`.agent-graph.json\` artifact is authoritative. It describes communication, reporting, knowledge stewardship, and loop convergence; it grants no tools or runtime permissions.
`
  }
  const card = plan.card
  return `## Share ACX workflow: ${cleanInline(card.name)}

- Workflow id: \`${cleanInline(card.id)}\`
- Publisher: \`${cleanInline(plan.publisher)}\`
- Version: \`${cleanInline(card.version)}\`
- Workflow digest: \`${cleanInline(card.digest)}\`
- Team slots: ${card.participantCount}
- Nodes: ${card.nodeCount}
- Tags: ${card.tags.map((tag) => `\`${cleanInline(tag)}\``).join(', ') || 'none'}

### Verification

- [x] Publication profile is valid
- [x] JCS digest and DSSE/in-toto signature verified
- [x] Signed publisher claim is cryptographically bound (namespace ownership still requires trust proof/review)
- [x] Private key is not included
- [ ] Registry index regenerated
- [ ] Conformance suite passes

The signed \`.cal.json\` artifact is authoritative; registry metadata is review convenience only.
`
}

export function registryPolicyIssues(registryRoot) {
  if (!existsSync(registryRoot)) return []
  const issues = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const rel = relative(registryRoot, path).replaceAll('\\', '/')
      if (entry.isSymbolicLink()) {
        issues.push(`${rel}: symbolic links are forbidden in the registry`)
        continue
      }
      if (entry.isDirectory()) {
        visit(path)
        continue
      }
      if (!entry.isFile()) continue
      if (
        /(^|\/)\.env(?:\.|$)/i.test(rel)
        || /\.key\.pem$/i.test(rel)
        || /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$/i.test(rel)
        || /(?:private|secret)[^/]*\.pem$/i.test(rel)
      ) {
        issues.push(`${rel}: secret-bearing filename is forbidden`)
      }
      const bytes = readFileSync(path)
      if (
        bytes.includes(Buffer.from('-----BEGIN PRIVATE KEY-----'))
        || bytes.includes(Buffer.from('-----BEGIN ENCRYPTED PRIVATE KEY-----'))
        || bytes.includes(Buffer.from('-----BEGIN RSA PRIVATE KEY-----'))
        || bytes.includes(Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----'))
      ) {
        issues.push(`${rel}: private key material is forbidden`)
      }
    }
  }
  visit(resolve(registryRoot))
  return [...new Set(issues)].sort()
}

export const sharePatterns = Object.freeze({
  publisher: PUBLISHER_RE,
  publisherSegment: PUBLISHER_SEGMENT_RE,
  slug: SLUG_RE,
  graphId: GRAPH_ID_RE,
})
