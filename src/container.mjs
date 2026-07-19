// The single-file SQLite container (SPEC §3).
// Zero external deps: Node's builtin node:sqlite.
import { DatabaseSync } from 'node:sqlite'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { oidRaw } from './canonical.mjs'

// SPEC §3.1 — file identity.
export const APPLICATION_ID = 1094932529 // 0x41435831 == ASCII "ACX1"
export const USER_VERSION = 16777472 // 0x01000100 == [spec_MAJOR=1][spec_MINOR=0][vec0_format=1][flags=0]
export const SPEC_VERSION = '0.1'
export const FLAG_SAVE_PRESENT = 0x01

// SPEC §3.2 — verbatim DDL. The vec0 virtual table is intentionally replaced
// by a plain, derived, never-signed `vectors` table in this reference impl:
// node:sqlite cannot load the sqlite-vec extension, and the spec (§3.5, §7.6)
// declares vectors derived / never signed / always re-indexed on import, so
// integrity is unaffected. Production hosts SHOULD use `CREATE VIRTUAL TABLE
// vectors USING vec0(...)` templated from acx.embedding_engine.dim.
export const DDL = `
CREATE TABLE IF NOT EXISTS cartridge (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS sqlar (
  name TEXT PRIMARY KEY,
  mode INT, mtime INT,
  sz   INT,
  data BLOB
);

CREATE TABLE IF NOT EXISTS memory (
  id                   TEXT PRIMARY KEY NOT NULL,
  zone                 TEXT NOT NULL CHECK (zone IN ('rom','save')),
  artifact_fingerprint TEXT NOT NULL,
  codebase_fingerprint TEXT,
  payload              TEXT NOT NULL,
  oid                  TEXT NOT NULL,
  created_at           TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS memory_zone_fp ON memory(zone, artifact_fingerprint);

CREATE TABLE IF NOT EXISTS vectors (
  memory_id            TEXT PRIMARY KEY,
  zone                 TEXT NOT NULL,
  embedding            BLOB NOT NULL,
  artifact_fingerprint TEXT
);

CREATE TABLE IF NOT EXISTS objects (
  oid        TEXT PRIMARY KEY NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('sqlar','memory','cartridge','skill','attestation')),
  source_ref TEXT NOT NULL,
  canon      TEXT NOT NULL,
  zone       TEXT NOT NULL CHECK (zone IN ('rom','save')),
  sz         INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS signatures (
  sig_id         TEXT PRIMARY KEY NOT NULL,
  target         TEXT NOT NULL DEFAULT 'rom-manifest',
  manifest_hash  TEXT NOT NULL,
  envelope       TEXT NOT NULL,           -- clean DSSE {payloadType,payload,signatures}
  keyid          TEXT NOT NULL,
  public_key_pem TEXT,                    -- SPKI PEM held OUT of the envelope (self-contained verify)
  alg            TEXT NOT NULL DEFAULT 'ed25519',
  created_at     TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS attestations (
  att_id      TEXT PRIMARY KEY NOT NULL,
  type        TEXT NOT NULL,
  subject_oid TEXT,
  media_type  TEXT NOT NULL,
  document    TEXT NOT NULL,
  status_url  TEXT,
  created_at  TEXT NOT NULL
) WITHOUT ROWID;

-- SPEC §5.3 derived skill index (re-derivable cache; SKILL.md in sqlar is authoritative).
CREATE TABLE IF NOT EXISTS acx_skill (
  sqlar_path     TEXT PRIMARY KEY,   -- authoritative identity (SPEC §5.3); the SKILL.md path
  name           TEXT NOT NULL,      -- frontmatter name (may collide across dirs)
  description    TEXT NOT NULL,
  license        TEXT, compatibility TEXT, skill_version TEXT,
  body_tokens    INTEGER,
  content_sha256 TEXT NOT NULL,
  resources      TEXT NOT NULL,
  ext            TEXT,
  schema_version TEXT NOT NULL
);

-- SPEC §6.1 capability records (ROM zone).
CREATE TABLE IF NOT EXISTS capabilities (
  id           TEXT PRIMARY KEY NOT NULL,
  json         TEXT NOT NULL,
  content_hash TEXT NOT NULL
);
`

export class Cartridge {
  /** @param {DatabaseSync} db */
  constructor(db, path) {
    this.db = db
    this.path = path
  }

  static create(path) {
    const db = new DatabaseSync(path)
    db.exec(`PRAGMA application_id = ${APPLICATION_ID};`)
    db.exec(`PRAGMA user_version = ${USER_VERSION};`)
    db.exec(DDL)
    return new Cartridge(db, path)
  }

  static open(path, { readonly = false } = {}) {
    const db = new DatabaseSync(path, { readOnly: readonly })
    const c = new Cartridge(db, path)
    const appId = db.prepare('PRAGMA application_id').get().application_id
    if (appId !== APPLICATION_ID) {
      throw new Error(`not an .acx cartridge: application_id=0x${(appId >>> 0).toString(16)} (expected 0x41435831)`)
    }
    return c
  }

  close() {
    this.db.close()
  }

  // ---- cartridge meta ---------------------------------------------------
  setMeta(key, value) {
    this.db.prepare('INSERT INTO cartridge(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, String(value))
  }

  getMeta(key) {
    const row = this.db.prepare('SELECT value FROM cartridge WHERE key=?').get(key)
    return row?.value ?? null
  }

  allMeta() {
    const out = {}
    for (const r of this.db.prepare('SELECT key,value FROM cartridge').all()) out[r.key] = r.value
    return out
  }

  // ---- sqlar (skills, markdown, assets) ---------------------------------
  /** Store a file. `name` MUST be prefixed rom/ or save/ (zone by prefix). */
  putFile(name, contentBuf, { mode = 0o644, mtime = 0, compress = true } = {}) {
    const zone = zoneOf(name)
    const raw = Buffer.isBuffer(contentBuf) ? contentBuf : Buffer.from(contentBuf, 'utf8')
    let data = raw
    let sz = raw.length
    if (compress && raw.length > 0) {
      const def = deflateRawSync(raw)
      if (def.length < raw.length) {
        data = def
        // sz != length(data) signals compression (stock sqlar convention)
      }
    }
    this.db.prepare('INSERT INTO sqlar(name,mode,mtime,sz,data) VALUES(?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET mode=excluded.mode,mtime=excluded.mtime,sz=excluded.sz,data=excluded.data')
      .run(name, mode, mtime, sz, data)
    // Register the object for ROM integrity (canon='raw' over UNCOMPRESSED bytes).
    this.putObject({ oid: oidRaw(raw), kind: 'sqlar', sourceRef: name, canon: 'raw', zone, sz: raw.length })
    return raw.length
  }

  /** Read a file's uncompressed bytes. */
  getFile(name) {
    const row = this.db.prepare('SELECT sz,data FROM sqlar WHERE name=?').get(name)
    // Node 22.5's initial node:sqlite implementation represents a missing
    // StatementSync#get() row as an object containing null column values.
    if (!row || row.sz == null || row.data == null) return null
    const data = Buffer.from(row.data)
    if (row.sz === data.length) return data // stored uncompressed
    return inflateRawSync(data)
  }

  listFiles(prefix = '') {
    const rows = prefix
      ? this.db.prepare('SELECT name,sz FROM sqlar WHERE name GLOB ? ORDER BY name').all(prefix + '*')
      : this.db.prepare('SELECT name,sz FROM sqlar ORDER BY name').all()
    return rows.map((r) => r.name)
  }

  // ---- objects (content-addressed integrity units) ----------------------
  putObject({ oid, kind, sourceRef, canon, zone, sz }) {
    this.db.prepare('INSERT INTO objects(oid,kind,source_ref,canon,zone,sz) VALUES(?,?,?,?,?,?) ON CONFLICT(oid) DO UPDATE SET kind=excluded.kind,source_ref=excluded.source_ref,canon=excluded.canon,zone=excluded.zone,sz=excluded.sz')
      .run(oid, kind, sourceRef, canon, zone, sz)
  }

  romObjects() {
    return this.db.prepare("SELECT oid,kind,source_ref,canon,zone,sz FROM objects WHERE zone='rom'").all()
  }

  // ---- transactions -----------------------------------------------------
  tx(fn) {
    this.db.exec('BEGIN')
    try {
      const r = fn()
      this.db.exec('COMMIT')
      return r
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
}

export function zoneOf(name) {
  if (name.startsWith('rom/')) return 'rom'
  if (name.startsWith('save/')) return 'save'
  throw new Error(`sqlar name must be zone-prefixed rom/ or save/: ${name}`)
}
