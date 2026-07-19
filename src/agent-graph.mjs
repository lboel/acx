// ACX Agent Graph: the declarative information architecture around workflows.
//
// CAL answers "what happens next?". An Agent Graph answers "who owns which
// knowledge, who must inform/direct/report to whom, and where separate loops
// converge?". It is descriptive data, not an execution plan or permission grant.
import { jcs, sha256Hex } from './canonical.mjs'
import { keyIdFromPem, signEnvelope, verifyEnvelope } from './sign.mjs'
import { scrub } from './scrub.mjs'
import { emptyTrustRegistry, trustedRegistryEntryIssues } from './trust.mjs'
import { validateLineage } from './lineage.mjs'

export const AGENT_GRAPH_SCHEMA_VERSION = 'acx.agent-graph/1'
export const AGENT_GRAPH_SIGNATURE_VERSION = 'acx.agent-graph-signature/1'
export const AGENT_GRAPH_PREDICATE_TYPE = 'https://acx.dev/attestation/agent-graph/v1'
export const AGENT_GRAPH_MEDIA_TYPE = 'application/vnd.acx.agent-graph.v1+json'

const ID_RE = /^[a-z][a-z0-9._-]{0,127}$/
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/
const KEYID_RE = /^ed25519:[0-9a-f]{64}$/
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const TAG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/
const EVENT_RE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/
const NAMESPACE_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9][a-z0-9-]*$/
const PUBLISHER_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9][a-z0-9-]*(?:[./][a-z0-9][a-z0-9._-]*)*$/
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const ACTOR_KINDS = new Set(['agent', 'human', 'group', 'service', 'mixed'])
const KNOWLEDGE_KINDS = new Set([
  'intent', 'requirement', 'decision', 'status', 'evidence', 'feedback',
  'risk', 'context', 'artifact', 'tacit', 'custom',
])
const DURABILITY = new Set(['turn', 'session', 'workflow', 'project', 'organization', 'public'])
const SENSITIVITY = new Set(['public', 'internal', 'restricted'])
const ROUTE_INTENTS = new Set([
  'inform', 'direct', 'request', 'report', 'advise', 'review',
  'approve', 'escalate', 'coordinate', 'observe', 'custom',
])
const OBLIGATIONS = new Set(['must', 'should', 'may'])
const AUTHORITIES = new Set(['informational', 'advisory', 'delegated', 'approval', 'escalation'])
const DELIVERY = new Set(['broadcast', 'one', 'owner', 'custom'])
const ACKNOWLEDGEMENT = new Set(['required', 'optional', 'none'])
const CADENCE_MODES = new Set(['event', 'continuous', 'periodic', 'on-demand', 'custom'])
const LOOP_KINDS = new Set(['acx-workflow', 'external', 'informal'])
const MERGE_MODES = new Set(['steward-synthesis', 'consensus', 'vote', 'priority', 'latest', 'custom'])
const PRIVATE_EXTENSION_EXACT_KEYS = new Set(['content', 'body', 'message', 'messages', 'payload', 'transcript', 'token'])

function record(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(value, key) {
  return record(value) && Object.prototype.hasOwnProperty.call(value, key)
}

function explicitNullIssues(value, path) {
  if (value === null) return [`${path} must not be null`]
  // Extension payloads are open JSON by design; their top-level container must
  // be an object, but nested null is schema-valid opaque data.
  if (path === 'agent graph.extensions') return []
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => explicitNullIssues(item, `${path}[${index}]`))
  }
  if (record(value)) {
    return Object.entries(value).flatMap(([key, child]) => explicitNullIssues(child, `${path}.${key}`))
  }
  return []
}

function isPrivateExtensionKey(key) {
  const normalized = String(key).replace(/[^A-Za-z0-9]/g, '').toLowerCase()
  if (PRIVATE_EXTENSION_EXACT_KEYS.has(normalized)) return true
  return /(?:credential|password|passwd|secret|privatekey|apikey|accesstoken|authtoken|bearertoken|refreshtoken|clienttoken|apitoken)/.test(normalized)
    || /^(?:knowledge|private|source|task)content$/.test(normalized)
}

function exactKeys(value, keys) {
  return record(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
}

function duplicateValues(values) {
  const seen = new Set()
  const duplicates = new Set()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function rejectUnknownKeys(value, allowed, path) {
  if (!record(value)) return [`${path} must be an object`]
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${path} contains unknown property '${key}'`)
}

function validateString(value, path, { min = 1, max = 2000 } = {}) {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max
    ? []
    : [`${path} must be a ${min}-${max} character string`]
}

function validateStringArray(value, path, { nonEmpty = false, maxLength = null } = {}) {
  if (!Array.isArray(value)) return [`${path} must be an array`]
  const issues = []
  if (nonEmpty && value.length === 0) issues.push(`${path} must be non-empty`)
  if (value.some((item) => typeof item !== 'string' || !item || (maxLength != null && item.length > maxLength))) {
    issues.push(`${path} must contain non-empty strings${maxLength == null ? '' : ` up to ${maxLength} characters`}`)
  }
  if (new Set(value).size !== value.length) issues.push(`${path} must not contain duplicates`)
  return issues
}

function validateIdArray(value, path, known, kind, { nonEmpty = false } = {}) {
  const issues = validateStringArray(value, path, { nonEmpty })
  if (!Array.isArray(value)) return issues
  for (const id of value) {
    if (typeof id === 'string' && !ID_RE.test(id)) issues.push(`${path} contains invalid id '${id}'`)
    if (typeof id === 'string' && known && !known.has(id)) issues.push(`${path} references unknown ${kind} '${id}'`)
  }
  return issues
}

function validAbsoluteUri(value) {
  try {
    const uri = new URL(value)
    return !!uri.protocol
  } catch {
    return false
  }
}

function validSpdxExpression(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) return false
  const tokens = value.match(/\(|\)|AND|OR|WITH|[A-Za-z0-9][A-Za-z0-9.+-]*/g) || []
  if (tokens.join('') !== value.replace(/\s/g, '')) return false
  let depth = 0
  let expectOperand = true
  let afterWith = false
  let allowWith = false
  for (const token of tokens) {
    if (expectOperand) {
      if (token === '(' && !afterWith) {
        depth++
        continue
      }
      if ([')', 'AND', 'OR', 'WITH'].includes(token)) return false
      expectOperand = false
      allowWith = !afterWith
      afterWith = false
      continue
    }
    if (token === ')') {
      if (--depth < 0) return false
      allowWith = false
    } else if (token === 'AND' || token === 'OR') {
      expectOperand = true
      allowWith = false
    } else if (token === 'WITH' && allowWith) {
      expectOperand = true
      afterWith = true
      allowWith = false
    } else {
      return false
    }
  }
  return tokens.length > 0 && !expectOperand && depth === 0
}

function validateCadence(value, path, intervalField) {
  const issues = rejectUnknownKeys(value, ['mode', 'description', intervalField], path)
  if (!record(value)) return issues
  if (!CADENCE_MODES.has(value.mode)) issues.push(`${path}.mode is invalid`)
  issues.push(...validateString(value.description, `${path}.description`, { max: 1000 }))
  if (value[intervalField] != null && (!Number.isInteger(value[intervalField]) || value[intervalField] < 1)) {
    issues.push(`${path}.${intervalField} must be a positive integer`)
  }
  if (value.mode === 'periodic' && value[intervalField] == null) {
    issues.push(`${path}.${intervalField} is required for periodic cadence`)
  }
  return issues
}

function validateTrigger(trigger, path) {
  if (!record(trigger)) return [`${path} must be an object`]
  const issues = []
  if (trigger.type === 'event') {
    issues.push(...rejectUnknownKeys(trigger, ['type', 'events', 'description'], path))
    issues.push(...validateStringArray(trigger.events, `${path}.events`, { nonEmpty: true, maxLength: 160 }))
    for (const event of Array.isArray(trigger.events) ? trigger.events : []) {
      if (typeof event === 'string' && !EVENT_RE.test(event)) issues.push(`${path}.events contains invalid event '${event}'`)
    }
  } else if (trigger.type === 'interval') {
    issues.push(...rejectUnknownKeys(trigger, ['type', 'everyMs', 'description'], path))
    if (!Number.isInteger(trigger.everyMs) || trigger.everyMs < 1) issues.push(`${path}.everyMs must be a positive integer`)
  } else if (trigger.type === 'manual') {
    issues.push(...rejectUnknownKeys(trigger, ['type', 'description'], path))
  } else {
    issues.push(`${path}.type is invalid`)
  }
  if (trigger.description != null) issues.push(...validateString(trigger.description, `${path}.description`, { max: 1000 }))
  return issues
}

function hasDirectedCycle(edges) {
  const graph = new Map()
  for (const [from, to] of edges) {
    if (!graph.has(from)) graph.set(from, new Set())
    graph.get(from).add(to)
  }
  const visiting = new Set()
  const visited = new Set()
  function visit(node) {
    if (visiting.has(node)) return true
    if (visited.has(node)) return false
    visiting.add(node)
    for (const target of graph.get(node) || []) {
      if (visit(target)) return true
    }
    visiting.delete(node)
    visited.add(node)
    return false
  }
  return [...graph.keys()].some(visit)
}

function validateSelector(selector, path) {
  const issues = rejectUnknownKeys(selector, ['roles', 'capabilities', 'tags', 'description'], path)
  if (!record(selector)) return issues
  if (Object.keys(selector).length === 0) issues.push(`${path} must constrain or describe the actor`)
  if (selector.roles != null) issues.push(...validateStringArray(selector.roles, `${path}.roles`, { nonEmpty: true, maxLength: 120 }))
  if (selector.capabilities != null) issues.push(...validateStringArray(selector.capabilities, `${path}.capabilities`, { nonEmpty: true, maxLength: 160 }))
  if (selector.tags != null) {
    issues.push(...validateStringArray(selector.tags, `${path}.tags`, { nonEmpty: true, maxLength: 64 }))
    for (const tag of Array.isArray(selector.tags) ? selector.tags : []) {
      if (!TAG_RE.test(tag)) issues.push(`${path}.tags contains invalid tag '${tag}'`)
    }
  }
  if (selector.description != null) issues.push(...validateString(selector.description, `${path}.description`, { max: 1000 }))
  return issues
}

function validateIntegrityStructure(integrity, path = 'integrity') {
  const issues = rejectUnknownKeys(
    integrity,
    ['schemaVersion', 'digest', 'publisherId', 'keyid', 'publicKeyPem', 'signedAt', 'envelope'],
    path,
  )
  if (!record(integrity)) return issues
  if (!exactKeys(integrity, ['schemaVersion', 'digest', 'publisherId', 'keyid', 'publicKeyPem', 'signedAt', 'envelope'])) {
    issues.push(`${path} must contain exactly the acx.agent-graph-signature/1 fields`)
  }
  if (integrity.schemaVersion !== AGENT_GRAPH_SIGNATURE_VERSION) issues.push(`${path}.schemaVersion is invalid`)
  if (!DIGEST_RE.test(integrity.digest || '')) issues.push(`${path}.digest must be sha256`)
  if (!PUBLISHER_RE.test(integrity.publisherId || '')) issues.push(`${path}.publisherId is invalid`)
  if (!KEYID_RE.test(integrity.keyid || '')) issues.push(`${path}.keyid is invalid`)
  if (typeof integrity.publicKeyPem !== 'string' || !integrity.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')) {
    issues.push(`${path}.publicKeyPem must be an SPKI public key`)
  }
  if (!RFC3339_RE.test(integrity.signedAt || '') || Number.isNaN(Date.parse(integrity.signedAt))) {
    issues.push(`${path}.signedAt must be RFC 3339`)
  }
  const envelope = integrity.envelope
  issues.push(...rejectUnknownKeys(envelope, ['payloadType', 'payload', 'signatures'], `${path}.envelope`))
  if (!record(envelope)) return issues
  if (envelope.payloadType !== 'application/vnd.in-toto+json') issues.push(`${path}.envelope.payloadType is invalid`)
  issues.push(...validateString(envelope.payload, `${path}.envelope.payload`))
  if (!Array.isArray(envelope.signatures) || envelope.signatures.length !== 1) {
    issues.push(`${path}.envelope.signatures must contain exactly one signature`)
  } else {
    const signature = envelope.signatures[0]
    issues.push(...rejectUnknownKeys(signature, ['keyid', 'sig'], `${path}.envelope.signatures[0]`))
    if (record(signature)) {
      if (!KEYID_RE.test(signature.keyid || '')) issues.push(`${path}.envelope.signatures[0].keyid is invalid`)
      issues.push(...validateString(signature.sig, `${path}.envelope.signatures[0].sig`))
    }
  }
  return issues
}

function collectAgentGraphScanItems(graph) {
  const items = []
  const document = unsignedAgentGraph(graph)
  function walk(value, path) {
    if (typeof value === 'string') {
      // Schema-constrained workflow and lineage pins are expected high-entropy
      // digests. Digest-looking extension metadata must still pass the scrub gate.
      const pinnedWorkflowDigest = /^agent-graph\.loops\[\d+\]\.workflowRef\.digest$/.test(path)
      const pinnedLineageDigest = /^agent-graph\.lineage\.parents\[\d+\]\.digest$/.test(path)
      if (!((pinnedWorkflowDigest || pinnedLineageDigest) && DIGEST_RE.test(value))) {
        items.push({ field: path, text: DIGEST_RE.test(value) ? value.slice('sha256:'.length) : value })
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`))
      return
    }
    if (record(value)) {
      for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`)
    }
  }
  walk(document, 'agent-graph')
  return items
}

function findPrivateExtensionKeys(value, path = 'extensions') {
  const issues = []
  if (Array.isArray(value)) {
    value.forEach((item, index) => issues.push(...findPrivateExtensionKeys(item, `${path}[${index}]`)))
  } else if (record(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`
      if (isPrivateExtensionKey(key)) issues.push(`${childPath} uses a private-content or credential-bearing key`)
      issues.push(...findPrivateExtensionKeys(child, childPath))
    }
  }
  return issues
}

/**
 * Validate the closed, reference-safe graph structure. Prose fields remain open
 * enough to describe fuzzy team expectations, while ids and cross-references
 * stay deterministic and machine-checkable.
 */
export function validateAgentGraphStructure(graph) {
  const issues = []
  if (!record(graph)) return ['agent graph must be a JSON object']
  issues.push(...explicitNullIssues(graph, 'agent graph'))
  issues.push(...rejectUnknownKeys(graph, [
    'schemaVersion', 'id', 'version', 'name', 'description', 'license', 'homepage',
    'authors', 'tags', 'lineage', 'actors', 'knowledge', 'routes', 'loops', 'convergence',
    'limits', 'extensions', 'integrity',
  ], 'agent graph'))
  if (graph.schemaVersion !== AGENT_GRAPH_SCHEMA_VERSION) issues.push(`unexpected schemaVersion ${graph.schemaVersion}`)
  if (!ID_RE.test(graph.id || '')) issues.push('agent graph id must match ^[a-z][a-z0-9._-]{0,127}$')
  if (hasOwn(graph, 'version') && !SEMVER_RE.test(graph.version || '')) issues.push('agent graph.version must be SemVer')
  if (hasOwn(graph, 'name')) issues.push(...validateString(graph.name, 'agent graph.name', { min: 3, max: 120 }))
  if (hasOwn(graph, 'description')) issues.push(...validateString(graph.description, 'agent graph.description', { min: 20, max: 2000 }))
  if (hasOwn(graph, 'license')) issues.push(...validateString(graph.license, 'agent graph.license', { max: 100 }))
  if (hasOwn(graph, 'homepage') && (typeof graph.homepage !== 'string' || !validAbsoluteUri(graph.homepage))) {
    issues.push('agent graph.homepage must be an absolute URI')
  }
  if (hasOwn(graph, 'authors')) {
    if (!Array.isArray(graph.authors) || graph.authors.length === 0) {
      issues.push('agent graph.authors must be a non-empty array')
    } else {
      for (const [index, author] of graph.authors.entries()) {
        const path = `author[${index}]`
        issues.push(...rejectUnknownKeys(author, ['name', 'url'], path))
        if (record(author)) {
          issues.push(...validateString(author.name, `${path}.name`, { max: 120 }))
          if (hasOwn(author, 'url') && (typeof author.url !== 'string' || !validAbsoluteUri(author.url))) {
            issues.push(`${path}.url must be an absolute URI`)
          }
        }
      }
    }
  }
  if (hasOwn(graph, 'tags')) {
    issues.push(...validateStringArray(graph.tags, 'agent graph.tags', { nonEmpty: true, maxLength: 64 }))
    if (Array.isArray(graph.tags) && graph.tags.length > 20) issues.push('agent graph.tags must contain at most 20 items')
    for (const tag of Array.isArray(graph.tags) ? graph.tags : []) {
      if (typeof tag === 'string' && !TAG_RE.test(tag)) issues.push(`agent graph.tags contains invalid tag '${tag}'`)
    }
  }
  if (hasOwn(graph, 'lineage')) {
    issues.push(...validateLineage(graph.lineage, {
      self: {
        artifactType: 'agent-graph',
        publisherId: graph.integrity?.publisherId,
        id: graph.id,
        version: graph.version,
      },
    }))
  }
  if (!Array.isArray(graph.actors) || graph.actors.length === 0) issues.push('actors must be a non-empty array')
  if (!Array.isArray(graph.knowledge) || graph.knowledge.length === 0) issues.push('knowledge must be a non-empty array')
  if (!Array.isArray(graph.routes) || graph.routes.length === 0) issues.push('routes must be a non-empty array')
  if (hasOwn(graph, 'loops') && !Array.isArray(graph.loops)) issues.push('loops must be an array')
  if (hasOwn(graph, 'convergence') && !Array.isArray(graph.convergence)) issues.push('convergence must be an array')
  issues.push(...rejectUnknownKeys(graph.limits, ['maxPropagationHops', 'maxFanout'], 'limits'))
  if (record(graph.limits)) {
    if (!Number.isInteger(graph.limits.maxPropagationHops) || graph.limits.maxPropagationHops < 1) issues.push('limits.maxPropagationHops must be a positive integer')
    if (!Number.isInteger(graph.limits.maxFanout) || graph.limits.maxFanout < 1) issues.push('limits.maxFanout must be a positive integer')
  }
  if (hasOwn(graph, 'extensions') && !record(graph.extensions)) issues.push('extensions must be an object')
  if (hasOwn(graph, 'integrity')) issues.push(...validateIntegrityStructure(graph.integrity))
  if (record(graph.extensions)) {
    for (const key of Object.keys(graph.extensions)) {
      if (!NAMESPACE_RE.test(key)) issues.push(`extension namespace '${key}' must be reverse-DNS`)
    }
  }

  const actors = Array.isArray(graph.actors) ? graph.actors : []
  const knowledge = Array.isArray(graph.knowledge) ? graph.knowledge : []
  const routes = Array.isArray(graph.routes) ? graph.routes : []
  const loops = Array.isArray(graph.loops) ? graph.loops : []
  const convergence = Array.isArray(graph.convergence) ? graph.convergence : []
  const actorIds = new Set(actors.map((actor) => actor?.id).filter(Boolean))
  const knowledgeIds = new Set(knowledge.map((item) => item?.id).filter(Boolean))
  const loopIds = new Set(loops.map((loop) => loop?.id).filter(Boolean))
  const routeIds = new Set(routes.map((route) => route?.id).filter(Boolean))

  for (const id of duplicateValues(actors.map((actor) => actor?.id).filter(Boolean))) issues.push(`duplicate actor id '${id}'`)
  for (const id of duplicateValues(knowledge.map((item) => item?.id).filter(Boolean))) issues.push(`duplicate knowledge id '${id}'`)
  for (const id of duplicateValues(routes.map((route) => route?.id).filter(Boolean))) issues.push(`duplicate route id '${id}'`)
  for (const id of duplicateValues(loops.map((loop) => loop?.id).filter(Boolean))) issues.push(`duplicate loop id '${id}'`)
  for (const id of duplicateValues(convergence.map((point) => point?.id).filter(Boolean))) issues.push(`duplicate convergence id '${id}'`)

  for (const [index, actor] of actors.entries()) {
    const path = `actor[${index}]`
    if (!record(actor)) {
      issues.push(`${path} must be an object`)
      continue
    }
    issues.push(...rejectUnknownKeys(actor, ['id', 'kind', 'name', 'description', 'selector', 'cardinality', 'responsibilities'], path))
    if (!ID_RE.test(actor.id || '')) issues.push(`${path}.id is invalid`)
    if (!ACTOR_KINDS.has(actor.kind)) issues.push(`${path}.kind is invalid`)
    issues.push(...validateString(actor.description, `${path}.description`))
    if (actor.name != null) issues.push(...validateString(actor.name, `${path}.name`, { max: 120 }))
    if (actor.selector != null) issues.push(...validateSelector(actor.selector, `${path}.selector`))
    if (actor.cardinality != null) {
      issues.push(...rejectUnknownKeys(actor.cardinality, ['min', 'max'], `${path}.cardinality`))
      if (record(actor.cardinality)) {
        if (actor.cardinality.min == null && actor.cardinality.max == null) issues.push(`${path}.cardinality must declare min or max`)
        if (actor.cardinality.min != null && (!Number.isInteger(actor.cardinality.min) || actor.cardinality.min < 0)) issues.push(`${path}.cardinality.min must be a non-negative integer`)
        if (actor.cardinality.max != null && (!Number.isInteger(actor.cardinality.max) || actor.cardinality.max < 1)) issues.push(`${path}.cardinality.max must be a positive integer`)
        if (actor.cardinality.min != null && actor.cardinality.max != null && actor.cardinality.min > actor.cardinality.max) issues.push(`${path}.cardinality.min must not exceed max`)
      }
    }
    if (actor.responsibilities != null) issues.push(...validateStringArray(actor.responsibilities, `${path}.responsibilities`, { maxLength: 500 }))
  }

  for (const [index, item] of knowledge.entries()) {
    const path = `knowledge[${index}]`
    if (!record(item)) {
      issues.push(`${path} must be an object`)
      continue
    }
    issues.push(...rejectUnknownKeys(item, [
      'id', 'kind', 'name', 'description', 'stewards', 'audience',
      'durability', 'sensitivity', 'freshness', 'locator',
    ], path))
    if (!ID_RE.test(item.id || '')) issues.push(`${path}.id is invalid`)
    if (!KNOWLEDGE_KINDS.has(item.kind)) issues.push(`${path}.kind is invalid`)
    issues.push(...validateString(item.description, `${path}.description`))
    if (item.name != null) issues.push(...validateString(item.name, `${path}.name`, { max: 120 }))
    issues.push(...validateIdArray(item.stewards, `${path}.stewards`, actorIds, 'actor', { nonEmpty: true }))
    if (item.audience != null) issues.push(...validateIdArray(item.audience, `${path}.audience`, actorIds, 'actor'))
    if (item.durability != null && !DURABILITY.has(item.durability)) issues.push(`${path}.durability is invalid`)
    if (item.sensitivity != null && !SENSITIVITY.has(item.sensitivity)) issues.push(`${path}.sensitivity is invalid`)
    if (item.freshness != null) issues.push(...validateCadence(item.freshness, `${path}.freshness`, 'maxAgeMs'))
    if (item.locator != null) {
      issues.push(...rejectUnknownKeys(item.locator, ['type', 'description'], `${path}.locator`))
      if (record(item.locator)) {
        if (!['rac', 'okf', 'mcp-resource', 'artifact', 'manual', 'custom'].includes(item.locator.type)) issues.push(`${path}.locator.type is invalid`)
        issues.push(...validateString(item.locator.description, `${path}.locator.description`, { max: 1000 }))
      }
    }
  }

  for (const [index, route] of routes.entries()) {
    const path = `route[${index}]`
    if (!record(route)) {
      issues.push(`${path} must be an object`)
      continue
    }
    issues.push(...rejectUnknownKeys(route, [
      'id', 'from', 'to', 'intent', 'relationship', 'obligation', 'authority',
      'purpose', 'success', 'carries', 'returns', 'triggers', 'cadence',
      'delivery', 'acknowledgement', 'medium', 'weight', 'expects',
    ], path))
    if (!ID_RE.test(route.id || '')) issues.push(`${path}.id is invalid`)
    if (!actorIds.has(route.from)) issues.push(`${path}.from references unknown actor '${route.from}'`)
    issues.push(...validateIdArray(route.to, `${path}.to`, actorIds, 'actor', { nonEmpty: true }))
    if (Array.isArray(route.to) && route.to.includes(route.from)) issues.push(`${path} must not route an actor to itself`)
    if (!ROUTE_INTENTS.has(route.intent)) issues.push(`${path}.intent is invalid`)
    if (route.relationship != null && !/^[a-z][a-z0-9._-]{0,63}$/.test(route.relationship)) issues.push(`${path}.relationship is invalid`)
    if (!OBLIGATIONS.has(route.obligation)) issues.push(`${path}.obligation is invalid`)
    if (route.authority != null && !AUTHORITIES.has(route.authority)) issues.push(`${path}.authority is invalid`)
    issues.push(...validateString(route.purpose, `${path}.purpose`, { min: 10 }))
    if (route.success != null) issues.push(...validateString(route.success, `${path}.success`, { max: 1000 }))
    issues.push(...validateIdArray(route.carries, `${path}.carries`, knowledgeIds, 'knowledge', { nonEmpty: true }))
    if (route.returns != null) issues.push(...validateIdArray(route.returns, `${path}.returns`, knowledgeIds, 'knowledge', { nonEmpty: true }))
    if (!Array.isArray(route.triggers) || route.triggers.length === 0) {
      issues.push(`${path}.triggers must be a non-empty array`)
    } else {
      for (const [triggerIndex, trigger] of route.triggers.entries()) {
        issues.push(...validateTrigger(trigger, `${path}.triggers[${triggerIndex}]`))
      }
      const canonicalTriggers = route.triggers.filter(record).map((trigger) => jcs(trigger))
      if (new Set(canonicalTriggers).size !== canonicalTriggers.length) issues.push(`${path}.triggers must not contain duplicates`)
    }
    if (route.cadence != null) issues.push(...validateCadence(route.cadence, `${path}.cadence`, 'intervalMs'))
    if (route.delivery != null && !DELIVERY.has(route.delivery)) issues.push(`${path}.delivery is invalid`)
    if (route.acknowledgement != null && !ACKNOWLEDGEMENT.has(route.acknowledgement)) issues.push(`${path}.acknowledgement is invalid`)
    if (route.medium != null) issues.push(...validateString(route.medium, `${path}.medium`, { max: 200 }))
    if (route.weight != null && (typeof route.weight !== 'number' || route.weight < 0 || route.weight > 1)) issues.push(`${path}.weight must be between 0 and 1`)
    if (route.expects != null) {
      issues.push(...rejectUnknownKeys(route.expects, ['via', 'withinMs', 'description'], `${path}.expects`))
      if (record(route.expects)) {
        if (!routeIds.has(route.expects.via)) issues.push(`${path}.expects.via references unknown route '${route.expects.via}'`)
        if (route.expects.withinMs != null && (!Number.isInteger(route.expects.withinMs) || route.expects.withinMs < 1)) issues.push(`${path}.expects.withinMs must be a positive integer`)
        if (route.expects.description != null) issues.push(...validateString(route.expects.description, `${path}.expects.description`, { max: 1000 }))
      }
    }
    if (Array.isArray(route.returns) && route.returns.length > 0 && !record(route.expects)) {
      issues.push(`${path}.expects is required when returns declares a response`)
    }
    if (Number.isInteger(graph.limits?.maxFanout) && Array.isArray(route.to) && route.to.length > graph.limits.maxFanout) {
      issues.push(`${path}.to exceeds limits.maxFanout`)
    }
  }

  const routeById = new Map(routes.filter(record).map((route) => [route.id, route]))
  for (const [index, route] of routes.entries()) {
    if (!record(route) || !record(route.expects)) continue
    const path = `route[${index}]`
    const response = routeById.get(route.expects.via)
    if (!record(response)) continue
    const reversesDirection = response.from != null
      && Array.isArray(route.to)
      && route.to.includes(response.from)
      && Array.isArray(response.to)
      && response.to.includes(route.from)
    if (!reversesDirection) issues.push(`${path}.expects.via must reference a return route from a target back to the source`)
    for (const knowledgeId of Array.isArray(route.returns) ? route.returns : []) {
      if (!Array.isArray(response.carries) || !response.carries.includes(knowledgeId)) {
        issues.push(`${path}.expects.via route must carry returned knowledge '${knowledgeId}'`)
      }
    }
  }

  // Reporting and feedback cycles are healthy. Conflicting or cyclic mandatory
  // direction for the same knowledge module is not: an agent must know which
  // source owns the instruction.
  const requiredDirectSources = new Map()
  const requiredDirectEdges = new Map()
  for (const route of routes.filter((item) => record(item) && item.intent === 'direct' && item.obligation === 'must')) {
    for (const knowledgeId of Array.isArray(route.carries) ? route.carries : []) {
      if (!requiredDirectEdges.has(knowledgeId)) requiredDirectEdges.set(knowledgeId, [])
      for (const target of Array.isArray(route.to) ? route.to : []) {
        const key = `${target}\u0000${knowledgeId}`
        const owner = requiredDirectSources.get(key)
        if (owner && owner !== route.from) {
          issues.push(`actor '${target}' has conflicting mandatory direction for knowledge '${knowledgeId}' from '${owner}' and '${route.from}'`)
        } else {
          requiredDirectSources.set(key, route.from)
        }
        requiredDirectEdges.get(knowledgeId).push([route.from, target])
      }
    }
  }
  for (const [knowledgeId, edges] of requiredDirectEdges) {
    if (hasDirectedCycle(edges)) issues.push(`mandatory direction for knowledge '${knowledgeId}' must be acyclic`)
  }

  for (const [index, loop] of loops.entries()) {
    const path = `loop[${index}]`
    if (!record(loop)) {
      issues.push(`${path} must be an object`)
      continue
    }
    issues.push(...rejectUnknownKeys(loop, ['id', 'kind', 'description', 'workflowRef', 'actorBindings', 'imports', 'exports'], path))
    if (!ID_RE.test(loop.id || '')) issues.push(`${path}.id is invalid`)
    if (!LOOP_KINDS.has(loop.kind)) issues.push(`${path}.kind is invalid`)
    issues.push(...validateString(loop.description, `${path}.description`))
    if (loop.kind === 'acx-workflow' && !record(loop.workflowRef)) issues.push(`${path}.workflowRef is required for acx-workflow`)
    if (loop.kind !== 'acx-workflow' && loop.workflowRef != null) issues.push(`${path}.workflowRef is only valid for acx-workflow`)
    if (loop.workflowRef != null) {
      issues.push(...rejectUnknownKeys(loop.workflowRef, ['publisherId', 'id', 'version', 'digest'], `${path}.workflowRef`))
      if (record(loop.workflowRef)) {
        if (loop.workflowRef.publisherId != null && !PUBLISHER_RE.test(loop.workflowRef.publisherId)) issues.push(`${path}.workflowRef.publisherId is invalid`)
        if (!ID_RE.test(loop.workflowRef.id || '')) issues.push(`${path}.workflowRef.id is invalid`)
        if (loop.workflowRef.version != null && !SEMVER_RE.test(loop.workflowRef.version)) issues.push(`${path}.workflowRef.version must be SemVer`)
        if (loop.workflowRef.digest != null && !DIGEST_RE.test(loop.workflowRef.digest)) issues.push(`${path}.workflowRef.digest must be sha256`)
      }
    }
    if (loop.actorBindings != null && !Array.isArray(loop.actorBindings)) issues.push(`${path}.actorBindings must be an array`)
    const boundParticipants = []
    for (const [bindingIndex, binding] of (Array.isArray(loop.actorBindings) ? loop.actorBindings : []).entries()) {
      const bindingPath = `${path}.actorBindings[${bindingIndex}]`
      issues.push(...rejectUnknownKeys(binding, ['actor', 'participants'], bindingPath))
      if (record(binding)) {
        if (!actorIds.has(binding.actor)) issues.push(`${bindingPath}.actor references unknown actor '${binding.actor}'`)
        issues.push(...validateStringArray(binding.participants, `${bindingPath}.participants`, { nonEmpty: true }))
        for (const participant of Array.isArray(binding.participants) ? binding.participants : []) {
          boundParticipants.push(participant)
          if (!ID_RE.test(participant)) issues.push(`${bindingPath}.participants contains invalid alias '${participant}'`)
        }
      }
    }
    for (const participant of duplicateValues(boundParticipants)) issues.push(`${path} binds participant '${participant}' to more than one actor`)
    if (loop.imports != null) issues.push(...validateIdArray(loop.imports, `${path}.imports`, knowledgeIds, 'knowledge', { nonEmpty: true }))
    if (loop.exports != null) issues.push(...validateIdArray(loop.exports, `${path}.exports`, knowledgeIds, 'knowledge', { nonEmpty: true }))
    if (!(Array.isArray(loop.imports) && loop.imports.length) && !(Array.isArray(loop.exports) && loop.exports.length)) {
      issues.push(`${path} must declare at least one knowledge import or export`)
    }
  }

  for (const [index, point] of convergence.entries()) {
    const path = `convergence[${index}]`
    if (!record(point)) {
      issues.push(`${path} must be an object`)
      continue
    }
    issues.push(...rejectUnknownKeys(point, [
      'id', 'description', 'inputs', 'steward', 'contributors',
      'policy', 'outputs', 'trigger', 'failureMode', 'limits',
    ], path))
    if (!ID_RE.test(point.id || '')) issues.push(`${path}.id is invalid`)
    issues.push(...validateString(point.description, `${path}.description`))
    if (!Array.isArray(point.inputs) || point.inputs.length < 2) issues.push(`${path}.inputs must contain at least two loop inputs`)
    const inputLoopIds = []
    for (const [inputIndex, input] of (Array.isArray(point.inputs) ? point.inputs : []).entries()) {
      const inputPath = `${path}.inputs[${inputIndex}]`
      issues.push(...rejectUnknownKeys(input, ['loop', 'knowledge'], inputPath))
      if (record(input)) {
        inputLoopIds.push(input.loop)
        if (!loopIds.has(input.loop)) issues.push(`${inputPath}.loop references unknown loop '${input.loop}'`)
        issues.push(...validateIdArray(input.knowledge, `${inputPath}.knowledge`, knowledgeIds, 'knowledge', { nonEmpty: true }))
        const boundLoop = loops.find((loop) => record(loop) && loop.id === input.loop)
        for (const knowledgeId of Array.isArray(input.knowledge) ? input.knowledge : []) {
          if (boundLoop && (!Array.isArray(boundLoop.exports) || !boundLoop.exports.includes(knowledgeId))) {
            issues.push(`${inputPath}.knowledge '${knowledgeId}' is not exported by loop '${input.loop}'`)
          }
          const reachesSteward = routes.some((route) => (
            record(route)
            && Array.isArray(route.to)
            && route.to.includes(point.steward)
            && Array.isArray(route.carries)
            && route.carries.includes(knowledgeId)
          ))
          if (!reachesSteward) issues.push(`${inputPath}.knowledge '${knowledgeId}' has no route to convergence steward '${point.steward}'`)
        }
      }
    }
    if (new Set(inputLoopIds).size < 2) issues.push(`${path} must converge at least two distinct loops`)
    if (!actorIds.has(point.steward)) issues.push(`${path}.steward references unknown actor '${point.steward}'`)
    if (point.contributors != null) issues.push(...validateIdArray(point.contributors, `${path}.contributors`, actorIds, 'actor'))
    issues.push(...rejectUnknownKeys(point.policy, ['mode', 'description'], `${path}.policy`))
    if (record(point.policy)) {
      if (!MERGE_MODES.has(point.policy.mode)) issues.push(`${path}.policy.mode is invalid`)
      issues.push(...validateString(point.policy.description, `${path}.policy.description`))
    }
    issues.push(...validateIdArray(point.outputs, `${path}.outputs`, knowledgeIds, 'knowledge', { nonEmpty: true }))
    const inputKnowledgeIds = new Set((Array.isArray(point.inputs) ? point.inputs : []).flatMap((input) => (
      record(input) && Array.isArray(input.knowledge) ? input.knowledge : []
    )))
    for (const outputId of Array.isArray(point.outputs) ? point.outputs : []) {
      if (inputKnowledgeIds.has(outputId)) issues.push(`${path}.outputs must be synthesized knowledge, not an unchanged input '${outputId}'`)
      const output = knowledge.find((item) => record(item) && item.id === outputId)
      if (output && (!Array.isArray(output.stewards) || !output.stewards.includes(point.steward))) {
        issues.push(`${path}.steward must steward output knowledge '${outputId}'`)
      }
    }
    issues.push(...validateString(point.trigger, `${path}.trigger`, { max: 1000 }))
    if (point.failureMode != null) issues.push(...validateString(point.failureMode, `${path}.failureMode`, { max: 1000 }))
    issues.push(...rejectUnknownKeys(point.limits, ['maxWaitMs', 'maxRounds'], `${path}.limits`))
    if (record(point.limits)) {
      if (!Number.isInteger(point.limits.maxWaitMs) || point.limits.maxWaitMs < 1) issues.push(`${path}.limits.maxWaitMs must be a positive integer`)
      if (!Number.isInteger(point.limits.maxRounds) || point.limits.maxRounds < 1) issues.push(`${path}.limits.maxRounds must be a positive integer`)
    }
  }

  // Publishing dead actors or knowledge modules makes the graph look complete
  // while silently dropping information. Every declaration must take part.
  const usedActors = new Set()
  const usedKnowledge = new Set()
  for (const item of knowledge.filter(record)) {
    for (const actor of Array.isArray(item.stewards) ? item.stewards : []) usedActors.add(actor)
    for (const actor of Array.isArray(item.audience) ? item.audience : []) usedActors.add(actor)
  }
  for (const route of routes.filter(record)) {
    usedActors.add(route.from)
    for (const actor of Array.isArray(route.to) ? route.to : []) usedActors.add(actor)
    for (const id of Array.isArray(route.carries) ? route.carries : []) usedKnowledge.add(id)
    for (const id of Array.isArray(route.returns) ? route.returns : []) usedKnowledge.add(id)
  }
  for (const loop of loops.filter(record)) {
    for (const binding of Array.isArray(loop.actorBindings) ? loop.actorBindings : []) usedActors.add(binding?.actor)
    for (const id of Array.isArray(loop.imports) ? loop.imports : []) usedKnowledge.add(id)
    for (const id of Array.isArray(loop.exports) ? loop.exports : []) usedKnowledge.add(id)
  }
  for (const point of convergence.filter(record)) {
    usedActors.add(point.steward)
    for (const actor of Array.isArray(point.contributors) ? point.contributors : []) usedActors.add(actor)
    for (const input of Array.isArray(point.inputs) ? point.inputs : []) {
      for (const id of Array.isArray(input?.knowledge) ? input.knowledge : []) usedKnowledge.add(id)
    }
    for (const id of Array.isArray(point.outputs) ? point.outputs : []) usedKnowledge.add(id)
  }
  for (const id of actorIds) if (!usedActors.has(id)) issues.push(`actor '${id}' is isolated from the information architecture`)
  for (const id of knowledgeIds) if (!usedKnowledge.has(id)) issues.push(`knowledge '${id}' is never routed, bound to a loop, or produced by convergence`)

  return [...new Set(issues)]
}

/** Public metadata profile required before signing or registry publication. */
export function validatePublishableAgentGraph(graph) {
  const issues = validateAgentGraphStructure(graph)
  if (!SEMVER_RE.test(graph?.version || '')) issues.push('publishable agent graph needs a SemVer version')
  if (typeof graph?.name !== 'string' || graph.name.trim().length < 3 || graph.name.length > 120) issues.push('publishable agent graph needs a 3-120 character name')
  if (typeof graph?.description !== 'string' || graph.description.trim().length < 20 || graph.description.length > 2000) issues.push('publishable agent graph needs a useful 20-2000 character description')
  if (!validSpdxExpression(graph?.license)) issues.push('publishable agent graph needs a syntactically valid SPDX license expression')
  if (graph?.homepage != null && (typeof graph.homepage !== 'string' || !validAbsoluteUri(graph.homepage))) issues.push('agent graph homepage must be an absolute URI')
  if (!Array.isArray(graph?.tags) || graph.tags.length === 0 || graph.tags.length > 20 || graph.tags.some((tag) => !TAG_RE.test(tag)) || new Set(graph.tags).size !== graph.tags.length) {
    issues.push('publishable agent graph needs 1-20 unique lowercase discovery tags')
  }
  if (!Array.isArray(graph?.authors) || graph.authors.length === 0) {
    issues.push('publishable agent graph needs at least one named author')
  } else {
    for (const [index, author] of graph.authors.entries()) {
      if (!record(author)) {
        issues.push(`author[${index}] must be an object`)
        continue
      }
      issues.push(...rejectUnknownKeys(author, ['name', 'url'], `author[${index}]`))
      if (typeof author.name !== 'string' || !author.name.trim() || author.name.length > 120) issues.push(`author[${index}] needs a 1-120 character name`)
      if (author.url != null && (typeof author.url !== 'string' || !validAbsoluteUri(author.url))) issues.push(`author[${index}].url must be an absolute URI`)
    }
  }
  for (const [index, loop] of (Array.isArray(graph?.loops) ? graph.loops : []).entries()) {
    if (record(loop) && loop.kind === 'acx-workflow') {
      if (!PUBLISHER_RE.test(loop.workflowRef?.publisherId || '')) issues.push(`loop[${index}].workflowRef.publisherId is required for publication`)
      if (!SEMVER_RE.test(loop.workflowRef?.version || '')) issues.push(`loop[${index}].workflowRef.version is required and must be SemVer for publication`)
      if (!DIGEST_RE.test(loop.workflowRef?.digest || '')) issues.push(`loop[${index}].workflowRef.digest is required for publication`)
    }
  }
  if (record(graph)) {
    if (record(graph.extensions)) issues.push(...findPrivateExtensionKeys(graph.extensions))
    const scan = scrub(collectAgentGraphScanItems(graph))
    if (scan.blocked) {
      issues.push(`publishable agent graph contains secret-like public metadata: ${scan.findings.filter((finding) => finding.ruleId !== 'home-path').map((finding) => `${finding.ruleId}@${finding.field}`).join(', ')}`)
    }
    for (const finding of scan.findings.filter((item) => item.ruleId === 'home-path')) {
      issues.push(`publishable agent graph exposes a local home path at ${finding.field}`)
    }
  }
  return [...new Set(issues)]
}

export function unsignedAgentGraph(graph) {
  if (!record(graph)) throw new Error('agent graph must be a JSON object')
  const { integrity: _integrity, ...document } = graph
  return document
}

export function agentGraphDigest(graph) {
  const canonical = jcs(unsignedAgentGraph(graph))
  const digestHex = sha256Hex(Buffer.from(canonical, 'utf8'))
  return { canonical, digestHex, digest: `sha256:${digestHex}` }
}

function agentGraphSubject(graph) {
  return `urn:acx:agent-graph:${graph.id}@${graph.version || 'unversioned'}`
}

export function buildAgentGraphStatement(graph, { publisherId, signedAt }) {
  const { digestHex, digest } = agentGraphDigest(graph)
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: agentGraphSubject(graph), digest: { sha256: digestHex } }],
    predicateType: AGENT_GRAPH_PREDICATE_TYPE,
    predicate: {
      acxSchemaVersion: graph.schemaVersion,
      agentGraphId: graph.id,
      agentGraphVersion: graph.version ?? null,
      publisherId,
      agentGraphDigest: digest,
      signedAt,
      actors: graph.actors?.length ?? 0,
      knowledgeModules: graph.knowledge?.length ?? 0,
      routes: graph.routes?.length ?? 0,
      loops: graph.loops?.length ?? 0,
      convergencePoints: graph.convergence?.length ?? 0,
    },
  }
}

export function signAgentGraph(graph, key, { publisherId, signedAt = new Date().toISOString() } = {}) {
  if (!PUBLISHER_RE.test(publisherId || '')) throw new Error('publisherId must be a reverse-DNS identifier')
  if (!key?.privateKey || !key?.keyid || !key?.publicKeyPem) throw new Error('an Ed25519 signing key is required')
  const document = unsignedAgentGraph(graph)
  const lineageIssues = !Object.prototype.hasOwnProperty.call(document, 'lineage') ? [] : validateLineage(document.lineage, {
    self: {
      artifactType: 'agent-graph',
      publisherId,
      id: document.id,
      version: document.version,
    },
  })
  if (lineageIssues.length) throw new Error(`agent graph lineage is invalid: ${lineageIssues.join('; ')}`)
  const { digest } = agentGraphDigest(document)
  const envelope = signEnvelope(buildAgentGraphStatement(document, { publisherId, signedAt }), key)
  return {
    ...document,
    integrity: {
      schemaVersion: AGENT_GRAPH_SIGNATURE_VERSION,
      digest,
      publisherId,
      keyid: key.keyid,
      publicKeyPem: key.publicKeyPem,
      signedAt,
      envelope,
    },
  }
}

function verificationResult(overrides = {}) {
  return {
    ok: false,
    signed: false,
    status: 'invalid',
    trust: 'tampered',
    digest: null,
    publisherId: null,
    keyid: null,
    issues: [],
    ...overrides,
  }
}

/** Recompute and verify every digest, DSSE/in-toto, identity, and trust binding. */
export function verifyAgentGraph(graph, { registry = emptyTrustRegistry(), now = new Date().toISOString() } = {}) {
  let actual
  try {
    actual = agentGraphDigest(graph)
  } catch (error) {
    return verificationResult({ issues: [error.message] })
  }
  const integrity = graph?.integrity
  if (!integrity) {
    return verificationResult({
      ok: true,
      status: 'warning',
      trust: 'unsigned',
      digest: actual.digest,
      issues: ['agent graph has no integrity signature'],
    })
  }
  const base = {
    signed: true,
    digest: actual.digest,
    publisherId: integrity.publisherId ?? null,
    keyid: integrity.keyid ?? null,
  }
  const profileIssues = validatePublishableAgentGraph(graph)
  if (profileIssues.length) {
    return verificationResult({
      ...base,
      issues: profileIssues.map((issue) => `publication profile: ${issue}`),
    })
  }
  if (!exactKeys(integrity, ['schemaVersion', 'digest', 'publisherId', 'keyid', 'publicKeyPem', 'signedAt', 'envelope'])) {
    return verificationResult({ ...base, issues: ['integrity must contain exactly the acx.agent-graph-signature/1 fields'] })
  }
  if (integrity.schemaVersion !== AGENT_GRAPH_SIGNATURE_VERSION) {
    return verificationResult({ ...base, issues: [`unexpected integrity schemaVersion ${integrity.schemaVersion}`] })
  }
  if (!PUBLISHER_RE.test(integrity.publisherId || '')) return verificationResult({ ...base, issues: ['publisherId must be a reverse-DNS identifier'] })
  if (!KEYID_RE.test(integrity.keyid || '')) return verificationResult({ ...base, issues: ['keyid must identify an Ed25519 public key'] })
  if (!RFC3339_RE.test(integrity.signedAt || '') || Number.isNaN(Date.parse(integrity.signedAt))) {
    return verificationResult({ ...base, issues: ['signedAt must be an RFC 3339 date-time'] })
  }
  if (!DIGEST_RE.test(integrity.digest || '') || integrity.digest !== actual.digest) {
    return verificationResult({ ...base, issues: [`agent graph digest mismatch: signed ${integrity.digest || 'missing'}, computed ${actual.digest}`] })
  }
  if (!exactKeys(integrity.envelope, ['payloadType', 'payload', 'signatures'])
      || !Array.isArray(integrity.envelope.signatures)
      || integrity.envelope.signatures.length !== 1
      || !exactKeys(integrity.envelope.signatures[0], ['keyid', 'sig'])) {
    return verificationResult({ ...base, issues: ['DSSE envelope must contain exactly payloadType, payload, and one clean signature'] })
  }
  let inlineKeyId
  try {
    inlineKeyId = keyIdFromPem(integrity.publicKeyPem)
  } catch (error) {
    return verificationResult({ ...base, issues: [`invalid public key: ${error.message}`] })
  }
  const envelopeKeyId = integrity.envelope?.signatures?.[0]?.keyid
  if (inlineKeyId !== integrity.keyid || envelopeKeyId !== integrity.keyid) {
    return verificationResult({ ...base, issues: ['keyid does not match the public key and DSSE signature'] })
  }

  const registryEntry = registry.byKeyId.get(integrity.keyid)
  if (registryEntry?.publicKeyPem) {
    let registryKeyId
    try {
      registryKeyId = keyIdFromPem(registryEntry.publicKeyPem)
    } catch (error) {
      return verificationResult({ ...base, issues: [`invalid registry public key: ${error.message}`] })
    }
    if (registryKeyId !== integrity.keyid) {
      return verificationResult({ ...base, issues: ['registry public key does not match the signed keyid'] })
    }
  }
  const publicKeyPem = registryEntry?.publicKeyPem ?? integrity.publicKeyPem
  const verified = verifyEnvelope(integrity.envelope, publicKeyPem)
  if (!verified.ok) return verificationResult({ ...base, issues: [verified.reason] })

  const statement = verified.statement
  const expected = {
    statementType: 'https://in-toto.io/Statement/v1',
    subject: actual.digest.slice('sha256:'.length),
    name: agentGraphSubject(graph),
    predicateType: AGENT_GRAPH_PREDICATE_TYPE,
    acxSchemaVersion: graph.schemaVersion,
    agentGraphId: graph.id,
    agentGraphVersion: graph.version ?? null,
    agentGraphDigest: actual.digest,
    publisherId: integrity.publisherId,
    signedAt: integrity.signedAt,
    actors: graph.actors?.length ?? 0,
    knowledgeModules: graph.knowledge?.length ?? 0,
    routes: graph.routes?.length ?? 0,
    loops: graph.loops?.length ?? 0,
    convergencePoints: graph.convergence?.length ?? 0,
  }
  const observed = {
    statementType: statement?._type,
    subject: statement?.subject?.[0]?.digest?.sha256,
    name: statement?.subject?.[0]?.name,
    predicateType: statement?.predicateType,
    acxSchemaVersion: statement?.predicate?.acxSchemaVersion,
    agentGraphId: statement?.predicate?.agentGraphId,
    agentGraphVersion: statement?.predicate?.agentGraphVersion ?? null,
    agentGraphDigest: statement?.predicate?.agentGraphDigest,
    publisherId: statement?.predicate?.publisherId,
    signedAt: statement?.predicate?.signedAt,
    actors: statement?.predicate?.actors,
    knowledgeModules: statement?.predicate?.knowledgeModules,
    routes: statement?.predicate?.routes,
    loops: statement?.predicate?.loops,
    convergencePoints: statement?.predicate?.convergencePoints,
  }
  if (!Array.isArray(statement?.subject) || statement.subject.length !== 1) {
    return verificationResult({ ...base, issues: ['in-toto Statement must contain exactly one agent graph subject'] })
  }
  const bindingIssues = Object.entries(expected)
    .filter(([key, value]) => observed[key] !== value)
    .map(([key, value]) => `${key} binding mismatch: expected ${JSON.stringify(value)}, got ${JSON.stringify(observed[key])}`)
  if (bindingIssues.length) return verificationResult({ ...base, issues: bindingIssues })

  if (!registryEntry) {
    return verificationResult({ ...base, ok: true, status: 'verified', trust: 'portable', issues: ['signer keyid not in trust registry'] })
  }
  if (registryEntry.publisherId !== integrity.publisherId) {
    return verificationResult({ ...base, issues: ['registry publisherId does not match signed publisherId'] })
  }
  if (registryEntry.status === 'revoked' && registryEntry.revocationReason === 'key-compromise') {
    return verificationResult({ ...base, issues: ['signer key revoked due to key compromise'] })
  }
  const eligibilityIssues = trustedRegistryEntryIssues(registryEntry, {
    publisherId: integrity.publisherId,
    signedAt: integrity.signedAt,
    now,
  })
  if (eligibilityIssues.length) {
    return verificationResult({ ...base, ok: true, status: 'warning', trust: 'portable', issues: eligibilityIssues })
  }
  return verificationResult({ ...base, ok: true, status: 'verified', trust: 'trusted', issues: [] })
}

export function agentGraphCard(graph, verification = verifyAgentGraph(graph)) {
  return {
    id: graph?.id ?? null,
    version: graph?.version ?? null,
    name: graph?.name || graph?.id || 'Invalid Agent Graph',
    description: graph?.description || '',
    license: graph?.license || null,
    tags: Array.isArray(graph?.tags) ? graph.tags : [],
    actorCount: graph?.actors?.length ?? 0,
    knowledgeCount: graph?.knowledge?.length ?? 0,
    routeCount: graph?.routes?.length ?? 0,
    loopCount: graph?.loops?.length ?? 0,
    convergenceCount: graph?.convergence?.length ?? 0,
    lineage: (Array.isArray(graph?.lineage?.parents) ? graph.lineage.parents : []).filter(record).map((parent) => ({
      artifactType: parent.artifactType ?? null,
      publisherId: parent.publisherId ?? null,
      id: parent.id ?? null,
      version: parent.version ?? null,
      digest: parent.digest ?? null,
      relation: parent.relation ?? null,
      source: parent.source ?? null,
    })),
    actors: (Array.isArray(graph?.actors) ? graph.actors : []).filter(record).map((actor) => ({
      id: actor.id,
      name: actor.name || actor.id,
      kind: actor.kind,
    })),
    knowledge: (Array.isArray(graph?.knowledge) ? graph.knowledge : []).filter(record).map((item) => ({
      id: item.id,
      name: item.name || item.id,
      kind: item.kind,
      stewards: item.stewards || [],
    })),
    intents: [...new Set((Array.isArray(graph?.routes) ? graph.routes : []).map((route) => route?.intent).filter(Boolean))].sort(),
    loops: (Array.isArray(graph?.loops) ? graph.loops : []).filter(record).map((loop) => ({
      id: loop.id,
      kind: loop.kind,
      workflowPublisherId: loop.workflowRef?.publisherId ?? null,
      workflowId: loop.workflowRef?.id ?? null,
      workflowVersion: loop.workflowRef?.version ?? null,
      digest: loop.workflowRef?.digest ?? null,
    })),
    digest: verification.digest,
    signed: verification.signed,
    publisher: verification.publisherId,
    trust: verification.trust,
    status: verification.status,
  }
}
