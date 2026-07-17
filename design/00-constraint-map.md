# Constraint Map: An Open Standard for Portable Specialized Coding Agents

> Source: Phase-0 understand workflow (15 research agents over AGENTIBUS + Harness/Gitness
> + the external standards landscape). This is the binding input for the spec design.

## 1. What AGENTIBUS already has — reuse verbatim, do not reinvent

- **Package directory shape.** `exportAgentPackage`/`importAgentPackage` in
  `agentibus/server/lib/game/agent-package.ts` (~1100 lines) produces a self-contained bundle:
  `manifest.json` + `memory-records.json` + optional `memory-lance/` + `memory-index.json`
  + knowledge `.md` files + `checksum.sha256` + `signature.json`. This IS the reference layout.
- **Integrity layering.** `checksum.sha256` in canonical `sha256sum` format
  (`<hex>␣␣<relpath>`, localeCompare-sorted, self-excluding), then `manifestHash` + `checksumHash`,
  then one signed `packageHash = sha256(JSON{packageSlug, manifestHash, checksumHash, files[]})`.
  Ed25519 via Node `crypto` `signBuffer(null, …)` over `Buffer.from(packageHash)`.
  Hash-of-hashes discipline is correct → stays verbatim as the signing core.
- **Trust taxonomy.** `local / trusted / portable / legacy / tampered` from
  `verifyPackageSignature`, graceful degradation (unknown signer → importable at `trust=portable`
  with warning). `AgentPackageVerification` (`types/game.ts:1100`) is the return type.
- **Idempotent content-addressed merge.** `mergeMemoriesIntoManifest`
  (memory-store.ts:942-1055): two-key dedupe (by `id`, then `artifactFingerprint` =
  sha1 over title+summary+sourceType+repoId+projectLabel+timestamp+impact+xp+tags, sliced 10).
  Deterministic conflict resolution (longer text, worse impact, max xp, union tags).
- **Report + guardrail schemas.** `OperatorCommandReport`
  (outcome/quality/confidence/blockers/nextAction) and `MissionGuardrailSignal`
  kind `milestone|checkpoint|question|blocked|stop`, plus `MissionRule {id,category,trigger,action,severity}`
  — already transport-agnostic loop-outcome contracts. `MissionRule` is already a declarative rule
  shape; it just needs to be *emitted as data* instead of produced by hardcoded `buildMissionRules()`.
- **Resource-policy precedent.** `resource-limits.yaml` / `ResourceLimits`
  (token spend, concurrency, timeouts, kill-switch scopes) is the one externalized policy file that
  already exists. The bundle's policy layer models itself on this.
- **Self-describing embedding tag.** `vectorEngine: 'local-hash-128'` in the manifest.
  The value is throwaway; the *pattern* — declare the embedding engine id so consumers re-index
  rather than trust foreign vectors — is mandatory and reused.
- **MCP tool-declaration shape.** `{name, description, inputSchema}` raw JSON-Schema,
  `agentibus_` snake_case namespace. The bundle's required-tools manifest copies these 1:1.

## 2. What is missing — must be built

- **Transport format.** No archive. "Sharing" = copy a folder into `inbox/`. Build the container (§4).
- **Codebase-agnostic / learned-specific partition.** *The single largest gap.* Every
  `AgentMemoryArtifact` hard-carries `repoId`, `repoLabel`, `projectLabel` (real leaked values:
  `workspace-example-a1b2`, `sample-app`, `service-core`). No `portable:boolean`,
  no strip/namespace step. `specialties`/`memoryTopics` are derived *from* repo-tagged memories,
  so even "abstract" expertise is contaminated. Build a two-tier memory model:
  `transferable` vs `field-learned` (namespaced by codebase fingerprint, quarantined).
- **Capability vocabulary for the sellable claim.** No structure says "good at building DAGs for
  data engineering with Airflow+Snowflake." Degrades to 5 domains / 7 SkillDomain / 19 tags /
  flat `techStack[]`. `similarProjects` hardcoded 0 (dead code). Build a capability triple:
  `{taskType, stack[], evidenceRefs[]}` with proficiency backed by verifiable evidence.
- **Provable "character level."** `level`/`xp`/`careerTier` are game numbers, no verification.
  Build the level as an attestation (§3, Open Badges/VC).
- **Declarative loop logic.** Routing weights, status inference, guardrail derivation are hardcoded
  TS `if/else`. No manifest for loop/routing/rule logic. Build a declarative loop-policy document.
- **Standalone publishable trust store.** Today `trustedSigners[]` lives *inside*
  `meta/game/package-signing.json` — the file that also holds the ed25519 **private key in plaintext,
  git-tracked**. Build a public-keys-only trust registry, separate from key material.
- **Org/user identity.** Signing binds to a hostname-derived `instanceId`; not portable across
  machines. Build user/org-level identity (reverse-DNS).
- **Automated PII/secret scrubbing on export.** Commit history shows *manual* scrub passes
  (f6f30a5a, 072b5fcf). A standard can't rely on humans remembering. Build a scrub gate.

## 3. External standards — align or ignore

**ALIGN (adopt):**
- **SKILL.md / agentskills.io** for the skill layer. Frontmatter verbatim: `name`
  (1-64, `^[a-z0-9]+(-[a-z0-9]+)*$`, matches parent dir), `description` (≤1024, "what+when"),
  `license`, `compatibility`, `metadata` map. Three-level progressive disclosure
  (metadata ~100 tok / body <5000 tok / resources on demand). `allowed-tools` provisional.
  Claude-Code superset fields (`context:fork`, `effort`, `hooks`, `model`) → namespaced extension.
- **OCI Image Spec v1.1.0** as distribution envelope: image manifest with top-level `artifactType`
  (RFC 6838 vendor tree, e.g. `application/vnd.agentibus.agent.bundle.v1`). Empty config descriptor
  `application/vnd.oci.empty.v1+json` (`sha256:44136fa3…8a`, size 2) OR custom config media type.
  **Never** the removed `application/vnd.oci.artifact.manifest.v1+json` or the CNAB annotation.
  → Harness/Gitness registry distributes bundles **today, zero code change** (`dbPutManifestV2`
  stores arbitrary artifactType/config/layers without validation).
- **OCI Referrers API + `subject`** for attaching signatures/SBOM/provenance/level-attestations.
  Mandate `sha256-<digest>` tag-schema fallback.
- **Sigstore/DSSE + in-toto** signing envelope. Keep ed25519 but wrap in **DSSE** (algorithm-agnostic
  via `keyid`) so cosign/oras verify cross-registry. Sign a manifest of per-object SHA-256, never
  raw whole-container bytes.
- **W3C Verifiable Credentials 2.0 + Open Badges 3.0** as the wire format for the provable level.
  `credentialSubject.achievement{criteria, resultDescription}`, `evidence` (URL to trajectories/logs),
  `credentialStatus` (revocable), `proof{cryptosuite: eddsa-rdfc-2022}`. No bespoke JSON badge.
- **SWE-bench "verified" pattern** anti-fake rule: level trustworthy only if an independent party
  re-runs the agent on a random hidden slice it could not pre-see. Bake in mandatory independent
  re-execution.
- **MCP reverse-DNS + namespace proof** (GitHub OIDC / DNS TXT) for publisher identity;
  reserved-name blocking; full-SHA pinning of evaluated work.
- **MCP protocol 2024-11-05**, `{name, description, inputSchema}` tool contract,
  `content:[{type:text,text}]` envelope — host-requirements manifest declares required tool names.

**IGNORE / avoid:** static-benchmark contamination basis (use time-sliced post-cutoff tasks);
self-attested leaderboard scores; opaque revenue formulas (publish payout math, Poe per-message is
clean reference); vendor trademark reserved words; effort scales / context-rot token budgets as
hardcoded fields (opaque hint only); KV-cache prefix-stability as declarable field (hint only).

## 4. Single-file container — verdict

**Two-container split: SQLite (`application_id`-tagged) as working/authoring container; OCI image
manifest as distribution wrapper.**

SQLite wins the working container: `PRAGMA application_id` (offset 68) brands the file
(`file(1)`-detectable), `PRAGMA user_version` (offset 60) = format version. Use `sqlar` table
(`name, mode, mtime, sz, data BLOB`; Deflate; `sz==length(data)` = uncompressed) for SKILL.md,
`.md` knowledge, assets — stock `sqlite3` CLI opens it. Use `sqlite-vec` `vec0` virtual tables for
memory vectors (pin version in `user_version`). Read-only VFS with HTTP range reads for streaming.
**Never sign raw file bytes** (change counter offset 24, freelist, VACUUM mutate them); sign a
content-addressed per-object manifest in a `signatures` table. Diffability via `sqldiff --changeset`
+ session extension.

Then wrap the single `.acx`/`.agentpkg` file as one layer in an OCI image manifest → Referrers,
subject, content-addressed dedup, pull-through proxy, cosign attach for free from Harness registry.

## 5. Hard design tensions to resolve

1. **Codebase-agnostic base vs field-learned specificity.** Two-tier memory partition +
   codebase-fingerprint namespace + re-projection on import. Make-or-break decision.
2. **Provable level vs unfakeable evidence.** Level = VC attestation whose `evidence` links immutable
   trajectories, issued only after held-out re-run; σ-must-shrink (TrueSkill) gating.
3. **Declarative loop policy vs model-specific reality.** Declare `maxTurns`, retrieval strategy
   `{just_in_time|preload|hybrid}`, compaction *intent*, sub-agent definitions. Cannot portably
   declare summarization algorithm, KV-cache, effort numerics → mechanism vendor-side, effort opaque.
4. **Portability vs vector lock-in.** Ship `memory-records.json` always-portable baseline; vectors
   optional + engine-tagged; **mandate re-indexing on import**, never trust foreign vectors.
5. **Open standard vs sellable moat.** Format open + unencumbered; the *value* is the signed level
   attestation + field-learned memory (revocable, identity-bound). Open envelope, priced contents.
6. **Single file vs git-diffability.** `.acx` is distribution/runtime; authoring against exploded
   dir; `sqldiff --changeset` for CI row diffs. Don't force humans to diff a binary.
7. **Private key hygiene vs current practice.** Split key material out of repo; trust store =
   public keys only.
8. **Host coupling vs true portability.** 58/60 MCP tools `fetch` internal Nitro routes. Declaring a
   tool *name* is meaningless without the runtime. Bundle declares a **minimal required-tool
   contract** (execute/dispatch/memory-write/search) with capability scopes; hosts advertise
   compliance; read-only inventory tools nice-to-have.

## 6. Non-negotiable requirements

1. Private keys never in the bundle and never git-tracked. Trust registry = public keys only.
2. Automated PII/secret scrub gate on export.
3. Explicit portable-vs-local field partition on every memory artifact.
4. Content-addressed self-excluding integrity manifest + detached DSSE/ed25519 over hash-of-hashes.
   Never sign mutable container bytes. Deterministic re-verification.
5. Every file versioned: `schemaVersion` (manifest/loop-policy/memory), `user_version`/`application_id`
   (SQLite), `artifactType` vN (OCI). No unversioned files.
6. Idempotent re-import via two-key (id + fingerprint) dedupe.
7. Declared embedding-engine id + always-present JSON memory baseline; vectors optional + re-indexed.
8. Machine-readable host-requirements manifest (required MCP tool names + scopes + min protocol rev).
9. Provable level = signed, revocable, evidence-linked VC/Open-Badge, issued only after independent
   re-execution on held-out tasks.
10. Distributable as one OCI artifact today (image manifest + artifactType), verifiable with stock
    cosign/oras, zero change to Harness registry.

## Known defects in current seeds (must fix in reference impl)
- `meta/game/package-signing.json` stores ed25519 **private key in plaintext, git-tracked**.
- Example packages inconsistent with own signatures: `ada-v1.9` checksum/signature (fileCount 17)
  reference a `memory-lance/` scrubbed off disk → re-verification fails as `tampered`.
- `returns/` merge-back is a stub (`returnBackupPath` hardcoded null).
- Schema drift: `addAgentMemory()` (MCP live-write) writes a different row shape into the same
  `memories` table than `persistEventMemory()`.
