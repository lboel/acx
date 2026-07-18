# Contributing

Thanks for helping build an open, vendor-neutral standard. Contributions of all sizes are welcome —
spec clarifications, reference-implementation fixes, new conformance tests, docs, and cartridges/templates
for the registry.

## Ground rules

- **Keep the core dependency-free.** `src/` runs on Node's builtin `node:sqlite` + `node:crypto` only.
  Optional tooling (e.g. the LanceDB materializer) lives outside the core with its dependency isolated.
- **Keep `SPEC.md`, `schemas/`, and the code consistent.** If you change the format, update all three and
  add/adjust a test.
- **English only, and legally neutral.** The "collectible cartridge" framing must never reference a
  trademarked franchise. Use cartridge / exchange / roster / trade / collect.
- **Never commit private keys.** `acx export` writes signing keys *outside* the cartridge; they are
  git-ignored.

## Develop

Requires **Node ≥ 22**. Everything runs through `node --experimental-sqlite`.

```bash
npm test                                              # conformance suite
node --experimental-sqlite --test test/memory.test.mjs   # a single test file
node --experimental-sqlite scripts/smoke.mjs          # export → verify → strip → tamper
node --experimental-sqlite scripts/prove-level.mjs    # earn + verify a provable level
```

See [`AGENTS.md`](./AGENTS.md) for the architecture and the non-obvious invariants (the load-bearing one:
signing recomputes object hashes from live content — never trust `objects.oid`).

## Pull requests

1. Add or update a test that covers your change; `npm test` must be green.
2. If you touched the format, update `SPEC.md` + `schemas/` and regenerate example artifacts
   (`scripts/smoke.mjs`, `platform/seed.mjs`).
3. Keep commits focused; describe the *why* in the PR.

## Sharing a cartridge or template

See [`registry/README.md`](./registry/README.md) — fork, add your cartridge under
`registry/cartridges/<publisher>/<name>/` or a signed workflow under `registry/cals/`, and open a PR. CI
verifies every signed artifact and rejects unsigned, tampered, invalid, or structurally unclean
ones. Use `acx share … --dry-run` before writing registry files, or invoke the bundled
`$acx-share-agent` skill for an agent-guided, reviewable submission.
