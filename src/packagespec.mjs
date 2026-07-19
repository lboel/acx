// Clean, fixed package specification (SPEC §3.6 / §7.7).
// Every cartridge declares its constituent artifacts and their versioned schema
// ids — MCP-style self-describing — and pins a normative LanceDB memory schema
// for the (optional) vector payload. Emitted into the ROM zone and signed.
import { oidJcs } from './canonical.mjs'

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
const CAPABILITY_REQUIRED = ['schemaVersion', 'id', 'taskType', 'stack', 'domain', 'proficiency', 'evidenceRefs', 'sampleCount', 'lastDemonstratedAt', 'createdAt', 'updatedAt']
const CAPABILITY_ALLOWED = [...CAPABILITY_REQUIRED, 'license']
const PROFICIENCY_REQUIRED = ['scale', 'mu', 'sigma', 'score', 'confidence', 'verified']
const EVIDENCE_KINDS = new Set(['level-attestation', 'memory-artifact', 'trajectory'])
const CAPABILITY_DOMAINS = new Set(['frontend', 'backend', 'infrastructure', 'testing', 'architecture', 'leadership', 'product'])
const CAPABILITY_ID_RE = /^cap-[0-9a-f]{16}$/
const TASK_TYPE_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*|[a-z0-9.-]+:[a-z0-9]+(?:-[a-z0-9]+)*)$/
const PURL_RE = /^pkg:[a-z0-9.+-]+\/.+/
const SHA256_RE = /^sha256:[0-9a-f]{64}$/
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const PACKAGE_PATH_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const PACKAGE_SPEC_KEYS = ['schemaVersion', 'cartridgeId', 'specVersion', 'embeddingEngine', 'artifacts']
const PACKAGE_ARTIFACT_PROFILES = new Map([
  ['identity', {
    keys: ['role', 'kind', 'schema', 'required'],
    values: { kind: 'meta', schema: ARTIFACT_SCHEMAS.identity, required: true },
  }],
  ['memory-baseline', {
    keys: ['role', 'kind', 'table', 'mediaType', 'schema', 'required', 'count'],
    values: {
      kind: 'table',
      table: 'memory',
      mediaType: 'application/json',
      schema: ARTIFACT_SCHEMAS.memoryBaseline,
      required: true,
    },
    count: true,
  }],
  ['memory-vectors', {
    keys: ['role', 'kind', 'path', 'schema', 'required', 'signed', 'reindexOnImport', 'descriptor'],
    values: {
      kind: 'lance',
      path: 'vectors/memories.lance',
      schema: ARTIFACT_SCHEMAS.memoryVectors,
      required: false,
      signed: false,
      reindexOnImport: true,
      descriptor: 'rom/schema/lance-memory.json',
    },
  }],
  ['skills', {
    keys: ['role', 'kind', 'path', 'schema', 'required', 'count'],
    values: {
      kind: 'sqlar',
      path: 'rom/skills/',
      schema: ARTIFACT_SCHEMAS.skills,
      required: false,
    },
    count: true,
  }],
  ['capabilities', {
    keys: ['role', 'kind', 'table', 'schema', 'required', 'count'],
    values: {
      kind: 'table',
      table: 'capabilities',
      schema: ARTIFACT_SCHEMAS.capabilities,
      required: false,
    },
    count: true,
  }],
  ['harness', {
    keys: ['role', 'kind', 'path', 'schema', 'required'],
    values: {
      kind: 'sqlar',
      path: 'rom/manifest/harness-requirements.json',
      schema: ARTIFACT_SCHEMAS.harness,
      required: true,
    },
  }],
  ['loop-context', {
    keys: ['role', 'kind', 'path', 'schema', 'required'],
    values: {
      kind: 'sqlar',
      path: 'rom/policy/loop-context-policy.json',
      schema: ARTIFACT_SCHEMAS.loopContext,
      required: true,
    },
  }],
  ['level', {
    keys: ['role', 'kind', 'schema', 'required', 'count'],
    values: {
      kind: 'attestation',
      schema: ARTIFACT_SCHEMAS.level,
      required: false,
    },
    count: true,
  }],
])

function record(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function validDateTime(value) {
  return typeof value === 'string' && RFC3339_RE.test(value) && !Number.isNaN(Date.parse(value))
}

function unknownKeys(value, allowed) {
  return record(value) ? Object.keys(value).filter((key) => !allowed.includes(key)) : []
}

export function validPackagePath(value) {
  if (typeof value !== 'string' || value.includes('\\') || value.includes('\0') || value.startsWith('/')) {
    return false
  }
  const segments = value.split('/')
  return segments.length >= 2
    && ['rom', 'save'].includes(segments[0])
    && segments.every((segment) => segment !== '.' && segment !== '..' && PACKAGE_PATH_SEGMENT_RE.test(segment))
}

function validatePackageManifest(spec, cart, issues) {
  for (const key of unknownKeys(spec, PACKAGE_SPEC_KEYS)) {
    issues.push(`package-spec contains unknown field '${key}'`)
  }
  if (spec.cartridgeId !== cart.getMeta('acx.cartridge_id')) {
    issues.push('package-spec cartridgeId does not match cartridge metadata')
  }
  if (spec.specVersion !== cart.getMeta('acx.spec_version')) {
    issues.push('package-spec specVersion does not match cartridge metadata')
  }
  const engine = safeJson(cart.getMeta('acx.embedding_engine'))
  if (
    !record(spec.embeddingEngine)
    || unknownKeys(spec.embeddingEngine, ['id', 'dim']).length
    || spec.embeddingEngine.id !== engine?.id
    || spec.embeddingEngine.dim !== engine?.dim
  ) {
    issues.push('package-spec embeddingEngine does not exactly match cartridge metadata')
  }
  if (!Array.isArray(spec.artifacts)) {
    issues.push('package-spec artifacts must be an array')
    return
  }

  const seen = new Set()
  for (const [index, artifact] of spec.artifacts.entries()) {
    const label = `package-spec artifacts[${index}]`
    if (!record(artifact)) {
      issues.push(`${label} must be an object`)
      continue
    }
    const profile = PACKAGE_ARTIFACT_PROFILES.get(artifact.role)
    if (!profile) {
      issues.push(`${label}.role '${artifact.role || ''}' is not part of acx.package-spec/1`)
      continue
    }
    if (seen.has(artifact.role)) issues.push(`${label}.role '${artifact.role}' is duplicated`)
    seen.add(artifact.role)
    for (const key of unknownKeys(artifact, profile.keys)) {
      issues.push(`${label} contains unknown field '${key}'`)
    }
    for (const key of profile.keys) {
      if (!(key in artifact)) issues.push(`${label} missing '${key}'`)
    }
    for (const [key, expected] of Object.entries(profile.values)) {
      if (artifact[key] !== expected) issues.push(`${label}.${key} must be ${JSON.stringify(expected)}`)
    }
    if (profile.count && (!Number.isInteger(artifact.count) || artifact.count < 0)) {
      issues.push(`${label}.count must be a non-negative integer`)
    }
  }
  for (const role of PACKAGE_ARTIFACT_PROFILES.keys()) {
    if (!seen.has(role)) issues.push(`package-spec is missing artifact role '${role}'`)
  }
}

function parseAttestationReferences(rows, issues) {
  const refs = new Set()
  for (const row of rows) {
    refs.add(row.att_id)
    let vc
    try {
      vc = JSON.parse(row.document)
    } catch (error) {
      issues.push(`attestation '${row.att_id}' document is not valid JSON: ${error.message}`)
      continue
    }
    if (typeof vc?.id === 'string') refs.add(vc.id)
    if (typeof vc?.credentialStatus?.id === 'string') refs.add(vc.credentialStatus.id)
  }
  return refs
}

/** Structural + local-reference validation against acx.capability/1. */
export function validateCapabilityRecords(rows, {
  attestationRows = [],
  memoryArtifactFingerprints = new Set(),
  objectOids = new Set(),
} = {}) {
  const issues = []
  const attestationRefs = parseAttestationReferences(attestationRows, issues)
  for (const [index, row] of rows.entries()) {
    let capability
    try {
      capability = typeof row.json === 'string' ? JSON.parse(row.json) : row
    } catch (error) {
      issues.push(`capability[${index}] JSON cannot be read: ${error.message}`)
      continue
    }
    const label = `capability[${index}]${row.id ? ` '${row.id}'` : ''}`
    if (!record(capability)) {
      issues.push(`${label} must be an object`)
      continue
    }
    for (const field of CAPABILITY_REQUIRED) if (!(field in capability)) issues.push(`${label} missing '${field}'`)
    for (const key of unknownKeys(capability, CAPABILITY_ALLOWED)) issues.push(`${label} contains unknown field '${key}'`)
    if (capability.schemaVersion !== 'acx.capability/1') issues.push(`${label}.schemaVersion must be acx.capability/1`)
    if (!CAPABILITY_ID_RE.test(capability.id || '')) issues.push(`${label}.id is invalid`)
    if (row.id != null && capability.id !== row.id) issues.push(`${label}.id does not match table id '${row.id}'`)
    if (!TASK_TYPE_RE.test(capability.taskType || '')) issues.push(`${label}.taskType is invalid`)
    if (!Array.isArray(capability.stack)) issues.push(`${label}.stack must be an array`)
    else for (const [stackIndex, purl] of capability.stack.entries()) {
      if (typeof purl !== 'string' || !PURL_RE.test(purl)) issues.push(`${label}.stack[${stackIndex}] is not a Package URL`)
    }
    if (!CAPABILITY_DOMAINS.has(capability.domain)) issues.push(`${label}.domain is invalid`)

    const proficiency = capability.proficiency
    if (!record(proficiency)) issues.push(`${label}.proficiency must be an object`)
    else {
      for (const field of PROFICIENCY_REQUIRED) if (!(field in proficiency)) issues.push(`${label}.proficiency missing '${field}'`)
      for (const key of unknownKeys(proficiency, PROFICIENCY_REQUIRED)) issues.push(`${label}.proficiency contains unknown field '${key}'`)
      if (proficiency.scale !== 'acx.proficiency/trueskill-1') issues.push(`${label}.proficiency.scale is invalid`)
      if (typeof proficiency.mu !== 'number' || !Number.isFinite(proficiency.mu)) issues.push(`${label}.proficiency.mu must be finite`)
      if (typeof proficiency.sigma !== 'number' || !Number.isFinite(proficiency.sigma) || proficiency.sigma < 0) issues.push(`${label}.proficiency.sigma must be non-negative`)
      if (typeof proficiency.score !== 'number' || !Number.isFinite(proficiency.score) || proficiency.score < 0 || proficiency.score > 1) issues.push(`${label}.proficiency.score must be between 0 and 1`)
      if (typeof proficiency.confidence !== 'number' || !Number.isFinite(proficiency.confidence) || proficiency.confidence < 0 || proficiency.confidence > 1) issues.push(`${label}.proficiency.confidence must be between 0 and 1`)
      if (typeof proficiency.verified !== 'boolean') issues.push(`${label}.proficiency.verified must be boolean`)
    }

    const evidenceRefs = capability.evidenceRefs
    if (!Array.isArray(evidenceRefs)) issues.push(`${label}.evidenceRefs must be an array`)
    else {
      for (const [evidenceIndex, evidence] of evidenceRefs.entries()) {
        const evidenceLabel = `${label}.evidenceRefs[${evidenceIndex}]`
        if (!record(evidence)) {
          issues.push(`${evidenceLabel} must be an object`)
          continue
        }
        for (const key of unknownKeys(evidence, ['kind', 'ref'])) issues.push(`${evidenceLabel} contains unknown field '${key}'`)
        if (!EVIDENCE_KINDS.has(evidence.kind)) issues.push(`${evidenceLabel}.kind is invalid`)
        if (typeof evidence.ref !== 'string' || !evidence.ref.trim()) {
          issues.push(`${evidenceLabel}.ref must be a non-empty string`)
          continue
        }
        if (evidence.kind === 'level-attestation' && !attestationRefs.has(evidence.ref)) {
          issues.push(`${evidenceLabel} references missing level attestation '${evidence.ref}'`)
        }
        if (evidence.kind === 'memory-artifact' && !memoryArtifactFingerprints.has(evidence.ref)) {
          issues.push(`${evidenceLabel} references missing memory artifact '${evidence.ref}'`)
        }
        if (evidence.kind === 'trajectory' && !SHA256_RE.test(evidence.ref) && !objectOids.has(evidence.ref)) {
          issues.push(`${evidenceLabel}.ref must be an OCI sha256 digest`)
        }
      }
      if (proficiency?.verified === true && !evidenceRefs.some((evidence) => evidence?.kind === 'level-attestation')) {
        issues.push(`${label} claims verified proficiency without level-attestation evidence`)
      }
    }
    if (!Number.isInteger(capability.sampleCount) || capability.sampleCount < 0) issues.push(`${label}.sampleCount must be a non-negative integer`)
    for (const field of ['lastDemonstratedAt', 'createdAt', 'updatedAt']) {
      if (!validDateTime(capability[field])) issues.push(`${label}.${field} must be RFC 3339`)
    }
    if (capability.license != null && (typeof capability.license !== 'string' || !capability.license.trim())) issues.push(`${label}.license must be a non-empty string`)
    if (row.content_hash != null && record(capability) && row.content_hash !== oidJcs(capability)) {
      issues.push(`${label}.content_hash does not match canonical capability JSON`)
    }
  }
  return issues
}

/** Structural validation of the JSON memory baseline against acx.memory-record.v1. */
export function validateMemoryRecords(records) {
  const issues = []
  records.forEach((r, i) => {
    if (!record(r)) {
      issues.push(`record[${i}] must be an object`)
      return
    }
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
  let spec
  try {
    spec = JSON.parse(specRaw.toString('utf8'))
  } catch (error) {
    return { ok: false, issues: [`rom/package-spec.json is not valid JSON: ${error.message}`] }
  }
  if (!record(spec)) return { ok: false, issues: ['rom/package-spec.json must contain an object'] }
  if (spec.schemaVersion !== 'acx.package-spec/1') issues.push(`unexpected package-spec version ${spec.schemaVersion}`)
  validatePackageManifest(spec, cart, issues)

  for (const row of cart.db.prepare('SELECT name FROM sqlar ORDER BY name').all()) {
    if (!validPackagePath(row.name)) issues.push(`sqlar path is unsafe or non-portable: ${row.name}`)
  }

  // memory baseline conforms
  const memoryRows = cart.db.prepare('SELECT id,artifact_fingerprint,payload FROM memory').all()
  const records = []
  for (const row of memoryRows) {
    try {
      records.push(JSON.parse(row.payload))
    } catch (error) {
      issues.push(`memory '${row.id}' payload is not valid JSON: ${error.message}`)
    }
  }
  issues.push(...validateMemoryRecords(records))

  // capability records conform and evidence references resolve locally where
  // the package format defines a local target (attestations and memory).
  const capabilityRows = cart.db.prepare('SELECT id,json,content_hash FROM capabilities ORDER BY id').all()
  const attestationRows = cart.db.prepare("SELECT att_id,document FROM attestations WHERE type='vc-2.0'").all()
  const memoryArtifactFingerprints = new Set(memoryRows.map((row) => row.artifact_fingerprint))
  const objectOids = new Set(cart.db.prepare('SELECT oid FROM objects').all().map((row) => row.oid))
  issues.push(...validateCapabilityRecords(capabilityRows, { attestationRows, memoryArtifactFingerprints, objectOids }))

  // lance descriptor present + dim matches engine
  const lanceRaw = cart.getFile('rom/schema/lance-memory.json')
  const engine = safeJson(cart.getMeta('acx.embedding_engine')) ?? {}
  if (!lanceRaw) issues.push('missing rom/schema/lance-memory.json')
  else {
    let lance
    try {
      lance = JSON.parse(lanceRaw.toString('utf8'))
    } catch (error) {
      issues.push(`rom/schema/lance-memory.json is not valid JSON: ${error.message}`)
    }
    if (lance) {
      if (lance.embeddingEngine?.dim !== engine.dim) issues.push(`lance schema dim ${lance.embeddingEngine?.dim} != engine dim ${engine.dim}`)
      if (lance.columns?.length !== LANCE_MEMORY_COLUMNS.length) issues.push('lance schema column count drift')
    }
  }

  // required artifacts exist
  for (const a of Array.isArray(spec.artifacts) ? spec.artifacts : []) {
    if (!record(a)) {
      continue
    }
    if (!a.required) continue
    if (a.kind === 'sqlar' && a.path && !a.path.endsWith('/') && !cart.getFile(a.path)) issues.push(`required artifact missing: ${a.path}`)
  }
  return { ok: issues.length === 0, issues, spec }
}

function safeJson(s) { try { return JSON.parse(s) } catch { return null } }
