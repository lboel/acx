#!/usr/bin/env -S node --experimental-sqlite
// acx — Agent Cartridge (.acx) command-line tool.
// Zero-dependency ESM. All real work is delegated to the src/ reference modules;
// this file only parses argv and wires the pipeline together (SPEC §12 conformance).
import { randomBytes } from 'node:crypto'
import { copyFileSync, writeFileSync, existsSync } from 'node:fs'
import { Cartridge, SPEC_VERSION, USER_VERSION } from './container.mjs'
import { generateSigningKey, signingKeyFromPrivatePem } from './sign.mjs'
import { exportPackageToCartridge } from './export.mjs'
import { evaluateTrust, emptyTrustRegistry, loadTrustRegistry } from './trust.mjs'
import { buildCapability } from './builders.mjs'
import { stripToRom } from './strip.mjs'
import { oidJcs } from './canonical.mjs'
import { runVerification, demoDagBenchmark } from './level/benchmark.mjs'
import { verifyLevelCredential } from './level/credential.mjs'
import { validatePackageSpec } from './packagespec.mjs'
import { loadCartridge, renderCard, readCard, DEFAULT_SKILLS_DIR } from './load.mjs'
import { harnessCheck, resolveHost, HOSTS, listDir } from './hostcheck.mjs'
import { lintCal, validatePublishableWorkflow } from './cal.mjs'
import { signWorkflow, verifyWorkflow, workflowCard, workflowDigest } from './workflow.mjs'
import {
  agentGraphCard,
  agentGraphDigest,
  signAgentGraph,
  validateAgentGraphStructure,
  validatePublishableAgentGraph,
  verifyAgentGraph,
} from './agent-graph.mjs'
import { scaffoldPackage, initFromCode } from './init.mjs'
import { startBuilder } from './builder.mjs'
import { materializeLance } from '../tools/materialize-lance.mjs'
import { prepareAgentGraphShare, prepareAgentShare, prepareWorkflowShare, sharePullRequestBody } from './share.mjs'
import { REPO_ROOT } from './paths.mjs'
import { join } from 'node:path'
import { readFileSync as _readFileSync, readdirSync } from 'node:fs'

const USAGE = `acx — Agent Cartridge (.acx) command-line tool

Usage:
  acx --version
  acx export <agent-package-dir> <out.acx> --publisher <reverse-dns> [--include-field-learned]
  acx inspect <file.acx>
  acx verify  <file.acx> [--registry <trust.json>]
  acx strip   <file.acx> <out.acx>
  acx spec    <file.acx>
  acx ls      [dir]                        overview (roster) of cartridges in a directory
  acx load    <file.acx> [--host claude|codex|cursor] [--skills-dir <dir>] [--print-only]
  acx check   <file.acx> [--tools <role,role>] [--all-tools]   harness preflight
  acx init    [dir] [--role <role>] | --from-code <dir> --out <dir>   scaffold an agent / agent set
  acx workflow lint    <workflow.cal.json> [--publish]
  acx workflow ready   <workflow.cal.json> [--cartridges <dir>]
  acx workflow sign    <workflow.cal.json> --publisher <reverse-dns> [--key <pem>] [--out <file>]
  acx workflow verify  <workflow.cal.json> [--registry <trust.json>]
  acx workflow inspect <workflow.cal.json>
  acx workflow digest  <workflow.cal.json>
  acx graph lint    <graph.agent-graph.json> [--publish]
  acx graph sign    <graph.agent-graph.json> --publisher <reverse-dns> [--key <pem>] [--out <file>]
  acx graph verify  <graph.agent-graph.json> [--registry <trust.json>]
  acx graph inspect <graph.agent-graph.json>
  acx graph digest  <graph.agent-graph.json>
  acx cal     <cal.json> [--cartridges <dir>]   alias for "workflow ready"
  acx lance   <file.acx> [--python <py>]        materialize a real LanceDB memory dataset
  acx builder [--port 8799]                     serve the static workflow + Agent Graph Studio locally
  acx share agent    <file.acx> [--slug <signed-id>] [--publisher <id>] [--registry <dir>] [--dry-run] [--force]
  acx share workflow <file.cal.json> [--publisher <id>] [--registry <dir>] [--dry-run] [--force]
  acx share graph    <file.agent-graph.json> [--publisher <id>] [--registry <dir>] [--dry-run] [--force]
  acx level   <file.acx>

Commands:
  export   Package an AGENTIBUS agent-package directory into a signed .acx cartridge.
           Generates an ed25519 signing key and writes the PRIVATE key to <out>.key.pem
           OUTSIDE the cartridge. Prints the cartridge id and ROM manifest hash.
  inspect  Print meta, ROM object count, skills, capabilities, memory zone counts,
           and attestations for a cartridge.
  verify   Evaluate the SPEC §4.5 trust taxonomy. Exits non-zero if tampered/invalid.
  strip    Copy a cartridge, strip the SAVE zone, and print the ROM hash-equality proof.
  level    Run the demo benchmark with an INDEPENDENT verifier key, issue a level
           credential if the gate passes, and write the VC next to the file.

Flags:
  --publisher <reverse-dns>   Publisher id (e.g. io.github.agentibus). Required for export.
  --include-field-learned     Include quarantined field-learned SAVE memory (default: off).
  --registry <trust.json>     Public-keys-only trust registry for verify.
`

const BOOL_FLAGS = new Set(['include-field-learned', 'print-only', 'card', 'no-install', 'json', 'quiet', 'all-tools', 'no-standalone', 'publish', 'dry-run', 'force'])
function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const name = a.slice(2)
      if (BOOL_FLAGS.has(name)) flags[name] = true
      else { const next = argv[i + 1]; if (next !== undefined && !next.startsWith('--')) { flags[name] = next; i++ } else flags[name] = true }
    } else positional.push(a)
  }
  if (flags['include-field-learned']) flags.includeFieldLearned = true
  return { positional, flags }
}

function die(msg) {
  console.error('acx: ' + msg)
  process.exit(2)
}

function cmdVersion() {
  const packageMetadata = JSON.parse(_readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
  const containerMajor = (USER_VERSION >>> 24) & 0xff
  const containerMinor = (USER_VERSION >>> 16) & 0xff
  console.log(`acx ${packageMetadata.version}`)
  console.log(`spec document ${SPEC_VERSION} (public draft)`)
  console.log(`container wire format ${containerMajor}.${containerMinor}`)
}

function romDigestOf(cart) {
  return cart.getMeta('acx.rom_manifest_hash')
}

// ---- export ---------------------------------------------------------------
function cmdExport(positional, flags) {
  const [packageDir, outPath] = positional
  if (!packageDir || !outPath) die('export requires <agent-package-dir> <out.acx>')
  if (!flags.publisher) die('export requires --publisher <reverse-dns>')
  if (!existsSync(packageDir)) die(`agent-package directory not found: ${packageDir}`)

  const key = generateSigningKey()
  // Org-scoped installation salt (>=256 bits) used only for codebase fingerprints
  // of field-learned memory. Ephemeral here; a real org persists this secret.
  const installationSalt = randomBytes(32)

  // Headline attested-able capability so downstream `level`/`inspect` are meaningful.
  const dagCap = buildCapability({
    taskType: 'build-dag',
    stack: ['airflow', 'snowflake', 'dbt'],
    domain: 'infrastructure',
  })

  const { cart, cartridgeId } = exportPackageToCartridge({
    packageDir,
    outPath,
    key,
    publisherId: flags.publisher,
    installationSalt,
    includeFieldLearned: !!flags.includeFieldLearned,
    extraCapabilities: [dagCap],
  })
  const romHash = romDigestOf(cart)
  cart.close()

  // The PRIVATE key MUST live outside the cartridge (SPEC §4). Never signed in.
  const keyPath = outPath + '.key.pem'
  writeFileSync(keyPath, key.privateKeyPem, { mode: 0o600 })

  console.log('cartridge id:   ' + cartridgeId)
  console.log('rom hash:       ' + romHash)
  console.log('keyid:          ' + key.keyid)
  console.log('signing key:    ' + keyPath + '  (private — keep secret, outside cartridge)')
  console.log('field-learned:  ' + (flags.includeFieldLearned ? 'included' : 'quarantined (default)'))
  console.log('wrote:          ' + outPath)
}

// ---- inspect --------------------------------------------------------------
function cmdInspect(positional) {
  const [file] = positional
  if (!file) die('inspect requires <file.acx>')
  const cart = Cartridge.open(file, { readonly: true })

  console.log('== meta ==')
  const meta = cart.allMeta()
  for (const k of Object.keys(meta).sort()) console.log('  ' + k + ' = ' + meta[k])

  console.log('\n== ROM objects ==')
  const rom = cart.romObjects()
  const byKind = {}
  for (const o of rom) byKind[o.kind] = (byKind[o.kind] ?? 0) + 1
  console.log('  total: ' + rom.length + '  (' + Object.entries(byKind).map(([k, n]) => `${k}:${n}`).join(', ') + ')')

  console.log('\n== skills (acx_skill) ==')
  const skills = cart.db.prepare('SELECT name, description FROM acx_skill ORDER BY name').all()
  if (!skills.length) console.log('  (none)')
  for (const s of skills) console.log('  - ' + s.name + ': ' + s.description.slice(0, 100))

  console.log('\n== capabilities ==')
  const caps = cart.db.prepare('SELECT json FROM capabilities').all()
  if (!caps.length) console.log('  (none)')
  for (const row of caps) {
    const c = JSON.parse(row.json)
    const verified = c.proficiency?.verified === true
    console.log(`  - ${c.taskType}[${(c.stack ?? []).join('+')}]  verified=${verified}`)
  }

  console.log('\n== memory (by zone) ==')
  const zones = cart.db.prepare('SELECT zone, COUNT(*) AS n FROM memory GROUP BY zone ORDER BY zone').all()
  if (!zones.length) console.log('  (none)')
  for (const z of zones) console.log('  ' + z.zone + ': ' + z.n)

  console.log('\n== attestations ==')
  const atts = cart.db.prepare('SELECT att_id, type, media_type, created_at FROM attestations ORDER BY created_at').all()
  if (!atts.length) console.log('  (none)')
  for (const a of atts) console.log(`  - ${a.att_id}  type=${a.type}  media=${a.media_type ?? ''}  at=${a.created_at}`)

  cart.close()
}

// ---- verify ---------------------------------------------------------------
function cmdVerify(positional, flags) {
  const [file] = positional
  if (!file) die('verify requires <file.acx>')
  const registry = flags.registry ? loadTrustRegistry(flags.registry) : emptyTrustRegistry()

  const cart = Cartridge.open(file, { readonly: true })
  const v = evaluateTrust(cart, { registry })
  cart.close()

  console.log('status:   ' + v.status)
  console.log('trust:    ' + v.trust)
  console.log('summary:  ' + v.summary)
  if (v.keyId) console.log('keyid:    ' + v.keyId)
  if (v.signedAt) console.log('signedAt: ' + v.signedAt)
  if (v.issues && v.issues.length) console.log('issues:   ' + v.issues.join('; '))

  const bad = v.status === 'invalid' || v.trust === 'tampered'
  process.exit(bad ? 1 : 0)
}

// ---- strip ----------------------------------------------------------------
function cmdStrip(positional) {
  const [file, outPath] = positional
  if (!file || !outPath) die('strip requires <file.acx> <out.acx>')
  copyFileSync(file, outPath)
  const cart = Cartridge.open(outPath)
  const proof = stripToRom(cart)
  cart.close()

  console.log('rom hash before strip: ' + proof.before)
  console.log('rom hash after  strip: ' + proof.after)
  console.log('hash-equality proof:   ' + (proof.equal ? 'EQUAL (ROM intact; SAVE removed)' : 'MISMATCH'))
  console.log('wrote:                 ' + outPath)
  process.exit(proof.equal ? 0 : 1)
}

// ---- load / install -------------------------------------------------------
function cmdLoad(positional, flags) {
  const [file] = positional
  if (!file) die('load requires <file.acx>')
  const printOnly = !!(flags['print-only'] || flags.card)
  const skillsDir = flags['skills-dir'] || (flags.host ? resolveHost(flags.host).skillsDir : DEFAULT_SKILLS_DIR)
  const registryPath = flags.registry || null

  const { card, installed, refused } = loadCartridge(file, { skillsDir, install: !printOnly, registryPath })
  if (refused) {
    console.error(renderCard(card))
    const packageReason = card.packageSpec?.ok === false
      ? `; package is unclean (${card.packageSpec.issues.join('; ')})`
      : ''
    console.error('\n✗ refused to load: cartridge is ' + card.trust + ' (' + card.trustSummary + ')' + packageReason)
    process.exit(1)
  }
  console.log(renderCard(card, { installed, skillsDir }))
  if (!printOnly) {
    console.log(`\nInstalled ${installed.length} skill bundle(s). Restart your agent / Claude Code to pick them up.`)
    if (card.trust === 'portable') console.log('Note: signer is portable (not in your trust registry) — verify the publisher namespace before relying on it.')
  }
  process.exit(0)
}

function cardOf(file) {
  const c = Cartridge.open(file, { readonly: true })
  try { return readCard(c) } finally { c.close() }
}

// ---- check (harness preflight) --------------------------------------------
function cmdCheck(positional, flags) {
  const [file] = positional
  if (!file) die('check requires <file.acx>')
  const providedTools = (flags.tools ? String(flags.tools).split(',') : []).map((s) => s.trim()).filter(Boolean)
  const assumeAllTools = !!flags['all-tools']
  const cart = Cartridge.open(file, { readonly: true })
  const r = harnessCheck(cart, { providedTools, assumeAllTools })
  const card = readCard(cart)
  cart.close()

  console.log(`Harness check — ${card.name} (${card.class})`)
  console.log(`  MCP protocol floor: ${r.mcp.minProtocolRevision || '?'}   model: toolUse=${r.model.toolUse} minContext=${r.model.minContextWindowTokens}`)
  console.log('  Required tool roles:')
  for (const t of r.requiredTools) console.log(`    ${t.satisfied ? '✓' : (t.verified ? '✗' : '?')} ${t.role.padEnd(18)} scopes=${(t.scopes || []).join(',')}`)
  if (providedTools.length === 0 && !assumeAllTools) console.log('      (pass --tools <role,role> or --all-tools to confirm the host provides these)')
  console.log('  External binaries:')
  for (const b of r.binaries) console.log(`    ${b.present ? '✓' : (b.optional ? '·' : '✗')} ${b.bin}${b.optional ? ' (optional)' : ''}`)
  console.log('  Skill integrity:')
  for (const s of r.skills) console.log(`    ${s.ok ? '✓' : '✗'} ${s.path}`)
  console.log(`\n  verdict: ${r.verdict === 'accept' ? 'ACCEPT ✓ — this host can boot the cartridge' : 'REFUSE ✗ — unmet: ' + r.unmet.join(', ')}`)
  process.exit(r.verdict === 'accept' ? 0 : 1)
}

// ---- ls (roster overview) -------------------------------------------------
function cmdLs(positional) {
  const dir = positional[0] || join(REPO_ROOT, 'platform', 'catalog')
  const rows = listDir(dir, cardOf)
  if (!rows.length) { console.log(`no cartridges in ${dir}`); process.exit(0) }
  console.log(`Roster — ${rows.length} cartridge(s) in ${dir}\n`)
  console.log('  ' + 'AGENT'.padEnd(16) + 'CLASS'.padEnd(20) + 'LEVEL'.padEnd(22) + 'TRUST'.padEnd(10) + 'MOVES')
  for (const c of rows.sort((a, b) => (b.level.acxLevel) - (a.level.acxLevel))) {
    const lvl = c.level.proven ? `${c.level.tier} Lv.${c.level.acxLevel} ✓` : `Lv.${c.level.acxLevel} (declared)`
    const moves = c.moves.map((m) => m.taskType + (m.verified ? '*' : '')).slice(0, 3).join(',')
    console.log('  ' + c.name.padEnd(16) + c.class.padEnd(20) + lvl.padEnd(22) + c.trust.padEnd(10) + moves)
  }
  process.exit(0)
}

// ---- init (scaffold a package, or an agent set from code) -----------------
function cmdInit(positional, flags) {
  if (flags['from-code']) {
    const codeDir = flags['from-code'] === true ? process.cwd() : flags['from-code']
    const outDir = flags.out || positional[0] || join(process.cwd(), 'agent-set')
    const { agentSet, rac } = initFromCode(codeDir, outDir)
    console.log(`Analyzed ${codeDir}\nGenerated an agent set in ${outDir}:`)
    for (const a of agentSet) console.log(`  • ${a.role.padEnd(16)} caps=${a.capabilities.join(',')}  (${a.reasons.join('; ')})`)
    console.log('Required Available Context (descriptions only):')
    for (const r of rac) console.log(`  □ ${r.id.padEnd(14)} [${r.kind}] ${r.description}`)
    console.log(`\nNext: fill agents/<role>/, export each, then 'acx workflow ready ${join(outDir, 'cal', 'from-code.cal.json')} --cartridges .'`)
    process.exit(0)
  }
  const dir = positional[0] || join(process.cwd(), 'new-agent-package')
  scaffoldPackage(dir, { role: flags.role || 'backend_dev' })
  console.log(`Scaffolded a fillable agent-package at ${dir}`)
  console.log(`Fill manifest.json + memory-records.json, then:`)
  console.log(`  node --experimental-sqlite src/cli.mjs export ${dir} my-agent.acx --publisher io.github.you`)
  process.exit(0)
}

// ---- lance (materialize a real LanceDB memory dataset) --------------------
function cmdLance(positional, flags) {
  const [file] = positional
  if (!file) die('lance requires <file.acx>')
  try {
    const r = materializeLance(file, { python: flags.python, keepStandalone: !flags['no-standalone'] })
    console.log(`materialized a real LanceDB dataset (acx.lance-memory/1): ${r.rows} rows, ${r.vectorType}`)
    console.log(`  embedded in cartridge → ${r.embedded}  (SAVE zone, unsigned)`)
    if (r.standalone) console.log(`  standalone dataset    → ${r.standalone}`)
    process.exit(0)
  } catch (e) {
    console.error('acx lance: ' + e.message)
    process.exit(1)
  }
}

// ---- workflows / CAL (multi-agent loops) ---------------------------------
function findCartridgeFiles(dir) {
  if (!existsSync(dir)) return []
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...findCartridgeFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.acx')) files.push(path)
  }
  return files
}

function readWorkflow(file) {
  const workflow = JSON.parse(_readFileSync(file, 'utf8'))
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) die(`${file} must contain a JSON object`)
  return workflow
}

function renderWorkflowReadiness(cal, lint, { staffed }) {
  const { ok, issues, warnings = [], resolved } = lint
  console.log(`ACX Workflow: ${cal.name || cal.id} @ ${cal.version || 'unversioned'}  (${(cal.nodes || []).length} nodes, ${(cal.participants || []).length} participants)`)
  console.log('\nParticipants (agents, referenced by hash or staffed by slot):')
  for (const r of resolved) {
    const marker = staffed ? (r.bound ? '✓' : '✗') : '·'
    const detail = staffed ? (r.bound ? r.bound.card.name + ' — ' + r.reason : r.reason) : 'declared; staffing not requested'
    console.log(`  ${marker} ${r.alias.padEnd(14)} ${r.bind.padEnd(5)} ${detail}`)
  }
  console.log('\nRequired Available Context (RAC — descriptions only, confirm before running):')
  for (const rc of cal.rac || []) console.log(`  ${rc.required === false ? '·' : '□'} ${rc.id.padEnd(16)} [${rc.kind}] ${rc.description}${rc.check ? '  (check: ' + rc.check.type + ' ' + (rc.check.hint || '') + ')' : ''}`)
  console.log('\nFlow:')
  for (const n of cal.nodes || []) {
    if (n.type === 'task') {
      const req = [...(n.requires?.capabilities || []).map((c) => 'cap:' + c), ...(n.requires?.skills || []).map((s) => 'skill:' + s), ...(n.requires?.rac || []).map((r) => 'rac:' + r)].join(' ')
      console.log(`  [task] ${n.id.padEnd(14)} agent=${n.agent.padEnd(12)} ${n.action || ''}  {${req}}  completion=${n.completion?.type}`)
    } else {
      console.log(`  [${n.type}] ${n.id}${n.gateway ? ' (' + n.gateway + ')' : ''}`)
    }
  }
  const conds = (cal.edges || []).filter((e) => e.when)
  if (conds.length) { console.log('\nConditional transitions:'); for (const e of conds) console.log(`  ${e.from} → ${e.to}  when ${JSON.stringify(e.when)}`) }
  console.log('\nverdict: ' + (ok ? (staffed ? 'READY ✓ — structure valid, team staffed, requirements covered' : 'VALID ✓ — structure and publish profile pass') : (staffed ? 'NOT READY' : 'INVALID')))
  for (const i of issues) console.log('  - ' + i)
  for (const warning of warnings) console.log('  ! ' + warning)
}

function cmdWorkflow(positional, flags) {
  let [action, workflowFile] = positional
  if (!['lint', 'ready', 'sign', 'verify', 'inspect', 'digest'].includes(action)) {
    workflowFile = action
    action = 'ready'
  }
  if (!workflowFile) die('workflow requires lint|ready|sign|verify|inspect|digest <workflow.cal.json>')
  const cal = readWorkflow(workflowFile)

  if (action === 'sign') {
    if (!flags.publisher) die('workflow sign requires --publisher <reverse-dns>')
    const issues = validatePublishableWorkflow(cal)
    if (issues.length) {
      console.error('workflow is not publishable:')
      for (const issue of issues) console.error('  - ' + issue)
      process.exit(1)
    }
    const generated = !flags.key
    const key = generated
      ? generateSigningKey()
      : signingKeyFromPrivatePem(_readFileSync(flags.key, 'utf8'))
    const signed = signWorkflow(cal, key, { publisherId: flags.publisher })
    const out = flags.out || workflowFile.replace(/(?:\.signed)?\.cal\.json$/, '') + '.signed.cal.json'
    writeFileSync(out, JSON.stringify(signed, null, 2) + '\n')
    console.log('workflow:     ' + signed.id + '@' + signed.version)
    console.log('digest:       ' + signed.integrity.digest)
    console.log('publisher:    ' + signed.integrity.publisherId)
    console.log('keyid:        ' + signed.integrity.keyid)
    console.log('wrote:        ' + out)
    if (generated) {
      const keyPath = out + '.key.pem'
      writeFileSync(keyPath, key.privateKeyPem, { mode: 0o600 })
      console.log('signing key:  ' + keyPath + '  (private — keep secret, never publish)')
    } else {
      console.log('signing key:  reused ' + flags.key)
    }
    process.exit(0)
  }

  if (action === 'verify') {
    const registry = flags.registry ? loadTrustRegistry(flags.registry) : emptyTrustRegistry()
    const verification = verifyWorkflow(cal, { registry })
    const structural = lintCal(cal, [], { resolve: false, publish: true })
    const ok = verification.ok && verification.signed && structural.ok
    if (flags.json) console.log(JSON.stringify({ ok, verification, structural }, null, 2))
    else {
      console.log('status:     ' + verification.status)
      console.log('trust:      ' + verification.trust)
      console.log('digest:     ' + verification.digest)
      console.log('publisher:  ' + (verification.publisherId || '—'))
      console.log('structure:  ' + (structural.ok ? 'publishable ✓' : 'invalid'))
      for (const issue of [...verification.issues, ...structural.issues]) console.log('  - ' + issue)
    }
    process.exit(ok ? 0 : 1)
  }

  if (action === 'inspect') {
    const registry = flags.registry ? loadTrustRegistry(flags.registry) : emptyTrustRegistry()
    const verification = verifyWorkflow(cal, { registry })
    const card = workflowCard(cal, verification)
    if (flags.json) console.log(JSON.stringify(card, null, 2))
    else {
      console.log(`${card.name} @ ${card.version || 'unversioned'}`)
      console.log(card.description || '(no description)')
      console.log(`  id:            ${card.id}`)
      console.log(`  team:          ${card.participantCount} participant(s)`)
      for (const participant of card.participants) console.log(`    - ${participant.alias}: ${participant.bind}${participant.role ? ' role=' + participant.role : ''}${participant.romDigest ? ' ' + participant.romDigest : ''}`)
      console.log(`  flow:          ${card.nodeCount} node(s)`)
      console.log(`  capabilities:  ${card.capabilities.join(', ') || '—'}`)
      console.log(`  license:       ${card.license || '—'}`)
      console.log(`  tags:          ${card.tags.join(', ') || '—'}`)
      console.log(`  digest:        ${card.digest}`)
      console.log(`  signature:     ${card.signed ? card.trust + ' (' + card.status + ')' : 'unsigned'}`)
      if (card.publisher) console.log(`  publisher:     ${card.publisher}`)
    }
    process.exit(0)
  }

  if (action === 'digest') {
    console.log(workflowDigest(cal).digest)
    process.exit(0)
  }

  const staffed = action === 'ready'
  const dir = flags.cartridges || join(REPO_ROOT, 'platform', 'catalog')
  const cartridges = staffed
    ? findCartridgeFiles(dir).map((path) => ({ path, card: cardOf(path) }))
    : []
  const lint = lintCal(cal, cartridges, { resolve: staffed, publish: !!flags.publish })
  if (flags.json) console.log(JSON.stringify(lint, null, 2))
  else renderWorkflowReadiness(cal, lint, { staffed })
  process.exit(lint.ok ? 0 : 1)
}

function cmdCal(positional, flags) {
  return cmdWorkflow(['ready', ...positional], flags)
}

// ---- agent graph (knowledge, reporting, and loop convergence) -------------
function cmdAgentGraph(positional, flags) {
  const [action, graphFile] = positional
  if (!['lint', 'sign', 'verify', 'inspect', 'digest'].includes(action) || !graphFile) {
    die('graph requires lint|sign|verify|inspect|digest <graph.agent-graph.json>')
  }
  const graph = readWorkflow(graphFile)

  if (action === 'sign') {
    if (!flags.publisher) die('graph sign requires --publisher <reverse-dns>')
    const issues = validatePublishableAgentGraph(graph)
    if (issues.length) {
      console.error('agent graph is not publishable:')
      for (const issue of issues) console.error('  - ' + issue)
      process.exit(1)
    }
    const generated = !flags.key
    const key = generated
      ? generateSigningKey()
      : signingKeyFromPrivatePem(_readFileSync(flags.key, 'utf8'))
    const signed = signAgentGraph(graph, key, { publisherId: flags.publisher })
    const out = flags.out || graphFile.replace(/(?:\.signed)?\.agent-graph\.json$/, '') + '.signed.agent-graph.json'
    writeFileSync(out, JSON.stringify(signed, null, 2) + '\n')
    console.log('agent graph:  ' + signed.id + '@' + signed.version)
    console.log('digest:       ' + signed.integrity.digest)
    console.log('publisher:    ' + signed.integrity.publisherId)
    console.log('keyid:        ' + signed.integrity.keyid)
    console.log('wrote:        ' + out)
    if (generated) {
      const keyPath = out + '.key.pem'
      writeFileSync(keyPath, key.privateKeyPem, { mode: 0o600 })
      console.log('signing key:  ' + keyPath + '  (private — keep secret, never publish)')
    } else {
      console.log('signing key:  reused ' + flags.key)
    }
    process.exit(0)
  }

  if (action === 'lint') {
    const issues = flags.publish
      ? validatePublishableAgentGraph(graph)
      : validateAgentGraphStructure(graph)
    if (flags.json) console.log(JSON.stringify({ ok: issues.length === 0, issues }, null, 2))
    else {
      console.log(`ACX Agent Graph: ${graph.name || graph.id} @ ${graph.version || 'unversioned'}`)
      console.log(`  actors=${(graph.actors || []).length} knowledge=${(graph.knowledge || []).length} routes=${(graph.routes || []).length} loops=${(graph.loops || []).length} convergence=${(graph.convergence || []).length}`)
      console.log('verdict: ' + (issues.length ? 'INVALID' : 'VALID ✓ — information architecture is reference-safe'))
      for (const issue of issues) console.log('  - ' + issue)
    }
    process.exit(issues.length ? 1 : 0)
  }

  if (action === 'verify') {
    const registry = flags.registry ? loadTrustRegistry(flags.registry) : emptyTrustRegistry()
    const verification = verifyAgentGraph(graph, { registry })
    const structural = validatePublishableAgentGraph(graph)
    const ok = verification.ok && verification.signed && structural.length === 0
    if (flags.json) console.log(JSON.stringify({ ok, verification, structural: { ok: structural.length === 0, issues: structural } }, null, 2))
    else {
      console.log('status:       ' + verification.status)
      console.log('trust:        ' + verification.trust)
      console.log('digest:       ' + verification.digest)
      console.log('publisher:    ' + (verification.publisherId || '—'))
      console.log('architecture: ' + (structural.length ? 'invalid' : 'publishable ✓'))
      for (const issue of [...verification.issues, ...structural]) console.log('  - ' + issue)
    }
    process.exit(ok ? 0 : 1)
  }

  if (action === 'inspect') {
    const registry = flags.registry ? loadTrustRegistry(flags.registry) : emptyTrustRegistry()
    const card = agentGraphCard(graph, verifyAgentGraph(graph, { registry }))
    if (flags.json) {
      console.log(JSON.stringify(card, null, 2))
    } else {
      console.log(`${card.name} @ ${card.version || 'unversioned'}`)
      console.log(card.description || '(no description)')
      console.log(`  id:            ${card.id}`)
      console.log(`  actors:        ${card.actorCount}`)
      for (const actor of card.actors) console.log(`    - ${actor.id}: ${actor.kind} — ${actor.name}`)
      console.log(`  knowledge:     ${card.knowledgeCount}`)
      for (const item of card.knowledge) console.log(`    - ${item.id}: ${item.kind} — steward=${item.stewards.join(',')}`)
      console.log(`  routes:        ${card.routeCount} (${card.intents.join(', ') || '—'})`)
      for (const route of graph.routes || []) {
        console.log(`    - ${route.from} → ${(route.to || []).join(',')} [${route.intent}/${route.obligation}] carries=${(route.carries || []).join(',')}`)
      }
      console.log(`  loops:         ${card.loopCount}`)
      for (const loop of card.loops) console.log(`    - ${loop.id}: ${loop.workflowId || loop.kind}${loop.digest ? ' ' + loop.digest : ''}`)
      console.log(`  convergence:   ${card.convergenceCount}`)
      for (const point of graph.convergence || []) console.log(`    - ${point.id}: ${(point.inputs || []).map((input) => input.loop).join(' + ')} → ${(point.outputs || []).join(',')} (steward=${point.steward})`)
      console.log(`  license:       ${card.license || '—'}`)
      console.log(`  tags:          ${card.tags.join(', ') || '—'}`)
      console.log(`  digest:        ${card.digest}`)
      console.log(`  signature:     ${card.signed ? card.trust + ' (' + card.status + ')' : 'unsigned'}`)
      if (card.publisher) console.log(`  publisher:     ${card.publisher}`)
    }
    process.exit(0)
  }

  console.log(agentGraphDigest(graph).digest)
  process.exit(0)
}

// ---- share (prepare a verified registry PR) -------------------------------
function cmdShare(positional, flags) {
  const [type, file] = positional
  if (!['agent', 'workflow', 'graph'].includes(type) || !file) {
    die('share requires agent <file.acx>, workflow <file.cal.json>, or graph <file.agent-graph.json>')
  }
  const defaultRegistry = join(process.cwd(), 'registry')
  const registryRoot = flags.registry || (
    existsSync(join(defaultRegistry, 'index.json'))
    && existsSync(join(defaultRegistry, 'status.json'))
      ? defaultRegistry
      : null
  )
  if (!registryRoot) {
    die('share requires --registry <dir> unless the current directory is an ACX checkout root containing registry/index.json and registry/status.json')
  }
  const options = {
    registryRoot,
    publisherId: flags.publisher || null,
    dryRun: !!flags['dry-run'],
    force: !!flags.force,
  }
  if (type === 'agent') {
    options.slug = flags.slug || null
  }
  const plan = type === 'agent'
    ? prepareAgentShare(file, options)
    : type === 'workflow'
      ? prepareWorkflowShare(file, options)
      : prepareAgentGraphShare(file, options)
  console.log(`${plan.dryRun ? 'share plan' : 'share prepared'}: ${plan.type} ${plan.slug}`)
  console.log('publisher:  ' + plan.publisher)
  console.log('artifact:   ' + plan.destination)
  if (plan.readme) console.log('card:       ' + plan.readme)
  console.log('changed:    ' + (plan.changed ? 'yes' : 'no (already current)'))
  console.log('\nSuggested pull-request body:\n')
  console.log(sharePullRequestBody(plan))
  console.log('Next:')
  console.log('  node --experimental-sqlite tools/build-registry-index.mjs')
  console.log('  npm test')
  console.log('  git diff -- registry/')
  console.log(
    plan.readme
      ? 'Review and stage only the intended registry artifact, generated agent card, and registry/index.json.'
      : 'Review and stage only the intended registry artifact and registry/index.json.',
  )
  process.exit(0)
}

// ---- spec -----------------------------------------------------------------
function cmdSpec(positional) {
  const [file] = positional
  if (!file) die('spec requires <file.acx>')
  const cart = Cartridge.open(file, { readonly: true })
  const result = validatePackageSpec(cart)
  const specFile = cart.getFile('rom/package-spec.json')
  cart.close()
  if (specFile) {
    const spec = JSON.parse(specFile.toString('utf8'))
    console.log('package-spec: ' + spec.schemaVersion + '  engine=' + JSON.stringify(spec.embeddingEngine))
    console.log('artifacts:')
    for (const a of spec.artifacts) {
      console.log(`  ${(a.required ? '*' : ' ')} ${a.role.padEnd(16)} ${a.schema.padEnd(28)} ${a.kind}${a.count != null ? ' (' + a.count + ')' : ''}`)
    }
  }
  console.log('\nvalidation: ' + (result.ok ? 'CLEAN ✓' : 'ISSUES'))
  for (const i of result.issues) console.log('  - ' + i)
  process.exit(result.ok ? 0 : 1)
}

// ---- level ----------------------------------------------------------------
function cmdLevel(positional) {
  const [file] = positional
  if (!file) die('level requires <file.acx>')

  const cart = Cartridge.open(file)
  const romDigest = romDigestOf(cart)
  const subjectId = 'urn:acx:cartridge:' + cart.getMeta('acx.cartridge_id')

  // INDEPENDENT verifier: a distinct key/identity from the cartridge publisher (SPEC §10.2).
  const verifierKey = generateSigningKey()
  const issuerDid = 'did:web:verifier.acx.dev'
  const benchmark = demoDagBenchmark()

  console.log('cartridge rom digest: ' + romDigest)
  console.log(`benchmark: ${benchmark.id}@${benchmark.version} (${benchmark.taskCount} tasks, held-out ${benchmark.heldOut.length})`)

  const run = runVerification({
    romDigest, benchmark, competence: 33, drawCount: 90,
    verifierKey, issuerDid, subjectId,
  })

  if (!run.issued) {
    console.log('\nlevel: NOT ISSUED — ' + run.reason)
    console.log(`rating: R=${run.R.toFixed(2)} tier=${run.level.careerTier}`)
    cart.close()
    process.exit(1)
  }

  const vc = run.vc
  console.log('\nlevel: ISSUED')
  console.log(`  acxLevel:  ${run.level.acxLevel}`)
  console.log(`  tier:      ${run.level.careerTier}`)
  console.log(`  rating:    mu=${run.rating.mu.toFixed(2)} sigma=${run.rating.sigma.toFixed(3)} games=${run.rating.gamesPlayed} pass@1=${(run.rating.passRate * 100).toFixed(0)}% R=${run.R.toFixed(2)}`)

  // Independent verification of the credential (proof, no self-issuance, ROM binding).
  const check = verifyLevelCredential(vc, { issuerPublicKeyPem: verifierKey.publicKeyPem, expectedRomDigest: romDigest })
  console.log('  credential verify: ' + (check.ok ? 'VALID' : 'INVALID ' + JSON.stringify(check.issues)))

  // Attach the attestation to the cartridge so `inspect` surfaces it, and bind the
  // verified proficiency onto the matching capability record.
  cart.db.prepare('INSERT INTO attestations(att_id,type,subject_oid,media_type,document,status_url,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(att_id) DO UPDATE SET document=excluded.document,created_at=excluded.created_at')
    .run('level-' + benchmark.id, 'vc-2.0', romDigest, 'application/vc', JSON.stringify(vc), vc.credentialStatus?.statusListCredential ?? null, vc.validFrom)
  // The verified proficiency is DERIVED by resolving this attestation against the
  // ROM digest — the signed ROM capability is NOT mutated (that would break the ROM
  // signature). To ship a cartridge whose capability reads verified=true, the
  // publisher re-exports and re-signs a new version once the attestation exists.
  console.log('  capability build-dag -> resolvable as VERIFIED via attestation (ROM signature left intact)')
  cart.close()

  const vcPath = (file.endsWith('.acx') ? file.slice(0, -4) : file) + '.level-attestation.json'
  writeFileSync(vcPath, JSON.stringify(vc, null, 2))
  console.log('wrote VC: ' + vcPath)
  process.exit(check.ok ? 0 : 1)
}

// ---- dispatch -------------------------------------------------------------
function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  const { positional, flags } = parseArgs(argv.slice(1))
  switch (cmd) {
    case 'version': case '--version': case '-v': return cmdVersion()
    case 'export': return cmdExport(positional, flags)
    case 'inspect': return cmdInspect(positional)
    case 'verify': return cmdVerify(positional, flags)
    case 'strip': return cmdStrip(positional)
    case 'spec': return cmdSpec(positional)
    case 'load': case 'install': case 'activate': return cmdLoad(positional, flags)
    case 'check': case 'doctor': return cmdCheck(positional, flags)
    case 'ls': case 'list': return cmdLs(positional)
    case 'workflow': case 'flow': return cmdWorkflow(positional, flags)
    case 'graph': case 'agent-graph': return cmdAgentGraph(positional, flags)
    case 'cal': return cmdCal(positional, flags)
    case 'lance': return cmdLance(positional, flags)
    case 'init': return cmdInit(positional, flags)
    case 'builder': return void startBuilder(Number(flags.port) || 8799)
    case 'share': return cmdShare(positional, flags)
    case 'level': return cmdLevel(positional)
    case 'help': case '--help': case '-h': case undefined:
      console.log(USAGE); return
    default:
      die(`unknown command: ${cmd}\n\n` + USAGE)
  }
}

try {
  main()
} catch (e) {
  console.error('acx: ' + (e.stack || e.message))
  process.exit(1)
}
