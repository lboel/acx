// PoC: issue a *measured* cartridge level from a real, externally-graded grade card,
// replacing the injected `competence` knob of the reference solver
// (src/level/benchmark.mjs:34) with real per-task outcomes.
//
// The grade card is produced by MemLoci's bridge
// (memloci.eval.prove_cartridge_level) from real SWE-bench/SWE-smith trajectories whose
// `resolved` labels are an EXTERNAL grading authority -- not self-graded. This script
// owns all crypto: it builds a benchmark from the card, plays sigma-gated TrueSkill using
// a solver that returns the real outcomes, uses an INDEPENDENT verifier key, issues a VC
// bound to the cartridge ROM digest, and independently verifies it.
//
// Usage:
//   node scripts/prove-level-from-gradecard.mjs <grade-card.json> [<file.acx>]
//
// Everything the reference `acx level` command does stays identical -- only the source of
// task outcomes changes from `f(romDigest, taskId, competence)` to measured labels.

import { readFileSync } from 'node:fs'
import { Cartridge } from '../src/container.mjs'
import { sha256Hex } from '../src/canonical.mjs'
import { generateSigningKey } from '../src/sign.mjs'
import { makeBenchmark, runVerification } from '../src/level/benchmark.mjs'
import { verifyLevelCredential } from '../src/level/credential.mjs'

const cardPath = process.argv[2]
const acxPath = process.argv[3] ?? 'research-designer.acx'
if (!cardPath) {
  console.error('usage: node scripts/prove-level-from-gradecard.mjs <grade-card.json> [<file.acx>]')
  process.exit(2)
}

const card = JSON.parse(readFileSync(cardPath, 'utf8'))
if (card.schema !== 'acx-grade-card/v1') {
  console.error(`unexpected grade-card schema: ${card.schema}`)
  process.exit(2)
}

// --- real outcome map (fail-closed: a drawn task must have a real grade) -------------
const gradeById = new Map()
for (const t of card.tasks) {
  if (typeof t.passed !== 'boolean') {
    console.error(`task ${t.id}: non-boolean grade -- refusing (fail-closed)`)
    process.exit(2)
  }
  gradeById.set(t.id, t.passed)
}

/**
 * Measured solver: returns the REAL external outcome for the task. `competence` is
 * deliberately ignored -- the level must emerge from measured wins/losses, not a knob.
 * Still ROM-bound in the trajectory hash so the evidence cannot be transplanted.
 */
function measuredSolver(romDigest, task /*, competence */) {
  if (!gradeById.has(task.id)) {
    throw new Error(`no external grade for drawn task ${task.id} (fail-closed)`)
  }
  const passed = gradeById.get(task.id)
  const h = sha256Hex(romDigest + '|' + task.id + '|' + card.provenance.source_digest)
  return { passed, u: null, p: null, trajectoryHash: 'sha256:' + h }
}

// --- build the benchmark from the real tasks -----------------------------------------
const tasks = card.tasks.map((t) => ({ id: t.id, difficulty: t.difficulty, spec: card.benchmark.id }))
const benchmark = makeBenchmark({
  id: card.benchmark.id,
  name: card.benchmark.name,
  version: card.benchmark.version,
  tasks,
  heldOutFraction: 0.6,
  seal: 'swesmith-held-out-' + card.provenance.source_digest.slice(7, 19),
})

// --- open cartridge, get ROM digest, independent verifier key ------------------------
const cart = Cartridge.open(acxPath)
const romDigest = cart.getMeta('acx.rom_manifest_hash')
const subjectId = 'urn:acx:cartridge:' + cart.getMeta('acx.cartridge_id')
const verifierKey = generateSigningKey()          // distinct from the cartridge publisher
const issuerDid = 'did:web:verifier.acx.dev'

console.log('== measured-level verification (real grade card) ==')
console.log('cartridge:            ' + acxPath)
console.log('rom digest:           ' + romDigest)
console.log('benchmark:            ' + benchmark.id + '@' + benchmark.version)
console.log('subject model:        ' + card.provenance.subject_model)
console.log('grading authority:    ' + card.provenance.grading_authority)
console.log('source digest:        ' + card.provenance.source_digest)
console.log(`tasks:                ${benchmark.taskCount} (held-out ${benchmark.heldOut.length}), external resolved-rate ${(card.provenance.resolved_rate * 100).toFixed(1)}%`)

const run = runVerification({
  romDigest,
  benchmark,
  solver: measuredSolver,
  drawCount: Math.min(120, benchmark.heldOut.length),
  verifierKey,
  issuerDid,
  subjectId,
})

if (!run.issued) {
  console.log('\nlevel: NOT ISSUED — ' + run.reason)
  console.log(`rating: R=${run.R.toFixed(2)} tier=${run.level.careerTier}`)
  cart.close()
  process.exit(1)
}

console.log('\nlevel: ISSUED (measured, not injected)')
console.log(`  acxLevel:  ${run.level.acxLevel}`)
console.log(`  tier:      ${run.level.careerTier}`)
console.log(`  rating:    mu=${run.rating.mu.toFixed(2)} sigma=${run.rating.sigma.toFixed(3)} games=${run.rating.gamesPlayed} pass@1=${(run.rating.passRate * 100).toFixed(0)}% R=${run.R.toFixed(2)}`)

const check = verifyLevelCredential(run.vc, { issuerPublicKeyPem: verifierKey.publicKeyPem, expectedRomDigest: romDigest })
console.log('  credential verify:  ' + (check.ok ? 'VALID' : 'INVALID ' + JSON.stringify(check.issues)))

// prove the level is bound to THIS ROM: a mutated digest must be rejected
const tamper = verifyLevelCredential(run.vc, { issuerPublicKeyPem: verifierKey.publicKeyPem, expectedRomDigest: 'sha256:deadbeef' })
console.log('  ROM-transplant check: ' + (tamper.ok ? 'WRONGLY ACCEPTED' : 'correctly REJECTED'))

// --- falsification controls (MemLoci discipline) -------------------------------------
// The level must be a real, monotone function of MEASURED outcomes -- not an artifact of
// the difficulty spread. We conservatively mask real passes to fails (never fails->passes)
// to synthesise weaker agents from the same tasks, and show the issued level drops. An
// agent that resolves nothing must fall to the bottom tier / not issue.
console.log('\n== falsification control: level vs measured pass-rate (mask real passes->fails) ==')
const passIds = card.tasks.filter((t) => t.passed).map((t) => t.id)
function solverAtRate(keepFraction) {
  // deterministically keep the first `keepFraction` of real passes as passes; rest -> fail
  const cut = Math.floor(passIds.length * keepFraction)
  const kept = new Set(passIds.slice(0, cut))
  return (romDigest, task) => {
    const realPass = gradeById.get(task.id) === true
    const passed = realPass && kept.has(task.id)
    return { passed, u: null, p: null, trajectoryHash: 'sha256:' + sha256Hex(romDigest + '|' + task.id + '|ctrl') }
  }
}
for (const frac of [1.0, 0.75, 0.5, 0.25, 0.0]) {
  const r = runVerification({
    romDigest, benchmark, solver: solverAtRate(frac),
    drawCount: Math.min(120, benchmark.heldOut.length), verifierKey, issuerDid, subjectId,
  })
  const tag = r.issued ? `L${r.level.acxLevel} ${r.level.careerTier}` : `NOT ISSUED (${r.reason.split(':')[0]})`
  console.log(`  keep ${(frac * 100).toString().padStart(3)}% of passes -> pass@1 ${(r.rating.passRate * 100).toFixed(0).padStart(3)}%  ->  ${tag}`)
}

cart.close()
process.exit(check.ok && !tamper.ok ? 0 : 1)
