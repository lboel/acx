# Memory partition

The memory block splits an agent's learned knowledge into a **transferable, sharable ROM core** and a **field-learned, codebase-specific SAVE tier** — bound together by a privacy-preserving fingerprint, an idempotent merge that never crosses the tier boundary, and a fail-closed scrub gate that blocks export the moment a secret appears.

This page covers SPEC §7. The reference logic lives in `src/memory.mjs` (partition, fingerprints, merge) and `src/scrub.mjs` (the export gate).

!!! quote "Why the two tiers exist"
    Lilian Weng's [*Harness Engineering for Self-Improvement*](https://lilianweng.github.io/posts/2026-07-04-harness/) (2026-07-04) argues that "a harness should not carry the entire workflow and all logs in context; instead, it should keep durable state in files." A cartridge *is* that durable state — but durable state that ships to other people has to answer a question a log file never does: **which of these memories are safe to give away, and which are about one specific repo?** That is exactly what the `portable` flag decides.

---

## The two tiers

Every memory record **MUST** carry a mandatory boolean `portable`. That single field selects the tier, the [container](container.md) zone, and the export rules.

=== "TRANSFERABLE (`portable: true`)"

    - Codebase-agnostic know-how — the portable, shareable core.
    - Lands in the **ROM zone**, so it is covered by the [signed manifest](signing-trust.md).
    - `codebaseFingerprint` **MUST** be `null` and `repoId` **MUST** be `null`.

=== "FIELD-LEARNED (`portable: false`)"

    - Codebase-specific memory learned on the job.
    - Lands in the mutable **SAVE zone**.
    - **MUST** carry a non-null `codebaseFingerprint`.
    - **Quarantined by default**: excluded from export unless `--include-field-learned` is passed, and even then it **MUST NOT** re-project onto an importer's codebase (§7.4).

`portable` and `codebaseFingerprint` are the *only* two additions to the upstream AGENTIBUS `AgentMemoryArtifact` shape; every other field (`title`, `summary`, `sourceType`, `impact`, `xpAwarded`, `tags`, `timestamp`, …) is reused verbatim.

The tier invariants are enforced at import by `validateRecord` — a malformed record is rejected, not coerced:

```js
// src/memory.mjs — validateRecord
if (rec.portable) {
  if (rec.codebaseFingerprint != null) throw new Error("portable=true requires codebaseFingerprint=null")
  if (rec.repoId != null)              throw new Error("portable=true requires repoId=null")
} else {
  if (rec.codebaseFingerprint == null) throw new Error("portable=false requires a codebaseFingerprint")
}
```

The conformance suite pins all four failure modes (see [Proofs](../proofs.md)):

```text
✔ §7.1 validateRecord accepts a well-formed portable record
✔ §7.1 validateRecord accepts a well-formed field-learned record
✔ §7.1 validateRecord rejects missing boolean portable
✔ §7.1 validateRecord rejects portable=true with a codebaseFingerprint
✔ §7.1 validateRecord rejects portable=true with a repoId
✔ §7.1 validateRecord rejects portable=false without a codebaseFingerprint
```

```mermaid
flowchart TD
    R[memory record] --> P{portable?}
    P -- "true" --> T[TRANSFERABLE<br/>ROM zone<br/>cbf = null, repoId = null]
    P -- "false" --> F[FIELD-LEARNED<br/>SAVE zone<br/>cbf = cbf1_…]
    T --> ROM[(signed ROM manifest)]
    F --> SAVE[(mutable SAVE, quarantined)]
```

!!! tip "This is what `strip-to-ROM` re-exports"
    Because field-learned memory sits in SAVE, `acx strip` can drop it and re-export a ROM-only cartridge whose manifest hash is **byte-identical** to the original. See the hash-equality proof under [signing & trust](container.md#strip-to-rom).

---

## The codebase fingerprint (privacy-preserving)

A field-learned record needs to say *"I belong to this repo"* — without ever naming the repo. `codebaseFingerprint` is a keyed HMAC that satisfies both.

!!! warning "The fingerprint is never the repo name"
    `codebaseFingerprint` **MUST NOT** be, contain, or derive from the repo name, `repoLabel`, or `projectLabel`. It is a one-way keyed hash. The conformance test `§7.2 codebaseFingerprint never contains the repo name/label` asserts this directly.

```js
// src/memory.mjs
// "cbf1_" + HMAC-SHA-256(key = installationSalt, msg = canonicalRepoIdentity)[:40]
export function codebaseFingerprint(installationSalt, canonicalRepoIdentity) {
  if (!installationSalt || Buffer.byteLength(installationSalt) < 32) {
    throw new Error('installationSalt must be >= 256 bits')
  }
  return 'cbf1_' + hmacSha256Hex(installationSalt, canonicalRepoIdentity).slice(0, 40)
}
```

The output matches the schema pattern `^cbf1_[0-9a-f]{40}$` — a `cbf1_` version tag plus 160 bits of hex.

**Two inputs, two guarantees:**

| Input | What it is | Property it buys |
| --- | --- | --- |
| `installationSalt` | a ≥ 256-bit **org-scoped secret**, held outside the bundle, **never exported** | secret key ⇒ dictionary-resistant; org-scoping ⇒ **intentionally non-correlatable across orgs** — the quarantine boundary |
| `canonicalRepoIdentity` | the git origin normalized to `host/path` | stable within an org, across every machine and clone |

`canonicalRepoIdentity` normalizes away every accidental difference between two URLs that point at the same repo — scheme, credentials, `user@` SCP form, `:` host separator, trailing `.git`, trailing slashes — falling back to the root-commit SHA when there is no remote:

```js
// src/memory.mjs — canonicalRepoIdentity (all of these collapse to one identity)
//   https://user:pass@github.com/acme/api.git  →  github.com/acme/api
//   git@github.com:acme/api.git                →  github.com/acme/api
```

The four §7.2 tests capture the full contract:

```text
✔ §7.2 codebaseFingerprint never contains the repo name/label
✔ §7.2 codebaseFingerprint is stable for the same salt + identity
✔ §7.2 codebaseFingerprint differs across installation salts (org quarantine)
✔ §7.2 codebaseFingerprint rejects a weak (<256-bit) salt
✔ §7.2 canonicalRepoIdentity normalizes scheme/credentials/.git/scp forms equally
```

!!! note "Quarantine, concretely"
    Two orgs that both learned something in a repo named `payments` will produce **different** fingerprints, because their salts differ. Foreign field-learned memory imported from someone else keeps its *own* fingerprint and `foreign: true`, and **MUST NOT** be rewritten to the importer's fingerprint (§7.4). Only TRANSFERABLE records are ever eligible to merge into native memory.

---

## The idempotent two-key merge

Import merge is a verbatim reuse of AGENTIBUS's `mergeMemoriesIntoManifest`. It dedupes on **two keys in order**: first `id`, then a content address called `artifactFingerprint`.

```text
artifactFingerprint = sha1( title + summary + sourceType + repoId +
                            projectLabel + timestamp + impact +
                            xpAwarded + tags ).hex[0:10]
```

Text is trimmed + lowercased; tags are lowercased + sorted; the whole thing is JCS-canonicalized before hashing, so it is stable under key-order, case, and whitespace noise.

!!! info "Tier fields are deliberately excluded from the content address"
    `portable` and `codebaseFingerprint` are **not** part of `artifactFingerprint`. A record's content address is therefore **tier-independent** — re-tiering a memory never forks a duplicate. Tests: `§7.3 artifactFingerprint excludes portable + codebaseFingerprint (tier-independent)` and `§7.3 artifactFingerprint is stable under tag reordering + case + whitespace`.

??? note "Contradiction resolved: slice length is 10, not 12"
    The live `shortHash()` helper sliced **12** chars; the binding constraint map and SPEC §7.3 mandate **10**. The spec resolves the conflict in favor of **10**, and the reference implementation re-keys existing fingerprints to 10 — asserted by `§7.3 artifactFingerprint is exactly 10 hex chars`.

**Deterministic, commutative conflict resolution.** When two records collide, the survivor is computed the same way regardless of arrival order:

| Field | Rule |
| --- | --- |
| `title`, `summary` | **longer** text wins (tie → lexicographically smaller) |
| `impact` | **worse** wins — `negative` > `neutral` > `positive` |
| `xpAwarded` | **max** |
| `tags` | **union**, sorted |
| `timestamp` | **latest** |

Because the merge is deterministic and order-independent, it is also idempotent — merging twice equals merging once:

```text
✔ §7.3 mergeRecords is idempotent (merge twice == merge once)
✔ §7.3 mergeRecords is commutative (order-independent survivor)
✔ §7.3 mergeRecords resolves conflicts: longer text, worse impact, max xp, union tags, latest ts
✔ §7.3 mergeRecords dedupes by artifactFingerprint across different ids
✔ §7.3 mergeRecords keeps distinct records distinct
```

### The tier-boundary rule: never collapse across it

The second dedupe key is **not** just the fingerprint — it is `fingerprint | tier | codebaseFingerprint`. Two records with the same content but different tiers (or different codebases) hash to the same `artifactFingerprint` yet occupy **different merge slots**, and any attempt to actually fold them together is refused:

```js
// src/memory.mjs — resolveConflict
if (a.portable !== b.portable ||
    (a.codebaseFingerprint ?? null) !== (b.codebaseFingerprint ?? null)) {
  throw new Error(`refusing to merge across the tier/codebase boundary (${a.id} vs ${b.id})`)
}
```

This is what keeps a private field-learned lesson from ever silently absorbing — or being absorbed into — the sharable ROM core:

```text
✔ §7.4 mergeRecords never collapses across the tier boundary
```

---

## The scrub gate (fail-closed)

Before a cartridge is signed, an export-time scrub gate scans **every string field of every record, every `sqlar` knowledge `.md`, and every skill body**. On any secret match it **blocks the export with a non-zero exit** — secrets are *never* silently redacted.

!!! danger "Fail-closed means the export dies, not the secret"
    The default outcome on a hit is refusal. `scrub()` returns `{ blocked, findings[] }`, and `exportPackageToCartridge` throws `scrub gate blocked export` when `blocked` is true. There is no "redact and continue" path for secret matches.

**Deny rules** (`src/scrub.mjs`, case-insensitive) — a match on any of these blocks:

| Rule id | Catches |
| --- | --- |
| `pem-private-key` | `-----BEGIN … PRIVATE KEY-----` headers |
| `aws-access-key` | `AKIA[0-9A-Z]{16}` |
| `github-token` | `gh[pousr]_[A-Za-z0-9]{36,}` |
| `slack-token` | `xox[baprs]-…` |
| `google-api-key` | `AIza[0-9A-Za-z_-]{35}` |
| `jwt` | `eyJ….….…` |
| `uri-credentials` | `://user:pass@host` |
| `secret-assignment` | `access_token=`, `client_secret=`, `passwd=`, `api-key=`, … |
| `high-entropy` | pure-hex ≥ 32 chars, or high-entropy base64/base64url blobs |
| `repo-identifier-leak` | any raw `repoId`/`repoLabel`/`projectLabel` literal surviving §7.4 |

!!! note "Home paths are a warning, not a block"
    Local home paths (`/Users/<name>`, `/home/<name>`, `C:\Users\<name>`, or `~/…`) are flagged but
    treated as **non-blocking** — they **MAY** be replaced with an environment-independent relative
    locator and re-scanned. Only the secret and leak rules above set `blocked: true`.

    The high-entropy rule is deliberately tuned so that hyphenated/camelCase identifiers (`LicenseRef-…`, `preferredProtocolRevision`) are *not* false positives, while a random 40-char token is. A pure-hex SHA/HMAC key tops out at 4.0 bits/char, so hex secrets get their own explicit `≥ 32 chars` branch rather than relying on an absolute-entropy threshold that could never catch them.

### The "FAILS CLOSED" proof

The suite ships a poisoned package: a **`portable: true`** record whose `summary` is `set AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE for the pipeline`. Export is attempted — and refused:

```text
✔ §7.5 scrub gate FAILS CLOSED: export is blocked when a portable record carries a secret
✔ §7.5 scrub gate catches hex secrets, access_token=, passwd= (H2) and passes clean text
✔ §12.8 scrub blocks an AWS access key
✔ §12.8 scrub blocks a PEM private key
✔ §12.8 scrub blocks a GitHub token
✔ §12.8 scrub passes clean input
```

```js
// test/export.test.mjs — the poisoned portable record that must not ship
assert.throws(
  () => exportPackageToCartridge({ packageDir: dir, outPath: badOut, key, /* … */ }),
  /scrub gate blocked export/,
)
```

The CLI reflects the same default on a clean package — field-learned memory is `quarantined (default)`:

```text
$ node --experimental-sqlite src/cli.mjs export …
field-learned:  quarantined (default)
wrote:          /tmp/demo.acx
```

---

## Portable baseline + re-indexed vectors

Memory travels as **canonical JSON first, vectors never**.

- `memory-records.json` — the canonical-JSON projection of the `memory` rows — is the **always-present portable baseline** and the **sole source of truth on import**. A bundle with vectors but no JSON baseline is **invalid**.
- Vectors are optional, live in SAVE-zone `vec0` tables, and **MUST** be tagged with the manifest's `embeddingEngine` id (e.g. `{"id":"local-hash-128","dim":128}`, visible under `acx.embedding_engine` in [`acx inspect`](../reference/cli.md)).
- On import a consumer **MUST re-index every record from the JSON baseline using its own engine** and **MUST discard foreign vectors**.

!!! note "vec0 is specified; the reference impl uses a plain table"
    The spec normatively describes SAVE-zone `vec0` virtual tables, but the zero-dependency reference implementation (Node ≥ 22 `node:sqlite`, run with `node --experimental-sqlite`) stores vectors in a **plain table** — the `vec0` extension itself is host-side and scoped out of the reference build. The re-index-from-JSON contract holds either way: foreign vectors are always thrown away and rebuilt locally.

This is the memory-side echo of the harness principle that "many harness improvements will be internalized into core model behavior, but the interface with external context and tools should remain" — the *records* are the durable, portable interface; the vector index is a disposable, engine-local acceleration.

---

## Related

- [The container](container.md) — the ROM/SAVE zones these records live in.
- [Signing & trust](signing-trust.md) — why ROM memory is covered by the signed manifest, and the `strip-to-ROM` hash-equality proof.
- [Provable level](../leveling/provable-level.md) — held-in/held-out re-runs that turn earned experience into an unfakeable credential.
- [Proofs](../proofs.md) — the full verbatim test + smoke transcript quoted above.
- SPEC §7 (Memory Partition), §7.1–§7.6.
