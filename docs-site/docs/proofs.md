# Proofs

Every headline claim on this site is backed by a runnable proof. This page shows the **verbatim
output** of the reference implementation. Reproduce any of it yourself — the whole thing is
zero-dependency and runs on Node ≥ 22.

!!! tip "Reproduce it"
    ```bash
    cd agent-cartridge
    npm test                                        # 69 conformance tests
    node --experimental-sqlite scripts/smoke.mjs    # export → verify → strip → tamper
    node --experimental-sqlite scripts/prove-level.mjs   # earn + verify a level
    ```

## 1 · Conformance test suite — 69/69 green

Every MUST the reference implementation supports is exercised. A representative slice:

```text
✔ §12.1 header bytes: application_id at offset 68, user_version at offset 60
✔ §12.3 DSSE/in-toto sign+verify round-trip; keyid form; subject.digest = manifest_hash
✔ §12.6 trust: unsigned -> legacy | valid+unknown -> portable | registered -> trusted | own key -> local | mutated ROM -> tampered
✔ §12.8 scrub blocks an AWS access key / a PEM private key / a GitHub token; passes clean input
✔ §3.4 strip-to-ROM: manifest hash equal when only SAVE rows are removed
✔ §12.7 sqlar skills are extractable byte-for-byte and index content_sha256 matches
✔ C1: rewriting signed sqlar content with a stale objects.oid is detected as tampered
✔ C1: rewriting a capability proficiency to verified with a stale oid is tampered
✔ §7.4 mergeRecords never collapses across the tier boundary
✔ §10.1 verifyLevelCredential rejects self-issuance / ROM digest mismatch / revocation / tampered body
✔ §7.2 codebaseFingerprint never contains the repo name/label
ℹ tests 69
ℹ pass 69
ℹ fail 0
```

## 2 · Round-trip: export → verify → strip → tamper

```text
exported cartridge: io.github.agentibus/scenario-research-designer@22f2ae29-…
rom_manifest_hash: sha256:1726cf1e6025c166e06dc839a5cbae6c900f0ffa3e0b1235be8b78e88ee09943
ROM objects: 21
skills: [ 'expertise-designer' ]
capabilities: [
  'implement-feature[pkg:generic/benchmarking+pkg:generic/research+pkg:generic/ux]',
  'build-dag[pkg:generic/snowflake+pkg:pypi/apache-airflow+pkg:pypi/dbt-core]'
]

verify (empty registry):            warning / portable  - Signature valid but signer not in trust registry.
verify (trusted registry, local):   verified / local    - Signed by this instance.

strip-to-ROM equal: true (before==after: true)

verify (objects.oid tamper):        invalid / tampered  - ROM content diverges from signed manifest.
verify (SKILL.md content tamper):   invalid / tampered  - ROM content diverges from signed manifest.

SMOKE OK
```

!!! success "What this proves"
    - A real AGENTIBUS agent exports to a single signed `.acx`.
    - The trust taxonomy behaves: `portable` for an unknown signer, `local` for our own key.
    - **strip-to-ROM equality** is the machine-checkable proof that field learning never mutated the ROM.
    - Both a metadata tamper *and* a content-body tamper (the critical **C1** attack — rewrite a signed
      `SKILL.md` while leaving the object hash stale) are caught as `tampered`.

## 3 · Provable level — earned, verified, unfakeable

```text
cartridge ROM digest: sha256:1726cf1e6025c166e06dc839a5cbae6c900f0ffa3e0b1235be8b78e88ee09943
benchmark acx-bench-dag-de@2026.07.1: 160 tasks, held-out slice digest sha256:d16bf83a37c399775…

weak agent   (competence 14): NOT ISSUED — gating failed: sigma=2.230 (<1.5?), games=50 | R=5.80  tier=junior
strong agent (competence 33): ISSUED ✅  mu=33.03 sigma=1.232 games=90 passRate=60% R=29.34 => acxLevel=29 tier=principal

credential verification: VALID ✅
capability build-dag effective proficiency (resolved from attestation): VERIFIED tier=principal
ROM signature after attaching attestation: warning / portable (intact ✅)

anti-gaming — self-issued credential:  REJECTED ✅  (issuer == subject)
anti-transplant — VC on mutated ROM:   REJECTED ✅  (ROM digest binding mismatch)
revocation — status bit set:           REVOKED ✅

PROVABLE LEVEL OK — level earned from re-run, cryptographically verified, unfakeable
```

!!! success "What this proves"
    A **weak** agent is *refused* a level; a **strong** agent *earns* one only after an independent
    held-out re-run passes the TrueSkill σ-gate. The resulting credential is cryptographically valid,
    and every forgery route — self-issuance, transplanting the level onto a mutated cartridge, and a
    revoked credential — is rejected. See [how agents level up](leveling/provable-level.md).

## 4 · The CLI, end to end

```text
$ acx export <agent-package> demo.acx --publisher io.github.agentibus
cartridge id:   io.github.agentibus/scenario-research-designer@025edd67-…
rom hash:       sha256:f479be021b8ea2e55cc6e3e33b95df9d151196548dfc854dedbe578be7120642
keyid:          ed25519:17bb8c9290fd2a3d0c3a434ad0e99544d809dbff1540d64be0bab2274df14f66
signing key:    demo.acx.key.pem  (private — kept OUTSIDE the cartridge)
field-learned:  quarantined (default)

$ acx verify demo.acx
status: warning   trust: portable   Signature valid but signer not in trust registry.   (exit 0)

$ acx strip demo.acx demo.rom.acx
rom hash before strip: sha256:f479be0…   rom hash after strip: sha256:f479be0…
hash-equality proof:   EQUAL (ROM intact; SAVE removed)   (exit 0)

$ acx level demo.acx
level: ISSUED   acxLevel: 29   tier: principal   rating: mu=32.85 sigma=1.191 games=90 pass@1=60%
credential verify: VALID
```

See the full [CLI reference](reference/cli.md).

## 5 · Interoperability & file identity

The cartridge is a plain SQLite file — the stock tools recognize and open it:

```text
$ file demo.acx
demo.acx: SQLite 3.x database, application id 1094932529, user version 16777472, …

$ sqlite3 demo.acx ".ar --list" | grep skills
rom/skills/expertise-designer/SKILL.md
```

!!! note "Honest scope"
    The benchmark's reference solver is **deterministic and pluggable** — a production verifier plugs
    in a real sandboxed agent run; the cryptographic gating, evidence, and credential machinery shown
    above are fully real. OCI push, live namespace-proof verification, and the host handshake runtime
    are specified normatively but are host-side, not part of this reference implementation.
