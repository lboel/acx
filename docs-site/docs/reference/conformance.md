# Conformance

The 16 normative **MUST** items of SPEC §12, mapped to the tests that exercise them in the zero-dependency reference implementation — and an honest accounting of the five requirements that are specified but deliberately left host-side.

A conformant Agent Cartridge is a contract with two parties: the **producer** (the tooling that authors,
signs, and levels a `.acx` file, ACX Workflow, or Agent Graph) and the **host** (the harness that boots or
consumes it). SPEC §12 enumerates sixteen `MUST` clauses that bind both. The reference implementation
proves the producer-side and cryptographic clauses end-to-end; a handful of runtime clauses — OCI push,
live namespace proofs, the activation handshake, the loop evaluator, and `vec0` vectors — are **specified
normatively but implemented by the host**, not by this repo.

!!! note "How to read this page"
    Each row links to the SPEC clause, to the format page that documents it, and — where applicable — to the exact test name that appears in the [Proofs](../proofs.md) transcript. "Exercised" means a passing assertion re-runs the behaviour on real bytes; "Host-side" means the clause is a normative requirement for a *host*, and the reference impl stops at the seam.

## The 16 MUST items

The full suite runs with **zero failures** (`node --experimental-sqlite --test 'test/*.test.mjs'` —
[Proof 1](../proofs.md)). The status column below reflects what that run and the scripted proofs actually
assert.

| # | §12 requirement | Status | Where it is proven |
|---|-----------------|--------|--------------------|
| 1 | Single SQLite ≥ 3.37, `application_id = 1094932529` (offset 68) + packed `user_version` (offset 60) | :material-check-circle: Exercised | `§12.1 header bytes…`, `§12.1 Cartridge.open rejects a non-.acx file`; [Proof 10](../proofs.md) `file(1)` magic — [container](../format/container.md) |
| 2 | Verbatim §3.2 DDL, stock `sqlar` schema, files zoned by `rom/`/`save/` prefix | :material-check-circle: Exercised | `§12.2 sqlar names must be zone-prefixed; zoneOf classifies rom/save` — [container](../format/container.md) |
| 3 | Sign **only** the ROM manifest via DSSE/in-toto (`payloadType application/vnd.in-toto+json`), Ed25519, `keyid = ed25519:<hex sha256(DER SPKI)>`, `subject.digest.sha256 = manifest_hash` | :material-check-circle: Exercised | `§12.3 DSSE/in-toto sign+verify round-trip; keyid form; subject.digest = manifest_hash`, `§4.2 DSSE envelope contains exactly {payloadType, payload, signatures}` — [signing & trust](../format/signing-trust.md) |
| 4 | Private keys out of the cartridge and out of git; publish trust as a **public-keys-only** registry | :material-check-circle: Exercised | `§12.4 loadTrustRegistry refuses private key material` — [signing & trust](../format/signing-trust.md) |
| 5 | Bind trust to `publisherId` (reverse-DNS, DNS-TXT or GitHub-OIDC proven) + `keyid`, never to `instanceId` | :material-check-circle: Binding exercised · :material-alert: proof host-side | keyid/publisher binding exercised across the `§12.6 trust` states; **live DNS-TXT / GitHub-OIDC namespace proof is host-side** — [signing & trust](../format/signing-trust.md) |
| 6 | Evaluate the trust taxonomy `tampered/legacy/portable/trusted/local` in §4.5 order | :material-check-circle: Exercised | `§12.6 trust:` ×5 (`unsigned → legacy`, `unknown signer → portable`, `registered → trusted`, `own key → local`, `mutated ROM → tampered`); [Proof 2](../proofs.md) — [signing & trust](../format/signing-trust.md) |
| 7 | Skills wholly in ROM, six-key agentskills.io frontmatter, re-derivable `acx_skill` index whose `content_sha256` matches the manifest, host-superset fields only in a reverse-DNS `ext` namespace | :material-check-circle: Exercised | `§12.7 sqlar skills are extractable byte-for-byte and index content_sha256 matches`; [Proof 9](../proofs.md) `sqlite3 … -Ax` — [skills](../format/skills.md) |
| 8 | Partition every memory record with `portable` + `codebaseFingerprint`, reject malformed tiers, run the **fail-closed** scrub gate before signing, strip TRANSFERABLE identity + quarantine FIELD-LEARNED on export, never re-project foreign field-learned memory | :material-check-circle: Exercised | `§12.8 scrub blocks…` ×4, `§7.1 validateRecord…` ×6, `§7.2 codebaseFingerprint…` ×5, `§7.5 scrub gate FAILS CLOSED`, `§7.6 stored memory payload carries schema-required zone + artifactFingerprint` — [memory](../format/memory.md) |
| 9 | Always-present JSON memory baseline, vectors tagged with an embedding-engine id, foreign vectors re-indexed (never trusted) on import | :material-check-circle: Baseline exercised · :material-alert: vec0 host-side | JSON baseline + `acx.embedding_engine` id are real ([Proof 5](../proofs.md) `acx.embedding_engine = {"id":"local-hash-128","dim":128}`); **`vec0` virtual table is specified; the reference impl uses a plain table** — [memory](../format/memory.md) |
| 10 | Merge idempotently by two-key dedupe (`id`, then 10-char `artifactFingerprint`) | :material-check-circle: Exercised | `§7.3 mergeRecords is idempotent`, `…dedupes by artifactFingerprint across different ids`, `§7.3 artifactFingerprint is exactly 10 hex chars` — [memory](../format/memory.md) |
| 11 | Exactly one **signed** harness-requirements manifest: four roles (`acx:execute`, `acx:dispatch`, `acx:memory.write`, `acx:search`), capability scopes, MCP `minProtocolRevision` floor; refuse activation (without mutating SAVE) via the §8.5 handshake when unmet | :material-check-circle: Manifest exercised · :material-alert: handshake host-side | `§8 harness-requirements manifest matches its schema (requiredTools, no forbidden keys)`; **the activation handshake runtime is specified; host-side** — [harness requirements](../format/harness-requirements.md) |
| 12 | Exactly one ROM-zone loop-context policy evaluated **as data**, all vendor/effort/KV-cache/summarization specifics confined to an ignorable `hints` object; enforce host `resource-limits.yaml` precedence over cartridge `budget` | :material-alert: Specified; host-side | Policy is carried in ROM and schema-validated; **the loop-policy evaluator and resource-limits precedence run in the host** — [loop & context](../format/loop-context.md) |
| 13 | Any level is a revocable, evidence-linked VC 2.0 / Open Badge 3.0, issued only after independent held-out re-execution, TrueSkill σ-gated (`sigma < 1.5`, `gamesPlayed ≥ 30`, `R = mu − 3σ`), bound to the ROM digest | :material-check-circle: Exercised | `§10.1 verifyLevelCredential accepts a valid, gated, ROM-bound credential` (+ rejects self-issuance / ROM mismatch / revoked / tampered), `§10.2 a weak agent fails the sigma gate → no VC issued`; [Proof 3](../proofs.md) — [provable level](../leveling/provable-level.md) |
| 14 | Distribute as **one** OCI image (§11), `artifactType application/vnd.acx.cartridge.v1`, verifiable with stock cosign/oras and **zero** registry change | :material-alert: Specified; host-side | The OCI wrapping is normatively specified; **the push/verify runtime is host-side** (stock `cosign`/`oras`, no code in this repo) — [distribution](../lifecycle/distribution.md) |
| 15 | Validate workflows independently of staffing; require closed structured conditions, complete references and completion contracts, terminal reachability, bounded cycles, and verify the JCS digest plus DSSE/in-toto publisher binding before slot resolution | :material-check-circle: Exercised | `acx.cal/1 publish profile accepts…`, `CAL conditions are closed structured data…`, `cyclic workflows fail closed…`, `workflow signing binds…`, tamper/trust/revocation tests, and `workflow lint separates portable structure checks from roster readiness` — [loop engineering](../format/loops-cal.md) |
| 16 | Validate Agent Graphs as non-executing information architecture: description-only knowledge, complete actor/knowledge/loop/return references, conflict-free mandatory direction, unambiguous bindings, and bounded propagation/convergence; verify the distinct JCS + DSSE/in-toto identity binding before publication | :material-check-circle: Exercised | `acx.agent-graph/1 accepts fuzzy prose with hard reference invariants`, reference/return/direction/convergence failure tests, secret-like metadata rejection, workflow-ref pinning, signature tamper/trust tests, and safe registry sharing — [Agent Graph](../format/agent-graph.md) |

!!! success "What the crypto actually proves"
    Items 3, 4, 6, 8, and 13 are the security spine, and they are **fully real** — no stubs. Signing recomputes every object hash from live bytes (`buildRomManifest` → `liveOid()`), so a rewritten `SKILL.md` body or an upgraded capability proficiency is caught even when its stored `objects.oid` is left stale:

    ```text
    verify (objects.oid tamper):          invalid / tampered
    verify (SKILL.md content tamper, oid stale): invalid / tampered
    strip-to-ROM equal: true (before==after: true)
    ```

    The `strip-to-ROM` round-trip proves by **hash equality** that removing every SAVE row leaves the signed ROM byte-identical — `sha256:1726cf1e6025c166e06dc839a5cbae6c900f0ffa3e0b1235be8b78e88ee09943` before and after ([Proof 7](../proofs.md)).

## The five host-side clauses, stated plainly

These are **normative** requirements a conformant *host* must satisfy. The reference implementation stops at the seam by design — it is a zero-dependency producer/verifier (Node ≥ 22 `node:sqlite` + `node:crypto`), not a running harness or a registry client.

=== "OCI push (item 14)"

    The `.acx` file is one layer in an OCI image manifest with `artifactType application/vnd.acx.cartridge.v1`. The format guarantees this distributes through any OCI registry and verifies with stock `cosign`/`oras` — but the reference repo does **not** ship a push runtime. See [distribution](../lifecycle/distribution.md).

=== "Namespace proof (item 5)"

    Trust binds to a `publisherId` that is *proven* to own its reverse-DNS name via DNS-TXT or GitHub-OIDC. The reference impl exercises the `publisherId + keyid` binding (never `instanceId`) but does **not** perform live DNS/OIDC resolution. Publisher handles like `io.github.agentibus` are illustrative, not real orgs.

=== "Handshake runtime (item 11)"

    The signed harness-requirements manifest and its schema are exercised. The §8.5 capability-negotiation handshake — refuse activation without mutating SAVE when roles/`minProtocolRevision` are unmet — is a host runtime and is not implemented here.

=== "Loop evaluator (item 12)"

    The loop-context policy is carried in ROM as data and schema-validated. Evaluating it (turn loop, verification/regression gates, `resource-limits.yaml` precedence over `budget`) is host work. The cartridge is deliberately declarative — "the cartridge **MUST NOT** specify a summarization algorithm."

=== "vec0 vectors (item 9)"

    Item 9's JSON baseline and embedding-engine tagging are real; the `vec0` virtual table is specified but the reference impl materialises a plain table instead. Because `vectors` is derived, never signed, and rebuilt on import, the concrete storage is a local detail that does not touch ROM integrity (SPEC §3.5).

!!! warning "One more honesty note: the benchmark solver is pluggable"
    Item 13's gating, credential, and revocation machinery is fully real, but the benchmark's **reference solver is deterministic and ROM-bound by design** (`§10.3 referenceSolver is deterministic and ROM-bound`) — a stand-in so the σ-gate and VC pipeline can be proven without a live model. A production verifier plugs a real sandboxed agent run into the same seam. The *unfakeability* properties (no self-issuance, ROM-digest binding, σ-gate, sealed held-out slice, revocation) do not depend on the solver:

    ```text
    weak agent  (competence 14): NOT ISSUED — sigma=2.230 (<1.5?)  R=5.80  tier=junior
    strong agent (competence 33): ISSUED ✅  mu=33.03 sigma=1.232  R=29.34 => acxLevel=29 tier=principal
    anti-transplant — VC on mutated ROM: REJECTED ✅ ['ROM digest binding mismatch']
    ```

    The held-out slice for `acx-bench-dag-de@2026.07.1` is sealed to digest `sha256:d16bf83a37c399775…` and the credential binds to ROM digest `sha256:1726cf1e6025c166…` ([Proof 3](../proofs.md)).

## Versioning & extension policy

SPEC §12 closes with a rule that keeps future readers safe: **every stored artifact MUST be versioned, and every extension point MUST be namespaced.** No unversioned files exist in the format.

### Everything carries a version

| Layer | Version carrier | Values |
|-------|-----------------|--------|
| SQLite container | `application_id` + packed `user_version` | `1094932529` / `16777472` = `[MAJOR=1][MINOR=0][vec0=1][flags]` |
| Skill index | `schemaVersion` | `acx.skill/1` |
| Capability record | `schemaVersion` | `acx.capability/1` |
| Harness requirements | `schemaVersion` | `acx.harness.v1` |
| Loop-context policy | `schemaVersion` | `acx.loop-context-policy/1` |
| Memory record | `schemaVersion` | memory-record v1 |
| OCI distribution | `artifactType` | `application/vnd.acx.cartridge.v1` |
| ACX Workflow | `schemaVersion` + SemVer + integrity version | `acx.cal/1`, `version: 1.0.0`, `acx.workflow-signature/1` |
| ACX Agent Graph | `schemaVersion` + SemVer + integrity version | `acx.agent-graph/1`, `version: 1.0.0`, `acx.agent-graph-signature/1` |

Spec evolution follows a two-track rule: **`spec_MAJOR` bumps break readers; `spec_MINOR` is additive.** v1.1 of the loop-context policy was a `spec_MINOR` addition — it layered `plan`/`reflect` phases, `verification.regression` (held-in/held-out), `observability`, `subAgents[].mode`, and `context.playbook` onto v1 without breaking a v1 reader (SPEC §9.6).

### Extensions live in a namespace or nowhere

The rule for forward compatibility: **recognizing hosts consume their namespace; every other reader MUST ignore unknown namespaces without error.** The namespaced extension points are:

- Reverse-DNS keys under `acx_skill.ext` (host-superset frontmatter like Claude Code `context`, `effort`, `hooks`, `model` travels here, never as top-level frontmatter keys).
- Reverse-DNS-prefixed `taskType` tokens.
- `x-`-prefixed capability scopes.
- Reverse-DNS keys under an Agent Graph's `extensions` object; unknown namespaces remain ignorable.
- A2A `AgentExtension` for capability records (`uri: https://acx.dev/a2a/ext/capability/v1`) — plain A2A clients still see a discoverable skill; extension-aware clients read verified proficiency.
- `acx:` JSON-LD terms in level credentials.

!!! tip "Why this matters for a signed artifact"
    Because the ROM manifest is content-addressed and signed, an unversioned or un-namespaced field would be a silent trust hazard — a reader could misinterpret it and still see a valid signature. Versioning + namespacing is what lets a v1 host safely boot a v1.1 cartridge (ignoring what it does not understand) rather than failing closed or, worse, guessing.

## Resolved contradictions

The format is stitched together from six independent design blocks, which disagreed in six places. SPEC §12 records each disagreement and its binding resolution — the standard **stands** because all six were resolved coherently (`design/01-review-response.md`).

| # | Tension | Resolution | SPEC |
|---|---------|------------|------|
| 1 | DSSE `payloadType`: `application/vnd.acx.rom-manifest.v1+json` vs `application/vnd.in-toto+json` | in-toto Statement v1 is the DSSE payloadType; the rom-manifest is the predicate content — keeps stock cosign/oras working | §4.2 |
| 2 | `keyid`: reverse-DNS publisher id vs `ed25519:<hex sha256(DER SPKI)>` | Content-addressed form wins; `publisherId` lives in the predicate/registry, not in `keyid`. Verified live: `ed25519:17bb8c9290fd2a3d0c3a434ad0e99544d809dbff1540d64be0bab2274df14f66` ([Proof 4](../proofs.md)) | §4.2 |
| 3 | `artifactFingerprint` slice length: spec-mandated 10 vs live 12 | Canonical length is **10**; the reference impl re-keys (`§7.3 artifactFingerprint is exactly 10 hex chars`) | §7.3 |
| 4 | `vec0` dimension: DDL `float[384]` vs engine `local-hash-128` (dim 128) | The `vectors` DDL is a per-engine **template**; dimension is taken from `acx.embedding_engine.dim`. `vectors` is derived, never signed, rebuilt on import | §3.5 |
| 5 | OCI vendor tree: `application/vnd.agentibus.*` vs `application/vnd.acx.*` | `application/vnd.acx.*` is normative; the `agentibus` naming is superseded and appears nowhere normatively | §11 |
| 6 | ROM digest naming: block C's `manifest_hash` vs block Identity's `packageHash` | Same value; unified as "the ROM `manifest_hash`, which is this format's `packageHash`" | §3.3, §4.1 |

!!! note "Open questions carried forward (non-normative)"
    SPEC §13 lists what is deliberately *not* pinned yet: the minimum `sqlite-vec` version and a stable `vec1` format; trust-registry federation and rollback protection; keyless Sigstore (Fulcio/Rekor) as an alternative to the static registry; `installationSalt` rotation and SAVE re-namespacing; the exact `R → acxLevel` bucketing calibration; verifier accreditation/quorum governance; and selective-disclosure (BBS/SD-JWT) for trajectory evidence. Workflow signing itself is pinned to RFC 8785/JCS. These open questions do not affect v1 conformance.

---

**See also:** [Proofs](../proofs.md) (the transcript and artifact checks behind the test names above) ·
[CLI](cli.md) · [Schemas](schemas.md) (the 13 draft-2020-12 schemas the `schemaVersion` tags point at).
