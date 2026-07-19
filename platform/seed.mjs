// Seed the Cartridge Exchange catalog with a varied roster of sample cartridges.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { generateSigningKey } from '../src/sign.mjs'
import { exportPackageToCartridge } from '../src/export.mjs'
import { buildCapability } from '../src/builders.mjs'
import { Cartridge } from '../src/container.mjs'
import { runVerification, demoDagBenchmark } from '../src/level/benchmark.mjs'
import { ensureCatalog, CATALOG_DIR } from './catalog.mjs'

const SEED_SRC = join(new URL('.', import.meta.url).pathname, '.seed-src')

const ROSTER = [
  { name: 'Ada Ridge', publisher: 'io.github.ridgeworks', role: 'devops_engineer', provider: 'claude', model: 'claude-opus-4-8',
    techStack: ['airflow', 'snowflake', 'dbt', 'python'], cap: { taskType: 'build-dag', stack: ['airflow', 'snowflake', 'dbt'], domain: 'infrastructure' },
    mintLevel: 33, topics: ['data engineering', 'pipeline orchestration', 'backfills'] },
  { name: 'Rex Calder', publisher: 'io.github.calder-sec', role: 'security_expert', provider: 'claude', model: 'claude-sonnet-5',
    techStack: ['oauth', 'postgres', 'node'], cap: { taskType: 'harden-security', stack: ['oauth', 'postgres'], domain: 'infrastructure' },
    mintLevel: 24, topics: ['threat modeling', 'authz', 'secrets hygiene'] },
  { name: 'Kit Sørender', publisher: 'io.github.kitworks', role: 'frontend_dev', provider: 'gemini', model: 'gemini-2.5-pro',
    techStack: ['react', 'typescript', 'nuxt'], cap: { taskType: 'implement-feature', stack: ['react', 'typescript'], domain: 'frontend' },
    mintLevel: null, topics: ['component systems', 'a11y'] },
  { name: 'Mia Torres', publisher: 'io.github.miastack', role: 'architect', provider: 'codex', model: 'gpt-5',
    techStack: ['postgres', 'python', 'node'], cap: { taskType: 'design-api', stack: ['postgres'], domain: 'architecture' },
    mintLevel: null, topics: ['api design', 'schema design'] },
]

function writePackage(dir, a) {
  mkdirSync(dir, { recursive: true })
  const manifest = {
    schemaVersion: '1.1', packageVersion: '2.0', exportedAt: '2026-07-16T00:00:00.000Z', exportedFrom: 'agentibus',
    originInstanceId: 'seed', originInstanceLabel: 'seed', agentId: 'seed-' + a.name.toLowerCase().replace(/\W+/g, '-'),
    artifactId: a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    artifactVersion: '1.0.0',
    sourceFingerprint: `${a.provider}:${a.model}:${a.role}:2:${a.techStack.slice(0, 3).join('+')}`,
    name: a.name, provider: a.provider, model: a.model, role: a.role, careerTier: 'mid', level: 6, xp: 0, skillPoints: 2,
    completedProjects: 4, stats: { intelligence: 6, speed: 6, quality: 6, creativity: 6, endurance: 6, teamwork: 6 },
    baseStats: { intelligence: 5, speed: 5, quality: 5, creativity: 5, endurance: 5, teamwork: 5 },
    traits: ['curious'], appearance: { bodyType: 1, skinTone: 1, hairStyle: 3, hairColor: 3, eyeShape: 3, accessories: [], outfitAccent: '#22c55e' },
    topSkills: [], unlockedSkills: [], unlockedSkillCount: 0, memoryRecordCount: 1, memoryTopics: a.topics,
    vectorEngine: 'local-hash-128', portableFormats: ['json'], techStack: a.techStack,
    personality: { communicationStyle: 'direct', codingPhilosophy: ['pragmatic', 'explicit-errors'], knownForIn: a.topics[0] },
    achievements: [],
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(dir, 'memory-records.json'), JSON.stringify([
    { id: 'm1', title: `${a.topics[0]} pattern`, summary: `Reusable approach for ${a.topics[0]} using ${a.techStack.join(', ')}.`, sourceType: 'knowledge', repoId: null, repoLabel: '', projectLabel: '', markdownPath: 'k.md', timestamp: '2026-07-01T00:00:00.000Z', impact: 'positive', xpAwarded: 20, tags: a.topics },
  ], null, 2))
  writeFileSync(join(dir, 'IDENTITY.md'), `# ${a.name}\n\nRole: ${a.role}. Known for ${a.topics[0]}.\n`)
  writeFileSync(join(dir, 'SKILLS.md'), `# Skills\n\n${a.techStack.map((t) => `- ${t}`).join('\n')}\n`)
}

function mintLevel(acxPath, competence) {
  const cart = Cartridge.open(acxPath)
  const romDigest = cart.getMeta('acx.rom_manifest_hash')
  const subjectId = 'urn:acx:cartridge:' + cart.getMeta('acx.cartridge_id')
  const verifierKey = generateSigningKey()
  const benchmark = demoDagBenchmark()
  const run = runVerification({ romDigest, benchmark, competence, drawCount: 90, verifierKey, issuerDid: 'did:web:verifier.acx.dev', subjectId, now: '2026-07-16T00:00:00Z' })
  if (run.issued) {
    cart.db.prepare('INSERT INTO attestations(att_id,type,subject_oid,media_type,document,status_url,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(att_id) DO UPDATE SET document=excluded.document')
      .run('level-' + benchmark.id, 'vc-2.0', romDigest, 'application/vc', JSON.stringify(run.vc), run.vc.credentialStatus?.statusListCredential ?? null, run.vc.validFrom)
  }
  cart.close()
  return run.issued ? `${run.level.careerTier} (Lv.${run.level.acxLevel})` : `not issued (${run.reason})`
}

export function seed() {
  ensureCatalog()
  rmSync(SEED_SRC, { recursive: true, force: true })
  const results = []
  for (const a of ROSTER) {
    const src = join(SEED_SRC, a.name.toLowerCase().replace(/\W+/g, '-'))
    writePackage(src, a)
    const out = join(CATALOG_DIR, a.name.toLowerCase().replace(/\W+/g, '-') + '.acx')
    const key = generateSigningKey()
    const cap = buildCapability({ taskType: a.cap.taskType, stack: a.cap.stack, domain: a.cap.domain, lastDemonstratedAt: '2026-07-16T00:00:00Z' })
    exportPackageToCartridge({ packageDir: src, outPath: out, key, publisherId: a.publisher, installationSalt: randomBytes(32), extraCapabilities: [cap] })
    let lvl = 'declared only'
    if (a.mintLevel) lvl = mintLevel(out, a.mintLevel)
    results.push({ name: a.name, publisher: a.publisher, out, level: lvl })
  }
  rmSync(SEED_SRC, { recursive: true, force: true })
  return results
}

// run directly: node --experimental-sqlite platform/seed.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const r of seed()) console.log(`seeded ${r.name.padEnd(16)} ${r.publisher.padEnd(24)} level=${r.level}`)
}
