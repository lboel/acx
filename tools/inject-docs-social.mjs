#!/usr/bin/env node
// Add deterministic Open Graph and Twitter metadata to the generated Zensical
// pages. The docs builder emits canonical/description metadata but no social
// image; crawlers do not execute the client-side sharing script.
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MARKER = '<!-- ACX_SOCIAL_META -->'

function fail(message) {
  throw new Error(`docs social metadata refused: ${message}`)
}

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function decodeBasicEntities(value) {
  return String(value)
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function htmlFiles(directory, root = directory) {
  const output = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) fail(`symbolic links are forbidden in docs output: ${relative(root, path)}`)
    if (entry.isDirectory()) output.push(...htmlFiles(path, root))
    else if (entry.isFile() && entry.name.endsWith('.html')) output.push(path)
  }
  return output.sort()
}

function pageUrl(siteUrl, relativePath) {
  if (relativePath === 'index.html') return siteUrl
  if (relativePath.endsWith('/index.html')) {
    return new URL(`${relativePath.slice(0, -'index.html'.length)}`, siteUrl).href
  }
  return new URL(relativePath, siteUrl).href
}

export function injectDocsSocial({
  siteRoot = join(PROJECT_ROOT, 'docs-site', 'site'),
  siteUrl = 'https://lboel.github.io/acx/',
} = {}) {
  const root = resolve(siteRoot)
  if (!existsSync(root) || !statSync(root).isDirectory()) fail(`site directory does not exist: ${root}`)
  let base
  try {
    base = new URL(siteUrl)
  } catch {
    fail(`siteUrl must be an absolute URL: ${siteUrl}`)
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    fail('siteUrl must be a clean HTTP(S) base URL')
  }
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  const shareImage = new URL('exchange/assets/share-card.png', base).href
  let changed = 0

  for (const path of htmlFiles(root)) {
    const rel = relative(root, path).replaceAll('\\', '/')
    if (rel === '404.html' || rel.startsWith('exchange/')) continue
    const source = readFileSync(path, 'utf8')
    if (source.includes(MARKER)) continue
    if (!source.includes('</head>')) fail(`${rel} has no closing head`)
    const titleMatch = source.match(/<title>([\s\S]*?)<\/title>/i)
    const descriptionMatch = source.match(/<meta\s+name="description"\s+content="([^"]*)"\s*\/?>/i)
    if (!titleMatch || !descriptionMatch) fail(`${rel} is missing title or description metadata`)

    const title = htmlEscape(decodeBasicEntities(titleMatch[1].trim()))
    const description = htmlEscape(decodeBasicEntities(descriptionMatch[1].trim()))
    const canonical = htmlEscape(pageUrl(base.href, rel))
    const image = htmlEscape(shareImage)
    const metadata = `${MARKER}
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${image}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="ACX — portable, signed agents, workflows, and Agent Graphs">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${image}">
  <meta name="twitter:image:alt" content="ACX — portable, signed agents, workflows, and Agent Graphs">
  `
    writeFileSync(path, source.replace('</head>', `${metadata}</head>`))
    changed += 1
  }
  return { changed, siteUrl: base.href, shareImage }
}

function parseArgs(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (!['--site', '--site-url'].includes(flag)) fail(`unknown option: ${flag}`)
    const value = args[++index]
    if (!value || value.startsWith('--')) fail(`${flag} requires a value`)
    if (flag === '--site') options.siteRoot = resolve(value)
    else options.siteUrl = value
  }
  return options
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    const result = injectDocsSocial(parseArgs(process.argv.slice(2)))
    console.log(`injected social metadata into ${result.changed} documentation page(s)`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
