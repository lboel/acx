#!/usr/bin/env node
// Refuse pull requests that rewrite an already-published immutable artifact.
//
// The registry builder validates the bytes currently present in a branch. This
// separate history-aware gate closes the other half of the contract: a valid
// new signature must not replace, delete, or rename an artifact at an existing
// publisher/id/version coordinate. Lifecycle changes belong in status.json.

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const COMMIT_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i
const VERSION = '(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?'
const IMMUTABLE_PATHS = [
  new RegExp(`^registry/cartridges/(?:[^/]+/){3}cartridge\\.acx$`),
  new RegExp(`^registry/cals/(?:[^/]+/){2,}${VERSION}\\.cal\\.json$`),
  new RegExp(`^registry/graphs/(?:[^/]+/){2,}${VERSION}\\.agent-graph\\.json$`),
]

function fail(message) {
  throw new Error(`registry immutability check refused: ${message}`)
}

function git(args, cwd = PROJECT_ROOT) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.status !== 0) {
    fail((result.stderr || result.stdout || `git ${args[0]} failed`).trim())
  }
  return result.stdout
}

export function isImmutableRegistryPath(path) {
  return typeof path === 'string' && IMMUTABLE_PATHS.some((pattern) => pattern.test(path))
}

export function parseNameStatusZ(output, repositoryPrefix = '') {
  const tokens = output.split('\0')
  if (tokens.at(-1) === '') tokens.pop()
  if (tokens.length % 2 !== 0) fail('git returned malformed name-status output')
  const prefix = repositoryPrefix.replace(/\\/g, '/')
  const changes = []
  for (let index = 0; index < tokens.length; index += 2) {
    const status = tokens[index]
    let path = tokens[index + 1]
    if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length)
    changes.push({ status, path })
  }
  return changes
}

export function immutableViolations(changes) {
  return changes.filter(({ status, path }) => status !== 'A' && isImmutableRegistryPath(path))
}

export function checkRegistryImmutability({
  base,
  head = 'HEAD',
  projectRoot = PROJECT_ROOT,
} = {}) {
  if (!COMMIT_RE.test(base || '')) fail('--base must be a full 40- or 64-character commit id')
  if (head !== 'HEAD' && !COMMIT_RE.test(head || '')) {
    fail('--head must be HEAD or a full 40- or 64-character commit id')
  }
  const prefix = git(['rev-parse', '--show-prefix'], projectRoot).trim()
  const output = git([
    'diff',
    '--name-status',
    '-z',
    '--no-renames',
    '--diff-filter=ACDMRTUXB',
    `${base}..${head}`,
    '--',
    'registry/cartridges',
    'registry/cals',
    'registry/graphs',
  ], projectRoot)
  const changes = parseNameStatusZ(output, prefix)
  const violations = immutableViolations(changes)
  if (violations.length) {
    const details = violations.map(({ status, path }) => `  ${status} ${path}`).join('\n')
    fail(
      `published artifact coordinates are append-only; publish a new SemVer and use registry/status.json for lifecycle changes:\n${details}`,
    )
  }
  return { checked: changes.length, additions: changes.filter(({ status }) => status === 'A').length }
}

function usage() {
  return `Usage: node tools/check-registry-immutability.mjs --base <full-commit-sha> [--head <full-commit-sha>]

Compares HEAD (or an explicitly fetched pull-request head) with its exact base commit. New canonical
artifact coordinates are allowed; modifications, deletions, and renames of
existing signed artifact files are refused.
`
}

function parseArgs(args) {
  if (args.includes('--help')) return { help: true }
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (!value || !['--base', '--head'].includes(flag)) {
      fail('expected --base <full-commit-sha> [--head <full-commit-sha>]')
    }
    if (flag === '--base') options.base = value
    else options.head = value
  }
  if (!options.base) fail('expected --base <full-commit-sha> [--head <full-commit-sha>]')
  return options
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) {
      process.stdout.write(usage())
    } else {
      const result = checkRegistryImmutability(options)
      console.log(`registry history is immutable (${result.additions} new artifact file(s))`)
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
