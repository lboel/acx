// Clean, fixed package specification (SPEC §3.6 / §7.7).
// Every cartridge declares its constituent artifacts and their versioned schema
// ids — MCP-style self-describing — and pins a normative LanceDB memory schema
// for the (optional) vector payload. Emitted into the ROM zone and signed.
import { jcs } from './canonical.mjs'

// ---- Normative LanceDB memory table schema (acx.lance-memory/1) ----------
// Fixed columns, snake_case, pinned types. A conforming `.lance` payload MUST use
// exactly these columns; `vector` dimension comes from the embedding engine.
// The JSON baseline (memory-records) is authoritative; the lance table is a
// derived, re-indexable projection (SPEC §7.6) — never signed.
export const LANCE_MEMORY_COLUMNS = [
  { name: 'id', type: 'utf8', nullable: false },
  { name: 'zone', type: 'utf8', nullable: false, enum: ['rom', 'save'] },
  { name: 'portable', type: 'bool', nullable: false },
  { name: 'artifact_fingerprint', type: 'utf8', nullable: false },
  { name: 'codebase_fingerprint', type: 'utf8', nullable: true },
  { name: 'title', type: 'utf8', nullable: false },
  { name: 'summary', type: 'utf8', nullable: false },
  { name: 'source_type', type: 'utf8', nullable: false },
  { name: 'tags', type: 'list<utf8>', nullable: false },
  { name: 'impact', type: 'utf8', nullable: false, enum: ['positive', 'neutral', 'negative'] },
  { name: 'xp_awarded', type: 'int32', nullable: false },
  { name: 'timestamp', type: 'utf8', nullable: false },
  { name: 'text', type: 'utf8', nullable: false }, // the embedded document: title + "\n\n" + summary
  { name: 'vector', type: 'fixed_size_list<float32>', nullable: false, sizeFromEngine: true },
]

/** The normative LanceDB memory schema descriptor for a given embedding engine. */
export function lanceMemorySchema(engine) {
  const dim = engine?.dim ?? 128
  return {
    schemaVersion: 'acx.lance-memory/1',
    format: 'lancedb',
    table: 'memories',
    partitionBy: 'zone',
    distanceMetric: 'cosine',
    embeddingEngine: { id: engine?.id ?? 'local-hash-128', dim },
    // how the JSON baseline projects into this table (SPEC §7.6)
    textTemplate: 'title + "\\n\\n" + summary',
    columns: LANCE_MEMORY_COLUMNS.map((c) => c.sizeFromEngine ? { ...c, type: `fixed_size_list<float32, ${dim}>` } : c),
  }
}

// ---- Package spec (acx.package-spec/1) -----------------------------------
// Enumerates every artifact in the package and its schema id, so a consumer can
// validate a cartridge is cleanly specified without guessing.
export const ARTIFACT_SCHEMAS = {
  identity: 'acx.cartridge-meta/1',
  memoryBaseline: 'acx.memory-record.v1',
  memoryVectors: 'acx.lance-memory/1',
  skills: 'acx.skill/1',
  capabilities: 'acx.capability/1',
  harness: 'acx.harness.v1',
  loopContext: 'acx.loop-context-policy/1.1',
  level: 'acx.level-credential.v1',
  romManifest: 'acx.rom-manifest.v1',
  trust: 'acx.trust-registry.v1',
}

export function buildPackageSpec(cart) {
  const engine = safeJson(cart.getMeta('acx.embedding_engine')) ?? { id: 'local-hash-128', dim: 128 }
  const count = (sql) => cart.db.prepare(sql).get().n
  const memRom = count("SELECT COUNT(*) n FROM memory WHERE zone='rom'")
  const memSave = count("SELECT COUNT(*) n FROM memory WHERE zone='save'")
  const nSkills = count('SELECT COUNT(*) n FROM acx_skill')
  const nCaps = count('SELECT COUNT(*) n FROM capabilities')
  const nAtt = count("SELECT COUNT(*) n FROM attestations WHERE type='vc-2.0'")
  return {
    schemaVersion: 'acx.package-spec/1',
    cartridgeId: cart.getMeta('acx.cartridge_id'),
    specVersion: cart.getMeta('acx.spec_version'),
    embeddingEngine: engine,
    artifacts: [
      { role: 'identity', kind: 'meta', schema: ARTIFACT_SCHEMAS.identity, required: true },
      { role: 'memory-baseline', kind: 'table', table: 'memory', mediaType: 'application/json', schema: ARTIFACT_SCHEMAS.memoryBaseline, required: true, count: memRom + memSave },
      { role: 'memory-vectors', kind: 'lance', path: 'vectors/memories.lance', schema: ARTIFACT_SCHEMAS.memoryVectors, required: false, signed: false, reindexOnImport: true, descriptor: 'rom/schema/lance-memory.json' },
      { role: 'skills', kind: 'sqlar', path: 'rom/skills/', schema: ARTIFACT_SCHEMAS.skills, required: false, count: nSkills },
      { role: 'capabilities', kind: 'table', table: 'capabilities', schema: ARTIFACT_SCHEMAS.capabilities, required: false, count: nCaps },
      { role: 'harness', kind: 'sqlar', path: 'rom/manifest/harness-requirements.json', schema: ARTIFACT_SCHEMAS.harness, required: true },
      { role: 'loop-context', kind: 'sqlar', path: 'rom/policy/loop-context-policy.json', schema: ARTIFACT_SCHEMAS.loopContext, required: true },
      { role: 'level', kind: 'attestation', schema: ARTIFACT_SCHEMAS.level, required: false, count: nAtt },
    ],
  }
}

/** Emit the package spec + lance schema descriptor into the ROM zone (signed). */
export function emitPackageSpec(cart) {
  const engine = safeJson(cart.getMeta('acx.embedding_engine')) ?? { id: 'local-hash-128', dim: 128 }
  cart.putFile('rom/schema/lance-memory.json', Buffer.from(JSON.stringify(lanceMemorySchema(engine), null, 2), 'utf8'))
  cart.putFile('rom/package-spec.json', Buffer.from(JSON.stringify(buildPackageSpec(cart), null, 2), 'utf8'))
  cart.setMeta('acx.package_spec', 'rom/package-spec.json')
  cart.setMeta('acx.lance_schema', 'rom/schema/lance-memory.json')
}

// ---- Validation ----------------------------------------------------------
const MEMORY_REQUIRED = ['id', 'title', 'summary', 'sourceType', 'portable', 'codebaseFingerprint', 'timestamp', 'impact', 'xpAwarded', 'tags', 'artifactFingerprint', 'zone']

/** Structural validation of the JSON memory baseline against acx.memory-record.v1. */
export function validateMemoryRecords(records) {
  const issues = []
  records.forEach((r, i) => {
    for (const f of MEMORY_REQUIRED) if (!(f in r)) issues.push(`record[${i}] missing '${f}'`)
    if (typeof r.portable !== 'boolean') issues.push(`record[${i}].portable not boolean`)
    if (!['positive', 'neutral', 'negative'].includes(r.impact)) issues.push(`record[${i}].impact invalid`)
    if (!['rom', 'save'].includes(r.zone)) issues.push(`record[${i}].zone invalid`)
    if (!Array.isArray(r.tags)) issues.push(`record[${i}].tags not array`)
    if (r.portable && r.codebaseFingerprint != null) issues.push(`record[${i}] portable=true must have null codebaseFingerprint`)
    if (!r.portable && r.codebaseFingerprint == null) issues.push(`record[${i}] portable=false must have a codebaseFingerprint`)
  })
  return issues
}

/** Validate a whole cartridge is cleanly specified: spec present, artifacts exist, memory conforms, lance dim matches. */
export function validatePackageSpec(cart) {
  const issues = []
  const specRaw = cart.getFile('rom/package-spec.json')
  if (!specRaw) return { ok: false, issues: ['missing rom/package-spec.json'] }
  const spec = JSON.parse(specRaw.toString('utf8'))
  if (spec.schemaVersion !== 'acx.package-spec/1') issues.push(`unexpected package-spec version ${spec.schemaVersion}`)

  // memory baseline conforms
  const records = cart.db.prepare('SELECT payload FROM memory').all().map((r) => JSON.parse(r.payload))
  issues.push(...validateMemoryRecords(records))

  // lance descriptor present + dim matches engine
  const lanceRaw = cart.getFile('rom/schema/lance-memory.json')
  const engine = safeJson(cart.getMeta('acx.embedding_engine')) ?? {}
  if (!lanceRaw) issues.push('missing rom/schema/lance-memory.json')
  else {
    const lance = JSON.parse(lanceRaw.toString('utf8'))
    if (lance.embeddingEngine?.dim !== engine.dim) issues.push(`lance schema dim ${lance.embeddingEngine?.dim} != engine dim ${engine.dim}`)
    if (lance.columns?.length !== LANCE_MEMORY_COLUMNS.length) issues.push('lance schema column count drift')
  }

  // required artifacts exist
  for (const a of spec.artifacts) {
    if (!a.required) continue
    if (a.kind === 'sqlar' && a.path && !a.path.endsWith('/') && !cart.getFile(a.path)) issues.push(`required artifact missing: ${a.path}`)
  }
  return { ok: issues.length === 0, issues, spec }
}

function safeJson(s) { try { return JSON.parse(s) } catch { return null } }
