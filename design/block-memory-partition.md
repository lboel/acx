## Memory Partition (normative)

### M-1. Two-tier memory model

Every memory record in an Agent Cartridge (`.acx`) MUST be classified into exactly one of two tiers by the mandatory boolean field `portable`:

- **TRANSFERABLE** (`portable: true`) — codebase-agnostic expertise (patterns, techniques, generalizable post-mortems). It lives in the **ROM zone** (signed, immutable, shareable/sellable). Its `codebaseFingerprint` MUST be `null` and its `repoId` MUST be `null`.
- **FIELD-LEARNED** (`portable: false`) — codebase-specific memory (facts true only of one repository). It lives in the **SAVE zone** (mutable, unsigned) and MUST be namespaced by a non-null `codebaseFingerprint`. It is **quarantined from re-share by default**: on export it MUST be excluded from the bundle unless the exporter passes an explicit `--include-field-learned` consent flag, and even then it MUST NOT re-project onto an importer's codebase (§M-4).

`portable` and `codebaseFingerprint` are the ONLY additions to the AGENTIBUS `AgentMemoryArtifact` shape (`types/game.ts:370`); all other fields are reused verbatim. A record with `portable: true` and a non-null `codebaseFingerprint`, or `portable: false` and a null `codebaseFingerprint`, is malformed and MUST be rejected at import.

### M-2. Codebase fingerprint (stable, privacy-preserving)

`codebaseFingerprint` MUST be `"cbf1_" + HMAC-SHA-256(key = installationSalt, msg = canonicalRepoIdentity)` truncated to the first 40 lowercase hex chars (160 bits). It MUST NOT be, contain, or be derived from the repo name, `repoLabel`, or `projectLabel`.

- `canonicalRepoIdentity` = the git remote `origin` URL normalized to `host + "/" + path`, lowercased, with userinfo/credentials removed, default port removed, and a trailing `.git` stripped. If no remote exists, it MUST fall back to the repository **root-commit SHA** (`git rev-list --max-parents=0 HEAD`), which is stable and reveals no name.
- `installationSalt` is a ≥256-bit random secret held per org/installation, stored outside the bundle and **NEVER exported** (it is not key material for signing; it is a pseudonymization salt). Because the salt is secret, the fingerprint resists dictionary recovery of the repo identity by outsiders; because it is org-scoped, fingerprints are intentionally non-correlatable across orgs — the desired quarantine property.

The fingerprint is stable across machines within one org (same salt + same canonical identity ⇒ same value), satisfying idempotent SAVE-zone namespacing.

### M-3. Idempotent two-key merge (reused verbatim)

Import merge reuses `mergeMemoriesIntoManifest` (`memory-store.ts:942`) unchanged: dedupe first by `id`, then by `artifactFingerprint`.

`artifactFingerprint = sha1( title + summary + sourceType + repoId + projectLabel + timestamp + impact + xpAwarded + tags ).hexdigest()[0:10]` (fields normalized: text trimmed + lowercased, tags lowercased+sorted). Conflict resolution is deterministic and unchanged: **longer** text wins, **worse** impact wins (`negative > neutral > positive`), **max** `xpAwarded`, **union** of tags, latest `timestamp`. The two-key dedupe makes re-import a no-op (`dedupedCount`).

`portable` and `codebaseFingerprint` are deliberately **excluded** from `artifactFingerprint` so a record's content address is stable regardless of tier, and re-tiering never forks a duplicate.

### M-4. Export boundary — strip vs namespace

`memory-records.json` today (`agent-package.ts:500`) dumps `AgentMemoryArtifact[]` including live `repoId`/`repoLabel`/`projectLabel` (e.g. `workspace-example-a1b2`, `sample-app`). The export boundary MUST rewrite every emitted record:

1. For **TRANSFERABLE** records (ROM zone): set `repoId = null`, `codebaseFingerprint = null`, and replace `repoLabel`/`projectLabel` with the fixed sentinel `"portable-core"`. This is a hard **strip** — the origin repo identity is destroyed.
2. For **FIELD-LEARNED** records (SAVE zone, only if `--include-field-learned`): set `repoId = null`, `repoLabel = projectLabel = "field-learned"`, and **retain** the already-pseudonymous `codebaseFingerprint` (namespace). These land in a SAVE-zone table flagged `foreign: true`.

On import, foreign field-learned records MUST remain quarantined under their imported `codebaseFingerprint` and MUST NOT be rewritten to the importer's own fingerprint. Only TRANSFERABLE records are eligible to merge into native memory.

### M-5. Scrub gate (fail-closed, automated)

A scrub gate MUST run on export before signing and MUST scan every string field of every emitted record, every `sqlar` knowledge `.md`, and every skill body. Deny-patterns (case-insensitive) include: PEM private-key headers (`-----BEGIN … PRIVATE KEY-----`), AWS keys (`AKIA[0-9A-Z]{16}`), GitHub tokens (`gh[pousr]_[A-Za-z0-9]{36,}`), Slack tokens (`xox[baprs]-`), Google API keys (`AIza[0-9A-Za-z_-]{35}`), JWTs (`eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`), URI credentials (`://[^/\s:@]+:[^/\s@]+@`), `.env`-style `SECRET|TOKEN|PASSWORD|API_KEY = …` assignments, high-Shannon-entropy blobs (≥4.0 bits/char over ≥20 chars), and absolute home paths (`/Users/<name>`, `/home/<name>`). It MUST also verify no raw `repoId`/`repoLabel`/`projectLabel` literal survives §M-4.

On any secret match the gate MUST **block** the export (non-zero exit) and emit a report of `{file, byteOffset, ruleId}` — secrets are never silently redacted (fail closed). Home paths MAY be auto-namespaced to `~` and re-scanned.

### M-6. Portable baseline + re-indexed vectors

`memory-records.json` (the JSON tier) is the **always-present portable baseline** and is the sole source of truth on import. Vectors are optional, live in SAVE-zone `sqlite-vec` `vec0` tables, and MUST be tagged with the manifest's `embeddingEngine` id (reuse pattern `vectorEngine: 'local-hash-128'`, `memory-store.ts:20`). On import a consumer MUST **re-index** every record from the JSON baseline using its own engine and MUST **discard** foreign vectors — foreign vectors are never trusted. A bundle with vectors but no JSON baseline is invalid.

OCI distribution artifactType is `application/vnd.acx.cartridge.v1`; the JSON baseline and scrub report are the memory layer within it.