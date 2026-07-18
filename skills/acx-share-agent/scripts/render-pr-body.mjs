#!/usr/bin/env -S node --experimental-sqlite
import { join } from 'node:path'
import {
  prepareAgentShare,
  prepareWorkflowShare,
  sharePullRequestBody,
} from '../../../src/share.mjs'
import { REPO_ROOT } from '../../../src/paths.mjs'

function usage() {
  console.error('usage: render-pr-body.mjs agent <file.acx> --slug <slug> | workflow <file.cal.json>')
  process.exit(2)
}

const args = process.argv.slice(2)
const type = args[0]
const file = args[1]
const slugIndex = args.indexOf('--slug')
const slug = slugIndex >= 0 ? args[slugIndex + 1] : null
if (!['agent', 'workflow'].includes(type) || !file || (type === 'agent' && !slug)) usage()

const options = {
  registryRoot: join(REPO_ROOT, 'registry'),
  dryRun: true,
  ...(slug ? { slug } : {}),
}
const plan = type === 'agent'
  ? prepareAgentShare(file, options)
  : prepareWorkflowShare(file, options)

process.stdout.write(sharePullRequestBody(plan))
