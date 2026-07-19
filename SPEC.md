# The Agent Cartridge (.acx) Open Standard

**Version 0.1 (public draft) — Editor's canonical assembly**
**Status:** Public Draft. Normative where marked with RFC 2119 keywords.
**Media type family:** `application/vnd.acx.*` (RFC 6838 vendor tree)

---

## 1. Abstract & Design Goals

An **Agent Cartridge** (file extension `.acx`) is a single, self-describing SQLite database that packages an AI agent — its skills, capability claims, memory, runtime contract, loop/context policy, and cryptographically provable competence level — into one portable, signable, distributable artifact. Software engineering is the flagship use case, but the format is **task-general**: any agent that has skills, accumulates knowledge, and runs a loop is expressible. The format lets an agent that **learned and leveled up** in one environment be shared, sold, verified, and re-hosted in another with deterministic integrity guarantees and no host lock-in — and lets cartridges **reference each other to form teams and run multi-agent workflows** (§14). An **ACX Workflow** is the complementary, readable `.cal.json` exchange artifact: it carries a team contract, bounded task graph, context requirements, safety declarations, discovery metadata, and an optional cryptographic signature. An **ACX Agent Graph** is a separate, readable `.agent-graph.json` exchange artifact for the team's information architecture (§16): who owns context, who may direct whom, where reports return, and where separate loops meet. The four capabilities the standard is built around are: *learn* (the memory partition, §7), *self-improve / level up* (the provable level, §10), *form teams* (hash-referenced participants, §14, and information architecture, §16), and *build workflows* (Conditional Agentic Loops, §14).

The standard is governed by five design goals:

1. **Portable.** Identity, trust, and behavior bind to a reverse-DNS publisher and a content-addressed manifest — never to a hostname-derived `instanceId`. A cartridge verifies and runs unchanged across machines, orgs, and hosts.
2. **Codebase-agnostic base, but field-learning.** Every memory artifact is partitioned into a **TRANSFERABLE** tier (generalizable expertise, signed, shareable) and a **FIELD-LEARNED** tier (codebase-specific, pseudonymously namespaced, quarantined). An agent keeps learning in the field without contaminating or invalidating its shareable core.
3. **Shareable / sellable.** The immutable **ROM zone** is the shareable/sellable core; the mutable **SAVE zone** holds local learning. A `strip-to-ROM` re-export proves, by hash equality, that field learning never mutated the core.
4. **Provable level.** An agent's level is never self-asserted. It is a W3C Verifiable Credential 2.0 embedding an Open Badges 3.0 achievement, issued by an independent verifier only after held-out re-execution, TrueSkill σ-gated, revocable, and bound to the ROM digest.
5. **Open envelope, priced contents.** The container format, schemas, and descriptive layer are 100% open and unencumbered. The *value* — the signed level attestation, the verified capability evidence, and field-learned memory — is the sellable, revocable, identity-bound asset carried inside a fully open envelope.

The cartridge deliberately reuses AGENTIBUS' proven hash-of-hashes signing discipline, two-key idempotent memory merge, `MissionRule`/`OperatorCommandReport` contracts, `ResourceLimits`, `SkillDomain`/`CareerTier` enums, and the self-describing embedding-engine tag, wrapping them in open standards (SQLite, sqlar, sqlite-vec, OCI, DSSE, in-toto, VC 2.0, Open Badges 3.0, A2A, purl, agentskills.io, MCP) rather than reinventing them.

---

## 2. Terminology & Model

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHOULD**, **SHOULD NOT**, **MAY**, and **OPTIONAL** are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) when, and only when, they appear in all capitals.

- **Cartridge / `.acx`** — a single SQLite ≥ 3.37 database branded with `application_id` = `0x41435831` ("ACX1"), media type `application/vnd.acx.cartridge`.
- **ROM zone** — the signed, immutable, shareable/sellable core: `cartridge` meta (minus SAVE keys), `sqlar` rows under `rom/`, `memory` rows with `zone='rom'`, plus `objects`/`signatures`/`attestations`.
- **SAVE zone** — the mutable, unsigned, codebase-fingerprinted field-learning store: `memory` rows with `zone='save'` and `sqlar` rows under `save/`.
- **Object** — a canonicalized, content-addressed unit (`objects` table) whose `oid = 'sha256:'||hex(sha256(canonical_bytes))`. Objects make signing deterministic independent of physical byte layout.
- **ROM integrity manifest** — the RFC 8785-canonicalized list of ROM objects that is hashed to `manifest_hash` and DSSE/Ed25519-signed. This is the single signed digest; it is **the** `packageHash` of this format (§4).
- **Attestation** — a VC 2.0 / Open Badge 3.0 / in-toto credential attached via the OCI Referrers API, provenance- and level-bearing.
- **Vectors** — derived sqlite-vec embeddings; never signed, re-indexed on import.
- **ACX Workflow / CAL** — a signed or unsigned `.cal.json` task graph that answers **what happens next**:
  participants, executable steps, structured conditions, required context, and termination bounds (§14).
- **ACX Agent Graph** — a signed or unsigned `.agent-graph.json` information architecture that answers
  **who owns context, who can direct whom, where reports return, and where separate loops meet** (§16).
  It is declarative metadata, not an execution plan or permission grant.

**Model.** A cartridge is authored against an exploded directory, materialized as one `.acx` file (working/runtime container), and distributed as one layer inside an OCI Image Manifest (distribution wrapper). ROM is signed once; SAVE mutates locally; vectors are always rebuilt by the consumer.

### 2.1 Referenced standards

ACX incorporates established formats instead of defining private equivalents. The following references are
normative wherever a conformance requirement cites them:

- [RFC 8785 — JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785),
  [RFC 6838 — Media Type Specifications](https://www.rfc-editor.org/rfc/rfc6838), and
  [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12/schema).
- [DSSE Protocol v1.0.2](https://github.com/secure-systems-lab/dsse/blob/master/protocol.md) and
  [in-toto Statement v1](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md).
- [OCI Image Manifest](https://github.com/opencontainers/image-spec/blob/main/manifest.md) and the
  [OCI Distribution Specification](https://github.com/opencontainers/distribution-spec/blob/main/spec.md).
- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/),
  [Open Badges 3.0](https://www.imsglobal.org/spec/ob/v3p0), and
  [ECMA-427 Package URL](https://ecma-international.org/publications-and-standards/standards/ecma-427/).

[A2A 1.0](https://a2a-protocol.org/latest/specification/) and the
[MCP 2025-11-25 specification](https://modelcontextprotocol.io/specification/2025-11-25) are informative
interoperability targets: ACX maps capabilities and tool requirements to them, but does not redefine their
wire protocols.

---

## 3. Container Format (block C — normative)

### 3.1 File identity

An Agent Cartridge **MUST** be a single SQLite ≥ 3.37 database, extension `.acx`, media type `application/vnd.acx.cartridge`. Two header words brand it and **MUST** be set:

- `PRAGMA application_id = 1094932529;` — magic `0x41435831`, the ASCII bytes `A C X 1` (`0x41 0x43 0x58 0x31`), stored big-endian at header **offset 68**. This makes `.acx` detectable by `file(1)`/libmagic from a 72-byte range read without a page cache. `1094932529 < 2^31`, so `PRAGMA application_id` (signed 32-bit) accepts it.
- `PRAGMA user_version = 16777472;` (`0x01000100`) at **offset 60**. Big-endian byte encoding: `[spec_MAJOR][spec_MINOR][vec0_storage_format][flags]`. A `spec_MAJOR` bump breaks readers; `spec_MINOR` is additive; `vec0_storage_format` pins the sqlite-vec on-disk format (an importer whose engine differs **MUST** drop and re-index `vectors`); `flags` bit0 = SAVE zone present.

### 3.2 Table schema (DDL — normative, verbatim)

```sql
CREATE TABLE cartridge (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
) WITHOUT ROWID;
-- Required keys: acx.spec_version, acx.cartridge_id (reverse-DNS + uuid),
-- acx.created_at, acx.embedding_engine (id + dim), acx.rom_manifest_hash,
-- acx.vec0_format, acx.save_codebase_fingerprint (nullable).

CREATE TABLE sqlar (        -- EXACT stock SQLite Archive schema (sqlite3 -A extracts it)
  name TEXT PRIMARY KEY,    -- zone by prefix: 'rom/...' | 'save/...'
  mode INT, mtime INT,
  sz INT,                   -- sz == length(data) => stored uncompressed; else Deflate
  data BLOB
);

CREATE TABLE memory (
  id                   TEXT PRIMARY KEY NOT NULL,
  zone                 TEXT NOT NULL CHECK (zone IN ('rom','save')),
  artifact_fingerprint TEXT NOT NULL,   -- sha1(title+summary+sourceType+...)[:10]
  codebase_fingerprint TEXT,            -- NULL iff zone='rom'
  payload              TEXT NOT NULL,    -- canonical JSON (RFC 8785) of the artifact
  oid                  TEXT NOT NULL,    -- 'sha256:'||hex(sha256(payload))
  created_at           TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX memory_zone_fp ON memory(zone, artifact_fingerprint);

CREATE VIRTUAL TABLE vectors USING vec0(   -- derived, NEVER signed, re-indexed on import
  memory_id TEXT PRIMARY KEY,
  zone TEXT partition key,
  embedding float[384] distance_metric=cosine,   -- dim is a TEMPLATE (see §3.5)
  +artifact_fingerprint TEXT
);

CREATE TABLE objects (
  oid        TEXT PRIMARY KEY NOT NULL,  -- 'sha256:'||hex(sha256(canonical_bytes))
  kind       TEXT NOT NULL CHECK (kind IN ('sqlar','memory','cartridge','skill','attestation')),
  source_ref TEXT NOT NULL,              -- sqlar name | 'memory:'||id | 'cartridge:'||key
  canon      TEXT NOT NULL,              -- 'raw' | 'jcs-rfc8785'
  zone       TEXT NOT NULL CHECK (zone IN ('rom','save')),
  sz         INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE signatures (
  sig_id        TEXT PRIMARY KEY NOT NULL,
  target        TEXT NOT NULL DEFAULT 'rom-manifest',
  manifest_hash TEXT NOT NULL,           -- 'sha256:...' over ROM objects
  envelope      TEXT NOT NULL,           -- DSSE JSON
  keyid         TEXT NOT NULL,           -- see §4 (ed25519:<hex>)
  alg           TEXT NOT NULL DEFAULT 'ed25519',
  created_at    TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE attestations (
  att_id      TEXT PRIMARY KEY NOT NULL,
  type        TEXT NOT NULL,             -- 'openbadge-3.0' | 'vc-2.0' | 'in-toto-provenance'
  subject_oid TEXT,                      -- NULL = whole ROM
  media_type  TEXT NOT NULL,
  document    TEXT NOT NULL,
  status_url  TEXT,
  created_at  TEXT NOT NULL
) WITHOUT ROWID;
```

`sqlar` **MUST** remain byte-for-byte at the stock schema (no zone column) so `sqlite3 file.acx -A` still extracts it; ROM/SAVE zoning for files is carried by the `rom/` vs `save/` name prefix and mirrored in `objects.zone`.

### 3.3 Integrity — sign a manifest, never the file

The whole-file SHA-256 is **not** stable and **MUST NOT** be signed. SQLite mutates header/page bytes independent of logical content: the **file change counter** (offset 24, 4 bytes) increments on every unlock-after-write; **version-valid-for** (offset 92) tracks it; **in-header page count** (offset 28); the **first-freelist-trunk-page** (offset 32) and **total-freelist-pages** (offset 36) shift as rows churn, and freelist reuse yields different physical bytes for identical content; **VACUUM** rewrites every b-tree page and bumps the change counter; **`SQLITE_VERSION_NUMBER`** (offset 96) changes when a different library writes; WAL checkpointing reorders pages. Any SAVE-zone write therefore alters the file digest while the ROM is untouched.

The signed object is the **ROM integrity manifest**: take every `objects` row where `zone='rom'`, sort ascending by `(kind, source_ref)` under Unicode codepoint order, emit `[{sourceRef, oid, canon, sz}, …]`, canonicalize with **RFC 8785 (JCS)**, and set `manifest_hash = "sha256:" || hex(sha256(that))`. `canon='raw'` hashes the *uncompressed* sqlar bytes (Deflate nondeterminism is irrelevant); `canon='jcs-rfc8785'` hashes the canonical-JSON `payload`/`value`. This reproduces AGENTIBUS' `packageHash` hash-of-hashes discipline; `manifest_hash` **is** the ROM `packageHash` (§4). Verification recomputes each `oid` from `source_ref`+`canon`, rebuilds the manifest, and checks the DSSE — deterministic and independent of container byte layout.

### 3.4 ROM / SAVE boundary and strip-to-ROM re-export

**Strip-to-ROM re-export** (proves the ROM was never mutated by field learning):

```sql
DELETE FROM memory  WHERE zone='save';
DELETE FROM sqlar   WHERE name GLOB 'save/*';
DELETE FROM vectors WHERE zone='save';
DELETE FROM objects WHERE zone='save';
-- clear acx.save_codebase_fingerprint; clear flags bit0; VACUUM;
```

The recomputed `manifest_hash` **MUST** equal the original signed hash; the existing `signatures` row re-verifies unchanged. This equality is the machine-checkable proof.

### 3.5 Resolved: the vec0 dimension template

**Contradiction.** The DDL declares `embedding float[384]`, but the reference embedding engine tag is `local-hash-128` (dim 128). **Resolution:** the `vectors` `CREATE VIRTUAL TABLE` is a **template**, not a constant. The dimension **MUST** be taken from `acx.embedding_engine.dim` and templated at authoring time. Because `vectors` is derived, never signed, and rebuilt on import, the concrete dimension is a local materialization detail and does not affect ROM integrity.

---

## 4. Identity, Signing & Trust (block Identity — normative)

### 4.1 Signing core

The AGENTIBUS hash-of-hashes discipline is retained as the integrity core. For an `.acx` file the integrity manifest **MUST** address **ROM-zone objects only**; the SAVE zone **MUST** be excluded so field learning never invalidates the signature. Implementations **MUST NOT** sign raw container bytes. The single signed digest is the ROM `manifest_hash` of §3.3 (equivalently, the ROM `packageHash`). Ed25519 is the default algorithm.

### 4.2 DSSE + in-toto envelope

**Contradiction resolved.** Block C draft-labeled the DSSE `payloadType` as `application/vnd.acx.rom-manifest.v1+json`; block Identity mandates the in-toto constant. **Resolution (binding):** the normative envelope is a **DSSE envelope whose `payloadType` is `application/vnd.in-toto+json`** carrying an **in-toto Statement v1**; the ROM manifest is conveyed inside the Statement's predicate (`predicateType: https://acx.dev/attestation/cartridge/v1`) and its media identity `application/vnd.acx.rom-manifest.v1+json` names the predicate content, not the DSSE payloadType. This keeps stock cosign/oras verification (§11).

The signing input is the DSSE Pre-Authentication Encoding, verbatim:

```
PAE = "DSSEv1" SP LEN(payloadType) SP payloadType SP LEN(payload) SP payload
```

where `payload` is the raw (pre-base64) canonical Statement bytes; `sig = Ed25519(privkey, PAE)`. The envelope **MUST** be:

```json
{
  "payloadType": "application/vnd.in-toto+json",
  "payload": "<base64(canonical-json(Statement))>",
  "signatures": [ { "keyid": "ed25519:af3c…", "sig": "<base64(Ed25519-sig-over-PAE)>" } ]
}
```

Verifiers **MUST** accept either standard or URL-safe base64. The decoded Statement's `subject[0].digest.sha256` **MUST** equal the ROM `manifest_hash`; subjects are matched purely by digest. `predicateType` **MUST** be `https://acx.dev/attestation/cartridge/v1`. The predicate carries `acxSchemaVersion`, `publisherId` (reverse-DNS), `romDigest`, `manifestHash`, `checksumHash`, `fileCount`, `embeddingEngine`, `signedAt`, and an informational `provenanceInstanceId` that **MUST NOT** participate in trust decisions.

**Contradiction resolved (keyid).** Block C said `keyid = reverse-DNS publisher id`; block Identity said `keyid = "ed25519:"+lowercasehex(sha256(DER SubjectPublicKeyInfo))`. **Resolution:** `keyid` **MUST** be `"ed25519:" + lowercasehex(sha256(DER SPKI))` — content-addressed, directly lookupable in the trust registry. It is a hint only; verification **MUST NOT** depend on it beyond registry lookup. The reverse-DNS publisher id lives in `predicate.publisherId` and in the trust-registry entry, not in `keyid`.

### 4.3 Portable publisher identity

Trust binds to `publisherId` + `keyid`, never to the hostname-derived `instanceId`. `publisherId` **MUST** be a reverse-DNS label (`com.example.teamx`, `io.github.alice`). Namespace ownership **MUST** be proven by one of:

- **DNS-TXT challenge** (`com.*`, `org.*`, `net.*`): publisher signs a registry challenge, publishes the public key at `_acx-challenge.<domain>`; the registrar verifies the signature against the TXT-published key. Grants `<domain>/*`.
- **GitHub OIDC** (`io.github.*`): a GitHub Actions OIDC id-token (`id-token: write`, issuer `https://token.actions.githubusercontent.com`) binds `io.github.<user|org>/*` to the workflow subject.

A verified `publisherId` supersedes `originInstanceId`/`signerInstanceId`/`signerInstanceLabel`, which become non-authoritative provenance strings. Reserved-name blocking and full-SHA pinning apply.

### 4.4 Standalone trust registry (public keys only)

This fixes the git-tracked-plaintext-private-key defect: private key material **MUST NEVER** appear in a cartridge, a `signature.json`, or the registry, and **MUST NEVER** be git-tracked. The registry is a separate `schemaVersion:"acx.trust-registry/1"` artifact, published at `https://<domain>/.well-known/acx-trust-registry.json` or as OCI `application/vnd.acx.trust-registry.v1`, carrying public keys only. Each entry carries `keyid`, `publisherId`, `algorithm`, `publicKeyPem` (SPKI), `status` (`active`|`revoked`|`expired`), `notBefore`/`notAfter` (RFC 3339), `namespaceProof`, optional `rotatedFrom`/`rotatedTo`, `revokedAt`/`revocationReason`.

- **Rotation:** a successor sets `rotatedFrom`; the predecessor overlaps until its `notAfter`. Cartridges whose `signedAt` falls within the predecessor's validity remain trusted after rotation.
- **Expiry:** `now > notAfter` ⇒ `status=expired`; verification **MUST NOT** return `trusted`.
- **Revocation:** `revocationReason == "key-compromise"` ⇒ never `trusted`, regardless of `signedAt`. Otherwise a cartridge with `signedAt < revokedAt` **MAY** remain `trusted`; else it downgrades to `portable` with a warning.

### 4.5 Trust taxonomy (verbatim from AGENTIBUS)

The taxonomy `local / trusted / portable / legacy / tampered` is preserved; `AgentPackageVerification` remains the return type. Evaluation order:

1. **tampered** — DSSE fails PAE verification, OR any recomputed ROM object digest ≠ its recorded manifest entry, OR `subject.digest.sha256 ≠ manifest_hash`. Reject.
2. **legacy** — no DSSE envelope; a bare pre-standard `signature.json` verifies against its embedded `publicKeyPem`. Importable at `trust=legacy` with warning.
3. **portable** — DSSE verifies, but `keyid` absent from registry, or `namespaceProof` unverified, or key revoked/expired under §4.4 downgrade. Importable with warning (graceful degradation).
4. **trusted** — DSSE verifies AND `keyid` is `active` AND namespace-proof valid AND not expired/revoked.
5. **local** — as `trusted`, and `keyid` equals the verifying instance's own key.

---

## 5. Skill Bundle (block Skill — normative)

Skills travel wholly in the **ROM zone** (signed, immutable). They are the vendor-neutral, codebase-agnostic capability layer; nothing skill-related lives in SAVE.

### 5.1 Layout

Every skill is a directory rooted at `skills/<name>/`, stored as `sqlar` rows (Deflate; `sz==length(data)` = uncompressed). `<name>` **MUST** equal the frontmatter `name`.

```
skills/<name>/SKILL.md          # REQUIRED
skills/<name>/references/*.md    # OPTIONAL (Level-3)
skills/<name>/scripts/*          # OPTIONAL (Level-3)
skills/<name>/assets/*           # OPTIONAL (Level-3)
```

`sqlite3 cartridge.acx -Ax skills/` **MUST** extract a byte-identical, spec-valid Agent-Skill package installable at `~/.claude/skills/` or any agentskills.io runtime. Reference chains **MUST** stay one level deep from `SKILL.md`.

### 5.2 Frontmatter — agentskills.io, verbatim

`SKILL.md` **MUST** begin with YAML frontmatter containing **only** these six keys; runtimes **MUST** reject unknown top-level keys: `name` (1–64, `^[a-z0-9]+(-[a-z0-9]+)*$`, matches parent dir), `description` (1–1024, what+when), `license` (MAY), `compatibility` (1–500, MAY), `metadata` (map string→string; `metadata.version` SHOULD be SemVer), `allowed-tools` (space-separated, Experimental).

Host-superset fields (Claude Code `context`, `effort`, `hooks`, `model`, `agent`, `when_to_use`, etc.) **MUST NOT** appear as top-level frontmatter keys; they travel in the namespaced extension (§5.4) and are re-projected into frontmatter by a recognizing host at install time.

### 5.3 Skill index — enumerate without unpacking

A host **MUST** be able to list and match skills reading only SQL rows, never inflating a BLOB. One ROM-zone table:

```sql
CREATE TABLE acx_skill (
  name           TEXT PRIMARY KEY,   -- == frontmatter name
  description    TEXT NOT NULL,       -- Level-1 payload (<=1024)
  license        TEXT, compatibility TEXT, skill_version TEXT,
  sqlar_path     TEXT NOT NULL,       -- 'skills/<name>/SKILL.md'
  body_tokens    INTEGER,
  content_sha256 TEXT NOT NULL,       -- sha256 of UNCOMPRESSED SKILL.md bytes
  resources      TEXT NOT NULL,       -- JSON inventory (§5.5)
  ext            TEXT,                -- JSON, namespaced superset (§5.4)
  schema_version TEXT NOT NULL        -- 'acx.skill/1'
);
```

`acx_skill` is a **derived cache**; `SKILL.md` in `sqlar` is authoritative. `content_sha256` **MUST** equal the entry's hash in the ROM integrity manifest, so the ROM signature covers skills transitively. On import a host **MUST** re-derive `acx_skill` and **MUST** reject rows whose `content_sha256` ≠ recomputed hash.

### 5.4 Namespaced host-superset extension

`acx_skill.ext` is a JSON object keyed by **reverse-DNS namespaces**; a host reads only namespaces it recognizes and ignores the rest. Structured values (e.g. `hooks` arrays) are why the superset is not forced into the string-only `metadata` map. At install a host **MAY** merge its recognized namespace's simple keys back into frontmatter, keeping stored `SKILL.md` 100% agentskills.io-valid.

### 5.5 Progressive-disclosure budget

| Level | Loaded | Budget | Location |
|---|---|---|---|
| L1 Metadata | Always, at startup | ~100 tok (`name`+`description`) | `acx_skill` row — no BLOB read |
| L2 Instructions | On activation | < 5000 tok; body < 500 lines | `sqlar` `SKILL.md` |
| L3 Resources | On demand | 0 tok until read | `references/` `scripts/` `assets/` |

`resources` inventories L3 as `[{"path":…,"bytes":…,"sha256":…}]` so material is discoverable and integrity-checkable without inflation. Authors **MUST** move detail beyond the 5000-token body into `references/`.

---

## 6. Capability Records & the Sellable Claim (block Capability — normative)

### 6.1 Purpose and placement

A **CapabilityRecord** asserts "this agent performs well at *taskType* on *stack* for *domain*." Records live in the **ROM zone** in `capabilities(id TEXT PRIMARY KEY, json TEXT, content_hash TEXT)`; each `json` row is covered by the ROM integrity manifest. A record **MUST NOT** be minted from a memory artifact whose `portable` flag is false.

### 6.2 Fields

Every record **MUST** carry `schemaVersion: "acx.capability/1"` and:

- `id` (REQUIRED) — `cap-<sha256_16>` over `sha256(taskType + "|" + sortedStack.join(",") + "|" + domain)`. Deterministic → re-export and two-key idempotent merge reuse the same row.
- `taskType` (REQUIRED) — one token, `^[a-z0-9]+(-[a-z0-9]+)*$`, from the v1 seed vocabulary: `build-dag`, `write-migration`, `design-api`, `implement-feature`, `refactor`, `debug`, `review`, `test-authoring`, `optimize-performance`, `harden-security`, `write-docs`, `deploy`, `incident-response`, `data-modeling`, `schema-design`, `prompt-engineering`, `dependency-upgrade`. Private tokens **MUST** use a reverse-DNS prefix + colon (`dev.acx.x:generate-terraform`). Unknown *seed-shaped* (non-namespaced) tokens **MUST** be rejected on import; namespaced tokens **MUST** be accepted.
- `stack` (REQUIRED, MAY be empty) — normalized **Package URL (purl, ECMA-427)** identifiers, `pkg:type/namespace/name@version?qualifiers#subpath`. Order-insensitive; consumers **MUST** sort before hashing. `airflow`/`Airflow`/`apache-airflow` all normalize to `pkg:pypi/apache-airflow`; services with no package use `pkg:generic/<name>`. Implementations **MUST** ship an alias table and **MUST NOT** invent purl types outside the registered set.
- `domain` (REQUIRED) — one AGENTIBUS `SkillDomain` verbatim: `frontend | backend | infrastructure | testing | architecture | leadership | product`.
- `proficiency` (REQUIRED) — `{ scale: "acx.proficiency/trueskill-1", mu, sigma, score (0..1), confidence (0..1), verified }`. `score` is advisory and **MUST** be treated as unverified unless `verified:true`, permitted **ONLY** when an `evidenceRefs` entry of `kind:"level-attestation"` resolves to a valid, non-revoked VC issued after independent held-out re-run (§10). A consumer **MAY** reject records whose `sigma` exceeds a policy threshold.
- `evidenceRefs` (REQUIRED; non-empty for `verified:true`) — each `{ kind: "level-attestation"|"memory-artifact"|"trajectory", ref }`. Proficiency is only as good as what `evidenceRefs` resolves to.
- `sampleCount` (≥ 0, REQUIRED), `lastDemonstratedAt` (RFC 3339, REQUIRED), `license` (OPTIONAL SPDX expression, default `LicenseRef-acx-proprietary`), `createdAt`/`updatedAt` (REQUIRED).

A `verified:false` record **MAY** be published (self-declared tier) but consumers **MUST** render it as unproven and **MUST NOT** let it satisfy a re-run-gated purchase — preserving the open-envelope / priced-contents split.

### 6.3 A2A AgentCard mapping

A cartridge advertises itself as an A2A agent (Protocol v1.0) by emitting an **AgentCard**. `provider = {organization, url}` from the reverse-DNS identity; `version` = cartridge semver; `signatures` = a JWS over the card; `supportedInterfaces[] = AgentInterface{url, protocolBinding:"JSONRPC", protocolVersion:"1.0"}`.

**One AgentSkill per CapabilityRecord:** `id` ← `CapabilityRecord.id`; `name` ← `"<taskType> · <stack display>"`; `description` ← generated one-liner; `tags` ← `[taskType, domain, ...purl names]`; `examples` ← backing task titles. Because A2A `AgentSkill` has no proficiency/evidence field, the full record **MUST** be attached through `AgentCard.capabilities.extensions[] = AgentExtension{ uri:"https://acx.dev/a2a/ext/capability/v1", required:false, params:{records:[…CapabilityRecord]} }`. Extension-aware consumers read verified proficiency; plain A2A clients still get discoverable skills. Emit JSON camelCase (`securitySchemes`, `security`, `defaultInputModes`) in the well-known `agent-card.json`.

---

## 7. Memory Partition (block Memory — normative)

### 7.1 Two-tier model

Every memory record **MUST** be classified by the mandatory boolean `portable`:

- **TRANSFERABLE** (`portable: true`) — codebase-agnostic; ROM zone; `codebaseFingerprint` **MUST** be `null` and `repoId` **MUST** be `null`.
- **FIELD-LEARNED** (`portable: false`) — codebase-specific; SAVE zone; **MUST** carry a non-null `codebaseFingerprint`. Quarantined from re-share by default: excluded from export unless `--include-field-learned` is passed, and even then **MUST NOT** re-project onto an importer's codebase (§7.4).

`portable` and `codebaseFingerprint` are the ONLY additions to the AGENTIBUS `AgentMemoryArtifact` shape; all other fields are reused verbatim. A record with `portable:true` + non-null fingerprint, or `portable:false` + null fingerprint, is malformed and **MUST** be rejected at import.

### 7.2 Codebase fingerprint (privacy-preserving)

`codebaseFingerprint` **MUST** be `"cbf1_" + HMAC-SHA-256(key=installationSalt, msg=canonicalRepoIdentity)` truncated to the first 40 lowercase hex chars (160 bits). It **MUST NOT** be, contain, or derive from the repo name, `repoLabel`, or `projectLabel`. `canonicalRepoIdentity` = the git `origin` URL normalized to `host + "/" + path`, lowercased, credentials removed, default port removed, trailing `.git` stripped; falling back to the repository root-commit SHA (`git rev-list --max-parents=0 HEAD`) when no remote exists. `installationSalt` is a ≥ 256-bit org-scoped secret held outside the bundle and **NEVER** exported. Secret salt ⇒ dictionary-resistant; org-scoping ⇒ intentionally non-correlatable across orgs (the quarantine boundary). Stable within an org across machines.

### 7.3 Idempotent two-key merge (verbatim)

Import merge reuses `mergeMemoriesIntoManifest` unchanged: dedupe by `id`, then by `artifactFingerprint = sha1(title+summary+sourceType+repoId+projectLabel+timestamp+impact+xpAwarded+tags).hexdigest()[0:10]` (text trimmed+lowercased; tags lowercased+sorted). Deterministic conflict resolution: **longer** text wins, **worse** impact wins (`negative > neutral > positive`), **max** `xpAwarded`, **union** tags, latest `timestamp`. `portable` and `codebaseFingerprint` are **excluded** from `artifactFingerprint`, so a record's content address is tier-independent and re-tiering never forks a duplicate.

**Contradiction noted & resolved (slice length).** Live `shortHash()` slices 12 chars; the binding constraint map and this spec mandate **10**. **Resolution:** the canonical length is **10**; the reference implementation **MUST** re-key existing fingerprints to 10.

### 7.4 Export boundary — strip vs namespace

For **TRANSFERABLE** records (ROM): set `repoId = null`, `codebaseFingerprint = null`, replace `repoLabel`/`projectLabel` with the sentinel `"portable-core"` — a hard strip. For **FIELD-LEARNED** records (SAVE, only with `--include-field-learned`): set `repoId = null`, `repoLabel = projectLabel = "field-learned"`, retain the pseudonymous `codebaseFingerprint`, flag `foreign: true`. On import, foreign field-learned records **MUST** stay quarantined under their imported fingerprint and **MUST NOT** be rewritten to the importer's fingerprint. Only TRANSFERABLE records are eligible to merge into native memory.

### 7.5 Scrub gate (fail-closed)

A scrub gate **MUST** run on export before signing and **MUST** scan every string field of every record, every `sqlar` knowledge `.md`, and every skill body. Deny-patterns (case-insensitive) include: PEM private-key headers (`-----BEGIN … PRIVATE KEY-----`), AWS keys (`AKIA[0-9A-Z]{16}`), GitHub tokens (`gh[pousr]_[A-Za-z0-9]{36,}`), Slack tokens (`xox[baprs]-`), Google API keys (`AIza[0-9A-Za-z_-]{35}`), JWTs (`eyJ[…]\.[…]\.[…]`), URI credentials (`://[^/\s:@]+:[^/\s@]+@`), `.env`-style `SECRET|TOKEN|PASSWORD|API_KEY = …`, high-entropy blobs (≥ 4.0 bits/char over ≥ 20 chars), and local home paths (`/Users/<name>`, `/home/<name>`, `C:\Users\<name>`, or `~/…`). It **MUST** also verify no raw `repoId`/`repoLabel`/`projectLabel` literal survives §7.4. On any secret match the gate **MUST** block export (non-zero exit) with a `{file, byteOffset, ruleId}` report — secrets are never silently redacted. Home paths **MAY** be replaced with an environment-independent relative locator and re-scanned.

### 7.6 Portable baseline + re-indexed vectors

`memory-records.json` (the canonical-JSON projection of `memory` rows) is the **always-present portable baseline** and the sole source of truth on import. Vectors are optional, live in SAVE-zone `vec0` tables, and **MUST** be tagged with the manifest's `embeddingEngine` id. On import a consumer **MUST** re-index every record from the JSON baseline using its own engine and **MUST** discard foreign vectors. A bundle with vectors but no JSON baseline is invalid.

---

### 7.7 Clean package specification & the LanceDB memory schema (normative, additive)

A cartridge **MUST** be *cleanly specified*: it carries a **package spec**
(`rom/package-spec.json`, `schemaVersion: "acx.package-spec/1"`, ROM-signed) that enumerates every
constituent artifact and its versioned schema id, in the self-describing, versioned style of MCP tool
declarations. Each entry is `{role, kind, schema, required, …}` where `schema` is one of the registered
ids (`acx.cartridge-meta/1`, `acx.memory-record.v1`, `acx.lance-memory/1`, `acx.skill/1`,
`acx.capability/1`, `acx.harness.v1`, `acx.loop-context-policy/1.1`, `acx.level-credential.v1`). A
consumer **MUST** be able to validate that every `required` artifact is present and conforms to its
schema without guessing (`acx spec <file>` does exactly this).

The optional vector payload has a **fixed, normative LanceDB schema**, `acx.lance-memory/1`, pinned in
`rom/schema/lance-memory.json` (ROM-signed) and pointed to by `acx.lance_schema`. The `memories` table
**MUST** use exactly these columns: `id, zone, portable, artifact_fingerprint, codebase_fingerprint,
title, summary, source_type, tags (list<utf8>), impact, xp_awarded, timestamp, text,
vector (fixed_size_list<float32, dim>)`, partitioned by `zone`, distance metric `cosine`, with the
embedding-engine id + `dim` in table metadata. `text` is the embedded document (`title + "\n\n" +
summary`); `vector` is `engine(text)`. The JSON memory baseline (§7.6) remains authoritative; the
LanceDB table is a **derived, re-indexable projection** that is **never signed** and **MUST** be rebuilt
on import against the consumer's own engine. Because the columns map 1:1 to `acx.memory-record.v1`, a
host can materialize the `.lance` payload deterministically, and a git-based registry can ship the
`.lance` file alongside the JSON baseline without ambiguity.

> The zero-dependency CLI core ships the JSON baseline plus the pinned `acx.lance-memory/1` descriptor
> and validator. `acx lance` (an optional tool that adds a single dependency, `pylance`) materializes a
> **genuine LanceDB dataset** with this exact schema — 128-d `local-hash-128` vectors computed by
> `src/embed.mjs` (`acx.embed/local-hash-128/1`) — and embeds it in the cartridge SAVE zone at
> `save/vectors/memories.lance/` (unsigned, so it never affects the ROM signature), leaving a standalone
> `<file>.memories.lance/` dataset alongside. The vectors are byte-reproducible, so any LanceDB runtime
> (e.g. the AGENTIBUS studio) reads the same dataset.

The embedding is defined as `acx.embed/local-hash-128/1`: `text = title + "\n\n" + summary`;
tokenize on `[a-z0-9]+` after lowercasing; for each token `h = sha1(token)`, add
`(h[4] & 1 ? +1 : -1)` at dimension `uint32be(h[0..4]) % 128`; L2-normalize. This is deterministic and
identical in JS and Python, so the materialized `vector` column matches on-import re-indexing.

---

## 8. Harness Requirements (block Harness — normative)

### 8.1 Placement

A cartridge **MUST** embed exactly one **harness-requirements manifest** at `sqlar` path `manifest/harness-requirements.json`, media type `application/vnd.acx.harness-requirements.v1+json`, `schemaVersion: "acx.harness.v1"`, ROM-zone, covered by the ROM integrity manifest. A host **MUST** refuse activation if it fails signature verification or its `schemaVersion` is unrecognized.

### 8.2 Tool-role contracts

Each tool is a **tool-role contract** reusing the AGENTIBUS `McpToolDefinition` shape verbatim — `{name, description, inputSchema}` (inputSchema a raw JSON Schema, default draft 2020-12 per MCP) — plus:

- `role` — a stable canonical id in the `acx:` namespace (e.g. `acx:execute`). Authored ROM content invokes tools by `role`, never by host-specific name (resolves the "bare tool name is not portable" tension). The host maps one concrete tool onto each role at handshake time.
- `tier` — `"required"` | `"optional"`.
- `capabilityScopes` — one or more scope tokens the bound tool **MUST** be permitted to exercise.

### 8.3 Capability-scope vocabulary

Closed set (extensible only under a vendor `x-` prefix): `exec`, `dispatch`, `memory.write`, `memory.read`, `search`, `knowledge.write`, `fs.read`, `fs.write`, `net.fetch`.

### 8.4 Required minimal contract vs optional inventory

The **required minimal contract** is exactly four roles; absence of ANY one **MUST** cause refusal:

- `acx:execute` — scopes `["exec"]` (may add `fs.read`): run commands/code in a sandbox, returning the MCP `content:[{type:"text",text}]` envelope.
- `acx:dispatch` — scope `["dispatch"]`: spawn/route a sub-agent unit of work.
- `acx:memory.write` — scope `["memory.write"]`: append a durable SAVE-zone record (ref tool `agentibus_add_memory`).
- `acx:search` — scopes `["search","memory.read"]`: retrieval over memory + knowledge (ref tool `agentibus_search_memory`).

Read-only inventory tools (`agentibus_list_agents`, `agentibus_list_repos`, `agentibus_project_status`, `agentibus_portfolio_overview`) **MUST** be `tier:"optional"`; their absence **MUST NOT** block activation, and the cartridge **MUST** run degraded when they are unbound.

### 8.5 Host compliance descriptor & negotiation

A host **MUST** produce a **compliance descriptor** (`application/vnd.acx.harness-compliance.v1+json`, `schemaVersion:"acx.harness.compliance.v1"`) carrying `requirementsHash` (`sha256:` of the exact manifest, binding descriptor to manifest), `protocolRevision`, `model` facts (`toolUse`, `contextWindowTokens`, `structuredOutput`), a `bindings[]` array (`{role, boundTool, scopesGranted[], satisfied}`), granted filesystem/network scopes, a `verdict` (`accept`|`refuse`), and an `unmet[]` list.

Handshake: (1) host reads & signature-verifies the manifest; (2) performs MCP `initialize`; (3) for each role binds a concrete tool whose advertised `inputSchema` is **structurally accepting** of the contract `inputSchema` (every contract-`required` property present and type-compatible) and whose granted scopes ⊇ `capabilityScopes`; (4) sets `verdict:"refuse"` if any holds — negotiated `protocolRevision < mcp.minProtocolRevision`; `model.toolUse` required but false; `contextWindowTokens < model.minContextWindowTokens`; any required role unbound/scope-denied; any required fs/net scope denied. (5) On refusal the host **MUST NOT** activate the ROM and **MUST NOT** mutate the SAVE zone; it **MUST** emit the descriptor and a JSON-RPC error reusing MCP's exact form: `code -32602`, `message "Unsupported harness"`, `data:{unmet, supported, requested}`. (6) The cartridge **MUST** carry a preflight self-check that aborts activation if the persisted descriptor shows any required binding with `satisfied:false`.

### 8.6 Floors, not versions

`mcp.minProtocolRevision` is a **floor** — the oldest MCP revision exposing `initialize` capability negotiation, `tools/list`/`tools/call`, and `inputSchema`, first available `2024-11-05`. `mcp.preferredProtocolRevision` SHOULD name the current revision, `2025-11-25` (as of 2026-07-16; `2026-07-28` is a locked release candidate, not final). Structured `outputSchema`-validated returns (MCP ≥ `2025-06-18`) SHOULD be requested for `acx:search` but **MUST** remain optional. `model.minContextWindowTokens` is an integer token floor and **MUST NOT** be a model id.

---

## 9. Loop Policy & Context Policy (block Loop — normative)

### 9.1 Location & integrity

Every cartridge **MUST** carry exactly one **Loop + Context Policy** document in the ROM zone, `sqlar` name `rom/policy/loop-context-policy.json`, media type `application/vnd.acx.loop-context-policy.v1+json`, listed in the ROM integrity manifest and covered by the DSSE signature. Hosts **MUST NOT** mutate it at runtime; field-learned rule additions **MUST** be written to a SAVE-zone overlay `save/policy/rule-overlay.json`. It **MUST** declare `schemaVersion: "acx.loop-context-policy/1"`; an unrecognized `schemaVersion` **MUST** be rejected. This turns hardcoded `buildMissionRules()`/routing/guardrail TypeScript into data; hosts **MUST** evaluate it as data without recompilation.

### 9.2 Loop policy (`loop`)

- `maxTurns` (integer ≥ 1, REQUIRED) — hard ceiling; maps 1:1 to Agent SDK `maxTurns`.
- `cycle` (REQUIRED) — ordered subset of `["gather_context","act","verify"]`; `verify` SHOULD be present, and a cartridge that omits it **MUST** justify in `hints`.
- `verification` — `{commands[], maxAttempts, scope:"touched"|"all", passIntent, blockOnFailure}`. `passIntent` is prose ("lint+types+touched tests green"), never a scored threshold.
- `stopConditions` (REQUIRED, ≥ 1) — `{when, action}`; `when ∈ {completed, pr_ready, blocked, max_turns, guardrail_stop, budget_exhausted, needs_input}`; `action ∈ {stop, handoff, await_human, report_continue}`. `guardrail_stop` fires on a `MissionGuardrailSignal` of kind `stop`; `blocked` on kind `blocked`.
- `handoff` — `{emits:"OperatorCommandReport", returnWindows ⊆ {phase_exit, blocker, pr_ready, ambiguity, destructive_change}}`. On any terminating condition with `action ∈ {handoff, await_human}` the loop **MUST** emit exactly one `OperatorCommandReport`.
- `subAgents` — reuses the Agent SDK `AgentDefinition` triple as `{id, description, promptRef, tools[], maxTurns?, retrieval?, contextReturnBudgetTokens?, concurrency}`. Sub-agents **MUST** return a single condensed summary (`contextReturnBudgetTokens` SHOULD default 1000–2000). Per Cognition ("Actions carry implicit decisions"), sub-agents that write or make design decisions **MUST** default `concurrency:"single_threaded"`; only read-only fan-out **MAY** set `parallel`.

### 9.3 Context policy (`context`)

- `retrieval` (REQUIRED) — `just_in_time | preload | hybrid`.
- `identifierKinds` — for `just_in_time`, `{file_path, stored_query, web_link, memory_ref, symbol}`.
- `compaction` — expressed strictly as **intent**: `{preserve[], discard[], targetTokenBudget}` over the fixed `ContextCategory` vocabulary (`architectural_decisions`, `unresolved_bugs`, `implementation_details`, `user_intent`, `task_state`, `tool_output`, `redundant_output`, `file_contents`). `targetTokenBudget` is a target, not a trigger. The cartridge **MUST NOT** specify a summarization algorithm.
- `toolResultTruncation` — intent knobs `{maxTokens?, keepLastN?, headBytes?, tailBytes?}`; **MUST NOT** reference any vendor strategy identifier.
- `memoryFiles` — CLAUDE.md-style note-taking references.
- `embeddingEngineId` (REQUIRED) — consumers **MUST** re-index against their own engine and **MUST NOT** trust foreign vectors; the JSON baseline is authoritative.

### 9.4 Rules & outcome contracts (verbatim)

- `rules` — `MissionRule[]` verbatim: `{id, category ∈ {question,checkpoint,devtools,quality,coordination}, title, trigger, action, severity ∈ {info,warn,critical}}`. (The full 6-field interface incl. `title` is kept; dropping `title` would fork the schema.)
- `guardrailContract.signalKinds` — `milestone | checkpoint | question | blocked | stop`.
- `guardrailContract.outcomeReport` — **MUST** be `"OperatorCommandReport"`; the terminal outcome **MUST** conform verbatim (`outcome ∈ {progressed,completed,blocked,handoff,needs-input}`, `quality`, `confidence`, `artifacts[]`, `learnings[]`, `blockers[]`, `nextAction`, `recommendedFollowUp`, `userAttentionRequired`).

### 9.5 Budget & opaque hints

- `budget` — OPTIONAL, reuses `ResourceLimits` verbatim (`tokenSpend`, `concurrency`, `timeouts`, `killSwitch`) as cartridge-authored **defaults**. At runtime the host's `meta/game/resource-limits.yaml` **MUST** take precedence; enforcement order is host policy > cartridge default, so a shared cartridge can never raise a consuming org's ceilings.
- `hints` — opaque, model-specific. Hosts **MUST** be able to ignore every field under `hints` and still run a conformant loop, and no field under `hints` may alter the §9.4 outcome contracts. Reasoning/`effort` scales, KV-cache/prefix-stability signals, the summarization algorithm, and any vendor context-editing strategy id or numeric token trigger (e.g. Anthropic `clear_tool_uses_20250919`, `compact_20260112`, beta header `context-management-2025-06-27`) **MUST** appear only here. A host **MAY** map `context.compaction` intent onto such a mechanism, but that mapping is host-side and non-portable.

### 9.6 Harness-engineering alignment (v1.1, informative + additive)

The v1.1 policy incorporates Lilian Weng, *"Harness Engineering for Self-Improvement"* (2026-07-04),
which frames a **harness** as "the system surrounding a base model that orchestrates execution and
decides how the model thinks and plans, calls tools and acts, perceives and manages context, stores
artifacts, and evaluates results" — i.e. exactly the object an `.acx` cartridge makes portable and
signable. Additive fields (a v1 reader ignores unknown keys; `schemaVersion` becomes
`acx.loop-context-policy/1.1`):

- `loop.cycle` MAY include `plan` and `reflect` in addition to `gather_context`/`act`/`verify`,
  matching her canonical loop "plan, execute, observe/test, improve, and execute again until the
  goal is achieved."
- `loop.verification.regression` `{heldInSuite, heldOutSuite, acceptIf}` encodes her acceptance rule
  — "Candidates are accepted only if they have no regression on both held-in and held-out data." This
  is the **same criterion the provable-level protocol enforces cryptographically** (§10): a level is
  a held-out-regression acceptance made into a signed, revocable credential.
- `context.playbook` `{store, entryShape}` gives the ACE "evolving playbook" its structured
  `(id, description)` itemized form, distinct from prose `memoryFiles`.
- `observability` `{tracer, decisionLog, pillars}` exposes AHE's component/experience/decision
  observability so runs are inspectable (ties to the repo audit log).
- `loop.subAgents[].mode` `{sync|backend}` adds a monitorable long-running job lifecycle (her
  Pattern 3: "make parallelism explicit and inspectable").

Her thesis — "the layer between the raw model and the real-world context seems to be as important as
the model's raw intelligence," and that an evolved harness *transfers* across benchmarks — is the
external warrant for treating this layer as a portable artifact. Her prediction that "many harness
improvements will be internalized into core model behavior, but the interface with external context
and tools should remain" justifies the §9.5 split: the durable interface is normative and declarative;
volatile model-specific mechanics stay in the ignorable `hints{}`.

---

## 10. Provable Character Level (block Provable — normative)

An agent's level is **never self-asserted**. It is a W3C Verifiable Credential 2.0 (media type `application/vc`) embedding an Open Badges 3.0 achievement, issued by an independent verifier only after re-executing the exact cartridge ROM on a held-out slice it could not pre-see, content-addressed and revocable.

### 10.1 The credential (`LevelCredential`)

The attestation **MUST** be a VC secured by a Data Integrity proof, distributed as an OCI **Referrers** artifact whose `subject` is the cartridge image-manifest digest and whose `artifactType` is `application/vnd.acx.level-attestation.v1`. It **MUST** bind to the exact **ROM-zone digest** via `credentialSubject.result[].acx:cartridgeRomDigest`, so a level cannot be transplanted onto a mutated cartridge.

`@context` **MUST** be `["https://www.w3.org/ns/credentials/v2", "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json", "https://acx.dev/ns/level/v1"]`; `type` **MUST** contain `VerifiableCredential` and `OpenBadgeCredential`; `issuer.id` is a verifier `did:web`; `credentialSubject.type` contains `AchievementSubject`. The achievement carries `criteria.narrative` and `resultDescription[]` (RubricCriterionLevel career-tier ladder, ScaledScore conservative rating 0–50, Percent held-out pass@1). `result[]` carries `achievedLevel`, `acx:ratingMu`, `acx:ratingSigma`, `acx:gamesPlayed`, `acx:acxLevel`, `acx:careerTier`, `acx:cartridgeRomDigest`, `acx:benchmarkId`, `acx:benchmarkVersion`, `acx:benchmarkDigest`, `acx:heldOutSliceDigest`. `evidence[]` links content-addressed DSSE-signed trajectories (`acx:digestMultibase`, `acx:dsseEnvelope`). `credentialStatus` **MUST** be a `BitstringStatusListEntry` (`statusPurpose: revocation`). `proof` **MUST** be `DataIntegrityProof` with `cryptosuite ∈ {eddsa-rdfc-2022, eddsa-jcs-2022}`, `proofPurpose: assertionMethod`, `proofValue` multibase base58-btc (`z` prefix). Verifiers **MUST** reject a credential whose `issuer.id` equals the `credentialSubject.id` controller, or whose issuer is not in the ACX trust registry.

### 10.2 Issuance protocol (unfakeable)

1. **Benchmark** is a bundled, versioned task-suite (`acx-bench-*`, its own `.acx`, `artifactType application/vnd.acx.benchmark.v1`) with a **public slice** and a **sealed held-out slice** — encrypted at rest, `acx:heldOutSliceDigest` published, plaintext keyed to the verifier enclave only. Held-out tasks **MUST** be time-sliced post-model-cutoff (SWE-bench "verified" pattern) so training-set contamination is structurally impossible; every task pins graded artifacts by full SHA-256.
2. An **independent verifier** (accredited `did:web` distinct from the subject controller) **MUST** re-run the pinned cartridge ROM in a sandbox on a randomly drawn held-out subset; each full trajectory is content-addressed (sha256 multihash → `acx:digestMultibase`), signed as a DSSE/in-toto envelope, and URL-linked in `evidence[]`.
3. **TrueSkill gating.** A credential **MUST NOT** issue unless `sigma < sigma_max` (default `1.5`) AND `gamesPlayed >= N_min` (default `30`). The conservative rating `R = mu - 3*sigma` maps to level — one lucky run cannot level up, because a single win barely moves `mu` while `sigma` stays high, failing the gate.
4. **Level → careerTier** reuses AGENTIBUS verbatim: bucket `R` into `acxLevel`, then `careerTierForLevel` (`intern <5, junior ≥5, mid ≥10, senior ≥15, staff ≥20, principal ≥25, distinguished ≥30, legend ≥35`). `acx:careerTier` **MUST** be one of the 8 `CareerTier` values.

### 10.3 Anti-gaming (all MUST)

Held-out slice is never revealed (only its digest is public); post-cutoff time-slicing prevents memorization; subject binds to `cartridgeRomDigest` (editing SAVE or ROM invalidates the level); σ-shrink + `N_min` defeats variance farming; a per-cartridge-digest cooldown plus logging of *failed* attempts defeats resubmission-until-lucky; self-issuance is rejected; on discovered contamination the verifier flips the `BitstringStatusListEntry` bit, instantly invalidating the level without recall.

---

## 11. OCI Distribution (blocks C, Identity, Provable — normative)

The `.acx` file is pushed as one immutable blob inside an **OCI Image Manifest v1.1.0** with top-level `artifactType: application/vnd.acx.cartridge.v1`, `config` = the empty descriptor `application/vnd.oci.empty.v1+json` (digest `sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`, size 2), and a single layer of media type `application/vnd.acx.cartridge.layer.v1+sqlite` (uncompressed, no tar) whose digest equals the frozen `.acx` bytes. Per OCI 1.1.0, `artifactType` **MUST** be set when `config.mediaType` is the empty value.

Two integrity guarantees are intentionally distinct: the **OCI layer digest** guarantees transport integrity of one frozen snapshot; the **DSSE rom-manifest-hash** guarantees ROM semantics across re-materialization (the on-disk file legitimately diverges once SAVE rows are written). Layer annotations SHOULD carry `vnd.acx.rom-manifest-hash` and `vnd.acx.spec-version`.

The DSSE envelope and each VC/Open-Badge attestation SHOULD be attached as separate **referring manifests** via the OCI Referrers API (`subject` → cartridge manifest digest), with the `sha256-<digest>` fallback tag mandated where Referrers is unsupported. The DSSE referrer's single layer has `mediaType: application/vnd.dsse.envelope.v1+json`; the level attestation's `artifactType` is `application/vnd.acx.level-attestation.v1`. Because this is stock DSSE + in-toto + OCI Referrers, verification uses stock tooling with no ACX-specific code:

```
oras discover --artifact-type application/vnd.dsse.envelope.v1+json <ref>
cosign attest --predicate predicate.json --type https://acx.dev/attestation/cartridge/v1 --key cosign.key <ref>
cosign verify-attestation --type https://acx.dev/attestation/cartridge/v1 --key cosign.pub <ref>
```

Harness/Gitness `dbPutManifestV2` stores the manifest row, empty config blob, and SQLite layer byte-for-byte without validating `artifactType`/config/layers, so cartridges distribute with **zero registry change**.

**Contradiction resolved (vendor tree).** The constraint map §3 references `application/vnd.agentibus.agent.bundle.v1`. **Resolution:** the normative vendor tree is `application/vnd.acx.*`; the `agentibus` naming is superseded and appears nowhere normatively.

---

## 12. Conformance Requirements

A conformant Agent Cartridge and its tooling **MUST**:

1. Be a single SQLite ≥ 3.37 file with `application_id = 1094932529` (offset 68) and a valid packed `user_version` (offset 60).
2. Use the verbatim DDL of §3.2, keeping `sqlar` at the stock schema and zoning files by `rom/`/`save/` prefix.
3. Sign only the ROM integrity manifest (§3.3) — never raw container bytes — with a DSSE/in-toto envelope (`payloadType application/vnd.in-toto+json`), Ed25519, `keyid = ed25519:<hex sha256(DER SPKI)>`, `subject.digest.sha256 = manifest_hash`.
4. Keep private keys out of the cartridge and out of git; publish trust as a public-keys-only registry.
5. Bind trust to `publisherId` (reverse-DNS, DNS-TXT or GitHub-OIDC proven) + `keyid`, never to `instanceId`.
6. Evaluate the trust taxonomy `tampered/legacy/portable/trusted/local` in the §4.5 order.
7. Store skills wholly in ROM with six-key agentskills.io frontmatter, a re-derivable `acx_skill` index whose `content_sha256` matches the manifest, and host-superset fields only in a reverse-DNS `ext` namespace.
8. Partition every memory record with `portable` + `codebaseFingerprint`, reject malformed tier combinations, run the fail-closed scrub gate before signing, strip TRANSFERABLE identity and quarantine FIELD-LEARNED records on export, and never re-project foreign field-learned memory.
9. Ship an always-present JSON memory baseline, tag vectors with an embedding-engine id, and re-index (never trust) foreign vectors on import.
10. Merge idempotently by two-key dedupe (`id`, then 10-char `artifactFingerprint`).
11. Embed exactly one signed harness-requirements manifest declaring the four required roles (`acx:execute`, `acx:dispatch`, `acx:memory.write`, `acx:search`) with capability scopes and an MCP `minProtocolRevision` floor; refuse activation (without mutating SAVE) via the §8.5 handshake when unmet.
12. Carry exactly one ROM-zone loop-context policy evaluated as data, with all vendor/effort/KV-cache/summarization specifics confined to an ignorable `hints` object; enforce host `resource-limits.yaml` precedence over cartridge `budget` defaults.
13. Represent any level as a revocable, evidence-linked VC 2.0 / Open Badge 3.0 issued only after independent held-out re-execution, TrueSkill σ-gated (`sigma < 1.5`, `gamesPlayed ≥ 30`, `R = mu − 3σ`), bound to the ROM digest.
14. Distribute as one OCI image (§11) verifiable with stock cosign/oras and zero registry change.
15. Validate ACX Workflows independently of staffing; require unique identifiers, closed structured conditions, valid completion contracts, a path from every reachable node to a terminal event, and `limits.maxSteps` for every cyclic graph; when signed, verify the RFC-8785/JCS digest and DSSE/in-toto publisher binding before resolving team slots (§14).
16. Validate ACX Agent Graphs as reference-safe information architectures: require bounded propagation and
    fan-out, structured route triggers, valid reverse response routes, unambiguous acyclic mandatory
    direction per knowledge module, pinned published CAL references, bounded convergence of at least two
    distinct loops, secret-scanned public metadata, and metadata-only knowledge declarations; when signed,
    verify the RFC-8785/JCS digest and DSSE/in-toto publisher binding, and never interpret the graph or its
    signature as a runtime permission grant (§16).

**Versioning & extension policy.** Every stored artifact **MUST** be versioned: `schemaVersion` (`acx.skill/1`, `acx.capability/1`, `acx.harness.v1`, `acx.loop-context-policy/1`, `acx.cal/1`, `acx.workflow-signature/1`, `acx.agent-graph/1`, `acx.agent-graph-signature/1`, memory-record v1), workflow and Agent Graph SemVer `version`, `user_version`/`application_id` (SQLite), and `artifactType` vN (OCI). No unversioned published files. `spec_MAJOR` bumps break readers; `spec_MINOR` is additive. Extension points are namespaced: reverse-DNS keys in `acx_skill.ext`, `cal.extensions`, and Agent Graph `extensions`; reverse-DNS-prefixed `taskType` tokens; `x-`-prefixed capability scopes; A2A `AgentExtension` for capability records; and `acx:` JSON-LD terms in credentials. Recognizing hosts consume their namespaces; all others **MUST** ignore unknown namespaces without error.

---

## 13. Appendix: Consolidated JSON Schema Index

| Block | Schema title | `$id` |
|---|---|---|
| Container & Integrity | ACX ROM Integrity Manifest (DSSE payload) | `https://acx.dev/schema/rom-manifest.v1.json` |
| Identity, Signing & Trust | ACX Trust Registry (public keys only) — with `$defs` DsseEnvelope, InTotoStatement, CartridgePredicate, NamespaceProof, TrustedKey | `https://acx.dev/schema/trust-registry/v1` |
| Skill Bundle | ACX Skill Index Descriptor (`acx_skill` row) | `https://acx.dev/schemas/skill-descriptor/1` |
| Capability & Sellable-Claim | CapabilityRecord | `https://acx.dev/schema/capability/1` |
| Memory Partition | AcxMemoryRecord | `https://acx.dev/schema/memory-record.v1.json` |
| Harness Requirements | AcxHarnessRequirements (with `$defs` harnessCompliance, toolRoleContract, capabilityScope, fsScopes, netScopes) | `https://acx.dev/schemas/harness-requirements.v1.json` |
| Loop + Context Policy | ACX Loop + Context Policy (with `$defs` MissionRule, ResourceLimits, RetrievalStrategy, ContextCategory) | `https://acx.dev/schemas/loop-context-policy/1` |
| Provable Character Level | AcxLevelCredential | `https://acx.dev/schema/level-credential.v1.json` |
| Clean Package Specification | ACX Package Spec | `https://acx.dev/schema/package-spec.v1.json` |
| LanceDB Memory Projection | ACX LanceDB Memory Schema | `https://acx.dev/schema/lance-memory.v1.json` |
| Multi-agent Workflow | ACX Workflow / Conditional Agentic Loop | `https://acx.dev/schema/cal.v1.json` |
| Cartridge Workflow Participation | ACX CAL Skill Set | `https://acx.dev/schema/cal-skillset.v1.json` |
| Agent Information Architecture | ACX Agent Graph | `https://acx.dev/schema/agent-graph.v1.json` |

All schemas are JSON Schema draft 2020-12. Media-type registry (RFC 6838 vendor tree): `application/vnd.acx.cartridge`, `application/vnd.acx.cartridge.v1`, `application/vnd.acx.cartridge.layer.v1+sqlite`, `application/vnd.acx.rom-manifest.v1+json`, `application/vnd.acx.workflow.v1+json`, `application/vnd.acx.agent-graph.v1+json`, `application/vnd.in-toto+json`, `application/vnd.dsse.envelope.v1+json`, `application/vnd.acx.trust-registry.v1`, `application/vnd.acx.harness-requirements.v1+json`, `application/vnd.acx.harness-compliance.v1+json`, `application/vnd.acx.loop-context-policy.v1+json`, `application/vnd.acx.level-attestation.v1`, `application/vnd.acx.benchmark.v1`, `application/vc`.

### Resolved contradictions (summary)

1. **DSSE payloadType** — block C's `application/vnd.acx.rom-manifest.v1+json` vs block Identity's `application/vnd.in-toto+json`. Resolved to in-toto Statement v1 as the DSSE payloadType; the rom-manifest is the predicate content. (§4.2)
2. **`keyid` definition** — reverse-DNS (block C) vs `ed25519:<hex sha256(DER SPKI)>` (block Identity). Resolved to the content-addressed form; publisherId lives in the predicate/registry. (§4.2)
3. **`artifactFingerprint` slice length** — spec-mandated 10 vs live 12. Resolved to 10; reference impl re-keys. (§7.3)
4. **vec0 dimension** — DDL `float[384]` vs engine `local-hash-128`. Resolved: the `vectors` DDL is a per-engine template, dimension from `acx.embedding_engine.dim`; never signed. (§3.5)
5. **OCI vendor tree** — `application/vnd.agentibus.*` (constraint map) vs `application/vnd.acx.*` (blocks). Resolved to `application/vnd.acx.*` normatively. (§11)
6. **ROM digest naming** — block C's `manifest_hash` and block Identity's `packageHash` are the same value; unified as "the ROM `manifest_hash`, which is this format's `packageHash`." (§3.3, §4.1)

### Open questions carried forward (non-normative)

Minimum sqlite-vec version and whether a stable vec1 format supersedes `vec0_storage_format`; authoritative trust-registry federation home and freshness/rollback protection; keyless Sigstore (Fulcio/Rekor) as an alternative to the static registry; `installationSalt` lifecycle and rotation-driven SAVE re-namespacing; scrub-gate policy as a versioned external file; SAVE-zone rule-overlay vs ROM `rules[]` precedence; a normative inputSchema-subsumption algorithm for structural acceptance; the exact `R → acxLevel` bucketing calibration; verifier accreditation/quorum governance; and selective-disclosure (BBS/SD-JWT) for trajectory evidence that must stay verifiable yet closed.

---

## 14. ACX Workflows: Conditional Agentic Loops (CAL), Teams & RAC

The [loop policy §9] governs a *single* agent's harness. Multi-agent orchestration is an **ACX Workflow**,
represented as a **Conditional Agentic Loop** (`acx.cal/1`, `schemas/cal.schema.json`) in one readable
`.cal.json` file. Its media type is `application/vnd.acx.workflow.v1+json`.

### 14.1 Public discovery profile

A CAL always carries `schemaVersion`, `id`, `participants`, `start`, `nodes`, and `edges`. A workflow
published to an exchange or registry **MUST** additionally carry:

- a SemVer `version`, human-readable `name` and useful `description`;
- an SPDX `license`, at least one named `author`, and at least one lowercase discovery `tag`;
- a valid graph under §14.3; and
- a valid `integrity` signature under §14.5.

`extensions` is a reverse-DNS-keyed object. Consumers **MUST** ignore namespaces they do not recognize.
The tuple `(id, version, digest)` is the immutable workflow identity; the human name is not an identifier.

### 14.2 Team contract

**Participants** are `CartridgeRef`s:

- `bind:"hash"` pins an exact cartridge by its signed `romDigest`. The digest **MUST** match
  `^sha256:[0-9a-f]{64}$`; a host **MUST NOT** silently substitute another cartridge.
- `bind:"slot"` declares portable staffing constraints: `role`, independently proven `minLevel` (§10),
  and/or capability requirements (`taskType` plus optional stack). A candidate **MUST** satisfy every
  declared constraint. When several candidates match, a host **MAY** rank them, but **MUST** expose which
  cartridge was selected.
- `required:false` permits an unstaffed optional participant. Every other participant **MUST** resolve
  before the workflow is ready.

Each cartridge **MAY** carry a **CalSkillSet** (`acx.cal-skillset/1`) at
`rom/cal/skillset.json` (ROM-signed, pointed to by `acx.cal_skillset`): which roles it `plays`, which
capabilities and skills it can complete, which collaborators it pins by ROM digest, and which workflow ids
it joins.

### 14.3 Graph and termination semantics

- **Nodes** are `task`, `gateway` (`exclusive` | `parallel` | `inclusive`), or `event`
  (`start` | `end` | `stop` | `handoff` | `timer`).
- Every task binds one participant alias, declares optional `requires{skills,capabilities,rac}`, and
  **MUST** define exactly one typed completion contract: non-empty `skill-scripts`, `verification`
  commands plus `passIntent`, a named `guardrail`, or a produced `artifact`.
- **Edges** carry an optional closed condition:
  `{var,op,value}` | `{all}` | `{any}` | `{not}` | `{racAvailable}` | `{always:true}`. A condition
  **MUST** contain exactly one of these shapes. Hosts **MUST NOT** accept or evaluate expression strings.
- Participant aliases, node ids, RAC ids, and variable names **MUST** be unique. Every reference **MUST**
  resolve. Every node **MUST** be reachable from `start`, and every reachable node **MUST** have a path to
  an `end` or `stop` event. Terminal events **MUST NOT** have outgoing edges.
- A cyclic graph **MUST** declare a positive `limits.maxSteps`. Hosts **MUST** stop before executing a
  step beyond this bound. `maxDurationMs` and `maxParallel` are additional host-enforced upper bounds.

Portable validity and local readiness are different verdicts. `acx workflow lint --publish` validates the
document without requiring local agents. `acx workflow ready --cartridges <dir>` additionally staffs every
required slot and checks per-task skill/capability coverage. `acx cal` is the backward-compatible alias for
the latter.

### 14.4 Safety and Required Available Context

Each task **MAY** declare `sideEffects` (`none` | `workspace` | `external`) and `approval`
(`never` | `on-request` | `always`). A host **MUST** pause for explicit approval when `approval:"always"`
and **MUST NOT** grant permissions beyond its own policy merely because a signed workflow requests them.
Signatures prove possession of the signing key and integrity, not namespace authorship or safety.
Publisher authorship becomes trusted only through a valid §4.3 namespace proof.

**RAC** (`RacItem`) declares **Required Available Context** as a description only. A RAC item **MUST NOT**
carry the knowledge content itself; it contains `kind`, `description`, optional availability `check`, and
optional OKF metadata (§15). This keeps a workflow portable and safe to publish while private wikis,
source trees, infrastructure, datasets, and runbooks stay in their authoritative environment.

### 14.5 Canonical digest and signature

Workflow signing is self-contained and reuses the cartridge trust spine:

1. Remove only the top-level `integrity` property.
2. Canonicalize the remaining JSON with RFC 8785/JCS.
3. Compute `digest = "sha256:" || hex(sha256(canonical_bytes))`.
4. Build an in-toto Statement v1 with subject name
   `urn:acx:workflow:<id>@<version>`, the sha256 digest, and
   `predicateType: https://acx.dev/attestation/workflow/v1`.
5. Bind `acxSchemaVersion`, workflow id/version, publisher id, digest, signing time, participant count, and
   node count in the predicate; wrap the statement in DSSE and sign it with Ed25519.

The top-level `integrity` object **MUST** use `schemaVersion:"acx.workflow-signature/1"` and carry the
digest, `publisherId`, content-addressed `keyid`, SPKI public key, RFC 3339 `signedAt`, and the clean DSSE
envelope. The private key **MUST NOT** appear in the workflow, registry, or git.

A verifier **MUST** recompute the digest from live workflow content; verify the public-key/keyid match,
DSSE signature, in-toto subject, predicate type, workflow id/version, publisher id, and signing time; then
apply the public trust registry lifecycle rules of §4.4. Any mismatch is `tampered`. A valid unknown signer
is `portable`; a namespace-proven registry signer is `trusted`. Editing any team slot, task, condition,
RAC description, limit, or metadata after signing therefore invalidates the artifact.

### 14.6 Relationship to A2A and MCP (informative)

ACX does not replace runtime protocols. A2A 1.0 supplies network agent discovery, signed Agent Cards, task
lifecycles, messages, artifacts, and protocol extensions; MCP supplies host tools and resources. ACX
supplies the portable, content-addressed agent artifact, the CAL task graph that selects and coordinates
agents, and the separate Agent Graph information architecture (§16). An ACX host may dispatch a task
through A2A and satisfy a RAC check through an MCP resource without changing either exchange artifact.

## 15. Open Knowledge Format alignment

A RAC item's optional `okf` field aligns with the **Open Knowledge Format** (OKF v0.1): the standard
describes required knowledge as **metadata only, never content** — OKF's central premise. An OKF *Knowledge
Bundle* (a directory of markdown *Concept* documents, each with a required `type` frontmatter field, plus
reserved `index.md`/`log.md`) is a natural producer for the knowledge a CAL declares as required: a
`code-wiki` RAC item **MAY** be satisfied by an OpenWiki/OKF bundle in the repo, referenced by
`okf` and confirmed by the RAC `check`. A cartridge's transferable memory (§7) **MAY** additionally be
*exported as* an OKF bundle (one Concept per portable record; `type` from `sourceType`; `title`,
`description`, `tags`, `timestamp` mapped verbatim) — field-learned records stay excluded, so the memory
quarantine (§7.4) and OKF's "metadata not raw data" rule compose. This makes generation (OpenWiki → OKF)
and declaration/verification (RAC + `acx workflow ready`) two ends of the same interface.

---

## 16. ACX Agent Graph: Team Communication, Knowledge & Loop Convergence

An **ACX Agent Graph** is a portable information architecture for an agent team. A CAL says **what happens
next**. An Agent Graph says **who owns the context, who can direct whom, where reports return, and where
separate loops meet**.

The two artifacts deliberately model different concerns:

- a CAL (`acx.cal/1`) is a bounded task-execution graph with participant slots, nodes, conditions, RAC,
  side-effect declarations, and terminal events (§14);
- an Agent Graph (`acx.agent-graph/1`) is a declarative responsibility and information-routing graph with
  actors, knowledge modules, communication routes, loop bindings, and convergence points.

An Agent Graph **MUST NOT** contain executable task payloads, **MUST NOT** embed the knowledge it
describes, and **MUST NOT** grant tools, data access, network access, approval rights, or runtime
permissions. Its media type is `application/vnd.acx.agent-graph.v1+json`, its portable file suffix is
`.agent-graph.json`, and its normative schema is `schemas/agent-graph.schema.json`.

### 16.1 Document, discovery & identity

Every Agent Graph **MUST** carry:

- `schemaVersion:"acx.agent-graph/1"`;
- a stable lowercase `id`;
- non-empty `actors`, `knowledge`, and `routes` arrays; and
- `limits` with positive `maxPropagationHops` and `maxFanout`.

`loops` and `convergence` are OPTIONAL. Actor ids, knowledge ids, route ids, loop ids, and convergence ids
**MUST** each be unique within their respective collections. Every graph-local id reference **MUST**
resolve; external CAL participant aliases are validated when a host resolves the pinned workflow.
Every actor **MUST** participate in stewardship, an audience, a route, a loop binding, or convergence;
every knowledge module **MUST** be routed, bound to a loop, or produced by convergence. Validators
**MUST** reject isolated actors and unused knowledge declarations.

A graph published to an exchange or registry **MUST** additionally carry a SemVer `version`, a
human-readable `name`, a useful `description`, an SPDX `license`, at least one named `author`, at least one
lowercase discovery `tag`, and a valid signature under §16.8. `homepage` is OPTIONAL and, when present,
**MUST** be an absolute URI. `extensions` is an OPTIONAL reverse-DNS-keyed object; consumers **MUST**
ignore namespaces they do not recognize. Before publication, all public metadata **MUST** pass a
fail-closed secret scan. Credential-like values, private keys, tokens, and other secret-like metadata
**MUST** be rejected; pinned sha256 workflow digests are identifiers and are excluded from that scan.

The tuple `(id, version, digest)` is the immutable published graph identity. Human-readable names,
descriptions, and fuzzy selectors are not identifiers.

### 16.2 Actors: logical seats, not pinned identities

An `Actor` represents a logical seat in the information architecture. It **MUST** carry an `id`, a `kind`
(`agent` | `human` | `group` | `service` | `mixed`), and a description. It **MAY** carry:

- a display `name`;
- a fuzzy `selector` containing one or more role names, capabilities, tags, or a prose description;
- `cardinality.min` and/or `cardinality.max`; and
- prose `responsibilities`.

When `cardinality` is present, it **MUST** contain at least `min` or `max`; an empty object is invalid.

Selectors make graphs reusable across teams: “the agent capable of product ownership” can occupy a seat
without hard-coding a person, cartridge, model, or vendor. They are matching hints, not authorization.
A host **MAY** map several runtime participants to a group seat, but each participant alias in one loop
binding maps to at most one graph seat. The host **MUST** expose that resolution and **MUST NOT** treat a
selector match as a permission grant.

### 16.3 Knowledge modules: stewardship metadata, never content

A `KnowledgeModule` describes an information responsibility. It **MUST** carry an `id`, `kind`,
description, and one or more actor ids in `stewards`. The closed v1 `kind` vocabulary is:
`intent`, `requirement`, `decision`, `status`, `evidence`, `feedback`, `risk`, `context`, `artifact`,
`tacit`, and `custom`.

A module **MAY** declare a display name, intended `audience`, `durability` (`turn` | `session` |
`workflow` | `project` | `organization` | `public`), `sensitivity` (`public` | `internal` |
`restricted`), and a freshness policy. Freshness carries a mode (`event` | `continuous` | `periodic` |
`on-demand` | `custom`), a prose description, and an optional positive `maxAgeMs`; periodic freshness
**MUST** declare `maxAgeMs`.

An optional `locator` is a metadata-only hint for resolving authoritative context in the receiving
environment. Its type is `rac`, `okf`, `mcp-resource`, `artifact`, `manual`, or `custom`, and its
description explains how a host can find or check that context. The module has deliberately **no**
`content` property. Source code, requirements, credentials, conversation transcripts, private wikis, and
other actual knowledge **MUST** stay in their authoritative environment. A conformant validator
**MUST** reject embedded content and unknown properties.

Stewardship means responsibility for keeping a knowledge module coherent and current. It does not by
itself permit a steward to read, write, disclose, or approve the underlying information.

### 16.4 Routes: direction, reporting & response contracts

A `Route` describes a communication responsibility. It **MUST** carry:

- a unique `id`, one `from` actor, and one or more `to` actors;
- an `intent`: `inform`, `direct`, `request`, `report`, `advise`, `review`, `approve`, `escalate`,
  `coordinate`, `observe`, or `custom`;
- an `obligation`: `must`, `should`, or `may`;
- a useful prose `purpose`;
- one or more knowledge ids in `carries`; and
- one or more structured `triggers`.

`relationship` is an OPTIONAL open-world lowercase label such as `reports-to`, `consults`, or
`hands-off-to`. `authority` is an OPTIONAL descriptive classification (`informational`, `advisory`,
`delegated`, `approval`, or `escalation`). Neither field grants runtime authority.

A trigger **MUST** be exactly one of:

- `{type:"event", events:[…], description?}`, where every event is a dotted lowercase token such as
  `work.requested` or `loop.completed`;
- `{type:"interval", everyMs:<positive integer>, description?}`; or
- `{type:"manual", description?}`.

Structured triggers are portable matching data, not executable expressions. A host **MAY** map its local
events and clocks to them; the graph does not dispatch a message by itself.

A route **MAY** further declare a success description, `delivery` (`broadcast` | `one` | `owner` |
`custom`), acknowledgement behavior (`required` | `optional` | `none`), a medium, or a cadence.
`weight` is an OPTIONAL number from 0 through 1 for fuzzy importance or expected communication strength;
it **MUST NOT** be interpreted as authority, confidence, or an access-control score.

Responses are explicit. When a route declares returned knowledge in `returns`, it **MUST** declare
`expects.via`, referencing a route from one of the original targets back to the original source. That
return route **MUST** carry every declared returned knowledge module. `expects.withinMs` and a prose
description are OPTIONAL. A present `returns` array **MUST** be non-empty. A route **MUST NOT** target its
own `from` actor; intra-actor state belongs in the actor's own loop or memory policy, not a communication
edge.

Reporting, feedback, advice, review, and escalation cycles are valid and often desirable. Mandatory
direction is intentionally stricter: a target actor **MUST NOT** receive routes with `intent:"direct"` and
`obligation:"must"` for the same knowledge module from more than one source, and the mandatory-direction
subgraph for each knowledge module **MUST** be acyclic. A validator **MUST** reject conflicting owners or
mandatory command cycles while preserving ordinary communication/reporting cycles.

No route may address more actors than `limits.maxFanout`.

### 16.5 Loop bindings: join workflows without remodeling their tasks

A `LoopBinding` identifies one loop whose information crosses the team graph. It **MUST** carry an `id`,
a `kind` (`acx-workflow` | `external` | `informal`), a description, and at least one knowledge id in
`imports` or `exports`.

An `acx-workflow` binding **MUST** carry a `workflowRef` with a CAL id. In a structural draft, its SemVer
version and sha256 digest are OPTIONAL; a published Agent Graph **MUST** include both. Other loop kinds
**MUST NOT** carry `workflowRef`.

Optional `actorBindings` map an Agent Graph actor id to one or more CAL participant aliases. These
bindings connect the responsibility graph to a workflow without copying its nodes, conditions, RAC,
permissions, or task payloads. Within one loop binding, a participant alias **MUST NOT** be bound to more
than one Agent Graph actor. An Agent Graph **MUST NOT** redefine CAL execution semantics.

An unpinned moving workflow reference is not publishable.

### 16.6 Convergence: where separate loops meet

A `ConvergencePoint` makes the synthesis of several loops explicit. It **MUST** carry:

- a unique `id` and description;
- at least two `inputs` from at least two distinct loop ids, each naming knowledge exported by that loop;
- one `steward` and optional contributors;
- a merge `policy`;
- one or more output knowledge ids;
- a prose `trigger`; and
- positive `limits.maxWaitMs` and `limits.maxRounds`.

For every input knowledge module, a route carrying it **MUST** reach the convergence steward. Outputs
**MUST** be synthesized knowledge rather than unchanged input ids, and the convergence steward **MUST**
also steward every output module. These invariants prevent a convergence point from claiming to combine
information that can never reach its owner.

The policy mode is `steward-synthesis`, `consensus`, `vote`, `priority`, `latest`, or `custom`, accompanied
by a prose description. `failureMode` is OPTIONAL and describes what should happen when inputs do not
arrive or agreement fails. The convergence trigger and policy remain descriptive; a CAL or host runtime
defines any executable synthesis steps. A host that operationalizes convergence **MUST** stop waiting or
iterating at the declared bounds.

### 16.7 Global bounds & runtime interpretation

`limits.maxPropagationHops` bounds any host-implemented cascade through communication routes;
`limits.maxFanout` bounds the number of targets on each route. Both **MUST** be positive integers. The
reference validator enforces structural fan-out; a host that propagates messages or context through the
graph **MUST** additionally stop before exceeding `maxPropagationHops`.

Agent Graph validation proves that ids and references are coherent, communication expectations are
paired, mandatory direction is unambiguous, and loop convergence is reachable and bounded. It does not
prove that a described team is staffed, a communication occurred, knowledge is correct or available, or
a policy is safe. Hosts remain authoritative for actor resolution, event mapping, task dispatch,
permission checks, approvals, resource limits, and data access.

#### 16.7.1 Host-side route event envelope

The Agent Graph file remains non-executing. A host that operationalizes routes or convergence **MUST**
carry an ephemeral event envelope containing at least:

- a globally unique `eventId` and a stable `correlationId` for one related information exchange;
- an OPTIONAL `causationId` naming the event that caused this event;
- the verified `graphDigest` and selected `routeId`;
- a non-negative `hopCount`; and
- one or more knowledge references containing a knowledge-module `id` and an opaque revision, version, or
  digest — never the knowledge content.

The first routed event starts at `hopCount:0`; every forwarding hop **MUST** increment it. A host **MUST**
stop before a forwarding action would exceed `limits.maxPropagationHops`, and **MUST** apply
`limits.maxFanout` at every route.

A host **MUST** deduplicate repeated delivery by `eventId` within the correlation. Convergence inputs
**MUST** retain their originating correlation, and a host **MUST NOT** merge inputs from different
`correlationId` values merely because their knowledge ids or loop bindings match. `causationId` SHOULD
preserve the event chain across reports, expected return routes, and synthesized convergence output.

This event envelope is runtime state, not a new property of `acx.agent-graph/1`, and **MUST NOT** be
written into the signed graph. The zero-dependency reference implementation validates, signs, verifies,
inspects, and shares graphs; it does not dispatch route events, resolve knowledge references, or execute
convergence.

### 16.8 Canonical digest, signature & trust

Agent Graph signing follows the same self-contained trust spine as workflows:

1. Remove only the top-level `integrity` property.
2. Canonicalize the remaining JSON with RFC 8785/JCS.
3. Compute `digest = "sha256:" || hex(sha256(canonical_bytes))`.
4. Build an in-toto Statement v1 whose sole subject is
   `urn:acx:agent-graph:<id>@<version>` with the sha256 digest and whose
   `predicateType` is `https://acx.dev/attestation/agent-graph/v1`.
5. Bind `acxSchemaVersion`, graph id/version, publisher id, digest, signing time, and the counts of actors,
   knowledge modules, routes, loops, and convergence points in the predicate.
6. Wrap the statement in a DSSE envelope with `payloadType:"application/vnd.in-toto+json"` and sign it
   with Ed25519.

The top-level `integrity` object **MUST** use
`schemaVersion:"acx.agent-graph-signature/1"` and carry exactly the digest, reverse-DNS `publisherId`,
content-addressed `keyid`, SPKI `publicKeyPem`, RFC 3339 `signedAt`, and clean DSSE `envelope`. The private
key **MUST NOT** appear in the graph, registry, or git.

A verifier **MUST** recompute the digest from live graph content; validate the publishable structure;
verify the public-key/keyid match, DSSE signature, in-toto subject, predicate type, graph id/version,
publisher id, signing time, and bound counts; and then apply the trust-registry lifecycle rules of §4.4.
Any mismatch is `tampered`. A valid unknown signer is `portable`; a namespace-proven registry signer is
`trusted`. Editing a selector, responsibility, knowledge declaration, route, trigger, expectation, loop,
convergence policy, limit, or discovery field after signing therefore invalidates the artifact.

A valid signature proves possession of the signing key and integrity only. It cryptographically binds
`publisherId` as the signer's claim; publisher authorship is trusted only after a valid §4.3 namespace
proof. Neither state **MUST** be treated as evidence that the publisher controls the named actors, that
the described authority exists in the receiving organization, or that execution is safe.

### 16.9 CLI & registry profile

The zero-dependency reference CLI exposes:

```text
acx graph lint <file.agent-graph.json> [--publish]
acx graph sign <file.agent-graph.json> --publisher <reverse-dns> [--key <pem>] [--out <file>]
acx graph verify <file.agent-graph.json> [--registry <trust.json>]
acx graph inspect <file.agent-graph.json>
acx graph digest <file.agent-graph.json>
acx share graph <file.agent-graph.json> [--publisher <id>] [--registry <dir>] [--dry-run] [--force]
```

`lint` validates the closed references and graph invariants; `lint --publish` additionally requires the
public discovery profile. `sign` requires the publishable profile and produces
`acx.agent-graph-signature/1`; `verify` requires both a valid publishable structure and valid signature;
`inspect` renders the discovery card; and `digest` prints the JCS digest.

`share graph` is fail-closed: it accepts only a signed, publishable `.agent-graph.json` whose publisher
binding verifies, preserves the authoritative artifact bytes, and prepares
`registry/graphs/<id>.agent-graph.json`. `--dry-run` **SHOULD** be used before writing a registry diff.
