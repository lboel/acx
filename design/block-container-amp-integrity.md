## CONTAINER & INTEGRITY (block C)

### C.1 File identity

An Agent Cartridge is a single SQLite ≥3.37 database, filename extension `.acx`, media type `application/vnd.acx.cartridge`. Two header words brand it and MUST be set:

- `PRAGMA application_id = 1094932529;` — magic `0x41435831`, the four ASCII bytes `A C X 1` (`0x41 0x43 0x58 0x31`), stored big-endian at header **offset 68**. `file(1)`/libmagic and a 72-byte range read detect an `.acx` without a page cache.
- `PRAGMA user_version = 16777472;` (`0x01000100`) at **offset 60**. Encoding (big-endian bytes): `[spec_MAJOR][spec_MINOR][vec0_storage_format][flags]`. `spec_MAJOR` bump breaks readers; `spec_MINOR` is additive; `vec0_storage_format` pins the sqlite-vec on-disk format so an importer whose engine differs MUST drop and re-index `vectors`; `flags` bit0 = SAVE zone present.

### C.2 Table schema (DDL verbatim)

```sql
-- Meta. WITHOUT ROWID for deterministic order. JSON-encoded structured values.
CREATE TABLE cartridge (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
) WITHOUT ROWID;
-- Required keys: acx.spec_version, acx.cartridge_id (reverse-DNS + uuid),
-- acx.created_at, acx.embedding_engine (id + dim), acx.rom_manifest_hash,
-- acx.vec0_format, acx.save_codebase_fingerprint (nullable).

-- Skills / SKILL.md / knowledge .md / assets. EXACT stock SQLite Archive schema
-- so `sqlite3 file.acx -A` extracts it. Zone by name prefix: 'rom/...' | 'save/...'.
CREATE TABLE sqlar (
  name TEXT PRIMARY KEY,   -- name of the file
  mode INT,                -- access permissions
  mtime INT,               -- last modification time
  sz INT,                  -- original file size; sz==length(data) => uncompressed
  data BLOB                -- compressed content (Deflate) or raw
);

-- Memory rows. Container-level columns; block MEMORY owns `payload` semantics.
CREATE TABLE memory (
  id                   TEXT PRIMARY KEY NOT NULL,
  zone                 TEXT NOT NULL CHECK (zone IN ('rom','save')),
  artifact_fingerprint TEXT NOT NULL,   -- sha1(title+summary+sourceType+...)[:10]
  codebase_fingerprint TEXT,            -- NULL iff zone='rom'; namespaces SAVE
  payload              TEXT NOT NULL,    -- canonical JSON (RFC 8785) of the artifact
  oid                  TEXT NOT NULL,    -- 'sha256:'||hex(sha256(payload))
  created_at           TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX memory_zone_fp ON memory(zone, artifact_fingerprint);

-- Vectors. Derived, NEVER signed, re-indexed on import. dim from acx.embedding_engine.
CREATE VIRTUAL TABLE vectors USING vec0(
  memory_id TEXT PRIMARY KEY,
  zone TEXT partition key,
  embedding float[384] distance_metric=cosine,
  +artifact_fingerprint TEXT
);

-- Content-address / canonicalization layer that makes signing deterministic.
CREATE TABLE objects (
  oid        TEXT PRIMARY KEY NOT NULL,  -- 'sha256:'||hex(sha256(canonical_bytes))
  kind       TEXT NOT NULL CHECK (kind IN ('sqlar','memory','cartridge','skill','attestation')),
  source_ref TEXT NOT NULL,              -- sqlar name | 'memory:'||id | 'cartridge:'||key
  canon      TEXT NOT NULL,              -- 'raw' (sqlar uncompressed bytes) | 'jcs-rfc8785'
  zone       TEXT NOT NULL CHECK (zone IN ('rom','save')),
  sz         INTEGER NOT NULL
) WITHOUT ROWID;

-- Detached DSSE envelope over the ROM integrity manifest (hash-of-hashes).
CREATE TABLE signatures (
  sig_id        TEXT PRIMARY KEY NOT NULL,
  target        TEXT NOT NULL DEFAULT 'rom-manifest',
  manifest_hash TEXT NOT NULL,           -- 'sha256:...' over ROM objects
  envelope      TEXT NOT NULL,           -- DSSE JSON (payloadType, payload b64, signatures[])
  keyid         TEXT NOT NULL,           -- DSSE keyid = reverse-DNS publisher id
  alg           TEXT NOT NULL DEFAULT 'ed25519',
  created_at    TEXT NOT NULL
) WITHOUT ROWID;

-- VC 2.0 / Open Badge 3.0 / in-toto attestations (the provable level, provenance).
CREATE TABLE attestations (
  att_id      TEXT PRIMARY KEY NOT NULL,
  type        TEXT NOT NULL,             -- 'openbadge-3.0' | 'vc-2.0' | 'in-toto-provenance'
  subject_oid TEXT,                      -- object attested; NULL = whole ROM
  media_type  TEXT NOT NULL,
  document    TEXT NOT NULL,             -- JSON-LD credential or DSSE
  status_url  TEXT,                      -- credentialStatus (revocation)
  created_at  TEXT NOT NULL
) WITHOUT ROWID;
```

### C.3 Integrity — sign a manifest, never the file

The whole-file SHA-256 is **not** stable and MUST NOT be signed. SQLite mutates header/page bytes independent of logical content: the **file change counter** (offset 24, 4 bytes) increments on every unlock-after-write; **version-valid-for** (offset 92) tracks it; **in-header page count** (offset 28); the **freelist trunk pointer / page count** (offsets 32 and 36) shift as rows churn, and freelist reuse yields different physical bytes for identical content; **VACUUM** rewrites every b-tree page and bumps the change counter; **`SQLITE_VERSION_NUMBER`** (offset 96) changes when a different library writes; WAL checkpointing reorders pages. Any SAVE-zone write therefore alters the file digest while the ROM is untouched.

The signed object is the **ROM integrity manifest**: take every row of `objects` where `zone='rom'`, sort ascending by `(kind, source_ref)` under Unicode codepoint order, emit `[{source_ref, oid, canon, sz}, …]`, canonicalize with **RFC 8785 (JCS)**, and `manifest_hash = "sha256:" || hex(sha256(that))`. `canon='raw'` hashes the *uncompressed* sqlar bytes (so Deflate nondeterminism is irrelevant); `canon='jcs-rfc8785'` hashes the canonical-JSON `payload`/`value`. This reproduces AGENTIBUS' `packageHash` hash-of-hashes discipline. The manifest is the DSSE payload (`payloadType: application/vnd.acx.rom-manifest.v1+json`), Ed25519-signed, stored in `signatures.envelope`. Verification recomputes each `oid` from `source_ref`+`canon`, rebuilds the manifest, and checks the DSSE — deterministic and independent of container byte layout.

### C.4 ROM / SAVE boundary and strip-to-ROM re-export

The ROM zone (signed, immutable, shareable) = all of `cartridge` (minus save keys), all `sqlar` under `rom/`, `memory` rows with `zone='rom'`, plus `objects/signatures/attestations`. The SAVE zone (mutable, field-learned, codebase-fingerprinted, unsigned) = `memory` rows with `zone='save'` and `sqlar` under `save/`. `vectors` is derived and outside both signatures. **Strip-to-ROM re-export**: `DELETE FROM memory WHERE zone='save'; DELETE FROM sqlar WHERE name GLOB 'save/*'; DELETE FROM vectors WHERE zone='save'; DELETE FROM objects WHERE zone='save';` clear `acx.save_codebase_fingerprint`, clear flags bit0, `VACUUM;`, then recompute the ROM manifest. The recomputed `manifest_hash` MUST equal the original — proving the ROM was never mutated by field learning; the existing `signatures` row re-verifies unchanged.

### C.5 OCI distribution wrapper

The `.acx` file is pushed as one immutable blob inside an **OCI Image Manifest v1.1.0**:

```json
{
  "schemaVersion": 2,
  "mediaType": "application/vnd.oci.image.manifest.v1+json",
  "artifactType": "application/vnd.acx.cartridge.v1",
  "config": {
    "mediaType": "application/vnd.oci.empty.v1+json",
    "digest": "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    "size": 2
  },
  "layers": [{
    "mediaType": "application/vnd.acx.cartridge.layer.v1+sqlite",
    "digest": "sha256:<digest of the frozen .acx bytes>",
    "size": 0,
    "annotations": {
      "org.opencontainers.image.title": "agent.acx",
      "vnd.acx.rom-manifest-hash": "sha256:…",
      "vnd.acx.spec-version": "1.0.0"
    }
  }]
}
```

Per OCI 1.1.0, top-level `artifactType` MUST be set when `config.mediaType` is the empty value `application/vnd.oci.empty.v1+json` (digest `sha256:44136fa3…aff8a`, size 2). A single layer carries the whole database — no tar, no gzip; the media type `application/vnd.acx.cartridge.layer.v1+sqlite` names it. The layer digest is over the frozen snapshot bytes and guarantees transport integrity of that snapshot only; the DSSE `rom-manifest-hash` guarantees ROM semantics across re-materialization — the two are intentionally distinct. Harness/Gitness `dbPutManifestV2` stores the manifest row, the empty config blob, and the SQLite layer blob byte-for-byte without validating `artifactType`/config/layers, so cartridges distribute with **zero registry change** and verify with stock cosign/oras. The DSSE signature and each VC/Open-Badge attestation SHOULD also be attached as separate referring manifests via the **OCI Referrers API** (`subject` pointing at the cartridge manifest digest), with the `sha256-<digest>` fallback tag mandated where Referrers is unsupported.