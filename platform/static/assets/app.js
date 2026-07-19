import { verifyArtifact } from './verify.js'

const TYPE_LABELS = {
  agent: 'Agent cartridge',
  workflow: 'Agent workflow',
  'agent-graph': 'Agent Graph',
  template: 'Starter template',
}

const TYPE_ORDER = ['agent', 'workflow', 'agent-graph', 'template']
const state = {
  items: [],
  filtered: [],
  selected: null,
  registryMode: 'built',
  query: '',
  type: 'all',
  trust: 'all',
  sort: 'featured',
}

const byId = (id) => document.getElementById(id)

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function number(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function strings(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()))]
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.includes('\0')) return null
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null
  return segments.every((segment) => /^[A-Za-z0-9][A-Za-z0-9._@+-]*$/.test(segment)) ? value : null
}

function sourceDownloadPath(type, registryPath) {
  const path = safeRelativePath(registryPath)
  if (!path) return null
  const allowed = type === 'agent'
    ? /^cartridges\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[A-Za-z0-9.+-]+\/cartridge\.acx$/.test(path)
    : type === 'workflow'
      ? /^cals\/(?:[A-Za-z0-9._+-]+\/){2,}[A-Za-z0-9.+-]+\.cal\.json$/.test(path)
      : type === 'agent-graph'
        ? /^graphs\/(?:[A-Za-z0-9._+-]+\/){2,}[A-Za-z0-9.+-]+\.agent-graph\.json$/.test(path)
        : /^templates\/[A-Za-z0-9._-]+\/manifest\.json$/.test(path)
  if (!allowed) return null
  return state.registryMode === 'built' ? `data/artifacts/${path}` : `../../registry/${path}`
}

function exchangePath(entry, field) {
  const candidate = safeRelativePath(entry?.exchange?.[field])
  return state.registryMode === 'built' ? candidate : null
}

function normalizeAgent(entry, index) {
  const capabilities = Array.isArray(entry?.capabilities) ? entry.capabilities : []
  const capabilityNames = capabilities.map((capability) => text(capability?.taskType)).filter(Boolean)
  const stacks = capabilities.flatMap((capability) => strings(capability?.stack))
  const capabilityStates = capabilities.map((capability) => text(capability?.verificationState)).filter(Boolean)
  const verifiedCapabilities = capabilities.filter((capability) => capability?.verified === true).length
  const authors = (Array.isArray(entry?.authors) ? entry.authors : [])
    .map((author) => typeof author === 'string' ? author : text(author?.name))
    .filter(Boolean)
  const publisher = text(entry?.publisher, 'Unknown publisher')
  const id = text(entry?.id, `agent-${index + 1}`)
  const version = text(entry?.version, 'unversioned')
  const lifecycle = text(entry?.registryStatus?.status, 'active')
  const effectiveLevel = entry?.level && Number.isFinite(Number(entry.level.acxLevel))
    ? number(entry.level.acxLevel)
    : null
  const fallbackDescription = `Portable ${text(entry?.role, 'agent')} cartridge for ${capabilityNames.length ? capabilityNames.join(', ') : 'reusable agent work'}.`
  return {
    key: `agent:${publisher}/${id}@${version}`,
    id,
    type: 'agent',
    name: text(entry?.name, id),
    description: text(entry?.description, fallbackDescription),
    publisher,
    version,
    license: text(entry?.license, null),
    tags: strings([...strings(entry?.tags), entry?.role, ...capabilityNames, ...stacks]),
    trustSignal: 'cli',
    trustLabel: 'Verify with CLI',
    registryTrust: text(entry?.trust, 'portable'),
    registryStatus: text(entry?.trustStatus, 'warning'),
    lifecycle,
    lifecycleReason: text(entry?.registryStatus?.reason, ''),
    latest: entry?.latest !== false,
    signed: true,
    path: safeRelativePath(entry?.path),
    downloadPath: exchangePath(entry, 'downloadPath') || sourceDownloadPath('agent', entry?.path),
    detailPath: exchangePath(entry, 'detailPath'),
    filename: `${id}-${version}.acx`,
    verifyCommand: `acx verify ${id}-${version}.acx`,
    metric: effectiveLevel === null ? `${capabilityNames.length} moves` : `Proven Lv.${effectiveLevel}`,
    level: effectiveLevel ?? -1,
    facts: [
      ['Version', text(entry?.version, 'Not versioned')],
      ['Role', text(entry?.role, 'Not declared')],
      ['Model', text(entry?.model, 'Not declared')],
      ['Capabilities', String(capabilityNames.length)],
      ['Verified moves', String(verifiedCapabilities)],
      ['Proven level', effectiveLevel === null ? 'Not resolved' : `Lv.${effectiveLevel}`],
      ['Lifecycle', lifecycle],
    ],
    search: [
      entry?.role,
      entry?.provider,
      entry?.model,
      entry?.romHash,
      entry?.homepage,
      ...authors,
      ...capabilityNames,
      ...stacks,
      ...capabilityStates,
    ],
  }
}

function normalizeWorkflow(entry, index) {
  const id = text(entry?.id, `workflow-${index + 1}`)
  const publisher = text(entry?.publisher, 'Unknown publisher')
  const lifecycle = text(entry?.registryStatus?.status, 'active')
  const lineage = Array.isArray(entry?.lineage) ? entry.lineage : []
  const latest = entry?.latest !== false
  return {
    key: `workflow:${publisher}/${id}@${text(entry?.version, 'unversioned')}`,
    id,
    type: 'workflow',
    name: text(entry?.name, id),
    description: text(entry?.description, 'A portable ACX agent-team workflow.'),
    publisher,
    version: text(entry?.version, null),
    license: text(entry?.license, null),
    tags: strings([...strings(entry?.tags), ...strings(entry?.capabilities)]),
    trustSignal: entry?.signed ? 'signed' : 'unsigned',
    trustLabel: entry?.signed ? (latest ? 'Signed JSON' : 'Signed · older') : 'Unsigned',
    registryTrust: text(entry?.trust, 'portable'),
    registryStatus: text(entry?.trustStatus, 'warning'),
    lifecycle,
    lifecycleReason: text(entry?.registryStatus?.reason, ''),
    latest,
    signed: Boolean(entry?.signed),
    path: safeRelativePath(entry?.path),
    downloadPath: exchangePath(entry, 'downloadPath') || sourceDownloadPath('workflow', entry?.path),
    detailPath: exchangePath(entry, 'detailPath'),
    filename: `${id}.cal.json`,
    verifyCommand: `acx workflow verify ${id}.cal.json`,
    metric: `${number(entry?.participantCount)} agents`,
    level: -1,
    facts: [
      ['Version', text(entry?.version, 'Unversioned')],
      ['Participants', String(number(entry?.participantCount))],
      ['Nodes', String(number(entry?.nodeCount))],
      ['Digest', text(entry?.digest, 'Not indexed')],
      ['License', text(entry?.license, 'Not declared')],
      ['Release', latest ? 'Latest' : 'Previous version'],
      ['Registry signal', text(entry?.trust, 'portable')],
      ['Lifecycle', lifecycle],
      ['Remix parents', String(lineage.length)],
    ],
    search: [
      entry?.digest,
      ...strings(entry?.capabilities),
      ...(Array.isArray(entry?.participants) ? entry.participants : []).flatMap((participant) => [participant?.alias, participant?.role]),
      ...lineage.flatMap((parent) => [parent?.publisherId, parent?.id, parent?.version, parent?.digest]),
    ],
  }
}

function normalizeGraph(entry, index) {
  const id = text(entry?.id, `agent-graph-${index + 1}`)
  const publisher = text(entry?.publisher, 'Unknown publisher')
  const lifecycle = text(entry?.registryStatus?.status, 'active')
  const lineage = Array.isArray(entry?.lineage) ? entry.lineage : []
  const dependencies = Array.isArray(entry?.dependencies) ? entry.dependencies : []
  const latest = entry?.latest !== false
  return {
    key: `agent-graph:${publisher}/${id}@${text(entry?.version, 'unversioned')}`,
    id,
    type: 'agent-graph',
    name: text(entry?.name, id),
    description: text(entry?.description, 'A portable information architecture for agent-team communication.'),
    publisher,
    version: text(entry?.version, null),
    license: text(entry?.license, null),
    tags: strings([...strings(entry?.tags), ...strings(entry?.intents)]),
    trustSignal: entry?.signed ? 'signed' : 'unsigned',
    trustLabel: entry?.signed ? (latest ? 'Signed JSON' : 'Signed · older') : 'Unsigned',
    registryTrust: text(entry?.trust, 'portable'),
    registryStatus: text(entry?.trustStatus, 'warning'),
    lifecycle,
    lifecycleReason: text(entry?.registryStatus?.reason, ''),
    latest,
    signed: Boolean(entry?.signed),
    path: safeRelativePath(entry?.path),
    downloadPath: exchangePath(entry, 'downloadPath') || sourceDownloadPath('agent-graph', entry?.path),
    detailPath: exchangePath(entry, 'detailPath'),
    filename: `${id}.agent-graph.json`,
    verifyCommand: `acx graph verify ${id}.agent-graph.json`,
    metric: `${number(entry?.routeCount)} routes`,
    level: -1,
    facts: [
      ['Version', text(entry?.version, 'Unversioned')],
      ['Actors', String(number(entry?.actorCount))],
      ['Knowledge', String(number(entry?.knowledgeCount))],
      ['Routes', String(number(entry?.routeCount))],
      ['Loops', String(number(entry?.loopCount))],
      ['Dependencies', String(dependencies.length)],
      ['Release', latest ? 'Latest' : 'Previous version'],
      ['Digest', text(entry?.digest, 'Not indexed')],
      ['Lifecycle', lifecycle],
      ['Remix parents', String(lineage.length)],
    ],
    search: [
      entry?.digest,
      ...strings(entry?.intents),
      ...(Array.isArray(entry?.actors) ? entry.actors : []).flatMap((actor) => [actor?.id, actor?.name, actor?.kind]),
      ...(Array.isArray(entry?.knowledge) ? entry.knowledge : []).flatMap((knowledge) => [knowledge?.id, knowledge?.name, knowledge?.kind]),
      ...dependencies.flatMap((dependency) => [dependency?.publisherId, dependency?.id, dependency?.version, dependency?.status]),
      ...lineage.flatMap((parent) => [parent?.publisherId, parent?.id, parent?.version, parent?.digest]),
    ],
  }
}

function normalizeTemplate(entry, index) {
  const id = text(entry?.id, `template-${index + 1}`)
  return {
    key: `template:${id}`,
    id,
    type: 'template',
    name: text(entry?.name, id),
    description: text(entry?.description, 'A portable starter package you can fill, review, and export locally.'),
    publisher: text(entry?.publisher, 'ACX community'),
    version: text(entry?.version, null),
    license: text(entry?.license, null),
    tags: strings(entry?.tags),
    trustSignal: 'unsigned',
    trustLabel: 'Inspect template',
    registryTrust: 'unsigned',
    registryStatus: 'warning',
    lifecycle: 'active',
    lifecycleReason: '',
    latest: true,
    signed: false,
    path: safeRelativePath(entry?.path),
    downloadPath: exchangePath(entry, 'downloadPath') || sourceDownloadPath('template', entry?.path),
    detailPath: exchangePath(entry, 'detailPath'),
    filename: `${id}.template.json`,
    verifyCommand: null,
    metric: `${number(entry?.fileCount)} files`,
    level: -1,
    facts: [
      ['Version', text(entry?.version, 'Draft')],
      ['Files', String(number(entry?.fileCount))],
      ['Format', 'ACX template bundle'],
      ['License', text(entry?.license, 'Not declared')],
      ['Signature', 'None — inspect files'],
      ['Execution', 'Never automatic'],
    ],
    search: strings(entry?.files),
  }
}

function normalizeIndex(index) {
  const items = [
    ...(Array.isArray(index?.cartridges) ? index.cartridges.map(normalizeAgent) : []),
    ...(Array.isArray(index?.workflows) ? index.workflows.map(normalizeWorkflow) : []),
    ...(Array.isArray(index?.agentGraphs) ? index.agentGraphs.map(normalizeGraph) : []),
    ...(Array.isArray(index?.templates) ? index.templates.map(normalizeTemplate) : []),
  ]
  return items
    .filter((item) => item.downloadPath)
    .map((item) => ({
      ...item,
      searchText: [
        item.name, item.description, item.publisher, item.id, item.version, item.license,
        item.lifecycle, item.lifecycleReason, ...item.tags, ...item.search,
      ].filter(Boolean).join(' ').toLocaleLowerCase(),
    }))
}

function createElement(tag, className, content) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (content !== undefined) element.textContent = String(content)
  return element
}

function appendTag(container, value) {
  container.append(createElement('span', 'tag', value))
}

function trustClass(item) {
  if (item.lifecycle === 'withdrawn') return 'trust-badge trust-badge-withdrawn'
  if (item.lifecycle !== 'active') return 'trust-badge trust-badge-unsigned'
  if (item.trustSignal === 'cli') return 'trust-badge trust-badge-cli'
  if (item.trustSignal === 'unsigned') return 'trust-badge trust-badge-unsigned'
  return 'trust-badge'
}

function cardFor(item) {
  const card = createElement('article', 'artifact-card')
  card.classList.add(`type-${item.type}`)
  card.tabIndex = 0
  card.setAttribute('role', 'button')
  card.setAttribute('aria-label', `Open ${TYPE_LABELS[item.type]}: ${item.name}`)

  const top = createElement('div', 'card-top')
  top.append(
    createElement('span', 'type-label', TYPE_LABELS[item.type]),
    createElement('span', trustClass(item), item.lifecycle === 'active' ? item.trustLabel : item.lifecycle),
  )

  const heading = createElement('h3', null, item.name)
  const description = createElement('p', 'card-description', item.description)
  const tags = createElement('div', 'card-tags')
  item.tags.slice(0, 3).forEach((tag) => appendTag(tags, tag))

  const footer = createElement('div', 'card-footer')
  const owner = createElement('div')
  owner.append(createElement('span', null, 'Publisher'), createElement('strong', null, item.publisher))
  footer.append(owner, createElement('span', 'card-metric', item.metric))

  card.append(top, heading, description, tags, footer)
  card.addEventListener('click', () => openDetail(item))
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openDetail(item)
    }
  })
  return card
}

function filterItems() {
  const query = state.query.trim().toLocaleLowerCase()
  state.filtered = state.items.filter((item) => {
    if (state.type !== 'all' && item.type !== state.type) return false
    if (state.trust !== 'all' && item.trustSignal !== state.trust) return false
    return !query || item.searchText.includes(query)
  })
  const typeRank = (item) => TYPE_ORDER.indexOf(item.type)
  state.filtered.sort((left, right) => {
    if (state.sort === 'name') return left.name.localeCompare(right.name)
    if (state.sort === 'type') return typeRank(left) - typeRank(right) || left.name.localeCompare(right.name)
    if (state.sort === 'level') return right.level - left.level || left.name.localeCompare(right.name)
    return Number(right.lifecycle === 'active') - Number(left.lifecycle === 'active')
      || Number(right.latest) - Number(left.latest)
      || typeRank(left) - typeRank(right)
      || right.signed - left.signed
      || left.name.localeCompare(right.name)
  })
}

function renderCounts() {
  const counts = Object.fromEntries(TYPE_ORDER.map((type) => [type, state.items.filter((item) => item.type === type).length]))
  byId('count-all').textContent = String(state.items.length)
  TYPE_ORDER.forEach((type) => { byId(`count-${type}`).textContent = String(counts[type]) })
}

function render() {
  filterItems()
  const results = byId('results')
  results.replaceChildren(...state.filtered.map(cardFor))
  results.setAttribute('aria-busy', 'false')
  byId('empty-state').hidden = state.filtered.length > 0
  byId('catalog-meta').textContent = `${state.filtered.length} of ${state.items.length} portable artifacts`
  document.querySelectorAll('[data-type]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.type === state.type))
  })
}

function clearFilters() {
  state.query = ''
  state.type = 'all'
  state.trust = 'all'
  state.sort = 'featured'
  byId('search').value = ''
  byId('type-filter').value = 'all'
  byId('trust-filter').value = 'all'
  byId('sort').value = 'featured'
  render()
}

function factNodes(facts) {
  return facts.map(([label, value]) => {
    const wrapper = createElement('div')
    wrapper.append(createElement('dt', null, label), createElement('dd', null, value))
    return wrapper
  })
}

function detailTrustCopy(item) {
  if (item.lifecycle !== 'active') {
    return `Registry lifecycle: ${item.lifecycle}. ${item.lifecycleReason || 'Treat this artifact as historical and inspect its successor or advisory before use.'}`
  }
  if (item.type === 'agent') {
    return 'The registry reports this cartridge as portable, but a browser cannot inspect its SQLite container. Download it and run the ACX CLI before loading.'
  }
  if (item.type === 'template') {
    return 'Templates are editable source material, not signed execution artifacts. Inspect every bundled file before using or publishing it.'
  }
  return 'The registry indexes a signed artifact. Browser verification authenticates its bytes to the included Ed25519 key; it does not prove control of the claimed publisher namespace.'
}

function verifyExplanation(item) {
  if (item.type === 'agent') return `After download, run: ${item.verifyCommand}`
  if (item.type === 'template') return 'No code runs here. Open the JSON bundle and review every file before importing.'
  return 'Recompute the JCS digest, verify the Ed25519 DSSE signature, and compare every in-toto identity binding.'
}

function setDetailHash(item) {
  const params = new URLSearchParams()
  params.set('artifact', item.key)
  history.replaceState(null, '', `${location.pathname}${location.search}#${params}`)
}

function clearDetailHash() {
  if (location.hash) history.replaceState(null, '', `${location.pathname}${location.search}`)
}

function openDetail(item, { updateHash = true } = {}) {
  state.selected = item
  byId('detail-accent').className = `detail-accent type-${item.type}`
  byId('detail-type').textContent = TYPE_LABELS[item.type]
  byId('detail-title').textContent = item.name
  byId('detail-description').textContent = item.description
  byId('detail-trust').textContent = detailTrustCopy(item)
  byId('detail-facts').replaceChildren(...factNodes(item.facts))
  const tags = byId('detail-tags')
  tags.replaceChildren()
  item.tags.forEach((tag) => appendTag(tags, tag))
  byId('verify-explanation').textContent = verifyExplanation(item)
  const output = byId('verify-result')
  output.textContent = ''
  output.removeAttribute('data-state')

  const browserVerifiable = item.type === 'workflow' || item.type === 'agent-graph'
  const remixable = browserVerifiable
  byId('verify-action').hidden = !browserVerifiable
  byId('copy-action').hidden = !item.verifyCommand
  byId('remix-action').hidden = !remixable
  byId('remix-action').href = remixable
    ? `./studio/?source=${encodeURIComponent(new URL(item.downloadPath, document.baseURI).href)}`
    : './studio/'
  byId('download-action').disabled = false

  if (updateHash) setDetailHash(item)
  const dialog = byId('detail-dialog')
  if (!dialog.open) dialog.showModal()
}

function closeDetail() {
  state.selected = null
  if (byId('detail-dialog').open) byId('detail-dialog').close()
  clearDetailHash()
}

function toast(message) {
  const element = byId('toast')
  element.textContent = message
  element.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => { element.hidden = true }, 3200)
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.className = 'clipboard-proxy'
  document.body.append(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) throw new Error('Clipboard access is unavailable')
}

async function fetchArtifact(item) {
  const url = new URL(item.downloadPath, document.baseURI)
  if (url.origin !== location.origin && location.protocol !== 'file:') throw new Error('Cross-origin artifact URLs are refused')
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error(`Artifact request failed (${response.status})`)
  const size = Number(response.headers.get('content-length') || 0)
  if (size > 10 * 1024 * 1024) throw new Error('Artifact exceeds the 10 MiB browser verification limit')
  return response
}

async function downloadSelected() {
  const item = state.selected
  if (!item) return
  const button = byId('download-action')
  button.disabled = true
  try {
    const response = await fetchArtifact(item)
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = item.filename
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(objectUrl)
    toast(`${item.filename} downloaded`)
  } catch (error) {
    toast(error.message)
  } finally {
    button.disabled = false
  }
}

async function verifySelected() {
  const item = state.selected
  if (!item || !['workflow', 'agent-graph'].includes(item.type)) return
  const button = byId('verify-action')
  const output = byId('verify-result')
  button.disabled = true
  output.textContent = 'Verifying locally…'
  output.removeAttribute('data-state')
  try {
    const response = await fetchArtifact(item)
    const artifact = await response.json()
    const result = await verifyArtifact(artifact)
    output.dataset.state = result.ok && result.signed ? 'valid' : 'invalid'
    output.textContent = result.ok && result.signed
      ? `Valid portable signature · ${result.digest.slice(0, 23)}… · namespace not proven`
      : result.issues.join(' ')
  } catch (error) {
    output.dataset.state = 'invalid'
    output.textContent = error.message
  } finally {
    button.disabled = false
  }
}

async function copyCommand() {
  if (!state.selected?.verifyCommand) return
  try {
    await copyText(state.selected.verifyCommand)
    toast('Verify command copied')
  } catch (error) {
    toast(error.message)
  }
}

function shareUrl(item) {
  if (item.detailPath) return new URL(item.detailPath, document.baseURI).href
  const url = new URL(location.href)
  url.hash = new URLSearchParams({ artifact: item.key }).toString()
  return url.href
}

async function shareSelected() {
  const item = state.selected
  if (!item) return
  const payload = {
    title: `${item.name} · ACX Exchange`,
    text: `${TYPE_LABELS[item.type]} by ${item.publisher}. Inspect and verify before use.`,
    url: shareUrl(item),
  }
  try {
    if (navigator.share) {
      await navigator.share(payload)
      return
    }
    await copyText(payload.url)
    toast('Artifact share link copied')
  } catch (error) {
    if (error.name !== 'AbortError') toast(error.message)
  }
}

function openFromHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''))
  const key = params.get('artifact')
  if (!key) return
  const item = state.items.find((candidate) => candidate.key === key)
  if (item) openDetail(item, { updateHash: false })
}

async function loadIndex() {
  byId('error-state').hidden = true
  byId('results').setAttribute('aria-busy', 'true')
  const candidates = [
    { url: './data/index.json', mode: 'built' },
    { url: '../../registry/index.json', mode: 'source' },
  ]
  let lastError
  for (const candidate of candidates) {
    try {
      const response = await fetch(new URL(candidate.url, document.baseURI), {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`${candidate.url} returned ${response.status}`)
      const index = await response.json()
      state.registryMode = index?.exchangeSchemaVersion ? 'built' : candidate.mode
      state.items = normalizeIndex(index)
      if (!state.items.length) throw new Error('Registry contains no safe exchange artifacts')
      renderCounts()
      render()
      openFromHash()
      return
    } catch (error) {
      lastError = error
    }
  }
  byId('results').setAttribute('aria-busy', 'false')
  byId('catalog-meta').textContent = 'Registry unavailable'
  byId('error-message').textContent = lastError?.message || 'Unknown registry error'
  byId('error-state').hidden = false
}

function wireEvents() {
  byId('filters').addEventListener('submit', (event) => event.preventDefault())
  byId('search').addEventListener('input', (event) => {
    state.query = event.target.value
    render()
  })
  byId('type-filter').addEventListener('change', (event) => {
    state.type = event.target.value
    render()
  })
  byId('trust-filter').addEventListener('change', (event) => {
    state.trust = event.target.value
    render()
  })
  byId('sort').addEventListener('change', (event) => {
    state.sort = event.target.value
    render()
  })
  document.querySelectorAll('[data-type]').forEach((button) => {
    button.addEventListener('click', () => {
      state.type = button.dataset.type
      byId('type-filter').value = state.type
      render()
    })
  })
  byId('clear-filters').addEventListener('click', clearFilters)
  byId('empty-clear').addEventListener('click', clearFilters)
  byId('retry').addEventListener('click', loadIndex)
  byId('dialog-close').addEventListener('click', closeDetail)
  byId('detail-dialog').addEventListener('click', (event) => {
    if (event.target === byId('detail-dialog')) closeDetail()
  })
  byId('detail-dialog').addEventListener('close', () => {
    state.selected = null
    clearDetailHash()
  })
  byId('download-action').addEventListener('click', downloadSelected)
  byId('verify-action').addEventListener('click', verifySelected)
  byId('copy-action').addEventListener('click', copyCommand)
  byId('share-action').addEventListener('click', shareSelected)
  window.addEventListener('hashchange', openFromHash)
}

wireEvents()
loadIndex()
