#!/usr/bin/env node
// Prove the published npm tarball is installable and its CLI import closure is
// complete. `npm pack --dry-run` only lists files; it does not execute the
// package, so a missing top-level import can otherwise reach the registry.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const work = mkdtempSync(join(tmpdir(), 'acx-package-smoke-'))
const npmCache = join(work, 'npm-cache')
const installRoot = join(work, 'install')
const env = { ...process.env, npm_config_cache: npmCache }

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status})\n${result.stdout || ''}${result.stderr || ''}`,
    )
  }
  return result
}

function runRefused(command, args, pattern, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  if (result.status === 0 || !pattern.test(output)) {
    throw new Error(
      `${command} ${args.join(' ')} did not fail closed as expected (${result.status})\n${output}`,
    )
  }
}

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`packed ${label} is missing: ${path}`)
}

try {
  mkdirSync(installRoot, { recursive: true })
  const packed = run('npm', ['pack', '--json', '--pack-destination', work])
  const packReport = JSON.parse(packed.stdout)
  const filename = packReport?.[0]?.filename
  if (!filename) throw new Error(`npm pack did not report a tarball: ${packed.stdout}`)
  const packedPaths = (packReport[0].files || []).map((file) => file.path)
  const forbidden = packedPaths.filter((path) => (
    path.includes('/memory-lance/')
    || path.includes('/.venv/')
    || path.includes('.memories.lance/')
    || path.endsWith('.key.pem')
    || /(^|\/)\.env(?:\.|$)/.test(path)
  ))
  if (forbidden.length) {
    throw new Error(`npm tarball contains local/generated or private paths:\n${forbidden.join('\n')}`)
  }

  const tarball = join(work, filename)
  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
    '--prefix',
    installRoot,
    tarball,
  ])

  const packageRoot = join(installRoot, 'node_modules', 'agent-cartridge')
  const cli = join(packageRoot, 'src', 'cli.mjs')
  const acx = join(installRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'acx.cmd' : 'acx')
  requireFile(cli, 'CLI')
  requireFile(acx, 'npm bin shim')
  requireFile(join(packageRoot, 'tools', 'materialize-lance.mjs'), 'LanceDB bridge')
  requireFile(join(packageRoot, 'tools', 'lance', 'materialize.py'), 'LanceDB materializer')
  requireFile(join(packageRoot, 'platform', 'static', 'studio', 'index.html'), 'static Studio')
  requireFile(join(packageRoot, 'skills', 'acx-share-agent', 'SKILL.md'), 'sharing skill')

  const help = run(acx, ['help'], { cwd: work })
  if (!help.stdout.includes('Usage:') || !help.stdout.includes('acx share graph')) {
    throw new Error(`packed CLI returned incomplete help:\n${help.stdout}`)
  }
  const version = run(acx, ['--version'], { cwd: work })
  const versionLines = version.stdout.trim().split('\n')
  if (
    versionLines[0] !== `acx ${packReport[0].version}`
    || versionLines[1] !== 'spec document 0.1 (public draft)'
    || versionLines[2] !== 'container wire format 1.0'
  ) {
    throw new Error(`packed CLI returned incoherent versions:\n${version.stdout}`)
  }

  const packageDir = join(work, 'agent-package')
  run(acx, ['init', packageDir], { cwd: work })
  const manifest = JSON.parse(readFileSync(join(packageDir, 'manifest.json'), 'utf8'))
  if (manifest.schemaVersion !== '1.1') {
    throw new Error(`packed CLI scaffolded unexpected manifest: ${manifest.schemaVersion}`)
  }

  const cartridge = join(work, 'package-smoke.acx')
  run(acx, [
    'export',
    packageDir,
    cartridge,
    '--publisher',
    'io.github.acx.package-smoke',
  ], { cwd: work })
  const verify = run(acx, ['verify', cartridge], { cwd: work })
  if (!verify.stdout.includes('trust:    portable') || !verify.stdout.includes('Signature valid')) {
    throw new Error(`packed CLI did not verify its exported cartridge:\n${verify.stdout}`)
  }

  const packagedGraph = join(
    packageRoot,
    'registry',
    'graphs',
    'io.github.lboel',
    'product-delivery',
    '1.0.0.agent-graph.json',
  )
  runRefused(
    acx,
    ['share', 'graph', packagedGraph, '--dry-run'],
    /share requires --registry <dir>/,
    { cwd: work },
  )
  const externalRegistry = join(work, 'fork', 'registry')
  const share = run(
    acx,
    ['share', 'graph', packagedGraph, '--registry', externalRegistry, '--dry-run'],
    { cwd: work },
  )
  if (!share.stdout.includes(`artifact:   ${join(externalRegistry, 'graphs')}`)) {
    throw new Error(`packed CLI did not target the explicit external registry:\n${share.stdout}`)
  }

  console.log(`packed npm CLI smoke: PASS (${filename})`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
