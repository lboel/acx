# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The **Agent Cartridge (`.acx`)** open standard and its **zero-dependency reference implementation**. A
cartridge is a single SQLite file packaging a specialized coding agent (skills, capabilities, memory,
harness/loop policy, identity, provable level). `SPEC.md` is the normative spec; everything in `src/`
implements it. This folder is **standalone and meant to be extracted into its own public repo** — it must
not depend on any parent repository.

## Commands

Everything runs on **Node ≥ 22** through the builtin `node:sqlite`, which requires the
`--experimental-sqlite` flag (the `acx` bin's shebang adds it automatically; scripts need it explicitly).

```bash
npm test                                              # 69 conformance tests
node --experimental-sqlite --test test/memory.test.mjs   # a single test file
node --experimental-sqlite scripts/smoke.mjs          # export→verify→strip→tamper; rewrites examples/research-designer.acx
node --experimental-sqlite scripts/prove-level.mjs    # earn + verify a provable level end to end
node --experimental-sqlite src/cli.mjs <cmd>          # the acx CLI (export/inspect/verify/spec/check/load/cal/init/level/ls/strip/builder)

node --experimental-sqlite platform/seed.mjs          # seed platform/catalog with a demo roster
node --experimental-sqlite platform/server.mjs        # the HTTP exchange (:8787)
node --experimental-sqlite src/cli.mjs builder        # the visual CAL/RAC loop builder (:8799)
node --experimental-sqlite tools/build-registry-index.mjs   # verify + index the git registry (CI gate)

cd docs-site && uv venv && uv pip install zensical     # one-time docs toolchain
cd docs-site && .venv/bin/zensical build               # build docs → docs-site/site/ (must say "No issues found")
cd docs-site && .venv/bin/zensical serve               # live docs preview
```

`npm test` uses the glob form `--test 'test/*.test.mjs'` on purpose: a bare `--test test/` is treated as a
module path and fails on recent Node.

## Architecture (the parts that need multiple files to understand)

**Zero runtime dependencies.** Only `node:sqlite` + `node:crypto`. Do not add npm dependencies to the core;
that constraint is a feature. `src/cli.mjs` is a thin dispatcher — all real logic lives in `src/` modules.

**The container (`src/container.mjs`).** A cartridge is one SQLite DB (`application_id` = `0x41435831` =
"ACX1"). Files live in the stock `sqlar` table, zoned by a `rom/` or `save/` name prefix. The `objects`
table content-addresses every ROM unit. **ROM zone** = signed/immutable/shareable; **SAVE zone** =
mutable/field-learned. `src/strip.mjs` removes SAVE and proves by hash equality the ROM was untouched.

**Integrity is the load-bearing invariant — do not regress it.** `buildRomManifest` (`src/sign.mjs`)
recomputes each object's content address from its **live** bytes/JSON via `liveOid()`; it never trusts the
stored `objects.oid`, and signing/verification never touch the raw SQLite bytes (which mutate on any SAVE
write). This is what makes "rewrite a signed SKILL.md but leave objects.oid stale" verify as `tampered`
(the C1 fix; regression-tested in `test/hardening.test.mjs`). Signing is ed25519 wrapped in a **DSSE /
in-toto** envelope; the public key lives in the `signatures.public_key_pem` column, never inside the
envelope. Trust taxonomy (`local/trusted/portable/legacy/tampered`) is in `src/trust.mjs`.

**Content addressing** rests on RFC-8785 JCS canonicalization (`src/canonical.mjs`). Changing it silently
breaks every signature — treat it as frozen.

**The export pipeline order matters (`src/export.mjs`).** Anything written with `cart.putFile(...)` before
`finalizeAndSign` becomes part of the signed ROM manifest. Current order: knowledge/skill files → memory →
capabilities → `deriveSkillIndex` → `emitCalSkillSet` → `emitPackageSpec` (must be last so its artifact
counts are accurate) → `bindRomMeta` → **`scrubOrThrow` (fail-closed secret gate)** → `finalizeAndSign`.
To add a new signed ROM artifact, `putFile` it before finalize and, if it's a declared artifact, register
it in `src/packagespec.mjs`.

**Memory partition (`src/memory.mjs`).** Every record carries `portable` (ROM) vs field-learned (SAVE, with
a privacy-preserving `codebaseFingerprint`). `artifactFingerprint` is 10 chars and **excludes**
`portable`/`codebaseFingerprint` so re-tiering never forks a duplicate; `mergeRecords` is commutative and
**never merges across the tier boundary**. The scrub gate (`src/scrub.mjs`) is fail-closed and tuned to
avoid false positives on identifiers/hashes — edit its entropy/keyword rules carefully.

**Provable level (`src/level/`).** A level is a W3C VC 2.0 / Open Badges 3.0 credential
(`credential.mjs`, cryptosuite `eddsa-jcs-2022`) issued only after an independent held-out re-run,
TrueSkill σ-gated (`trueskill.mjs`, `benchmark.mjs`). The benchmark's `referenceSolver` is deterministic
and **pluggable** — a production verifier swaps in a real sandboxed agent run; the crypto/gating is real.
Attestations are attached to the SAVE-adjacent `attestations` table and do **not** mutate the signed ROM.

**Multi-agent loops (`src/cal.mjs`).** A CAL connects several cartridges by content hash (`romDigest`) or
role slot; RAC declares required context as **descriptions only** (never content). Edge conditions are
**structured data**, never evaluated strings.

**Surfaces that reuse `src/`:** `platform/` (HTTP exchange + `builder/app.html` visual editor),
`registry/` + `tools/build-registry-index.mjs` (git-based sharing; the index build **rejects tampered
cartridges** — the CI gate), and `docs-site/` (a Zensical site; nav is in `docs-site/zensical.toml`).

## Conventions and constraints

- Repo-relative paths only, via `src/paths.mjs` (`SAMPLE_PACKAGE_DIR`, overridable with
  `ACX_SAMPLE_PACKAGE`). The bundled `examples/sample-agent-package/` keeps the repo self-contained. Never
  hardcode a path into a parent repo.
- After changing the export/format, regenerate artifacts: run `scripts/smoke.mjs` (rewrites
  `examples/research-designer.acx`) and re-seed `platform/catalog/` via `platform/seed.mjs`, or `acx spec`
  / registry index will drift.
- Keep `SPEC.md`, `schemas/*.schema.json`, and the code consistent when the format changes.
- **English only**, and the "collectible cartridge" framing must stay **legally neutral** — never name a
  trademarked franchise (no Pokémon/Nintendo/Game Boy/Switch) anywhere shipped; use cartridge / exchange /
  roster / trade / collect. There is a grep sweep for this; keep it clean.
- Adding a CLI command: add `cmdX`, a `switch` case, and a usage line in `src/cli.mjs`; flags parse
  generically (add value-less flags to `BOOL_FLAGS`).
- `AGENTS.md` documents the CLI for agents *using* the tool; this file is for *developing* it.
