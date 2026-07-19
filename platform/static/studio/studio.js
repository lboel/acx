import { verifyArtifact } from '../assets/verify.js'

const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

const ID_RE = /^[a-z][a-z0-9._-]{0,127}$/
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const TAG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/
const STORAGE_KEY = 'acx-studio-draft-v1'
const MAX_IMPORT_BYTES = 2 * 1024 * 1024

const actorKinds = ['agent', 'human', 'group', 'service', 'mixed']
const knowledgeKinds = ['intent', 'requirement', 'decision', 'status', 'evidence', 'feedback', 'risk', 'context', 'artifact', 'tacit', 'custom']
const routeIntents = ['inform', 'direct', 'request', 'report', 'advise', 'review', 'approve', 'escalate', 'coordinate', 'observe', 'custom']
const obligations = ['must', 'should', 'may']

let mode = 'agent-graph'
let draft = graphExample()
let rawEditorDirty = false

function graphExample() {
  return {
    schemaVersion: 'acx.agent-graph/1',
    id: 'product-delivery-remix',
    version: '0.1.0',
    name: 'Product delivery remix',
    description: 'A portable information architecture connecting product intent, delivery work, status reporting, and product decisions.',
    license: 'Apache-2.0',
    authors: [{ name: 'Your name' }],
    tags: ['agent-graph', 'product', 'reporting'],
    actors: [
      { id: 'product-owner', kind: 'mixed', name: 'Product owner', description: 'Owns product intent and turns evidence into bounded decisions.' },
      { id: 'developers', kind: 'group', name: 'Developer team', description: 'Builds the outcome and keeps delivery status current.' },
    ],
    knowledge: [
      { id: 'product-intent', kind: 'intent', name: 'Product intent', description: 'The outcome, constraints, and priority that guide delivery.', stewards: ['product-owner'] },
      { id: 'delivery-status', kind: 'status', name: 'Delivery status', description: 'Current progress, evidence, blockers, and next decision needed.', stewards: ['developers'] },
    ],
    routes: [
      {
        id: 'direct-delivery',
        from: 'product-owner',
        to: ['developers'],
        intent: 'direct',
        obligation: 'must',
        purpose: 'Give the delivery team one unambiguous product direction.',
        carries: ['product-intent'],
        triggers: [{ type: 'event', events: ['work.requested'] }],
      },
      {
        id: 'report-delivery',
        from: 'developers',
        to: ['product-owner'],
        intent: 'report',
        obligation: 'must',
        purpose: 'Return delivery progress and decision needs to the product owner.',
        carries: ['delivery-status'],
        triggers: [{ type: 'event', events: ['work.updated', 'work.blocked', 'work.completed'] }],
      },
    ],
    limits: { maxPropagationHops: 6, maxFanout: 4 },
  }
}

function workflowExample() {
  return {
    schemaVersion: 'acx.cal/1',
    id: 'review-and-ship-remix',
    version: '0.1.0',
    name: 'Review and ship remix',
    description: 'A bounded agent-team workflow that implements one outcome, reviews the result, and returns a verification artifact.',
    license: 'Apache-2.0',
    authors: [{ name: 'Your name' }],
    tags: ['agent-team', 'review'],
    participants: [
      { alias: 'builder', bind: 'slot', slot: { role: 'backend_dev', capabilities: [{ taskType: 'implement-feature' }] } },
      { alias: 'reviewer', bind: 'slot', slot: { role: 'qa_engineer', capabilities: [{ taskType: 'review' }] } },
    ],
    rac: [],
    variables: [],
    limits: { maxSteps: 12, maxDurationMs: 3600000, maxParallel: 2 },
    start: 'start',
    nodes: [
      { id: 'start', type: 'event', event: 'start' },
      {
        id: 'build',
        type: 'task',
        agent: 'builder',
        action: 'Implement the requested outcome and record verification evidence.',
        requires: { capabilities: ['implement-feature'], skills: [], rac: [] },
        sideEffects: 'workspace',
        approval: 'on-request',
        completion: { type: 'verification', commands: ['test'], passIntent: 'Relevant checks pass and evidence is recorded.' },
      },
      {
        id: 'review',
        type: 'task',
        agent: 'reviewer',
        action: 'Review the result against the requested outcome and verification evidence.',
        requires: { capabilities: ['review'], skills: [], rac: [] },
        sideEffects: 'none',
        approval: 'never',
        completion: { type: 'artifact', produces: 'review-report' },
      },
      { id: 'done', type: 'event', event: 'end' },
    ],
    edges: [
      { from: 'start', to: 'build' },
      { from: 'build', to: 'review' },
      { from: 'review', to: 'done' },
    ],
  }
}

function setStatus(message, bad = false) {
  const status = $('[data-status]')
  status.textContent = message
  status.dataset.state = bad ? 'bad' : 'ok'
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function slug(value, fallback = 'artifact') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 128) || fallback
}

function option(value, selected, label = value) {
  const element = document.createElement('option')
  element.value = value
  element.textContent = label
  element.selected = value === selected
  return element
}

function field(labelText, value, onInput, options = {}) {
  const label = document.createElement('label')
  if (options.wide) label.className = 'field-wide'
  label.append(document.createTextNode(labelText))
  let input
  if (options.choices) {
    input = document.createElement('select')
    options.choices.forEach((choice) => input.append(option(choice, value)))
    if (value && !options.choices.includes(value)) input.append(option(value, value))
  } else if (options.textarea) {
    input = document.createElement('textarea')
    input.rows = options.rows || 2
    input.value = value ?? ''
  } else {
    input = document.createElement('input')
    input.type = options.type || 'text'
    input.value = value ?? ''
    if (options.min != null) input.min = String(options.min)
  }
  input.addEventListener(options.choices ? 'change' : 'input', () => {
    const next = options.number ? Number(input.value) : input.value
    onInput(next)
    changed()
  })
  label.append(input)
  return label
}

function removeButton(label, callback) {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.remove = ''
  button.setAttribute('aria-label', label)
  button.textContent = '×'
  button.addEventListener('click', callback)
  return button
}

function collectionHost(selector) {
  const host = $(selector)
  host.className = 'collection-list'
  host.replaceChildren()
  return host
}

function renderMetadata() {
  const form = $('[data-metadata-form]')
  for (const name of ['id', 'version', 'name', 'description', 'license']) {
    const input = form.elements.namedItem(name)
    input.value = draft[name] ?? ''
  }
  form.elements.namedItem('author').value = draft.authors?.[0]?.name ?? ''
  form.elements.namedItem('tags').value = (draft.tags || []).join(', ')
}

function bindMetadata() {
  $('[data-metadata-form]').addEventListener('input', (event) => {
    const target = event.target
    if (!target.name) return
    if (target.name === 'author') draft.authors = target.value.trim() ? [{ name: target.value }] : []
    else if (target.name === 'tags') draft.tags = target.value.split(',').map((value) => slug(value, '')).filter(Boolean)
    else if (target.name === 'id') draft.id = slug(target.value)
    else draft[target.name] = target.value
    changed()
  })
}

function renderActors() {
  const host = collectionHost('[data-actor-list]')
  for (const actor of draft.actors || []) {
    const card = document.createElement('div')
    card.className = 'entry-card'
    card.append(
      field('Id', actor.id, (value) => { actor.id = slug(value, 'actor') }),
      field('Kind', actor.kind, (value) => { actor.kind = value }, { choices: actorKinds }),
      field('Name', actor.name, (value) => { actor.name = value }),
      field('Description', actor.description, (value) => { actor.description = value }, { textarea: true, wide: true }),
      removeButton(`Remove actor ${actor.name || actor.id}`, () => {
        draft.actors = draft.actors.filter((item) => item !== actor)
        changed(true)
      }),
    )
    host.append(card)
  }
}

function renderKnowledge() {
  const host = collectionHost('[data-knowledge-list]')
  const actorIds = (draft.actors || []).map((actor) => actor.id)
  for (const item of draft.knowledge || []) {
    const card = document.createElement('div')
    card.className = 'entry-card'
    const steward = item.stewards?.[0] || actorIds[0] || ''
    card.append(
      field('Id', item.id, (value) => { item.id = slug(value, 'knowledge') }),
      field('Kind', item.kind, (value) => { item.kind = value }, { choices: knowledgeKinds }),
      field('Steward', steward, (value) => { item.stewards = value ? [value] : [] }, { choices: actorIds }),
      field('Name', item.name, (value) => { item.name = value }),
      field('Description', item.description, (value) => { item.description = value }, { textarea: true, wide: true }),
      removeButton(`Remove knowledge ${item.name || item.id}`, () => {
        draft.knowledge = draft.knowledge.filter((candidate) => candidate !== item)
        changed(true)
      }),
    )
    host.append(card)
  }
}

function renderRoutes() {
  const host = collectionHost('[data-route-list]')
  const actorIds = (draft.actors || []).map((actor) => actor.id)
  const knowledgeIds = (draft.knowledge || []).map((item) => item.id)
  for (const route of draft.routes || []) {
    const card = document.createElement('div')
    card.className = 'entry-card'
    card.append(
      field('Id', route.id, (value) => { route.id = slug(value, 'route') }),
      field('From', route.from, (value) => { route.from = value }, { choices: actorIds }),
      field('To', route.to?.[0] || '', (value) => { route.to = value ? [value] : [] }, { choices: actorIds }),
      field('Intent', route.intent, (value) => { route.intent = value }, { choices: routeIntents }),
      field('Obligation', route.obligation, (value) => { route.obligation = value }, { choices: obligations }),
      field('Carries', route.carries?.[0] || '', (value) => { route.carries = value ? [value] : [] }, { choices: knowledgeIds }),
      field('Purpose', route.purpose, (value) => { route.purpose = value }, { textarea: true, wide: true }),
      removeButton(`Remove route ${route.id}`, () => {
        draft.routes = draft.routes.filter((candidate) => candidate !== route)
        changed(true)
      }),
    )
    host.append(card)
  }
}

function renderGraphBounds() {
  const host = $('[data-graph-editor]')
  const hops = $('[name="maxPropagationHops"]', host)
  const fanout = $('[name="maxFanout"]', host)
  hops.value = draft.limits?.maxPropagationHops ?? 6
  fanout.value = draft.limits?.maxFanout ?? 4
}

function bindGraphBounds() {
  const host = $('[data-graph-editor]')
  host.addEventListener('input', (event) => {
    if (!['maxPropagationHops', 'maxFanout'].includes(event.target.name)) return
    draft.limits ||= {}
    draft.limits[event.target.name] = Number(event.target.value)
    changed()
  })
}

function renderParticipants() {
  const host = collectionHost('[data-participant-list]')
  for (const participant of draft.participants || []) {
    const card = document.createElement('div')
    card.className = 'entry-card'
    card.append(
      field('Alias', participant.alias, (value) => { participant.alias = slug(value, 'agent') }),
      field('Role', participant.slot?.role || '', (value) => { participant.slot ||= {}; participant.slot.role = value }),
      field('Capabilities', (participant.slot?.capabilities || []).map((item) => item.taskType).join(', '), (value) => {
        participant.slot ||= {}
        participant.slot.capabilities = value.split(',').map((item) => slug(item, '')).filter(Boolean).map((taskType) => ({ taskType }))
      }, { wide: true }),
      removeButton(`Remove participant ${participant.alias}`, () => {
        draft.participants = draft.participants.filter((candidate) => candidate !== participant)
        changed(true)
      }),
    )
    host.append(card)
  }
}

function renderTasks() {
  const host = collectionHost('[data-task-list]')
  const aliases = (draft.participants || []).map((participant) => participant.alias)
  for (const task of (draft.nodes || []).filter((node) => node.type === 'task')) {
    const card = document.createElement('div')
    card.className = 'entry-card'
    card.append(
      field('Step id', task.id, (value) => { task.id = slug(value, 'step') }),
      field('Agent', task.agent, (value) => { task.agent = value }, { choices: aliases }),
      field('Capability', task.requires?.capabilities?.[0] || '', (value) => {
        task.requires ||= { capabilities: [], skills: [], rac: [] }
        task.requires.capabilities = value ? [slug(value)] : []
      }),
      field('Action', task.action, (value) => { task.action = value }, { textarea: true, wide: true }),
      field('Pass intent / produced artifact', completionSummary(task), (value) => {
        if (task.completion?.type === 'artifact') task.completion.produces = value
        else {
          task.completion = {
            type: 'verification',
            commands: task.completion?.commands?.length ? task.completion.commands : ['test'],
            passIntent: value,
          }
        }
      }, { wide: true }),
      removeButton(`Remove step ${task.id}`, () => {
        if (!isLinearWorkflow(draft)) {
          setStatus('This imported workflow has branches. Remove advanced nodes in JSON so no edge is silently rewritten.', true)
          return
        }
        draft.nodes = draft.nodes.filter((candidate) => candidate !== task)
        rebuildLinearEdges()
        changed(true)
      }),
    )
    host.append(card)
  }
}

function completionSummary(task) {
  if (task.completion?.type === 'artifact') return task.completion.produces || ''
  return task.completion?.passIntent || ''
}

function renderWorkflowBounds() {
  const host = $('[data-workflow-editor]')
  for (const name of ['maxSteps', 'maxDurationMs', 'maxParallel']) {
    $('[name="' + name + '"]', host).value = draft.limits?.[name] ?? ({ maxSteps: 12, maxDurationMs: 3600000, maxParallel: 2 })[name]
  }
}

function bindWorkflowBounds() {
  const host = $('[data-workflow-editor]')
  host.addEventListener('input', (event) => {
    if (!['maxSteps', 'maxDurationMs', 'maxParallel'].includes(event.target.name)) return
    draft.limits ||= {}
    draft.limits[event.target.name] = Number(event.target.value)
    changed()
  })
}

function isLinearWorkflow(workflow) {
  const nodes = workflow.nodes || []
  const edges = workflow.edges || []
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(nodes.map((node) => [node.id, 0]))
  edges.forEach((edge) => {
    incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1)
    outgoing.set(edge.from, (outgoing.get(edge.from) || 0) + 1)
  })
  return nodes.every((node) => (incoming.get(node.id) || 0) <= 1 && (outgoing.get(node.id) || 0) <= 1)
}

function rebuildLinearEdges() {
  const start = draft.nodes.find((node) => node.id === draft.start)
    || draft.nodes.find((node) => node.type === 'event' && node.event === 'start')
  const end = draft.nodes.find((node) => node.type === 'event' && ['end', 'stop'].includes(node.event))
  const tasks = draft.nodes.filter((node) => node.type === 'task')
  if (!start || !end) return
  draft.start = start.id
  const sequence = [start, ...tasks, end]
  draft.edges = sequence.slice(0, -1).map((node, index) => ({ from: node.id, to: sequence[index + 1].id }))
}

function previewNode(title, subtitle, className = '') {
  const node = document.createElement('div')
  node.className = 'preview-node ' + className
  const strong = document.createElement('strong')
  strong.textContent = title
  const small = document.createElement('small')
  small.textContent = subtitle
  node.append(strong, small)
  return node
}

function renderPreview() {
  const host = $('[data-preview]')
  host.replaceChildren()
  if (mode === 'agent-graph') {
    for (const actor of draft.actors || []) host.append(previewNode(actor.name || actor.id, `${actor.kind} · ${actor.description || 'No responsibility described'}`))
    for (const route of draft.routes || []) {
      const card = document.createElement('div')
      card.className = `preview-route preview-route--${route.intent || 'inform'}`
      const strong = document.createElement('strong')
      strong.textContent = `${route.from || '—'} → ${(route.to || []).join(', ') || '—'}`
      const small = document.createElement('small')
      small.textContent = `${route.intent || 'route'} · ${(route.carries || []).join(', ') || 'no knowledge'} · ${route.purpose || 'No purpose described'}`
      card.append(strong, small)
      host.append(card)
    }
  } else {
    const byId = new Map((draft.nodes || []).map((node) => [node.id, node]))
    let current = draft.start
    const visited = new Set()
    while (current && !visited.has(current)) {
      visited.add(current)
      const node = byId.get(current)
      if (!node) break
      const label = node.type === 'task' ? `${node.agent || 'unassigned'} · ${node.action || 'No action'}` : node.event || node.type
      host.append(previewNode(node.id, label))
      const outgoing = (draft.edges || []).filter((edge) => edge.from === current)
      if (outgoing.length !== 1) {
        if (outgoing.length > 1) host.append(previewNode(`${outgoing.length} branches`, 'Open the JSON editor to inspect conditional paths.'))
        break
      }
      current = outgoing[0].to
    }
  }
  if (!host.children.length) host.append(previewNode('Empty draft', 'Add at least one actor or workflow step.'))
}

function renderLineage() {
  const card = $('[data-lineage-card]')
  const copy = $('[data-lineage-copy]')
  const parents = draft.lineage?.parents || []
  card.hidden = parents.length === 0
  if (parents.length) {
    const parent = parents[0]
    copy.textContent = `${parent.relation || 'remix'} of ${parent.publisherId || 'unknown'}/${parent.id || 'artifact'}${parent.version ? '@' + parent.version : ''}, pinned by ${shortDigest(parent.digest)}.`
  }
}

function shortDigest(value) {
  return typeof value === 'string' && value.startsWith('sha256:') ? value.slice(0, 18) + '…' : value || 'unknown digest'
}

function renderAll({ preserveJson = false } = {}) {
  renderMetadata()
  $('[data-graph-editor]').hidden = mode !== 'agent-graph'
  $('[data-workflow-editor]').hidden = mode !== 'workflow'
  $('[data-draft-kind]').textContent = mode === 'agent-graph' ? 'Agent Graph draft' : 'Workflow draft'
  $$('[data-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)))
  if (mode === 'agent-graph') {
    renderActors()
    renderKnowledge()
    renderRoutes()
    renderGraphBounds()
  } else {
    renderParticipants()
    renderTasks()
    renderWorkflowBounds()
  }
  renderPreview()
  renderLineage()
  updateHandoff()
  if (!preserveJson) {
    $('[data-json-editor]').value = JSON.stringify(draft, null, 2)
    rawEditorDirty = false
  }
  updateDigest()
}

function changed(rerenderCollections = false) {
  delete draft.integrity
  rawEditorDirty = false
  $('[data-json-editor]').value = JSON.stringify(draft, null, 2)
  if (rerenderCollections) renderAll()
  else {
    renderPreview()
    renderLineage()
    updateHandoff()
    updateDigest()
  }
  $('[data-validation-summary]').removeAttribute('data-state')
  $('[data-validation-summary]').replaceChildren(
    strongText('Draft changed. Run the checks again.'),
    paragraph('The exported document remains unsigned until you use the CLI.'),
  )
}

function strongText(text) {
  const strong = document.createElement('strong')
  strong.textContent = text
  return strong
}

function paragraph(text) {
  const p = document.createElement('p')
  p.textContent = text
  return p
}

function canonicalize(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JSON numbers must be finite')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalize(value[key])).join(',') + '}'
  }
  throw new Error('Unsupported JSON value')
}

async function updateDigest() {
  const chip = $('[data-digest]')
  try {
    const unsigned = clone(draft)
    delete unsigned.integrity
    const bytes = new TextEncoder().encode(canonicalize(unsigned))
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    chip.textContent = `draft sha256:${hex.slice(0, 12)}…`
    chip.title = `sha256:${hex}`
  } catch {
    chip.textContent = 'digest unavailable'
  }
}

function validateMetadata(issues) {
  if (!ID_RE.test(draft.id || '')) issues.push('Artifact id must be lowercase and start with a letter.')
  if (!SEMVER_RE.test(draft.version || '')) issues.push('Version must be valid SemVer.')
  if (typeof draft.name !== 'string' || draft.name.trim().length < 3) issues.push('Name must contain at least three characters.')
  if (typeof draft.description !== 'string' || draft.description.trim().length < 20) issues.push('Description must explain the reusable outcome in at least 20 characters.')
  if (!Array.isArray(draft.authors) || !draft.authors[0]?.name?.trim()) issues.push('Add the remix author.')
  if (!Array.isArray(draft.tags) || draft.tags.length === 0 || draft.tags.some((tag) => !TAG_RE.test(tag))) issues.push('Add one or more unique lowercase discovery tags.')
  if (draft.integrity) issues.push('Draft still carries an integrity block; edit it only by re-signing with the CLI.')
}

function duplicates(values) {
  return values.filter((value, index) => values.indexOf(value) !== index)
}

function validateGraph(issues) {
  const actors = draft.actors || []
  const knowledge = draft.knowledge || []
  const routes = draft.routes || []
  if (!actors.length) issues.push('Add at least one actor.')
  if (!knowledge.length) issues.push('Add at least one knowledge responsibility.')
  if (!routes.length) issues.push('Add at least one communication route.')
  const actorIds = new Set(actors.map((actor) => actor.id))
  const knowledgeIds = new Set(knowledge.map((item) => item.id))
  duplicates(actors.map((actor) => actor.id)).forEach((id) => issues.push(`Actor id '${id}' is duplicated.`))
  duplicates(knowledge.map((item) => item.id)).forEach((id) => issues.push(`Knowledge id '${id}' is duplicated.`))
  duplicates(routes.map((route) => route.id)).forEach((id) => issues.push(`Route id '${id}' is duplicated.`))
  actors.forEach((actor) => {
    if (!ID_RE.test(actor.id || '')) issues.push(`Actor '${actor.id || '?'}' has an invalid id.`)
    if (!actor.description?.trim()) issues.push(`Actor '${actor.id || '?'}' needs a responsibility description.`)
  })
  knowledge.forEach((item) => {
    if (!ID_RE.test(item.id || '')) issues.push(`Knowledge '${item.id || '?'}' has an invalid id.`)
    if (!item.description?.trim()) issues.push(`Knowledge '${item.id || '?'}' needs a description.`)
    ;(item.stewards || []).forEach((id) => { if (!actorIds.has(id)) issues.push(`Knowledge '${item.id}' references unknown steward '${id}'.`) })
  })
  routes.forEach((route) => {
    if (!actorIds.has(route.from)) issues.push(`Route '${route.id}' references unknown source '${route.from}'.`)
    ;(route.to || []).forEach((id) => { if (!actorIds.has(id)) issues.push(`Route '${route.id}' references unknown target '${id}'.`) })
    if ((route.to || []).includes(route.from)) issues.push(`Route '${route.id}' cannot target its own source.`)
    ;(route.carries || []).forEach((id) => { if (!knowledgeIds.has(id)) issues.push(`Route '${route.id}' carries unknown knowledge '${id}'.`) })
    if (!route.purpose?.trim() || route.purpose.trim().length < 10) issues.push(`Route '${route.id}' needs a useful purpose.`)
  })
  if (!Number.isInteger(draft.limits?.maxPropagationHops) || draft.limits.maxPropagationHops < 1) issues.push('Maximum propagation hops must be positive.')
  if (!Number.isInteger(draft.limits?.maxFanout) || draft.limits.maxFanout < 1) issues.push('Maximum fan-out must be positive.')
}

function validateWorkflow(issues) {
  const participants = draft.participants || []
  const nodes = draft.nodes || []
  const edges = draft.edges || []
  const aliases = new Set(participants.map((participant) => participant.alias))
  const nodeIds = new Set(nodes.map((node) => node.id))
  if (!participants.length) issues.push('Add at least one participant slot.')
  if (!nodes.length) issues.push('Add workflow nodes.')
  duplicates(participants.map((participant) => participant.alias)).forEach((id) => issues.push(`Participant alias '${id}' is duplicated.`))
  duplicates(nodes.map((node) => node.id)).forEach((id) => issues.push(`Node id '${id}' is duplicated.`))
  if (!nodeIds.has(draft.start)) issues.push('Workflow start does not reference a node.')
  if (!nodes.some((node) => node.type === 'event' && ['end', 'stop'].includes(node.event))) issues.push('Workflow needs an end or stop event.')
  nodes.filter((node) => node.type === 'task').forEach((task) => {
    if (!aliases.has(task.agent)) issues.push(`Task '${task.id}' references unknown participant '${task.agent}'.`)
    if (!task.completion?.type) issues.push(`Task '${task.id}' needs a typed completion contract.`)
  })
  edges.forEach((edge) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) issues.push(`Edge '${edge.from} → ${edge.to}' has a dangling node reference.`)
  })
  if (!Number.isInteger(draft.limits?.maxSteps) || draft.limits.maxSteps < 1) issues.push('Maximum steps must be positive.')
}

function secretLikeIssues() {
  const text = JSON.stringify(draft)
  const patterns = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key material'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
    [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
    [/\bxox[baprs]-[A-Za-z0-9-]+\b/, 'Slack token'],
    [/https?:\/\/[^/\s:@]+:[^/\s@]+@/, 'credential-bearing URL'],
    [/(?:\/Users\/|\/home\/|C:\\Users\\)[^"\\\s]+/i, 'local home path'],
  ]
  return patterns.filter(([pattern]) => pattern.test(text)).map(([, label]) => `Remove detected ${label} before export.`)
}

function validateDraft() {
  const issues = []
  validateMetadata(issues)
  if (mode === 'agent-graph') validateGraph(issues)
  else validateWorkflow(issues)
  issues.push(...secretLikeIssues())
  const summary = $('[data-validation-summary]')
  summary.replaceChildren()
  if (issues.length === 0) {
    summary.dataset.state = 'ok'
    summary.append(strongText('Draft checks passed.'), paragraph('Export the JSON, then run the authoritative CLI publication lint and signing command.'))
    setStatus('Draft checks passed. The document is still unsigned.')
  } else {
    summary.dataset.state = 'bad'
    summary.append(strongText(`${issues.length} draft issue${issues.length === 1 ? '' : 's'} to fix.`))
    const list = document.createElement('ul')
    issues.slice(0, 12).forEach((issue) => {
      const item = document.createElement('li')
      item.textContent = issue
      list.append(item)
    })
    if (issues.length > 12) {
      const item = document.createElement('li')
      item.textContent = `${issues.length - 12} more issue(s); use the CLI for the complete profile.`
      list.append(item)
    }
    summary.append(list)
    setStatus('Draft checks found issues. Nothing was uploaded.', true)
  }
  return issues
}

function filename() {
  return `${slug(draft.id)}.${mode === 'agent-graph' ? 'agent-graph' : 'cal'}.json`
}

function downloadDraft() {
  const body = JSON.stringify(draft, null, 2) + '\n'
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename()
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  setStatus(`Downloaded ${filename()}. Sign it only after the CLI lint passes.`)
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.className = 'clipboard-proxy'
  document.body.append(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  if (!ok) throw new Error('Clipboard unavailable')
}

function updateHandoff() {
  const file = filename()
  const command = mode === 'agent-graph'
    ? `acx graph lint ${file} --publish\nacx graph sign ${file} --publisher io.github.you --out ${slug(draft.id)}.signed.agent-graph.json\nacx graph verify ${slug(draft.id)}.signed.agent-graph.json\nacx share graph ${slug(draft.id)}.signed.agent-graph.json --registry ./registry --dry-run\nacx share graph ${slug(draft.id)}.signed.agent-graph.json --registry ./registry`
    : `acx workflow lint ${file} --publish\nacx workflow sign ${file} --publisher io.github.you --out ${slug(draft.id)}.signed.cal.json\nacx workflow verify ${slug(draft.id)}.signed.cal.json\nacx share workflow ${slug(draft.id)}.signed.cal.json --registry ./registry --dry-run\nacx share workflow ${slug(draft.id)}.signed.cal.json --registry ./registry`
  $('[data-sign-command]').textContent = command
}

function setMode(next, nextDraft = null) {
  mode = next
  draft = nextDraft || (mode === 'agent-graph' ? graphExample() : workflowExample())
  delete draft.integrity
  renderAll()
  setStatus(`Started a new unsigned ${mode === 'agent-graph' ? 'Agent Graph' : 'workflow'} draft.`)
}

function addGraphItem(type) {
  if (type === 'actor') {
    draft.actors ||= []
    const index = draft.actors.length + 1
    draft.actors.push({ id: `actor-${index}`, kind: 'agent', name: `Actor ${index}`, description: 'Describe this logical seat and its responsibility.' })
  } else if (type === 'knowledge') {
    draft.knowledge ||= []
    const index = draft.knowledge.length + 1
    draft.knowledge.push({
      id: `knowledge-${index}`,
      kind: 'context',
      name: `Knowledge ${index}`,
      description: 'Describe the information responsibility, never the private content.',
      stewards: [draft.actors?.[0]?.id || 'actor-1'],
    })
  } else if (type === 'route') {
    draft.routes ||= []
    const index = draft.routes.length + 1
    draft.routes.push({
      id: `route-${index}`,
      from: draft.actors?.[0]?.id || '',
      to: [draft.actors?.[1]?.id || draft.actors?.[0]?.id || ''],
      intent: 'inform',
      obligation: 'should',
      purpose: 'Describe why this information should move between these seats.',
      carries: [draft.knowledge?.[0]?.id || ''],
      triggers: [{ type: 'manual', description: 'A human or host maps its local event to this route.' }],
    })
  }
  changed(true)
}

function addWorkflowItem(type) {
  if (type === 'participant') {
    draft.participants ||= []
    const index = draft.participants.length + 1
    draft.participants.push({ alias: `agent-${index}`, bind: 'slot', slot: { role: 'backend_dev', capabilities: [{ taskType: 'implement-feature' }] } })
    changed(true)
    return
  }
  if (type === 'task') {
    if (!isLinearWorkflow(draft)) {
      setStatus('This imported workflow has branches. Add advanced nodes in JSON so existing conditions are preserved.', true)
      return
    }
    const endIndex = draft.nodes.findIndex((node) => node.type === 'event' && ['end', 'stop'].includes(node.event))
    const index = draft.nodes.filter((node) => node.type === 'task').length + 1
    const task = {
      id: `step-${index}`,
      type: 'task',
      agent: draft.participants?.[0]?.alias || '',
      action: 'Describe the reusable outcome this agent must produce.',
      requires: { capabilities: [], skills: [], rac: [] },
      sideEffects: 'workspace',
      approval: 'on-request',
      completion: { type: 'verification', commands: ['test'], passIntent: 'Define the evidence that proves this step is complete.' },
    }
    if (endIndex >= 0) draft.nodes.splice(endIndex, 0, task)
    else draft.nodes.push(task)
    rebuildLinearEdges()
    changed(true)
  }
}

function lineageParent(document, sourceUrl = null) {
  const integrity = document.integrity || {}
  const parent = {
    artifactType: document.schemaVersion === 'acx.agent-graph/1' ? 'agent-graph' : 'workflow',
    publisherId: integrity.publisherId || 'io.github.unknown',
    id: document.id,
    version: document.version,
    digest: integrity.digest,
    relation: 'remix',
  }
  if (sourceUrl?.protocol === 'https:') parent.source = sourceUrl.href
  return parent
}

function remixImported(document, sourceUrl = null) {
  const imported = clone(document)
  const signed = imported.integrity
  delete imported.integrity
  if (signed?.digest && imported.id && imported.version) {
    imported.lineage = {
      parents: [lineageParent(document, sourceUrl)],
      note: 'Remixed in the static ACX Studio; inspect the signed parent before reuse.',
    }
  }
  imported.id = `${slug(imported.id)}-remix`
  imported.version = '0.1.0'
  imported.name = `${imported.name || imported.id} remix`
  imported.authors = [{ name: 'Your name' }]
  imported.tags = [...new Set([...(imported.tags || []), 'remix'])]
  return imported
}

function acceptDocument(document, { remix = true, sourceUrl = null } = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Imported JSON must be an object.')
  const nextMode = document.schemaVersion === 'acx.agent-graph/1'
    ? 'agent-graph'
    : document.schemaVersion === 'acx.cal/1'
      ? 'workflow'
      : null
  if (!nextMode) throw new Error('Expected schemaVersion acx.agent-graph/1 or acx.cal/1.')
  mode = nextMode
  draft = remix ? remixImported(document, sourceUrl) : clone(document)
  delete draft.integrity
  renderAll()
  setStatus(remix && document.integrity ? 'Signed parent imported. Its integrity block was removed and immutable remix lineage was added.' : 'Draft imported locally. Nothing was uploaded.')
}

async function acceptImportedDocument(document, { sourceUrl = null } = {}) {
  if (document?.integrity) {
    const verification = await verifyArtifact(document)
    if (!verification.ok || !verification.signed) {
      throw new Error(`Integrity-bearing parent failed portable verification: ${verification.issues.join(' ')}`)
    }
  }
  acceptDocument(document, { remix: true, sourceUrl })
}

async function importFile(file) {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('Imported JSON exceeds the 2 MiB Studio limit.')
  const text = await file.text()
  await acceptImportedDocument(JSON.parse(text))
}

async function loadSourceFromQuery() {
  const params = new URLSearchParams(location.search)
  const source = params.get('source')
  if (!source) return
  const url = new URL(source, location.href)
  if (url.origin !== location.origin || !url.pathname.includes('/artifacts/')) {
    throw new Error('Remix source must be a same-origin bundled registry artifact.')
  }
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`Could not load remix source (${response.status}).`)
  await acceptImportedDocument(await response.json(), { sourceUrl: url })
}

function applyJson() {
  try {
    acceptDocument(JSON.parse($('[data-json-editor]').value), { remix: false })
    rawEditorDirty = false
    setStatus('JSON applied to the local draft. The integrity block remains removed.')
  } catch (error) {
    setStatus(`JSON was not applied: ${error.message}`, true)
  }
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, draft }))
    setStatus('Draft saved only in this browser. Clear site data to remove it.')
  } catch {
    setStatus('This browser did not allow local draft storage. Download the JSON instead.', true)
  }
}

function restoreLocal() {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (!value) {
      setStatus('No local ACX Studio draft was found.', true)
      return
    }
    const saved = JSON.parse(value)
    acceptDocument(saved.draft, { remix: false })
    setStatus('Restored the draft from this browser.')
  } catch (error) {
    setStatus(`Local draft could not be restored: ${error.message}`, true)
  }
}

function bindActions() {
  $('[data-metadata-form]').addEventListener('submit', (event) => event.preventDefault())
  $$('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)))
  $$('[data-add]').forEach((button) => button.addEventListener('click', () => {
    if (mode === 'agent-graph') addGraphItem(button.dataset.add)
    else addWorkflowItem(button.dataset.add)
  }))
  $('[data-import]').addEventListener('change', async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try { await importFile(file) } catch (error) { setStatus(`Import failed: ${error.message}`, true) }
    event.target.value = ''
  })
  $('[data-json-editor]').addEventListener('input', () => { rawEditorDirty = true })
  $('[data-action="new"]').addEventListener('click', () => setMode(mode))
  $('[data-action="example"]').addEventListener('click', () => setMode(mode))
  $('[data-action="validate"]').addEventListener('click', validateDraft)
  $('[data-action="download"]').addEventListener('click', downloadDraft)
  $('[data-action="apply-json"]').addEventListener('click', applyJson)
  $('[data-action="save-local"]').addEventListener('click', saveLocal)
  $('[data-action="restore-local"]').addEventListener('click', restoreLocal)
  $('[data-action="copy-json"]').addEventListener('click', async () => {
    try {
      await copyText(rawEditorDirty ? $('[data-json-editor]').value : JSON.stringify(draft, null, 2))
      setStatus('JSON copied.')
    } catch { setStatus('Clipboard unavailable. Select the JSON and copy it manually.', true) }
  })
  $('[data-action="copy-command"]').addEventListener('click', async () => {
    try {
      await copyText($('[data-sign-command]').textContent)
      setStatus('CLI handoff copied.')
    } catch { setStatus('Clipboard unavailable. Select the command and copy it manually.', true) }
  })
}

bindMetadata()
bindGraphBounds()
bindWorkflowBounds()
bindActions()
renderAll()
loadSourceFromQuery().catch((error) => setStatus(`Could not open the requested remix: ${error.message}`, true))
