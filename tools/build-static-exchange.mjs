#!/usr/bin/env node
// Build the ACX Exchange as a dependency-free static directory.
//
// The registry index is the only artifact allowlist. Every referenced path is
// type-constrained, traversal-safe, and checked component-by-component for
// symbolic links before bytes are copied. Signed workflow and Agent Graph JSON
// is cryptographically re-verified with the same WebCrypto module used by the
// browser. Indexed SQLite .acx cartridges are also reopened and independently
// checked for live ROM integrity, PackageSpec cleanliness, immutable coordinate
// bindings, and an empty SAVE zone before their bytes enter the static output.

import {
  createHash,
} from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyArtifact } from '../platform/static/assets/verify.js'
import { Cartridge } from '../src/container.mjs'
import { validatePackageSpec } from '../src/packagespec.mjs'
import { emptyTrustRegistry, evaluateTrust } from '../src/trust.mjs'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STATIC_EXTENSIONS = new Set(['.css', '.html', '.ico', '.js', '.png', '.svg', '.txt', '.webmanifest', '.webp'])
const TEMPLATE_EXTENSIONS = new Set(['.json', '.md'])
const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._@+-]*$/
const AGENT_ID_RE = /^[a-z][a-z0-9-]{0,63}$/
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

const REGISTRY_PATTERNS = {
  agent: /^cartridges\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[A-Za-z0-9.+-]+\/cartridge\.acx$/,
  workflow: /^cals\/(?:[A-Za-z0-9._+-]+\/){2,}[A-Za-z0-9.+-]+\.cal\.json$/,
  'agent-graph': /^graphs\/(?:[A-Za-z0-9._+-]+\/){2,}[A-Za-z0-9.+-]+\.agent-graph\.json$/,
  template: /^templates\/[A-Za-z0-9._-]+\/manifest\.json$/,
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function fail(message) {
  throw new Error(`static exchange build refused: ${message}`)
}

function isInside(root, destination) {
  const rel = relative(resolve(root), resolve(destination))
  return rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)
}

function safeRelativePath(value, type) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.includes('\0')) {
    fail(`${type} registry path must be a non-empty POSIX-relative path`)
  }
  const segments = value.split('/')
  if (segments.some((segment) => !SAFE_SEGMENT_RE.test(segment) || segment === '.' || segment === '..')) {
    fail(`${type} registry path contains an unsafe segment: ${value}`)
  }
  if (!REGISTRY_PATTERNS[type]?.test(value)) fail(`${type} registry path is outside its allowlist: ${value}`)
  return value
}

function boundRegistryPath(entry, type) {
  const path = safeRelativePath(entry?.path, type)
  if (type === 'agent' || type === 'workflow' || type === 'agent-graph') {
    const publisher = text(entry?.publisher)
    const id = text(entry?.id)
    const version = text(entry?.version)
    const publisherSegments = publisher.split('/')
    if (!publisherSegments.length
        || !publisherSegments.every((segment) => SAFE_SEGMENT_RE.test(segment))
        || ![id, version].every((segment) => SAFE_SEGMENT_RE.test(segment))
        || !SEMVER_RE.test(version)
        || (type === 'agent' && !AGENT_ID_RE.test(id))) {
      fail(`${type} publisher, id, and version must be safe path segments`)
    }
    const expected = type === 'agent'
      ? `cartridges/${publisher}/${id}/${version}/cartridge.acx`
      : type === 'workflow'
        ? `cals/${publisher}/${id}/${version}.cal.json`
        : `graphs/${publisher}/${id}/${version}.agent-graph.json`
    if (path !== expected) {
      fail(`${type} path is not bound to publisher/id/version (expected ${expected}, got ${path})`)
    }
  } else if (type === 'template') {
    const expected = `templates/${text(entry?.id)}/manifest.json`
    if (path !== expected) fail(`template path is not bound to its id (expected ${expected}, got ${path})`)
  }
  return path
}

function assertNoSymlinkPath(root, relativePath, { requireFile = true } = {}) {
  const rootPath = resolve(root)
  if (!existsSync(rootPath) || !lstatSync(rootPath).isDirectory() || lstatSync(rootPath).isSymbolicLink()) {
    fail(`source root must be a real directory: ${rootPath}`)
  }
  let current = rootPath
  for (const segment of relativePath.split('/')) {
    current = join(current, segment)
    if (!isInside(rootPath, current)) fail(`source path escapes its root: ${relativePath}`)
    if (!existsSync(current)) fail(`source path does not exist: ${relativePath}`)
    if (lstatSync(current).isSymbolicLink()) fail(`symbolic links are forbidden in sources: ${relativePath}`)
  }
  if (requireFile && !lstatSync(current).isFile()) fail(`source artifact is not a regular file: ${relativePath}`)
  return current
}

function writeBytes(destination, bytes) {
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, bytes)
}

function copyFileChecked(source, destination) {
  const bytes = readFileSync(source)
  writeBytes(destination, bytes)
  return { bytes: bytes.length, sha256: sha256(bytes) }
}

function decodeUtf8(bytes, label) {
  try {
    return UTF8_DECODER.decode(bytes)
  } catch {
    fail(`${label} is not valid UTF-8`)
  }
}

function extension(path) {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? '' : path.slice(dot)
}

function copyStaticTree(sourceRoot, outputRoot, directory = '') {
  const absolute = directory ? assertNoSymlinkPath(sourceRoot, directory, { requireFile: false }) : resolve(sourceRoot)
  const entries = readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const relativePath = directory ? `${directory}/${entry.name}` : entry.name
    if (!SAFE_SEGMENT_RE.test(entry.name) || entry.name.startsWith('.')) fail(`unsafe static source name: ${relativePath}`)
    if (entry.isSymbolicLink()) fail(`symbolic links are forbidden in static sources: ${relativePath}`)
    if (entry.isDirectory()) {
      copyStaticTree(sourceRoot, outputRoot, relativePath)
      continue
    }
    if (!entry.isFile() || !STATIC_EXTENSIONS.has(extension(entry.name))) {
      fail(`static source type is not allowlisted: ${relativePath}`)
    }
    const source = assertNoSymlinkPath(sourceRoot, relativePath)
    copyFileChecked(source, join(outputRoot, ...relativePath.split('/')))
  }
}

function readJsonFile(path, label) {
  const source = decodeUtf8(readFileSync(path), label)
  try {
    return JSON.parse(source)
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`)
  }
}

function safeSlug(value) {
  const slug = String(value || 'artifact')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, 72)
  return slug || 'artifact'
}

function detailSlug(type, id, registryPath) {
  return `${safeSlug(id)}-${sha256(Buffer.from(`${type}\0${registryPath}`)).slice(0, 8)}`
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function cleanDescription(value) {
  const normalized = text(value, 'A portable ACX artifact.').replace(/\s+/g, ' ')
  if (normalized.length <= 240) return normalized
  const shortened = normalized.slice(0, 237).replace(/\s+\S*$/, '').trimEnd()
  return `${shortened || normalized.slice(0, 237)}…`
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

function breakableHtml(value) {
  return htmlEscape(value)
    .replace(/([/:@._-])/g, '$1<wbr>')
    .replace(/([0-9a-f]{16})(?=[0-9a-f])/gi, '$1<wbr>')
}

function meta(name, value, content) {
  return content ? `<meta ${name}="${htmlEscape(value)}" content="${htmlEscape(content)}">\n` : ''
}

function artifactKey(type, entry) {
  if (type === 'template') return `template:${entry.id}`
  return `${type}:${entry.publisher}/${entry.id}@${entry.version || 'unversioned'}`
}

function cardForDetail(type, entry) {
  if (type === 'agent') {
    const capabilities = Array.isArray(entry.capabilities) ? entry.capabilities.map((item) => item?.taskType).filter(Boolean) : []
    const fallbackDescription = `Portable ${text(entry.role, 'agent')} cartridge${capabilities.length ? ` for ${capabilities.join(', ')}` : ''}.`
    return {
      name: text(entry.name, entry.slug),
      description: cleanDescription(entry.description || fallbackDescription),
      publisher: text(entry.publisher, 'Unknown publisher'),
      version: text(entry.version, null),
      license: text(entry.license, null),
      tags: [...new Set([...(Array.isArray(entry.tags) ? entry.tags : []), entry.role, ...capabilities].filter(Boolean))],
      trust: 'Verify the SQLite cartridge with the ACX CLI before loading.',
      mediaType: 'application/vnd.acx.cartridge',
    }
  }
  if (type === 'template') {
    return {
      name: text(entry.name, entry.id),
      description: cleanDescription(entry.description),
      publisher: text(entry.publisher, 'ACX community'),
      version: text(entry.version, null),
      license: text(entry.license, null),
      tags: entry.tags || [],
      trust: 'Unsigned editable source. Inspect every bundled file before use.',
      mediaType: 'application/json',
    }
  }
  return {
    name: text(entry.name, entry.id),
    description: cleanDescription(entry.description),
    publisher: text(entry.publisher, 'Unknown publisher'),
    version: text(entry.version, null),
    license: text(entry.license, null),
    tags: entry.tags || [],
    trust: 'Portable signature: bytes are bound to an inline key. Publisher namespace ownership is not proven by the artifact alone.',
    mediaType: type === 'workflow'
      ? 'application/vnd.acx.workflow.v1+json'
      : 'application/vnd.acx.agent-graph.v1+json',
  }
}

function compactDetailPreview(type, entry, artifact = null) {
  if (type === 'agent') {
    const capabilities = Array.isArray(entry.capabilities)
      ? entry.capabilities.map((item) => text(item?.taskType)).filter(Boolean)
      : []
    const role = text(entry.role, 'portable agent')
    const model = text(entry.model)
    return {
      title: 'Agent profile at a glance',
      copy: `${role}${model ? ` on ${model}` : ''} with ${capabilities.length} declared capability${capabilities.length === 1 ? '' : 'ies'}.`,
      items: capabilities.map((capability) => `Capability: ${capability}`),
    }
  }

  if (type === 'workflow') {
    const participants = Array.isArray(artifact?.participants) ? artifact.participants : []
    const tasks = Array.isArray(artifact?.nodes)
      ? artifact.nodes.filter((node) => node?.type === 'task')
      : []
    return {
      title: 'Team workflow at a glance',
      copy: `${participants.length} portable team slot${participants.length === 1 ? '' : 's'} coordinate ${tasks.length} outcome task${tasks.length === 1 ? '' : 's'} across ${Number(entry.nodeCount) || artifact?.nodes?.length || 0} bounded nodes.`,
      items: participants.map((participant) => {
        const role = text(participant?.slot?.role, text(participant?.cartridge?.role, 'host-selected role'))
        return `${text(participant?.alias, 'slot')} · ${role}`
      }),
    }
  }

  if (type === 'agent-graph') {
    const actors = Array.isArray(artifact?.actors) ? artifact.actors : []
    const actorNames = new Map(actors.map((actor) => [actor?.id, text(actor?.name, actor?.id)]))
    const routes = Array.isArray(artifact?.routes) ? artifact.routes : []
    const loops = Array.isArray(artifact?.loops) ? artifact.loops : []
    const routeCopy = routes.slice(0, 4).map((route) => {
      const from = actorNames.get(route?.from) || text(route?.from, 'Unknown source')
      const targets = (Array.isArray(route?.to) ? route.to : [])
        .map((target) => actorNames.get(target) || text(target))
        .filter(Boolean)
        .join(', ')
      return `${from} → ${targets || 'Unknown target'} · ${text(route?.intent, 'inform')}`
    })
    if (routes.length > routeCopy.length) routeCopy.push(`+ ${routes.length - routeCopy.length} more route${routes.length - routeCopy.length === 1 ? '' : 's'}`)
    const loopItems = loops.map((loop) => {
      const reference = loop?.workflowRef
      return reference?.id
        ? `Loop: ${reference.id}${reference.version ? `@${reference.version}` : ''}`
        : `Loop: ${text(loop?.id, 'host-defined')}`
    })
    return {
      title: 'Information flow at a glance',
      copy: routeCopy.join('. '),
      items: [
        ...actors.map((actor) => `Seat: ${text(actor?.name, actor?.id)} · ${text(actor?.kind, 'agent')}`),
        ...loopItems,
      ],
    }
  }

  const files = Array.isArray(entry.files) ? entry.files : []
  return {
    title: 'Editable starter at a glance',
    copy: `${Number(entry.fileCount) || files.length} inspectable source file${(Number(entry.fileCount) || files.length) === 1 ? '' : 's'} travel in this unsigned template bundle.`,
    items: files.map((file) => `File: ${text(file)}`),
  }
}

function normalizeSiteUrl(siteUrl) {
  if (!siteUrl) return null
  let url
  try {
    url = new URL(siteUrl)
  } catch {
    fail(`--site-url must be an absolute URL: ${siteUrl}`)
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    fail('--site-url must be a clean HTTP(S) base URL')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

function injectRootSiteMetadata(outputRoot, siteUrl) {
  const indexPath = join(outputRoot, 'index.html')
  const source = readFileSync(indexPath, 'utf8')
  const marker = '<!-- ACX_SITE_META -->'
  if (!source.includes(marker)) fail('static index.html is missing the ACX_SITE_META build marker')
  const metadata = siteUrl
    ? `<meta property="og:url" content="${htmlEscape(siteUrl)}">
  <meta property="og:image" content="${htmlEscape(new URL('assets/share-card.png', siteUrl).href)}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="ACX Exchange — discover, verify, remix, and share portable agent teams">
  <meta name="twitter:image" content="${htmlEscape(new URL('assets/share-card.png', siteUrl).href)}">
  <meta name="twitter:image:alt" content="ACX Exchange — discover, verify, remix, and share portable agent teams">
  <link rel="canonical" href="${htmlEscape(siteUrl)}">`
    : ''
  writeFileSync(indexPath, source.replace(marker, metadata))

  const studioPath = join(outputRoot, 'studio', 'index.html')
  const studioSource = readFileSync(studioPath, 'utf8')
  const studioMarker = '<!-- ACX_STUDIO_META -->'
  if (!studioSource.includes(studioMarker)) {
    fail('static Studio index.html is missing the ACX_STUDIO_META build marker')
  }
  const studioUrl = siteUrl ? new URL('studio/', siteUrl).href : null
  const shareImage = siteUrl ? new URL('assets/share-card.png', siteUrl).href : null
  const studioMetadata = studioUrl
    ? `<meta property="og:url" content="${htmlEscape(studioUrl)}">
  <meta property="og:image" content="${htmlEscape(shareImage)}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="ACX Studio — build and remix portable agent teams locally">
  <meta name="twitter:image" content="${htmlEscape(shareImage)}">
  <meta name="twitter:image:alt" content="ACX Studio — build and remix portable agent teams locally">
  <link rel="canonical" href="${htmlEscape(studioUrl)}">`
    : ''
  writeFileSync(studioPath, studioSource.replace(studioMarker, studioMetadata))
}

function renderDetailPage({ type, entry, siteUrl, artifact = null }) {
  const card = cardForDetail(type, entry)
  const lifecycle = text(entry?.registryStatus?.status, 'active')
  const lifecycleReason = text(entry?.registryStatus?.reason)
  if (lifecycle !== 'active') {
    card.trust = `Registry lifecycle: ${lifecycle}. ${text(entry?.registryStatus?.reason, 'Treat as historical and inspect its successor or advisory before use.')}`
  }
  const key = artifactKey(type, entry)
  const detailPath = entry.exchange.detailPath
  const downloadPath = entry.exchange.downloadPath
  const canonicalUrl = siteUrl ? new URL(detailPath, siteUrl).href : null
  const shareImage = siteUrl ? new URL('assets/share-card.png', siteUrl).href : null
  const downloadHref = `../../../${downloadPath}`
  const canonicalDownloadUrl = siteUrl ? new URL(downloadPath, siteUrl).href : downloadHref
  const appUrl = `../../../index.html#${new URLSearchParams({ artifact: key })}`
  const remixable = type === 'workflow' || type === 'agent-graph'
  const remixUrl = remixable
    ? `../../../studio/?source=${encodeURIComponent(`../${downloadPath}`)}`
    : null
  const shareGuideUrl = 'https://lboel.github.io/acx/share/'
  const typeLabel = {
    agent: 'Agent cartridge',
    workflow: 'Agent workflow',
    'agent-graph': 'Agent Graph',
    template: 'Starter template',
  }[type]
  const title = `${card.name} · ACX Exchange`
  const description = cleanDescription(card.description)
  const artifactId = text(entry.id, type)
  const coordinate = type === 'template'
    ? `template:${artifactId}`
    : `${type}:${card.publisher}/${artifactId}@${card.version || 'unversioned'}`
  const digest = text(entry.digest, text(entry.romHash, entry.exchange?.sha256 ? `sha256:${entry.exchange.sha256}` : 'Not indexed'))
  const digestLabel = type === 'agent'
    ? 'ROM digest'
    : type === 'template'
      ? 'Bundle digest'
      : 'Signed JCS digest'
  const preview = compactDetailPreview(type, entry, artifact)
  const previewItems = preview.items
    .filter(Boolean)
    .slice(0, 8)
    .map((item) => `<span class="tag" title="${htmlEscape(item)}">${htmlEscape(item)}</span>`)
    .join('')
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    identifier: coordinate,
    name: card.name,
    description,
    version: card.version,
    license: card.license,
    author: { '@type': 'Organization', name: card.publisher },
    encoding: {
      '@type': 'MediaObject',
      encodingFormat: card.mediaType,
      contentUrl: canonicalDownloadUrl,
    },
    url: canonicalUrl,
    keywords: card.tags,
  }).replace(/</g, '\\u003c')
  const jsonLdHash = Buffer.from(createHash('sha256').update(jsonLd).digest()).toString('base64')
  const tags = card.tags.slice(0, 8).map((tag) => `<span class="tag">${htmlEscape(tag)}</span>`).join('')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#071b18">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-${jsonLdHash}'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>${htmlEscape(title)}</title>
  ${meta('name', 'description', description)}
  ${meta('property', 'og:title', title)}
  ${meta('property', 'og:description', description)}
  <meta property="og:type" content="website">
  ${canonicalUrl ? `<meta property="og:url" content="${htmlEscape(canonicalUrl)}">\n  <link rel="canonical" href="${htmlEscape(canonicalUrl)}">` : ''}
  ${meta('property', 'og:image', shareImage)}
  ${meta('property', 'og:image:type', shareImage ? 'image/png' : null)}
  ${meta('property', 'og:image:width', shareImage ? '1200' : null)}
  ${meta('property', 'og:image:height', shareImage ? '630' : null)}
  ${meta('property', 'og:image:alt', 'ACX Exchange — discover, verify, remix, and share portable agent teams')}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${htmlEscape(title)}">
  <meta name="twitter:description" content="${htmlEscape(description)}">
  ${meta('name', 'twitter:image', shareImage)}
  ${meta('name', 'twitter:image:alt', shareImage ? 'ACX Exchange — discover, verify, remix, and share portable agent teams' : null)}
  <link rel="icon" href="../../../assets/icon.svg" type="image/svg+xml">
  <link rel="alternate" type="${htmlEscape(card.mediaType)}" href="${htmlEscape(downloadHref)}">
  <link rel="stylesheet" href="../../../assets/app.css?v=20260719">
  <script type="application/ld+json">${jsonLd}</script>
  <script type="module" src="../../../assets/detail.js?v=20260719"></script>
</head>
<body>
  <header class="site-header">
    <a class="brand" href="../../../index.html"><span class="brand-mark" aria-hidden="true">AX</span><span><strong>ACX</strong><small>Exchange</small></span></a>
  </header>
  <main class="pre-render-main">
    <article class="pre-render-card">
      <p class="eyebrow">${htmlEscape(typeLabel)}</p>
      <h1>${htmlEscape(card.name)}</h1>
      <p class="pre-render-description">${htmlEscape(description)}</p>
      <p class="detail-trust">${htmlEscape(card.trust)}</p>
      <div class="tag-list">${tags}</div>
      <section class="verify-panel" aria-labelledby="identity-heading">
        <div>
          <h3 id="identity-heading">Immutable registry identity</h3>
          <p><strong>Coordinate</strong><br><code data-coordinate="${htmlEscape(coordinate)}">${breakableHtml(coordinate)}</code></p>
        </div>
        <div class="verify-result">
          <strong>${htmlEscape(digestLabel)}</strong><br>
          <code data-digest="${htmlEscape(digest)}">${breakableHtml(digest)}</code>
        </div>
      </section>
      <dl class="fact-grid">
        <div><dt>Publisher</dt><dd>${htmlEscape(card.publisher)}</dd></div>
        <div><dt>Artifact id</dt><dd>${htmlEscape(artifactId)}</dd></div>
        <div><dt>Version</dt><dd>${htmlEscape(card.version || 'Not versioned')}</dd></div>
        <div><dt>Lifecycle</dt><dd${lifecycleReason ? ` title="${htmlEscape(lifecycleReason)}"` : ''}>${htmlEscape(lifecycle)}</dd></div>
        <div><dt>License</dt><dd>${htmlEscape(card.license || 'Not declared')}</dd></div>
      </dl>
      <section class="verify-panel" aria-labelledby="preview-heading">
        <div>
          <h3 id="preview-heading">${htmlEscape(preview.title)}</h3>
          <p>${htmlEscape(preview.copy)}</p>
        </div>
        ${previewItems ? `<div class="tag-list">${previewItems}</div>` : ''}
      </section>
      <div class="detail-actions">
        <a class="button button-primary" href="${htmlEscape(appUrl)}">Inspect &amp; verify</a>
        <a class="button button-secondary" href="${htmlEscape(downloadHref)}" download>Download artifact</a>
        ${remixUrl ? `<a class="button button-secondary" href="${htmlEscape(remixUrl)}">Remix in Studio</a>` : ''}
        <button class="button button-secondary" type="button" data-acx-copy-link="${htmlEscape(canonicalUrl || '')}" aria-describedby="copy-link-status">Copy share link</button>
        <a class="button button-quiet" href="${htmlEscape(shareGuideUrl)}">Share or publish via PR</a>
      </div>
      <p id="copy-link-status" class="copy-link-status" role="status" aria-live="polite"></p>
    </article>
  </main>
  <noscript><p class="noscript">This artifact card and download work without JavaScript. Use the ACX CLI or Exchange browser verifier before running the artifact.</p></noscript>
</body>
</html>
`
}

function decorateEntry(type, rawEntry, outputRoot, registryRoot, siteUrl) {
  const entry = structuredClone(rawEntry)
  const path = boundRegistryPath(entry, type)
  const source = assertNoSymlinkPath(registryRoot, path)
  const artifact = type === 'workflow' || type === 'agent-graph'
    ? readJsonFile(source, path)
    : null
  const outputPath = join(outputRoot, 'data', 'artifacts', ...path.split('/'))
  const copied = copyFileChecked(source, outputPath)
  const id = text(entry.id, type)
  const slug = detailSlug(type, id, path)
  entry.exchange = {
    key: artifactKey(type, entry),
    downloadPath: `data/artifacts/${path}`,
    detailPath: `artifacts/${type}/${slug}/`,
    bytes: copied.bytes,
    sha256: copied.sha256,
  }
  const page = renderDetailPage({ type, entry, siteUrl, artifact })
  writeBytes(join(outputRoot, 'artifacts', type, slug, 'index.html'), Buffer.from(page))
  return entry
}

async function verifySignedJson(entry, registryRoot, type) {
  const path = boundRegistryPath(entry, type)
  const source = assertNoSymlinkPath(registryRoot, path)
  const artifact = readJsonFile(source, path)
  const verification = await verifyArtifact(artifact)
  if (!verification.ok || !verification.signed) {
    fail(`${path} is not a valid signed ${type}: ${verification.issues.join('; ')}`)
  }
  if (entry.digest && entry.digest !== verification.digest) {
    fail(`${path} digest does not match registry/index.json`)
  }
  if (artifact.id !== entry.id || (artifact.version ?? null) !== (entry.version ?? null)) {
    fail(`${path} signed id/version does not match registry/index.json`)
  }
  if (verification.publisherId !== entry.publisher) {
    fail(`${path} signed publisher does not match registry/index.json`)
  }
}

function verifyAgentCartridge(entry, registryRoot) {
  const path = boundRegistryPath(entry, 'agent')
  const source = assertNoSymlinkPath(registryRoot, path)
  const cart = Cartridge.open(source, { readonly: true })
  try {
    const meta = cart.allMeta()
    const verification = evaluateTrust(cart, { registry: emptyTrustRegistry() })
    const packageSpec = validatePackageSpec(cart)
    const save = {
      memory: Number(cart.db.prepare("SELECT COUNT(*) n FROM memory WHERE zone='save'").get().n || 0),
      files: Number(cart.db.prepare("SELECT COUNT(*) n FROM sqlar WHERE name GLOB 'save/*'").get().n || 0),
      objects: Number(cart.db.prepare("SELECT COUNT(*) n FROM objects WHERE zone='save'").get().n || 0),
      vectors: Number(cart.db.prepare("SELECT COUNT(*) n FROM vectors WHERE zone='save'").get().n || 0),
    }
    const saveTotal = Object.values(save).reduce((sum, count) => sum + count, 0)
    if (verification.trust === 'tampered'
        || verification.trust === 'legacy'
        || verification.status === 'invalid') {
      fail(`${path} cartridge trust verification failed (${verification.trust}: ${verification.summary})`)
    }
    if (!packageSpec.ok || entry.specClean !== true) {
      fail(`${path} cartridge PackageSpec is not clean: ${packageSpec.issues.join('; ')}`)
    }
    if (saveTotal > 0) {
      fail(`${path} public cartridge is not ROM-only (${Object.entries(save).map(([kind, count]) => `${kind}=${count}`).join(', ')})`)
    }
    if (meta['acx.publisher_id'] !== entry.publisher
        || meta['acx.artifact_id'] !== entry.id
        || meta['acx.artifact_version'] !== entry.version
        || !String(meta['acx.cartridge_id'] || '').startsWith(`${entry.publisher}/${entry.id}@`)) {
      fail(`${path} ROM-bound publisher/id/version does not match registry/index.json`)
    }
    if (meta['acx.rom_manifest_hash'] !== entry.digest || entry.romHash !== entry.digest) {
      fail(`${path} ROM digest does not match registry/index.json`)
    }
  } finally {
    cart.close()
  }
}

function templateFiles(registryRoot, directoryRelative) {
  const files = []
  function walk(relativeDirectory = '') {
    const fromRoot = relativeDirectory ? `${directoryRelative}/${relativeDirectory}` : directoryRelative
    const absolute = assertNoSymlinkPath(registryRoot, fromRoot, { requireFile: false })
    const entries = readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const localPath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      const registryPath = `${directoryRelative}/${localPath}`
      if (!SAFE_SEGMENT_RE.test(entry.name) || entry.name.startsWith('.')) fail(`unsafe template source name: ${registryPath}`)
      if (entry.isSymbolicLink()) fail(`symbolic links are forbidden in template sources: ${registryPath}`)
      if (entry.isDirectory()) {
        walk(localPath)
        continue
      }
      if (!entry.isFile() || !TEMPLATE_EXTENSIONS.has(extension(entry.name))) {
        fail(`template source type is not allowlisted: ${registryPath}`)
      }
      const source = assertNoSymlinkPath(registryRoot, registryPath)
      const bytes = readFileSync(source)
      if (bytes.length > 1024 * 1024 || bytes.includes(0)) fail(`template source must be UTF-8 text up to 1 MiB: ${registryPath}`)
      const content = decodeUtf8(bytes, registryPath)
      files.push({
        path: localPath,
        content,
        bytes: bytes.length,
        sha256: sha256(bytes),
      })
    }
  }
  walk()
  if (!files.length || !files.some((file) => file.path === 'manifest.json')) {
    fail(`${directoryRelative} must contain manifest.json`)
  }
  return files
}

function discoverTemplates(registryRoot, outputRoot, siteUrl, indexedTemplates) {
  if (!Array.isArray(indexedTemplates)) fail('registry/index.json must contain a templates array')
  const templatesRoot = join(registryRoot, 'templates')
  if (!existsSync(templatesRoot)) {
    if (indexedTemplates.length) fail('registry index lists templates but registry/templates does not exist')
    return []
  }
  if (lstatSync(templatesRoot).isSymbolicLink() || !lstatSync(templatesRoot).isDirectory()) {
    fail('registry/templates must be a real directory')
  }
  const templates = []
  const directories = readdirSync(templatesRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  for (const directory of directories) {
    if (directory.isSymbolicLink()) fail(`symbolic links are forbidden in template sources: templates/${directory.name}`)
    if (!directory.isDirectory() || !SAFE_SEGMENT_RE.test(directory.name) || directory.name.startsWith('.')) {
      fail(`registry/templates may contain only safe template directories: ${directory.name}`)
    }
  }
  const directoryNames = directories.map((directory) => directory.name).sort()
  const indexedIds = indexedTemplates.map((entry) => text(entry?.id)).sort()
  if (new Set(indexedIds).size !== indexedIds.length
      || JSON.stringify(directoryNames) !== JSON.stringify(indexedIds)) {
    fail('registry template directories must exactly match registry/index.json templates')
  }

  for (const rawEntry of [...indexedTemplates].sort((a, b) => text(a?.id).localeCompare(text(b?.id)))) {
    const directoryName = text(rawEntry?.id)
    if (!SAFE_SEGMENT_RE.test(directoryName)) fail(`template id is not path-safe: ${directoryName}`)
    const registryDirectory = `templates/${directoryName}`
    const registryPath = boundRegistryPath(rawEntry, 'template')
    if (registryPath !== `${registryDirectory}/manifest.json`) {
      fail(`template index path does not match directory ${directoryName}`)
    }
    const files = templateFiles(registryRoot, registryDirectory)
    const manifestFile = files.find((file) => file.path === 'manifest.json')
    let manifest
    try {
      manifest = JSON.parse(manifestFile.content)
    } catch (error) {
      fail(`${registryDirectory}/manifest.json is not valid JSON: ${error.message}`)
    }
    const actualFiles = files.map((file) => file.path).sort()
    const declaredFiles = Array.isArray(rawEntry.files) ? [...rawEntry.files].sort() : []
    if (!Number.isInteger(rawEntry.fileCount) || rawEntry.fileCount !== files.length
        || JSON.stringify(declaredFiles) !== JSON.stringify(actualFiles)) {
      fail(`${registryDirectory} files do not match registry/index.json`)
    }
    const friendlyName = text(rawEntry.name)
      || (/^TODO\b/i.test(text(manifest.name))
        ? directoryName.split(/[-_]/).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
        : text(manifest.name, directoryName))
    const bundle = {
      schemaVersion: 'acx.template-bundle/1',
      id: directoryName,
      name: friendlyName,
      files: files.map(({ path, content, bytes, sha256: digest }) => ({
        path,
        mediaType: path.endsWith('.json') ? 'application/json' : 'text/markdown',
        bytes,
        digest: `sha256:${digest}`,
        content,
      })),
    }
    const bundleRelative = `data/artifacts/templates/${directoryName}.template.json`
    const bundleBytes = Buffer.from(json(bundle))
    writeBytes(join(outputRoot, ...bundleRelative.split('/')), bundleBytes)
    for (const file of files) {
      writeBytes(
        join(outputRoot, 'data', 'artifacts', 'templates', directoryName, ...file.path.split('/')),
        Buffer.from(file.content),
      )
    }
    const entry = {
      ...structuredClone(rawEntry),
      id: directoryName,
      version: text(rawEntry.version, text(manifest.packageVersion, text(manifest.schemaVersion, null))),
      name: friendlyName,
      description: cleanDescription(rawEntry.description),
      path: registryPath,
      exchange: {
        key: `template:${directoryName}`,
        downloadPath: bundleRelative,
        detailPath: `artifacts/template/${detailSlug('template', directoryName, registryPath)}/`,
        bytes: bundleBytes.length,
        sha256: sha256(bundleBytes),
      },
    }
    const page = renderDetailPage({ type: 'template', entry, siteUrl })
    const slug = entry.exchange.detailPath.split('/').filter(Boolean).at(-1)
    writeBytes(join(outputRoot, 'artifacts', 'template', slug, 'index.html'), Buffer.from(page))
    templates.push(entry)
  }
  return templates
}

function outputFiles(outputRoot, directory = '') {
  const files = []
  const absolute = directory ? join(outputRoot, ...directory.split('/')) : outputRoot
  for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = directory ? `${directory}/${entry.name}` : entry.name
    if (path === 'manifest.json') continue
    if (entry.isSymbolicLink()) fail(`build output unexpectedly contains a symbolic link: ${path}`)
    if (entry.isDirectory()) files.push(...outputFiles(outputRoot, path))
    else if (entry.isFile()) {
      const bytes = readFileSync(join(outputRoot, ...path.split('/')))
      files.push({ path, bytes: bytes.length, digest: `sha256:${sha256(bytes)}` })
    } else {
      fail(`build output contains a non-regular file: ${path}`)
    }
  }
  return files
}

function assertSafeOutput(outputRoot, staticRoot, registryRoot) {
  const output = resolve(outputRoot)
  const filesystemRoot = resolve(output, sep)
  if (output === filesystemRoot) fail('output directory must not be the filesystem root')
  if (output === resolve(staticRoot) || output === resolve(registryRoot)
      || isInside(output, staticRoot) || isInside(output, registryRoot)) {
    fail('output directory must not contain a source directory')
  }
  if (isInside(staticRoot, output) || isInside(registryRoot, output)) {
    fail('output directory must not be inside a source directory')
  }
  if (existsSync(output) && lstatSync(output).isSymbolicLink()) fail('output directory must not be a symbolic link')
}

export async function buildStaticExchange({
  projectRoot = PROJECT_ROOT,
  staticRoot = join(projectRoot, 'platform', 'static'),
  registryRoot = join(projectRoot, 'registry'),
  outputRoot = join(projectRoot, 'dist', 'exchange'),
  siteUrl = null,
  quiet = false,
} = {}) {
  const resolvedStatic = resolve(staticRoot)
  const resolvedRegistry = resolve(registryRoot)
  const resolvedOutput = resolve(outputRoot)
  const normalizedSiteUrl = normalizeSiteUrl(siteUrl)
  assertSafeOutput(resolvedOutput, resolvedStatic, resolvedRegistry)
  if (!existsSync(resolvedStatic)) fail(`static source does not exist: ${resolvedStatic}`)
  if (!existsSync(resolvedRegistry)) fail(`registry does not exist: ${resolvedRegistry}`)

  const indexPath = assertNoSymlinkPath(resolvedRegistry, 'index.json')
  const sourceIndex = readJsonFile(indexPath, 'registry/index.json')
  if (sourceIndex?.schemaVersion !== 'acx.registry-index/1') fail('registry/index.json has an unsupported schemaVersion')
  if (!Array.isArray(sourceIndex.cartridges)
      || !Array.isArray(sourceIndex.workflows)
      || !Array.isArray(sourceIndex.agentGraphs)
      || !Array.isArray(sourceIndex.templates)) {
    fail('registry/index.json must contain cartridges, workflows, agentGraphs, and templates arrays')
  }

  for (const entry of sourceIndex.cartridges) verifyAgentCartridge(entry, resolvedRegistry)
  for (const entry of sourceIndex.workflows) await verifySignedJson(entry, resolvedRegistry, 'workflow')
  for (const entry of sourceIndex.agentGraphs) await verifySignedJson(entry, resolvedRegistry, 'agent-graph')

  if (existsSync(resolvedOutput)) rmSync(resolvedOutput, { recursive: true })
  mkdirSync(resolvedOutput, { recursive: true })
  copyStaticTree(resolvedStatic, resolvedOutput)
  injectRootSiteMetadata(resolvedOutput, normalizedSiteUrl)

  const exchangeIndex = {
    ...structuredClone(sourceIndex),
    exchangeSchemaVersion: 'acx.static-exchange/1',
    cartridges: sourceIndex.cartridges.map((entry) => decorateEntry('agent', entry, resolvedOutput, resolvedRegistry, normalizedSiteUrl)),
    workflows: sourceIndex.workflows.map((entry) => decorateEntry('workflow', entry, resolvedOutput, resolvedRegistry, normalizedSiteUrl)),
    agentGraphs: sourceIndex.agentGraphs.map((entry) => decorateEntry('agent-graph', entry, resolvedOutput, resolvedRegistry, normalizedSiteUrl)),
    templates: discoverTemplates(resolvedRegistry, resolvedOutput, normalizedSiteUrl, sourceIndex.templates),
  }
  exchangeIndex.count = exchangeIndex.cartridges.length
  exchangeIndex.workflowCount = exchangeIndex.workflows.length
  exchangeIndex.agentGraphCount = exchangeIndex.agentGraphs.length
  exchangeIndex.templateCount = exchangeIndex.templates.length
  const artifactCount = exchangeIndex.cartridges.length
    + exchangeIndex.workflows.length
    + exchangeIndex.agentGraphs.length
    + exchangeIndex.templates.length
  exchangeIndex.artifactCount = artifactCount
  const exchangeIndexBytes = Buffer.from(json(exchangeIndex))
  writeBytes(join(resolvedOutput, 'data', 'index.json'), exchangeIndexBytes)

  const artifacts = [
    ...exchangeIndex.cartridges.map((entry) => ({ type: 'agent', entry })),
    ...exchangeIndex.workflows.map((entry) => ({ type: 'workflow', entry })),
    ...exchangeIndex.agentGraphs.map((entry) => ({ type: 'agent-graph', entry })),
    ...exchangeIndex.templates.map((entry) => ({ type: 'template', entry })),
  ].map(({ type, entry }) => ({
    key: entry.exchange.key,
    type,
    publisher: entry.publisher,
    id: type === 'agent' ? entry.id || entry.slug : entry.id,
    version: entry.version ?? null,
    digest: entry.digest || entry.romHash || `sha256:${entry.exchange.sha256}`,
    registryStatus: entry.registryStatus?.status || 'active',
    latest: entry.latest !== false,
    trust: entry.trust || (type === 'template' ? 'unsigned' : null),
    downloadPath: entry.exchange.downloadPath,
    detailPath: entry.exchange.detailPath,
    bytes: entry.exchange.bytes,
  }))
  const manifest = {
    schemaVersion: 'acx.static-exchange-manifest/1',
    builtAt: text(sourceIndex.generatedAt, '1970-01-01T00:00:00.000Z'),
    siteUrl: normalizedSiteUrl,
    exchangeIndexDigest: `sha256:${sha256(exchangeIndexBytes)}`,
    artifactCount,
    artifacts,
    files: outputFiles(resolvedOutput),
  }
  writeBytes(join(resolvedOutput, 'manifest.json'), Buffer.from(json(manifest)))

  if (!quiet) {
    console.log(`built static ACX Exchange: ${resolvedOutput}`)
    console.log(`  ${artifactCount} artifact(s), ${manifest.files.length + 1} file(s)`)
  }
  return { outputRoot: resolvedOutput, index: exchangeIndex, manifest }
}

function usage() {
  return `Usage: node --experimental-sqlite tools/build-static-exchange.mjs [options]

Options:
  --out DIR          Output directory (default: dist/exchange)
  --registry DIR     Registry directory (default: registry)
  --static DIR       Static app source (default: platform/static)
  --site-url URL     Public exchange base URL for canonical/OG metadata
  --quiet            Suppress build summary
  --help             Show this help
`
}

export function parseBuildArgs(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help') return { help: true }
    if (argument === '--quiet') {
      options.quiet = true
      continue
    }
    const field = {
      '--out': 'outputRoot',
      '--registry': 'registryRoot',
      '--static': 'staticRoot',
      '--site-url': 'siteUrl',
    }[argument]
    if (!field) fail(`unknown option: ${argument}`)
    const value = args[++index]
    if (!value || value.startsWith('--')) fail(`${argument} requires a value`)
    options[field] = field === 'siteUrl' ? value : resolve(value)
  }
  return options
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    const options = parseBuildArgs(process.argv.slice(2))
    if (options.help) {
      process.stdout.write(usage())
    } else {
      await buildStaticExchange(options)
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
