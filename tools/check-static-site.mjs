#!/usr/bin/env node
// Verify that a generated ACX documentation + Exchange tree is self-contained.
// This deliberately checks emitted HTML rather than Markdown sources so broken
// theme assets, rewritten routes, and pre-rendered detail links are covered.
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  throw new Error(`static site check refused: ${message}`)
}

function normalizeBasePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('?') || value.includes('#')) {
    fail('--base-path must be an absolute URL path such as /acx/')
  }
  return value.endsWith('/') ? value : `${value}/`
}

function htmlFiles(directory, root = directory) {
  const output = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) fail(`symbolic links are forbidden in site output: ${relative(root, path)}`)
    if (entry.isDirectory()) output.push(...htmlFiles(path, root))
    else if (entry.isFile() && entry.name.endsWith('.html')) output.push(path)
  }
  return output.sort()
}

function localReference(value) {
  const decoded = String(value).replaceAll('&amp;', '&').trim()
  if (
    !decoded
    || /^(?:https?:|mailto:|tel:|data:|blob:|javascript:|\/\/)/i.test(decoded)
  ) return null
  const separator = decoded.search(/[?#]/)
  return {
    original: decoded,
    path: separator < 0 ? decoded : decoded.slice(0, separator),
    fragment: decoded.includes('#')
      ? decoded.slice(decoded.indexOf('#') + 1).split('?', 1)[0]
      : '',
  }
}

function decodeUrlPart(value, source) {
  try {
    return decodeURIComponent(value)
  } catch {
    fail(`${source} contains malformed URL encoding: ${value}`)
  }
}

function isInside(root, path) {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function targetFor({ root, source, reference, basePath }) {
  const raw = reference.path
  if (!raw) return source
  const baseWithoutSlash = basePath.slice(0, -1)
  if (raw === basePath || raw === baseWithoutSlash) return join(root, 'index.html')
  if (raw.startsWith(basePath)) return join(root, decodeUrlPart(raw.slice(basePath.length), source))
  if (raw.startsWith('/')) return null
  return resolve(dirname(source), decodeUrlPart(raw, source))
}

function anchorSet(path, cache) {
  let anchors = cache.get(path)
  if (anchors) return anchors
  const html = readFileSync(path, 'utf8')
  anchors = new Set(
    [...html.matchAll(/\b(?:id|name)=(["'])(.*?)\1/gi)].map((match) => match[2]),
  )
  cache.set(path, anchors)
  return anchors
}

export function checkStaticSite({
  siteRoot = join(PROJECT_ROOT, 'docs-site', 'site'),
  basePath = '/acx/',
} = {}) {
  const root = resolve(siteRoot)
  if (!existsSync(root) || !statSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) {
    fail(`site root must be a real directory: ${root}`)
  }
  const normalizedBase = normalizeBasePath(basePath)
  const issues = []
  const anchors = new Map()
  let references = 0
  let fragments = 0
  const files = htmlFiles(root)

  for (const source of files) {
    const sourceLabel = relative(root, source).replaceAll('\\', '/')
    const html = readFileSync(source, 'utf8')
    for (const match of html.matchAll(/\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi)) {
      const reference = localReference(match[2])
      if (!reference) continue
      const target = targetFor({
        root,
        source,
        reference,
        basePath: normalizedBase,
      })
      if (!target) {
        issues.push(`${sourceLabel}: root-relative URL is outside ${normalizedBase}: ${reference.original}`)
        continue
      }
      if (!isInside(root, target)) {
        issues.push(`${sourceLabel}: URL escapes the generated site: ${reference.original}`)
        continue
      }
      let resolvedTarget = target
      if (existsSync(resolvedTarget) && statSync(resolvedTarget).isDirectory()) {
        resolvedTarget = join(resolvedTarget, 'index.html')
      }
      references += 1
      if (!existsSync(resolvedTarget)) {
        issues.push(`${sourceLabel}: missing ${reference.original} (${relative(root, resolvedTarget)})`)
        continue
      }

      // Exchange detail hashes (`#artifact=...`) are application state, and
      // Zensical's `#__skip` is a keyboard-navigation sentinel. Other local
      // fragments must resolve to an emitted id/name.
      if (
        reference.fragment
        && !reference.fragment.includes('=')
        && reference.fragment !== '__skip'
        && resolvedTarget.endsWith('.html')
      ) {
        const fragment = decodeUrlPart(reference.fragment, sourceLabel)
        fragments += 1
        if (!anchorSet(resolvedTarget, anchors).has(fragment)) {
          issues.push(`${sourceLabel}: missing #${fragment} in ${relative(root, resolvedTarget)}`)
        }
      }
    }
  }

  if (issues.length) fail(`found ${issues.length} broken local reference(s):\n${issues.join('\n')}`)
  return { pages: files.length, references, fragments }
}

function parseArgs(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (!['--site', '--base-path'].includes(flag)) fail(`unknown option: ${flag}`)
    const value = args[++index]
    if (!value || value.startsWith('--')) fail(`${flag} requires a value`)
    if (flag === '--site') options.siteRoot = resolve(value)
    else options.basePath = value
  }
  return options
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    const result = checkStaticSite(parseArgs(process.argv.slice(2)))
    console.log(
      `static site links: PASS (${result.references} local target(s), ${result.fragments} static fragment(s), ${result.pages} page(s))`,
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
