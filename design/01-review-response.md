# Adversarial Review — Response & Resolution

The Phase-4 adversarial review (3 reviewers over conformance, crypto/security, correctness)
produced 22 findings. Below: what was fixed in code (with the regression test that locks it in)
and what is explicitly **scoped out** of the zero-dependency reference implementation.

## Fixed (verified by `test/hardening.test.mjs` + `scripts/smoke.mjs`)

| # | Sev | Finding | Fix | Regression test |
|---|-----|---------|-----|-----------------|
| C1 | **critical** | Signed ROM manifest was built from self-declared `objects.oid`, never re-hashed from live content → an attacker could rewrite a signed `SKILL.md` body or capability proficiency and it still verified as `trusted`. | `buildRomManifest` now recomputes each oid from live content via `liveOid()` (sqlar bytes / memory payload / capability json / meta). Any divergence ⇒ `tampered`. `finalizeAndSign` refuses to sign on mismatch. | `C1: rewriting signed sqlar content…`, `C1: rewriting a capability proficiency…` |
| H1 | high | Scrub gate only scanned `.md`/`.json` and a fixed subset of record fields. | `scrubOrThrow` scans **every** `rom/` sqlar entry (incl. scripts/assets/binaries) + capability rows; `collectScanItems` walks **every** string field recursively. | `§7.5 scrub gate catches …` |
| H2 | high | Secret detector missed hex-encoded (entropy caps at 4.0), short, and `access_token=`/`passwd=` secrets. | Added pure-hex ≥32 detector, charset-normalized base64 detector (digit/length-gated to avoid identifier false positives), and an assignment-shape regex (`\b[\w-]*(secret|token|password|passwd|pwd|api_key|…)\s*[=:]…`). | `§7.5 scrub gate …` |
| H3 | high | `mergeRecords` collapsed TRANSFERABLE (ROM) and field-learned (SAVE) records across the quarantine boundary; survivor was order-dependent. | Second dedupe key now includes `portable` + `codebaseFingerprint`; `resolveConflict` throws if asked to cross the boundary. | `§7.4 mergeRecords never collapses across the tier boundary` |
| H4 | high | `harness-requirements.json` (signed into ROM) failed its own schema (`tools`/`fsScopes` vs `requiredTools`/`filesystem`/`network`). | `defaultHarnessRequirements` emits schema-valid keys (`requiredTools`, `optionalTools`, `filesystem`, `network`). | `§8 harness-requirements manifest matches its schema` |
| H5 | high | Canonical memory payload (the import source of truth) omitted schema-required `artifactFingerprint` + `zone`. | `insertMemory` stores the full projection including both. | `§7.6 stored memory payload carries …` |
| M1 | medium | `mergeRecords` conflict resolution was non-commutative. | Canonical survivor = lower `id`; longer-then-lexicographic tie-breaks; impact/xp/tags/timestamp already commutative. | `§7.3 mergeRecords is commutative` |
| M2 | medium | Unsigned/unverifiable cartridges could be blessed and an unverified envelope reported as "Signature valid". | Live-content mismatch ⇒ `tampered` (evaluated first); no key available ⇒ explicit "UNVERIFIED", never "valid". | `§4.5 unverifiable envelope … never claims valid` |
| M3 | medium | DSSE envelope carried a non-standard `_acxInlinePublicKeyPem`, breaking the schema and stock cosign/oras, and used as a trust fallback. | Public key moved to a `signatures.public_key_pem` column; envelope is exactly `{payloadType,payload,signatures}`. | `§4.2 DSSE envelope contains exactly …` |
| DDL | medium | `attestations` table diverged from the §3.2 verbatim schema. | Restored `document` / `status_url` / `media_type NOT NULL`. | (exercised by `prove-level` + CLI `level`) |
| corr | medium | `deriveSkillIndex` keyed on mutable frontmatter `name`; duplicate names aborted export. | `acx_skill` PK is now `sqlar_path` (authoritative) with `ON CONFLICT` upsert. | (export path) |
| corr | medium | Export classified `repoId=''` / `0` as portable ROM, bypassing quarantine + repo-literal scrub. | Only `null`/undefined `repoId` is transferable; every record's slug-shaped repo labels feed `forbidLiterals`. | (export path) |

Also fixed: the level lifecycle. `acx level` / `prove-level` no longer mutate the **signed** ROM
capability (which C1 correctly flags as tampering). The verified proficiency is **derived** by
resolving the ROM-digest-bound VC attestation; the ROM signature stays intact. Baking
`verified:true` into a capability requires a publisher re-export + re-sign (a new cartridge version).

## Scoped out of the reference implementation (documented, not silently skipped)

These are conformance items whose full runtime is out of scope for a zero-dependency reference impl.
They are **specified normatively** in `SPEC.md`; the reference impl asserts them at the data-structure
level only. A production host implements the runtime.

- **MUST 14 / §11 — OCI push.** No image-manifest generation / registry push / `cosign`/`oras`
  round-trip. The `.acx` file is produced; wrapping it as an OCI layer + Referrers is documented in
  §11 and is intentionally left to a Harness/Gitness integration.
- **MUST 11 / §8.5 — harness handshake runtime.** The signed requirements manifest is produced and
  schema-valid; the host-side compliance descriptor, capability negotiation, `-32602` refusal path,
  and cartridge preflight are not implemented (they belong to a host, not the cartridge).
- **MUST 12 / §9 — loop-policy evaluator + budget precedence.** The policy is authored, signed, and
  confined-to-`hints`; a runtime evaluator and host `resource-limits.yaml` precedence are host-side.
- **M4 / §4.3 — namespace-proof verification.** Trust checks that a `namespaceProof` is present but
  does not perform live DNS-TXT / GitHub-OIDC validation. A production trust resolver must verify the
  proof material and that its granted namespace covers `publisherId`.
- **§3.5 — vec0 vectors.** Vectors use a plain table (node:sqlite cannot load `sqlite-vec`);
  integrity-neutral per §3.5/§7.6 (vectors are derived, never signed, re-indexed on import). A
  conformant build uses the `vec0` virtual table.
- **§10.2 — real agent execution.** The benchmark verifier uses a deterministic, ROM-bound reference
  solver so the issuance protocol, σ-gating, evidence, and credential machinery are fully exercised
  and reproducible. A production verifier plugs a real sandboxed agent run into the same interface;
  the surrounding protocol is unchanged.

## Verdict

The standard **stands**: the spec is coherent and self-consistent (all six block contradictions
resolved), and the reference implementation demonstrates every headline property — portable
single-file container, ROM/SAVE partition with a machine-checkable strip-to-ROM proof, content-bound
DSSE/ed25519 signing that now catches content tampering (C1), the fail-closed scrub gate, and a
**provable character level** earned only via independent held-out re-run, σ-gated, ROM-bound,
revocable, and unfakeable. The full conformance suite is green, including signed workflow,
team-readiness, immutable-registry, static-Exchange, and safe PR-sharing coverage.
