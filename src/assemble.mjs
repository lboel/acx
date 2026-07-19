// Finalize a cartridge: register ROM docs -> scrub gate -> build manifest -> sign (SPEC §3.3, §4, §7.5).
import { jcs, oidJcs, sha256Hex } from './canonical.mjs'
import { buildRomManifest, buildStatement, signEnvelope } from './sign.mjs'
import { readMemory } from './memory.mjs'
import { scrub, collectScanItems } from './scrub.mjs'

/** Store a capability record in the ROM zone (table + integrity object). */
export function putCapability(cartridge, rec) {
  const json = jcs(rec)
  const oid = oidJcs(rec)
  cartridge.db.prepare('INSERT INTO capabilities(id,json,content_hash) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json,content_hash=excluded.content_hash')
    .run(rec.id, json, oid)
  cartridge.putObject({ oid, kind: 'cartridge', sourceRef: 'capability:' + rec.id, canon: 'jcs-rfc8785', zone: 'rom', sz: Buffer.byteLength(json) })
  return oid
}

/** Register stable ROM identity meta keys as integrity objects. */
export function bindRomMeta(cartridge, keys) {
  for (const key of keys) {
    const value = cartridge.getMeta(key)
    if (value == null) continue
    const oid = oidJcs({ key, value })
    cartridge.putObject({ oid, kind: 'cartridge', sourceRef: 'cartridge:' + key, canon: 'jcs-rfc8785', zone: 'rom', sz: Buffer.byteLength(value) })
  }
}

/** Derive/refresh the acx_skill index from ROM SKILL.md files (SPEC §5.3). */
export function deriveSkillIndex(cartridge) {
  cartridge.db.exec('DELETE FROM acx_skill')
  for (const name of cartridge.listFiles('rom/skills/')) {
    if (!name.endsWith('/SKILL.md')) continue
    const body = cartridge.getFile(name)
    const fm = parseFrontmatter(body.toString('utf8'))
    const skillDir = name.slice(0, -('/SKILL.md'.length))
    const resources = cartridge.listFiles(skillDir + '/references/')
      .concat(cartridge.listFiles(skillDir + '/scripts/'), cartridge.listFiles(skillDir + '/assets/'))
      .map((p) => ({ path: p, bytes: cartridge.getFile(p).length, sha256: sha256Hex(cartridge.getFile(p)) }))
    cartridge.db.prepare('INSERT INTO acx_skill(sqlar_path,name,description,license,compatibility,skill_version,body_tokens,content_sha256,resources,ext,schema_version) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(sqlar_path) DO UPDATE SET name=excluded.name,description=excluded.description,content_sha256=excluded.content_sha256,resources=excluded.resources')
      .run(name, fm.name ?? '', fm.description ?? '', fm.license ?? null, fm.compatibility ?? null, fm.metadata?.version ?? null,
        Math.ceil(body.length / 4), sha256Hex(body), JSON.stringify(resources), fm.ext ? JSON.stringify(fm.ext) : null, 'acx.skill/1')
  }
}

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  const out = { metadata: {} }
  if (!m) return out
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z-]+):\s*(.*)$/i)
    if (kv) out[kv[1]] = kv[2].trim()
  }
  return out
}

/** Compute a checksum digest over ROM objects (predicate.checksumHash). */
export function romChecksumHash(cartridge) {
  const lines = cartridge.romObjects()
    .map((o) => `${o.oid}  ${o.source_ref}`)
    .sort()
    .join('\n')
  return 'sha256:' + sha256Hex(Buffer.from(lines, 'utf8'))
}

/** Run the fail-closed scrub gate (SPEC §7.5). Throws with a report if blocked. */
export function scrubOrThrow(cartridge, { forbidLiterals = [] } = {}) {
  const records = readMemory(cartridge)
  // Scan EVERY rom/ sqlar entry (scripts, assets, .env, binaries), not just .md/.json (SPEC §7.5).
  const files = cartridge.listFiles('rom/').map((name) => {
    const buf = cartridge.getFile(name)
    // decode as UTF-8; a binary blob still gets byte-pattern-scanned via latin1 fallback
    const text = buf.includes(0) ? buf.toString('latin1') : buf.toString('utf8')
    return { name, text }
  })
  // Also scan capability records (they live in a table, not sqlar).
  const caps = cartridge.db.prepare('SELECT json FROM capabilities').all().map((r) => JSON.parse(r.json))
  const publicMetaKeys = [
    'acx.publisher_id',
    'acx.agent_name',
    'acx.provider',
    'acx.model',
    'acx.role',
    'acx.description',
    'acx.license',
    'acx.authors',
    'acx.tags',
    'acx.homepage',
  ]
  const publicMeta = Object.fromEntries(publicMetaKeys.map((key) => [key, cartridge.getMeta(key)]))
  const items = collectScanItems({
    records: [...records, ...caps, { id: 'public-cartridge-meta', ...publicMeta }],
    files,
  })
  const result = scrub(items, { forbidLiterals })
  if (result.blocked) {
    const err = new Error('scrub gate blocked export: ' + result.findings.filter((f) => f.ruleId !== 'home-path').map((f) => `${f.ruleId}@${f.field}`).join(', '))
    err.findings = result.findings
    throw err
  }
  return result
}

/** Build the ROM manifest, persist rom_manifest_hash, and DSSE-sign it (SPEC §4). */
export function finalizeAndSign(cartridge, key, { publisherId, embeddingEngine, signedAt, provenanceInstanceId }) {
  const manifest = buildRomManifest(cartridge)
  if (manifest.mismatches.length) {
    throw new Error('refusing to sign: ROM object(s) diverge from live content: ' + JSON.stringify(manifest.mismatches))
  }
  cartridge.setMeta('acx.rom_manifest_hash', manifest.manifestHash)
  const checksumHash = romChecksumHash(cartridge)
  const statement = buildStatement({
    manifestHashHex: manifest.manifestHashHex,
    publisherId,
    embeddingEngine,
    signedAt: signedAt ?? new Date().toISOString(),
    cartridgeId: cartridge.getMeta('acx.cartridge_id'),
    checksumHash,
    fileCount: manifest.list.length,
    provenanceInstanceId,
  })
  // Clean DSSE envelope (exactly {payloadType,payload,signatures}); the public key
  // travels in a separate column, never inside the envelope (SPEC §4.2).
  const envelope = signEnvelope(statement, key)
  cartridge.db.prepare('INSERT INTO signatures(sig_id,target,manifest_hash,envelope,keyid,public_key_pem,alg,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(sig_id) DO UPDATE SET manifest_hash=excluded.manifest_hash,envelope=excluded.envelope,keyid=excluded.keyid,public_key_pem=excluded.public_key_pem,created_at=excluded.created_at')
    .run('sig-rom-' + manifest.manifestHashHex.slice(0, 12), 'rom-manifest', manifest.manifestHash, JSON.stringify(envelope), key.keyid, key.publicKeyPem, 'ed25519', statement.predicate.signedAt)
  return { manifest, statement, envelope }
}
