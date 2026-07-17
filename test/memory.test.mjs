// SPEC §7 memory partition: validation, fingerprints, idempotent two-key merge.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  validateRecord, artifactFingerprint, mergeRecords,
  codebaseFingerprint, canonicalRepoIdentity,
} from '../src/memory.mjs'

const base = {
  id: 'm1', title: 'Prefer explicit errors', summary: 'Return typed errors over throwing.',
  sourceType: 'knowledge', repoId: null, projectLabel: 'portable-core',
  timestamp: '2026-01-01T00:00:00Z', impact: 'positive', xpAwarded: 5, tags: ['errors', 'style'],
}

// ── §7.1 validateRecord tier invariants ─────────────────────────────────────
test('§7.1 validateRecord accepts a well-formed portable record', () => {
  assert.equal(validateRecord({ ...base, portable: true, codebaseFingerprint: null, repoId: null }), true)
})

test('§7.1 validateRecord accepts a well-formed field-learned record', () => {
  assert.equal(validateRecord({ ...base, portable: false, codebaseFingerprint: 'cbf1_' + 'a'.repeat(40) }), true)
})

test('§7.1 validateRecord rejects missing boolean portable', () => {
  assert.throws(() => validateRecord({ ...base }), /missing boolean 'portable'/)
})

test('§7.1 validateRecord rejects portable=true with a codebaseFingerprint', () => {
  assert.throws(() => validateRecord({ ...base, portable: true, codebaseFingerprint: 'cbf1_x' }), /requires codebaseFingerprint=null/)
})

test('§7.1 validateRecord rejects portable=true with a repoId', () => {
  assert.throws(() => validateRecord({ ...base, portable: true, codebaseFingerprint: null, repoId: 'repo-x' }), /requires repoId=null/)
})

test('§7.1 validateRecord rejects portable=false without a codebaseFingerprint', () => {
  assert.throws(() => validateRecord({ ...base, portable: false, codebaseFingerprint: null }), /requires a codebaseFingerprint/)
})

// ── §7.3 artifactFingerprint: 10 chars, tier-independent ────────────────────
test('§7.3 artifactFingerprint is exactly 10 hex chars', () => {
  const fp = artifactFingerprint(base)
  assert.equal(fp.length, 10)
  assert.match(fp, /^[0-9a-f]{10}$/)
})

test('§7.3 artifactFingerprint excludes portable + codebaseFingerprint (tier-independent)', () => {
  const portable = artifactFingerprint({ ...base, portable: true, codebaseFingerprint: null })
  const fieldLearned = artifactFingerprint({ ...base, portable: false, codebaseFingerprint: 'cbf1_' + 'e'.repeat(40) })
  assert.equal(portable, fieldLearned, 'fingerprint must not depend on portable/codebaseFingerprint')
})

test('§7.3 artifactFingerprint is stable under tag reordering + case + whitespace', () => {
  const a = artifactFingerprint({ ...base, tags: ['errors', 'style'], title: 'Prefer explicit errors' })
  const b = artifactFingerprint({ ...base, tags: ['STYLE', 'Errors'], title: '  Prefer Explicit Errors  ' })
  assert.equal(a, b)
})

// ── §7.3 two-key idempotent merge ───────────────────────────────────────────
test('§7.3 mergeRecords is idempotent (merge twice == merge once)', () => {
  const A = { ...base, id: '1', title: 'short', summary: 'brief', impact: 'positive', xpAwarded: 5, tags: ['b', 'a'], timestamp: '2026-01-01T00:00:00Z' }
  const A2 = { ...base, id: '1', title: 'a much longer title', summary: 'a far more detailed summary', impact: 'negative', xpAwarded: 10, tags: ['c'], timestamp: '2026-03-03T00:00:00Z' }
  const once = mergeRecords([A], [A2])
  const twice = mergeRecords(mergeRecords([A], [A2]), [A2])
  assert.deepEqual(twice, once)
})

test('§7.3 mergeRecords resolves conflicts: longer text, worse impact, max xp, union tags, latest ts', () => {
  const A = { ...base, id: '1', title: 'short', summary: 'brief', impact: 'positive', xpAwarded: 5, tags: ['b', 'a'], timestamp: '2026-01-01T00:00:00Z' }
  const A2 = { ...base, id: '1', title: 'a much longer title', summary: 'a far more detailed summary text', impact: 'negative', xpAwarded: 10, tags: ['c', 'a'], timestamp: '2026-03-03T00:00:00Z' }
  const [m] = mergeRecords([A], [A2])
  assert.equal(m.title, 'a much longer title', 'longer text wins')
  assert.equal(m.summary, 'a far more detailed summary text')
  assert.equal(m.impact, 'negative', 'worse impact wins')
  assert.equal(m.xpAwarded, 10, 'max xp wins')
  assert.deepEqual(m.tags, ['a', 'b', 'c'], 'tags unioned + sorted')
  assert.equal(m.timestamp, '2026-03-03T00:00:00Z', 'latest timestamp wins')
})

test('§7.3 mergeRecords dedupes by artifactFingerprint across different ids', () => {
  const A = { ...base, id: 'alpha' }
  const B = { ...base, id: 'beta' } // different id, identical identity fields -> same fp
  assert.equal(artifactFingerprint(A), artifactFingerprint(B))
  const merged = mergeRecords([A], [B])
  assert.equal(merged.length, 1, 'records with the same fingerprint collapse to one')
})

test('§7.3 mergeRecords keeps distinct records distinct', () => {
  const A = { ...base, id: 'a', title: 'topic one' }
  const B = { ...base, id: 'b', title: 'topic two' }
  const merged = mergeRecords([A], [B])
  assert.equal(merged.length, 2)
})

// ── §7.2 codebaseFingerprint: never leaks repo name; stable; salt-scoped ────
test('§7.2 codebaseFingerprint never contains the repo name/label', () => {
  const salt = randomBytes(32)
  const cbf = codebaseFingerprint(salt, canonicalRepoIdentity({ originUrl: 'git@github.com:acme/super-secret-repo.git' }))
  assert.match(cbf, /^cbf1_[0-9a-f]{40}$/)
  assert.ok(!cbf.includes('super-secret-repo'))
  assert.ok(!cbf.includes('acme'))
})

test('§7.2 codebaseFingerprint is stable for the same salt + identity', () => {
  const salt = randomBytes(32)
  const id = canonicalRepoIdentity({ originUrl: 'https://github.com/acme/app.git' })
  assert.equal(codebaseFingerprint(salt, id), codebaseFingerprint(salt, id))
})

test('§7.2 codebaseFingerprint differs across installation salts (org quarantine)', () => {
  const id = canonicalRepoIdentity({ originUrl: 'https://github.com/acme/app.git' })
  assert.notEqual(codebaseFingerprint(randomBytes(32), id), codebaseFingerprint(randomBytes(32), id))
})

test('§7.2 codebaseFingerprint rejects a weak (<256-bit) salt', () => {
  assert.throws(() => codebaseFingerprint(randomBytes(16), 'github.com/acme/app'), />= 256 bits/)
})

test('§7.2 canonicalRepoIdentity normalizes scheme/credentials/.git/scp forms equally', () => {
  const a = canonicalRepoIdentity({ originUrl: 'https://github.com/acme/app.git' })
  const b = canonicalRepoIdentity({ originUrl: 'git@github.com:acme/app.git' })
  const c = canonicalRepoIdentity({ originUrl: 'ssh://git@github.com/acme/app/' })
  assert.equal(a, 'github.com/acme/app')
  assert.equal(a, b)
  assert.equal(a, c)
})
