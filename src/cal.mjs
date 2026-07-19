// Conditional Agentic Loop (CAL) + Required Available Context (RAC).
// A CAL connects MULTIPLE cartridges — referenced by content hash (romDigest) or by
// a role SLOT to be staffed — into a BPMN-like process: who (which agent) may do
// what, when, under which conditions, and what counts as completion. RAC declares
// the knowledge that MUST be available — as a DESCRIPTION only, never the content.
//
// Data model (all connected):
//   CartridgeRef  -> a hash/slot reference to an agent that fills a participant alias
//   RacItem       -> required available context (description + how to confirm; no content)
//   CalNode       -> a task/gateway/event; a task binds an agent + required skills/caps/rac + completion
//   CalEdge       -> a conditional transition (structured condition, no eval)
//   Cal           -> participants[] + rac[] + variables[] + nodes[] + edges[] + start
//   CalSkillSet   -> stored IN a cartridge: which roles it plays, which agents it references (by hash)
import { validateLineage } from './lineage.mjs'
import { scrub } from './scrub.mjs'

const ID_RE = /^[a-z][a-z0-9._-]{0,127}$/
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const CAREER_TIERS = ['intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'distinguished', 'legend']
const VARIABLE_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array'])
const RAC_KINDS = new Set(['wiki', 'code-map', 'infra', 'terraform', 'api-spec', 'dataset', 'runbook', 'custom'])
const RAC_CHECK_TYPES = new Set(['file-glob', 'url', 'mcp-resource', 'manual'])
const TAG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/
const NAMESPACE_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9][a-z0-9-]*$/
const PRIVATE_EXTENSION_KEY_RE = /(?:credential|password|passwd|secret|privatekey|apikey|access(?:token|key)|auth(?:token|key)|bearertoken|refreshtoken|client(?:token|secret)|taskcontent|knowledgecontent|payload|transcript)/i

function record(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
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

function requireStringArray(value, path, { nonEmpty = false } = {}) {
  if (!Array.isArray(value)) return [`${path} must be an array`]
  const issues = []
  if (nonEmpty && value.length === 0) issues.push(`${path} must be non-empty`)
  if (value.some((item) => typeof item !== 'string' || !item)) issues.push(`${path} must contain non-empty strings`)
  if (new Set(value).size !== value.length) issues.push(`${path} must not contain duplicates`)
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

function collectWorkflowScanItems(cal) {
  const items = []
  const { integrity: _integrity, ...document } = record(cal) ? cal : {}
  function walk(value, path) {
    if (typeof value === 'string') {
      const pinnedDigest = /^workflow\.(?:participants\[\d+\]\.romDigest|lineage\.parents\[\d+\]\.digest)$/.test(path)
      if (!(pinnedDigest && DIGEST_RE.test(value))) {
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
  walk(document, 'workflow')
  return items
}

function privateExtensionIssues(value, path = 'workflow.extensions') {
  const issues = []
  if (Array.isArray(value)) {
    value.forEach((item, index) => issues.push(...privateExtensionIssues(item, `${path}[${index}]`)))
  } else if (record(value)) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`
      if (PRIVATE_EXTENSION_KEY_RE.test(key.replace(/[^A-Za-z0-9]/g, ''))) {
        issues.push(`${childPath} uses a private-content or credential-bearing key`)
      }
      issues.push(...privateExtensionIssues(child, childPath))
    }
  }
  return issues
}

function graphHasCycle(start, edges) {
  const outgoing = new Map()
  for (const edge of edges) {
    const list = outgoing.get(edge.from) || []
    list.push(edge.to)
    outgoing.set(edge.from, list)
  }
  const visiting = new Set()
  const visited = new Set()
  const visit = (id) => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const next of outgoing.get(id) || []) if (visit(next)) return true
    visiting.delete(id)
    visited.add(id)
    return false
  }
  return start ? visit(start) : false
}

function validateCondition(cond, { variables, racIds, path = 'condition' }) {
  const issues = []
  if (!record(cond)) return [`${path} must be an object`]
  const shapes = ['always', 'var', 'all', 'any', 'not', 'racAvailable'].filter((key) => key in cond)
  if (shapes.length !== 1) issues.push(`${path} must contain exactly one condition shape`)
  const allowed = shapes[0] === 'var' ? ['var', 'op', 'value'] : shapes.slice(0, 1)
  issues.push(...rejectUnknownKeys(cond, allowed, path))
  if ('always' in cond && cond.always !== true) issues.push(`${path}.always must be true`)
  if ('var' in cond) {
    if (typeof cond.var !== 'string' || !cond.var) issues.push(`${path}.var must be a non-empty dotted path`)
    const root = typeof cond.var === 'string' ? cond.var.split('.')[0] : ''
    if (root && !variables.has(root)) issues.push(`${path} references undeclared variable '${root}'`)
    if (!['eq', 'ne', 'lt', 'gt', 'le', 'ge', 'in'].includes(cond.op)) issues.push(`${path}.op is invalid`)
    if (!('value' in cond)) issues.push(`${path} comparison is missing value`)
  }
  if ('all' in cond || 'any' in cond) {
    const key = 'all' in cond ? 'all' : 'any'
    if (!Array.isArray(cond[key]) || cond[key].length === 0) issues.push(`${path}.${key} must be a non-empty array`)
    else cond[key].forEach((child, index) => issues.push(...validateCondition(child, { variables, racIds, path: `${path}.${key}[${index}]` })))
  }
  if ('not' in cond) issues.push(...validateCondition(cond.not, { variables, racIds, path: `${path}.not` }))
  if ('racAvailable' in cond && !racIds.has(cond.racAvailable)) issues.push(`${path} references unknown rac '${cond.racAvailable}'`)
  return issues
}

// ---- structured conditions (safe; no expression eval) --------------------
export function evalCondition(cond, ctx = {}) {
  if (cond == null || cond.always === true) return true
  if ('all' in cond) return cond.all.every((c) => evalCondition(c, ctx))
  if ('any' in cond) return cond.any.some((c) => evalCondition(c, ctx))
  if ('not' in cond) return !evalCondition(cond.not, ctx)
  if ('racAvailable' in cond) return !!(ctx.rac && ctx.rac[cond.racAvailable]?.available)
  if ('var' in cond) {
    const actual = cond.var.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx.vars ?? ctx)
    const v = cond.value
    switch (cond.op) {
      case 'eq': return actual === v
      case 'ne': return actual !== v
      case 'lt': return actual < v
      case 'gt': return actual > v
      case 'le': return actual <= v
      case 'ge': return actual >= v
      case 'in': return Array.isArray(v) && v.includes(actual)
      default: return false
    }
  }
  return false
}

// ---- structural validation ------------------------------------------------
export function validateCalStructure(cal) {
  const issues = []
  if (!record(cal)) return ['workflow must be a JSON object']
  issues.push(...rejectUnknownKeys(cal, [
    'schemaVersion', 'id', 'version', 'name', 'description', 'license', 'homepage',
    'authors', 'tags', 'lineage', 'participants', 'rac', 'variables', 'limits', 'start',
    'nodes', 'edges', 'extensions', 'integrity',
  ], 'workflow'))
  if (cal.schemaVersion !== 'acx.cal/1') issues.push(`unexpected schemaVersion ${cal.schemaVersion}`)
  if (!ID_RE.test(cal.id || '')) issues.push('workflow id must match ^[a-z][a-z0-9._-]{0,127}$')
  if (!Array.isArray(cal.participants)) issues.push('participants must be an array')
  if (!Array.isArray(cal.nodes) || cal.nodes.length === 0) issues.push('nodes must be a non-empty array')
  if (!Array.isArray(cal.edges)) issues.push('edges must be an array')
  if (cal.extensions && !record(cal.extensions)) issues.push('extensions must be an object')
  if (record(cal.extensions)) {
    for (const key of Object.keys(cal.extensions)) if (!NAMESPACE_RE.test(key)) issues.push(`extension namespace '${key}' must be reverse-DNS`)
  }
  if (Object.prototype.hasOwnProperty.call(cal, 'lineage')) {
    issues.push(...validateLineage(cal.lineage, {
      self: {
        artifactType: 'workflow',
        publisherId: cal.integrity?.publisherId,
        id: cal.id,
        version: cal.version,
      },
    }))
  }

  const participants = Array.isArray(cal.participants) ? cal.participants : []
  const rac = Array.isArray(cal.rac) ? cal.rac : []
  const variables = Array.isArray(cal.variables) ? cal.variables : []
  const nodes = Array.isArray(cal.nodes) ? cal.nodes : []
  const edges = Array.isArray(cal.edges) ? cal.edges : []
  const validEdges = edges.filter(record)
  const aliases = new Set(participants.map((p) => p?.alias).filter(Boolean))
  const racIds = new Set(rac.map((r) => r?.id).filter(Boolean))
  const variableNames = new Set(variables.map((v) => v?.name).filter(Boolean))
  const nodeIds = new Set(nodes.map((n) => n?.id).filter(Boolean))

  for (const alias of duplicateValues(participants.map((p) => p?.alias).filter(Boolean))) issues.push(`duplicate participant alias '${alias}'`)
  for (const id of duplicateValues(rac.map((r) => r?.id).filter(Boolean))) issues.push(`duplicate rac id '${id}'`)
  for (const name of duplicateValues(variables.map((v) => v?.name).filter(Boolean))) issues.push(`duplicate variable name '${name}'`)
  for (const id of duplicateValues(nodes.map((n) => n?.id).filter(Boolean))) issues.push(`duplicate node id '${id}'`)

  if (!nodeIds.has(cal.start)) issues.push(`start node '${cal.start}' does not exist`)
  for (const p of participants) {
    if (!record(p)) {
      issues.push('participant must be an object')
      continue
    }
    issues.push(...rejectUnknownKeys(
      p,
      p.bind === 'hash'
        ? ['alias', 'bind', 'romDigest', 'cartridgeId', 'required']
        : ['alias', 'bind', 'slot', 'required'],
      `participant ${p.alias || '?'}`,
    ))
    if (!ID_RE.test(p.alias || '')) issues.push('participant alias must match ^[a-z][a-z0-9._-]{0,127}$')
    if (!['hash', 'slot'].includes(p.bind)) issues.push(`participant ${p.alias || '?'} has invalid bind '${p.bind}'`)
    if (p.required != null && typeof p.required !== 'boolean') issues.push(`participant ${p.alias} required must be boolean`)
    if (p.bind === 'hash') {
      if (!DIGEST_RE.test(p.romDigest || '')) issues.push(`participant ${p.alias} bind=hash needs a sha256 romDigest`)
      if (p.cartridgeId != null && (typeof p.cartridgeId !== 'string' || !p.cartridgeId)) issues.push(`participant ${p.alias} cartridgeId must be a non-empty string`)
      if ('slot' in p) issues.push(`participant ${p.alias} bind=hash MUST NOT carry slot constraints`)
    }
    if (p.bind === 'slot') {
      if (!record(p.slot)) issues.push(`participant ${p.alias} bind=slot needs a slot`)
      if ('romDigest' in p) issues.push(`participant ${p.alias} bind=slot MUST NOT carry romDigest`)
      const slot = p.slot || {}
      if (record(slot)) issues.push(...rejectUnknownKeys(slot, ['role', 'minLevel', 'capabilities'], `participant ${p.alias}.slot`))
      if (!slot.role && !slot.minLevel && !(slot.capabilities || []).length) issues.push(`participant ${p.alias} slot must constrain role, level, or capabilities`)
      if (slot.role != null && (typeof slot.role !== 'string' || !slot.role)) issues.push(`participant ${p.alias} slot.role must be a non-empty string`)
      if (slot.capabilities != null && !Array.isArray(slot.capabilities)) issues.push(`participant ${p.alias} slot.capabilities must be an array`)
      if (slot.minLevel && !record(slot.minLevel)) issues.push(`participant ${p.alias} minLevel must be an object`)
      if (record(slot.minLevel)) issues.push(...rejectUnknownKeys(slot.minLevel, ['careerTier', 'acxLevel'], `participant ${p.alias}.slot.minLevel`))
      if (record(slot.minLevel) && Object.keys(slot.minLevel).length === 0) issues.push(`participant ${p.alias} minLevel must constrain careerTier or acxLevel`)
      if (slot.minLevel?.acxLevel != null && (!Number.isInteger(slot.minLevel.acxLevel) || slot.minLevel.acxLevel < 0)) issues.push(`participant ${p.alias} minLevel.acxLevel must be a non-negative integer`)
      if (slot.minLevel?.careerTier && !CAREER_TIERS.includes(slot.minLevel.careerTier)) issues.push(`participant ${p.alias} has unknown careerTier '${slot.minLevel.careerTier}'`)
      for (const [index, capability] of (Array.isArray(slot.capabilities) ? slot.capabilities : []).entries()) {
        if (!record(capability) || typeof capability.taskType !== 'string' || !capability.taskType) issues.push(`participant ${p.alias} slot capability[${index}] needs taskType`)
        if (record(capability)) issues.push(...rejectUnknownKeys(capability, ['taskType', 'stack'], `participant ${p.alias}.slot.capability[${index}]`))
        if (record(capability) && capability.stack != null) issues.push(...requireStringArray(capability.stack, `participant ${p.alias}.slot.capability[${index}].stack`))
      }
    }
  }
  for (const r of rac) {
    if (!record(r)) {
      issues.push('rac item must be an object')
      continue
    }
    issues.push(...rejectUnknownKeys(r, ['id', 'kind', 'description', 'required', 'check', 'okf'], `rac ${r.id || '?'}`))
    if (!ID_RE.test(r.id || '')) issues.push('rac id must match ^[a-z][a-z0-9._-]{0,127}$')
    if (!RAC_KINDS.has(r.kind)) issues.push(`rac ${r.id} has unsupported kind '${r.kind}'`)
    if (typeof r.description !== 'string' || !r.description.trim() || r.description.length > 2000) issues.push(`rac ${r.id} needs a 1-2000 character description`)
    if (r.required != null && typeof r.required !== 'boolean') issues.push(`rac ${r.id}.required must be boolean`)
    if ('content' in r) issues.push(`rac ${r.id} MUST NOT carry content — description only`)
    if (r.check && !record(r.check)) issues.push(`rac ${r.id}.check must be an object`)
    if (record(r.check)) {
      issues.push(...rejectUnknownKeys(r.check, ['type', 'hint'], `rac ${r.id}.check`))
      if (!RAC_CHECK_TYPES.has(r.check.type)) issues.push(`rac ${r.id}.check has unsupported type '${r.check.type}'`)
      if (r.check.hint != null && typeof r.check.hint !== 'string') issues.push(`rac ${r.id}.check.hint must be a string`)
    }
    if (r.okf != null && !record(r.okf)) issues.push(`rac ${r.id}.okf must be an object`)
  }
  for (const variable of variables) {
    if (!record(variable)) {
      issues.push('variable must be an object')
      continue
    }
    issues.push(...rejectUnknownKeys(variable, ['name', 'type', 'init'], `variable ${variable.name || '?'}`))
    if (!ID_RE.test(variable.name || '')) issues.push('variable name must match ^[a-z][a-z0-9._-]{0,127}$')
    if (!VARIABLE_TYPES.has(variable.type)) issues.push(`variable ${variable.name} has unsupported type '${variable.type}'`)
  }
  if (cal.limits && !record(cal.limits)) issues.push('limits must be an object')
  if (record(cal.limits)) {
    issues.push(...rejectUnknownKeys(cal.limits, ['maxSteps', 'maxDurationMs', 'maxParallel'], 'limits'))
    for (const key of ['maxSteps', 'maxDurationMs', 'maxParallel']) {
      if (cal.limits[key] != null && (!Number.isInteger(cal.limits[key]) || cal.limits[key] < 1)) issues.push(`limits.${key} must be a positive integer`)
    }
  }
  for (const n of nodes) {
    if (!record(n)) {
      issues.push('node must be an object')
      continue
    }
    if (!ID_RE.test(n.id || '')) issues.push('node id must match ^[a-z][a-z0-9._-]{0,127}$')
    if (n.type === 'task') {
      issues.push(...rejectUnknownKeys(n, ['id', 'type', 'agent', 'action', 'requires', 'completion', 'sideEffects', 'approval', 'budget', 'guardrails'], `task ${n.id || '?'}`))
      if (!aliases.has(n.agent)) issues.push(`node ${n.id} references unknown agent alias '${n.agent}'`)
      if (n.action != null && typeof n.action !== 'string') issues.push(`task ${n.id}.action must be a string`)
      if (n.requires && !record(n.requires)) issues.push(`task ${n.id}.requires must be an object`)
      if (record(n.requires)) {
        issues.push(...rejectUnknownKeys(n.requires, ['skills', 'capabilities', 'rac'], `task ${n.id}.requires`))
        for (const key of ['skills', 'capabilities', 'rac']) {
          if (n.requires[key] != null) issues.push(...requireStringArray(n.requires[key], `task ${n.id}.requires.${key}`))
        }
      }
      for (const rid of Array.isArray(n.requires?.rac) ? n.requires.rac : []) if (!racIds.has(rid)) issues.push(`node ${n.id} requires unknown rac '${rid}'`)
      if (!n.completion) issues.push(`task ${n.id} missing a completion condition`)
      else {
        const completion = n.completion
        const completionFields = {
          'skill-scripts': ['type', 'scripts'],
          verification: ['type', 'commands', 'passIntent'],
          guardrail: ['type', 'kind'],
          artifact: ['type', 'produces'],
        }
        issues.push(...rejectUnknownKeys(completion, completionFields[completion.type] || ['type'], `task ${n.id}.completion`))
        if (!['skill-scripts', 'verification', 'guardrail', 'artifact'].includes(completion.type)) issues.push(`task ${n.id} has invalid completion type '${completion.type}'`)
        if (completion.type === 'skill-scripts') issues.push(...requireStringArray(completion.scripts, `task ${n.id} skill-scripts completion scripts`, { nonEmpty: true }))
        if (completion.type === 'verification') issues.push(...requireStringArray(completion.commands, `task ${n.id} verification completion commands`, { nonEmpty: true }))
        if (completion.type === 'verification' && !completion.passIntent) issues.push(`task ${n.id} verification completion needs passIntent`)
        if (completion.type === 'guardrail' && !completion.kind) issues.push(`task ${n.id} guardrail completion needs kind`)
        if (completion.type === 'artifact' && !completion.produces) issues.push(`task ${n.id} artifact completion needs produces`)
      }
      if (n.sideEffects && !['none', 'workspace', 'external'].includes(n.sideEffects)) issues.push(`task ${n.id} has invalid sideEffects '${n.sideEffects}'`)
      if (n.approval && !['never', 'on-request', 'always'].includes(n.approval)) issues.push(`task ${n.id} has invalid approval '${n.approval}'`)
      if (n.budget != null && !record(n.budget)) issues.push(`task ${n.id}.budget must be an object`)
      if (n.guardrails != null) issues.push(...requireStringArray(n.guardrails, `task ${n.id}.guardrails`))
    } else if (n.type === 'gateway') {
      issues.push(...rejectUnknownKeys(n, ['id', 'type', 'gateway'], `gateway ${n.id || '?'}`))
      if (!['exclusive', 'parallel', 'inclusive'].includes(n.gateway)) issues.push(`gateway ${n.id} has invalid gateway '${n.gateway}'`)
    } else if (n.type === 'event') {
      issues.push(...rejectUnknownKeys(n, ['id', 'type', 'event', 'afterMs'], `event ${n.id || '?'}`))
      if (!['start', 'end', 'stop', 'handoff', 'timer'].includes(n.event)) issues.push(`event ${n.id} has invalid event '${n.event}'`)
      if (n.event === 'timer' && (!Number.isInteger(n.afterMs) || n.afterMs < 1)) issues.push(`timer event ${n.id} needs a positive afterMs`)
    } else {
      issues.push(`node ${n.id || '?'} has invalid type '${n.type}'`)
    }
  }
  const edgeKeys = new Set()
  for (const [index, e] of edges.entries()) {
    if (!record(e)) {
      issues.push(`edge[${index}] must be an object`)
      continue
    }
    issues.push(...rejectUnknownKeys(e, ['from', 'to', 'when'], `edge[${index}]`))
    if (!nodeIds.has(e.from)) issues.push(`edge from unknown node '${e.from}'`)
    if (!nodeIds.has(e.to)) issues.push(`edge to unknown node '${e.to}'`)
    const edgeKey = `${e.from}\0${e.to}\0${JSON.stringify(e.when || null)}`
    if (edgeKeys.has(edgeKey)) issues.push(`duplicate edge ${e.from} → ${e.to}`)
    edgeKeys.add(edgeKey)
    if (e.when) issues.push(...validateCondition(e.when, { variables: variableNames, racIds, path: `edge[${index}].when` }))
  }

  const startEvents = nodes.filter((node) => record(node) && node.type === 'event' && node.event === 'start')
  if (startEvents.length > 1) issues.push('workflow may contain at most one start event')
  if (startEvents.length === 1 && startEvents[0].id !== cal.start) issues.push(`start event '${startEvents[0].id}' must be the workflow start`)
  const terminalIds = new Set(nodes.filter((node) => record(node) && node.type === 'event' && ['end', 'stop'].includes(node.event)).map((node) => node.id))
  if (terminalIds.size === 0) issues.push('workflow needs at least one end or stop event')

  // reachability from start
  const reach = new Set([cal.start])
  let changed = true
  while (changed) {
    changed = false
    for (const e of validEdges) if (reach.has(e.from) && !reach.has(e.to)) { reach.add(e.to); changed = true }
  }
  for (const id of nodeIds) if (!reach.has(id)) issues.push(`node ${id} is unreachable from start`)

  const canTerminate = new Set(terminalIds)
  changed = true
  while (changed) {
    changed = false
    for (const e of validEdges) if (canTerminate.has(e.to) && !canTerminate.has(e.from)) { canTerminate.add(e.from); changed = true }
  }
  for (const id of reach) if (nodeIds.has(id) && !canTerminate.has(id)) issues.push(`node ${id} has no path to an end or stop event`)

  for (const terminal of terminalIds) if (validEdges.some((edge) => edge.from === terminal)) issues.push(`terminal event ${terminal} MUST NOT have outgoing edges`)
  for (const node of nodes.filter(record)) {
    const outgoing = validEdges.filter((edge) => edge.from === node.id)
    if (!terminalIds.has(node.id) && outgoing.length === 0) issues.push(`non-terminal node ${node.id} has no outgoing edge`)
    if (node.type !== 'gateway' && outgoing.length > 1 && outgoing.some((edge) => !edge.when)) issues.push(`node ${node.id} has multiple outgoing edges and every branch must be conditional`)
  }
  if (graphHasCycle(cal.start, validEdges) && (!Number.isInteger(cal.limits?.maxSteps) || cal.limits.maxSteps < 1)) {
    issues.push('cyclic workflow needs limits.maxSteps to guarantee termination')
  }
  return issues
}

/** Stricter metadata profile required for signing and registry publication. */
export function validatePublishableWorkflow(cal) {
  const issues = validateCalStructure(cal)
  if (!SEMVER_RE.test(cal?.version || '')) issues.push('publishable workflow needs a SemVer version')
  if (typeof cal?.name !== 'string' || cal.name.trim().length < 3 || cal.name.length > 120) issues.push('publishable workflow needs a 3-120 character name')
  if (typeof cal?.description !== 'string' || cal.description.trim().length < 20 || cal.description.length > 2000) issues.push('publishable workflow needs a useful 20-2000 character description')
  if (!validSpdxExpression(cal?.license)) issues.push('publishable workflow needs a syntactically valid SPDX license expression')
  if (cal?.homepage != null && (typeof cal.homepage !== 'string' || !validAbsoluteUri(cal.homepage))) issues.push('workflow homepage must be an absolute URI')
  if (!Array.isArray(cal?.tags) || cal.tags.length === 0 || cal.tags.length > 20 || cal.tags.some((tag) => !TAG_RE.test(tag)) || new Set(cal.tags).size !== cal.tags.length) issues.push('publishable workflow needs 1-20 unique lowercase discovery tags')
  if (!Array.isArray(cal?.authors) || cal.authors.length === 0) {
    issues.push('publishable workflow needs at least one named author')
  } else {
    for (const [index, author] of cal.authors.entries()) {
      if (!record(author)) {
        issues.push(`author[${index}] must be an object`)
        continue
      }
      issues.push(...rejectUnknownKeys(author, ['name', 'url'], `author[${index}]`))
      if (typeof author.name !== 'string' || !author.name.trim() || author.name.length > 120) issues.push(`author[${index}] needs a 1-120 character name`)
      if (author.url != null && (typeof author.url !== 'string' || !validAbsoluteUri(author.url))) issues.push(`author[${index}].url must be an absolute URI`)
    }
  }
  if (record(cal)) {
    if (record(cal.extensions)) issues.push(...privateExtensionIssues(cal.extensions))
    const scan = scrub(collectWorkflowScanItems(cal))
    if (scan.blocked) {
      issues.push(`publishable workflow contains secret-like public metadata: ${scan.findings.filter((finding) => finding.ruleId !== 'home-path').map((finding) => `${finding.ruleId}@${finding.field}`).join(', ')}`)
    }
    for (const finding of scan.findings.filter((item) => item.ruleId === 'home-path')) {
      issues.push(`publishable workflow exposes a local home path at ${finding.field}`)
    }
  }
  return [...new Set(issues)]
}

// ---- participant resolution against available cartridges ------------------
// cartridges: [{ path, card }] where card = readCard() output.
function matchesSlot(slot, card) {
  if (slot.role && card.role !== slot.role) return false
  if (slot.minLevel && card.level?.proven !== true) return false
  if (slot.minLevel?.acxLevel != null && (card.level?.acxLevel ?? 0) < slot.minLevel.acxLevel) return false
  if (slot.minLevel?.careerTier) {
    const actual = CAREER_TIERS.indexOf(card.level?.tier)
    const minimum = CAREER_TIERS.indexOf(slot.minLevel.careerTier)
    if (actual < minimum) return false
  }
  for (const need of Array.isArray(slot.capabilities) ? slot.capabilities : []) {
    const has = (Array.isArray(card.moves) ? card.moves : []).some((move) => move.taskType === need.taskType
      && (Array.isArray(need.stack) ? need.stack : []).every((stackItem) => (move.stack || []).includes(stackItem)))
    if (!has) return false
  }
  return true
}

export function resolveParticipants(cal, cartridges) {
  return (cal.participants || []).filter(record).map((p) => {
    if (p.bind === 'hash') {
      const hit = cartridges.find((c) => c.card.romHash === p.romDigest)
      return { alias: p.alias, bind: 'hash', bound: hit || null, reason: hit ? 'matched by romDigest' : 'no cartridge with that romDigest' }
    }
    const candidates = cartridges.filter((c) => matchesSlot(p.slot || {}, c.card))
    candidates.sort((a, b) => (b.card.level?.acxLevel ?? 0) - (a.card.level?.acxLevel ?? 0))
    return { alias: p.alias, bind: 'slot', bound: candidates[0] || null, candidates: candidates.length, reason: candidates.length ? `staffed best of ${candidates.length} match(es)` : 'no cartridge matches the slot' }
  })
}

// ---- full lint (structure + resolution + per-node capability coverage) ----
export function lintCal(cal, cartridges = [], { resolve = true, publish = false } = {}) {
  const issues = publish ? validatePublishableWorkflow(cal) : validateCalStructure(cal)
  const warnings = []
  const resolved = resolveParticipants(cal, cartridges)
  const byAlias = Object.fromEntries(resolved.map((r) => [r.alias, r]))
  if (resolve) {
    for (const p of resolved) {
      const wanted = (cal.participants.find((x) => x?.alias === p.alias))
      if ((wanted.required !== false) && !p.bound) issues.push(`participant '${p.alias}' unresolved: ${p.reason}`)
      if ((wanted.required === false) && !p.bound) warnings.push(`optional participant '${p.alias}' unresolved: ${p.reason}`)
    }
  }
  // per-task capability/skill coverage against the bound agent
  for (const n of resolve ? (cal.nodes || []).filter(record) : []) {
    if (n.type !== 'task') continue
    const agent = byAlias[n.agent]?.bound
    if (!agent) continue
    for (const cap of Array.isArray(n.requires?.capabilities) ? n.requires.capabilities : []) {
      if (!(agent.card.moves || []).some((m) => m.taskType === cap)) issues.push(`node ${n.id}: agent '${n.agent}' lacks required capability '${cap}'`)
    }
    for (const sk of Array.isArray(n.requires?.skills) ? n.requires.skills : []) {
      if (!(agent.card.skills || []).some((s) => s.name === sk)) issues.push(`node ${n.id}: agent '${n.agent}' lacks required skill '${sk}'`)
    }
  }
  return { ok: issues.length === 0, issues: [...new Set(issues)], warnings: [...new Set(warnings)], resolved }
}

// ---- CalSkillSet: the per-agent BPM participation declaration -------------
export function buildCalSkillSet(cart) {
  const meta = cart.allMeta()
  const caps = cart.db.prepare('SELECT json FROM capabilities').all().map((r) => JSON.parse(r.json))
  const skills = cart.db.prepare('SELECT name FROM acx_skill').all().map((r) => r.name)
  return {
    schemaVersion: 'acx.cal-skillset/1',
    plays: [{ role: meta['acx.role'] || 'engineer', providesCapabilities: [...new Set(caps.map((c) => c.taskType))], canComplete: skills }],
    references: [], // other agents this one hands off to (by romDigest) — filled by authors
    processes: [], // CAL ids this agent participates in
  }
}

/** Emit the CalSkillSet into the ROM zone (signed). */
export function emitCalSkillSet(cart) {
  cart.putFile('rom/cal/skillset.json', Buffer.from(JSON.stringify(buildCalSkillSet(cart), null, 2), 'utf8'))
  cart.setMeta('acx.cal_skillset', 'rom/cal/skillset.json')
}
