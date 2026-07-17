// Benchmark suite + independent verifier + level issuance (SPEC §10.2, §10.3).
import { createHash } from 'node:crypto'
import { jcs, sha256Hex } from '../canonical.mjs'
import { pae, PAYLOAD_TYPE } from '../sign.mjs'
import { sign as edSign } from 'node:crypto'
import { update, conservative, levelFor, DEFAULT_MU, DEFAULT_SIGMA } from './trueskill.mjs'
import { buildLevelCredential, signCredential } from './credential.mjs'

/**
 * Build a benchmark. Tasks are split into a public slice and a SEALED held-out
 * slice; only the held-out slice's digest is published (SPEC §10.2 step 1).
 */
export function makeBenchmark({ id, name, version, tasks, heldOutFraction = 0.5, seal = 'sealed-key' }) {
  const sorted = [...tasks].sort((a, b) => (a.id < b.id ? -1 : 1))
  const nHeld = Math.floor(sorted.length * heldOutFraction)
  // deterministic held-out selection keyed by a sealed key the verifier holds
  const ranked = sorted
    .map((t) => ({ t, r: sha256Hex(seal + '|' + t.id) }))
    .sort((a, b) => (a.r < b.r ? -1 : 1))
  const heldOut = ranked.slice(0, nHeld).map((x) => x.t)
  const publicSlice = ranked.slice(nHeld).map((x) => x.t)
  const digest = 'sha256:' + sha256Hex(jcs({ id, version, tasks: sorted }))
  const heldOutSliceDigest = 'sha256:' + sha256Hex(jcs(heldOut.map((t) => t.id).sort()))
  return { id, name, version, digest, heldOutSliceDigest, publicSlice, heldOut, seal, taskCount: sorted.length }
}

/**
 * Reference deterministic solver. Success is a pure function of (romDigest, taskId,
 * competence): reproducible for an independent re-run, and bound to the ROM digest so
 * a level cannot be transplanted onto a mutated cartridge (SPEC §10.3). A production
 * verifier replaces this with a real sandboxed agent run whose graded artifacts are
 * pinned by full SHA-256; the surrounding protocol is identical.
 */
export function referenceSolver(romDigest, task, competence) {
  const h = sha256Hex(romDigest + '|' + task.id + '|acx-benchmark-v1')
  const u = parseInt(h.slice(0, 13), 16) / 0x10000000000000 // uniform [0,1)
  const p = 1 / (1 + Math.exp(-0.6 * (competence - task.difficulty)))
  return { passed: u < p, u, p, trajectoryHash: 'sha256:' + h }
}

/**
 * Independent verifier: re-run the pinned ROM on a random held-out subset, play
 * TrueSkill games, gate on sigma<sigmaMax & games>=minGames, and issue a VC.
 * The subset draw is deterministic in (romDigest, benchmark) so a second verifier
 * reproduces it (SPEC §10.2 step 2).
 */
export function runVerification({ romDigest, benchmark, competence, solver = referenceSolver, sigmaMax = 1.5, minGames = 30, drawCount = 50, verifierKey, issuerDid, subjectId, statusListUrl = 'https://acx.dev/status/1', statusIndex = 0, now }) {
  // deterministic draw order over held-out tasks
  const order = benchmark.heldOut
    .map((t) => ({ t, r: sha256Hex(romDigest + '|draw|' + t.id) }))
    .sort((a, b) => (a.r < b.r ? -1 : 1))
    .map((x) => x.t)
  const n = Math.min(drawCount, order.length)

  let rating = { mu: DEFAULT_MU, sigma: DEFAULT_SIGMA }
  let passes = 0
  const evidence = []
  for (let i = 0; i < n; i++) {
    const task = order[i]
    const r = solver(romDigest, task, competence)
    rating = update(rating, task.difficulty, r.passed)
    if (r.passed) passes++
    // content-addressed, verifier-signed trajectory evidence
    const trajectory = { benchmark: benchmark.id, version: benchmark.version, task: task.id, difficulty: task.difficulty, romDigest, passed: r.passed }
    const digest = 'sha256:' + sha256Hex(jcs(trajectory))
    const env = signVerifierEnvelope(trajectory, verifierKey)
    evidence.push({ id: `https://acx.dev/evidence/${benchmark.id}/${task.id}`, type: ['Evidence'], 'acx:digestMultibase': digest, 'acx:dsseEnvelope': env })
  }

  const gamesPlayed = n
  const passRate = passes / n
  const R = conservative(rating)
  const level = levelFor(R)
  const gated = rating.sigma < sigmaMax && gamesPlayed >= minGames

  const ratingOut = { mu: rating.mu, sigma: rating.sigma, gamesPlayed, passRate }

  if (!gated) {
    return { issued: false, reason: `gating failed: sigma=${rating.sigma.toFixed(3)} (<${sigmaMax}?), games=${gamesPlayed} (>=${minGames}?)`, rating: ratingOut, level, R }
  }

  const vcUnsigned = buildLevelCredential({
    issuerDid, subjectId, romDigest, benchmark,
    rating: ratingOut, level, evidence, statusListUrl, statusIndex,
    validFrom: now ?? new Date().toISOString(),
  })
  const vc = signCredential(vcUnsigned, { privateKey: verifierKey.privateKey, verificationMethod: issuerDid + '#key-1', created: now })
  return { issued: true, vc, rating: ratingOut, level, R, passRate }
}

function signVerifierEnvelope(statement, key) {
  const payloadBytes = Buffer.from(jcs(statement), 'utf8')
  const sig = edSign(null, pae(PAYLOAD_TYPE, payloadBytes), key.privateKey)
  return { payloadType: PAYLOAD_TYPE, payload: payloadBytes.toString('base64'), signatures: [{ keyid: key.keyid, sig: sig.toString('base64') }] }
}

/** A small synthetic benchmark for the reference/demo (post-cutoff DAG tasks). */
export function demoDagBenchmark() {
  const tasks = []
  // Difficulties span 15..48 so a mid/senior agent faces INFORMATIVE games
  // (some wins, some losses) that let TrueSkill sigma shrink below the gate.
  for (let i = 0; i < 160; i++) {
    tasks.push({ id: `dag-task-${String(i).padStart(3, '0')}`, difficulty: 15 + (i % 34), spec: `build+backfill a partitioned Airflow DAG, variant ${i}` })
  }
  return makeBenchmark({ id: 'acx-bench-dag-de', name: 'Data-Engineering DAG Construction (Airflow+Snowflake)', version: '2026.07.1', tasks, heldOutFraction: 0.6, seal: 'held-out-sealed-key-7f3a' })
}
