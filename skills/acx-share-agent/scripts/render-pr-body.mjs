#!/usr/bin/env -S node --experimental-sqlite
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join, relative } from 'node:path'
import {
  prepareAgentGraphShare,
  prepareAgentShare,
  prepareWorkflowShare,
  sharePullRequestBody,
} from '../../../src/share.mjs'
import { REPO_ROOT } from '../../../src/paths.mjs'

function usage() {
  console.error('usage: render-pr-body.mjs agent <file.acx> [--slug <matching-id>] | workflow <file.cal.json> | graph <file.agent-graph.json>')
  process.exit(2)
}

const args = process.argv.slice(2)
const type = args[0]
const file = args[1]
if (!['agent', 'workflow', 'graph'].includes(type) || !file) usage()
let slug = null
if (type === 'agent') {
  if (args.length === 4 && args[2] === '--slug' && args[3]) slug = args[3]
  else if (args.length !== 2) usage()
} else if (args.length !== 2) {
  usage()
}

const options = {
  registryRoot: join(REPO_ROOT, 'registry'),
  dryRun: true,
  ...(slug ? { slug } : {}),
}
const plan = type === 'agent'
  ? prepareAgentShare(file, options)
  : type === 'workflow'
    ? prepareWorkflowShare(file, options)
    : prepareAgentGraphShare(file, options)

function safeSlug(value) {
  return String(value || 'artifact')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, 72) || 'artifact'
}

function publicShareUrl(sharePlan) {
  const artifactType = sharePlan.type
  const registryPath = relative(options.registryRoot, sharePlan.destination).replaceAll('\\', '/')
  const id = artifactType === 'agent' ? sharePlan.id : sharePlan.card.id
  const suffix = createHash('sha256')
    .update(`${artifactType}\0${registryPath}`)
    .digest('hex')
    .slice(0, 8)
  return `https://lboel.github.io/acx/exchange/artifacts/${artifactType}/${safeSlug(id)}-${suffix}/`
}

function publicationDisposition(sharePlan) {
  const registryPath = relative(REPO_ROOT, sharePlan.destination).replaceAll('\\', '/')
  const prefixResult = spawnSync('git', ['rev-parse', '--show-prefix'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  const repositoryPath = `${prefixResult.status === 0 ? prefixResult.stdout.trim() : ''}${registryPath}`
  const tracked = spawnSync('git', ['cat-file', '-e', `HEAD:${repositoryPath}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).status === 0
  if (tracked) return 'existing in current HEAD; do not open an empty PR for this coordinate'
  if (sharePlan.changed) return 'new registry content would be prepared by the non-dry share command'
  return 'new registry content is already present in the worktree and is not yet in current HEAD'
}

plan.publicationDisposition = publicationDisposition(plan)
const body = sharePullRequestBody(plan).trimEnd()
const shareUrl = publicShareUrl(plan)
process.stdout.write(`${body}

### Expected public share URL

After registry CI, human review, merge, and the static Exchange deployment:
${shareUrl}
`)
