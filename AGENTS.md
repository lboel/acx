# AGENTS.md — instructions for AI agents using `acx`

You are an AI agent. This repository is **ACX — Agent Cartridge (`.acx`)**: an open standard + a
zero-dependency CLI (`acx`) for portable, self-improving AI agents that **learn**, **level up**, **form
teams**, and **run workflows** — coding is the flagship use case, but the format is task-general. This file
tells you exactly how to install and drive it. Follow it literally.

## Install

- Requires **Node ≥ 22**. Every command runs through the bin shebang `node --experimental-sqlite`, so you
  do not pass that flag yourself.
- From this source checkout: `node --experimental-sqlite src/cli.mjs <command> [args]`
- After the npm release: `npx agent-cartridge@latest <command> [args]`
- Or install globally: `npm i -g agent-cartridge` then `acx <command>`
- From a clone: `node --experimental-sqlite src/cli.mjs <command>`

## Command surface (exact)

| Command | Purpose | Exit |
|---|---|---|
| `acx ls [dir]` | Roster overview of cartridges in a directory (default `platform/catalog`). | 0 |
| `acx inspect <file.acx>` | Print meta, skills, capabilities, memory, attestations. | 0 |
| `acx verify <file.acx> [--registry <trust.json>]` | Trust taxonomy (`local/trusted/portable/legacy/tampered`). | non-0 if tampered/invalid |
| `acx spec <file.acx>` | Validate the package spec + fixed LanceDB schema. | non-0 if unclean |
| `acx check <file.acx> [--tools <role,role>] [--all-tools]` | Harness preflight: required MCP tool-roles, external binaries, skill integrity. | non-0 if REFUSE |
| `acx load <file.acx> [--host claude\|codex\|cursor] [--skills-dir <dir>] [--print-only]` | Verify, then install the cartridge's skills into the host's skills dir; prints a card (class, level, moves). Refuses tampered. | non-0 if refused |
| `acx workflow lint <cal.json> [--publish]` | Validate a portable workflow without requiring a local roster. | non-0 if invalid |
| `acx workflow ready <cal.json> [--cartridges <dir>]` | Resolve the workflow's team slots against available cartridges; prints readiness. | non-0 if not ready |
| `acx workflow sign <cal.json> --publisher <id> [--key <pem>] [--out <file>]` | Canonicalize and sign a publishable workflow with Ed25519 + DSSE/in-toto. | non-0 if invalid |
| `acx workflow verify <cal.json> [--registry <trust.json>]` | Verify workflow structure, digest, signature, and publisher binding. | non-0 if unsigned/invalid |
| `acx workflow inspect <cal.json>` | Print the workflow card, team slots, capabilities, digest, and trust. | 0 |
| `acx cal <cal.json> [--cartridges <dir>]` | Backward-compatible alias for `acx workflow ready`. | non-0 if not ready |
| `acx lance <file.acx> [--python <py>]` | Materialize a genuine LanceDB memory dataset (`acx.lance-memory/1`) into the SAVE zone. Needs the optional `pylance` venv. | non-0 on error |
| `acx init [dir] [--role <role>]` | Scaffold a fillable agent-package. | 0 |
| `acx init --from-code <dir> --out <dir>` | Analyze a codebase and generate an agent set + CAL + RAC. | 0 |
| `acx export <agent-package-dir> <out.acx> --publisher <reverse-dns>` | Package + sign a cartridge. Writes the private key to `<out>.key.pem` **outside** the cartridge. | 0 |
| `acx strip <file.acx> <out.acx>` | Remove SAVE zone; print the ROM hash-equality proof. | non-0 if mismatch |
| `acx level <file.acx>` | Run the demo benchmark with an independent verifier and issue a level credential. | 0 |
| `acx builder [--port 8799]` | Launch the visual CAL/RAC builder; saves unsigned drafts outside the registry. | (serves) |
| `acx share agent <file.acx> --slug <slug> [--dry-run]` | Verify and prepare an agent plus discovery card under `registry/`. | non-0 if unsafe |
| `acx share workflow <file.cal.json> [--dry-run]` | Verify and prepare a signed workflow under `registry/cals/`. | non-0 if unsafe |

## Decision tree

- **Want to use a shared agent?** → `acx verify` it, then `acx check` it against your host, then `acx load` it.
- **Building a new agent?** → `acx init`, fill it in, `acx export`, then `acx verify`/`acx spec`.
- **Generating a team from a codebase?** → `acx init --from-code <repo>`.
- **Orchestrating several agents?** → author or generate a CAL, run `acx workflow lint --publish`, then `acx workflow ready`; use `acx builder` to build it visually.
- **Sharing a workflow?** → `acx workflow sign ...`, then share the one `.cal.json` file; recipients run `acx workflow verify` before staffing it.
- **Sharing an agent?** → push the `.acx` cartridge to the git registry (`registry/`), an OCI registry, or the HTTP exchange (`platform/`).
- **Submitting yourself through a PR?** → read `skills/acx-share-agent/SKILL.md`, run the dry-run, then prepare and review the focused registry diff.

## Safety rules (MUST follow)

1. **Always `acx verify` before `acx load`.** A `tampered` cartridge is refused; `portable` means the
   signer is not in your trust registry — confirm the publisher before relying on it.
2. **The tooling never executes cartridge content** — it reads metadata and verifies signatures. Do not
   `eval`, run, or trust cartridge-supplied scripts without your own review.
3. **RAC is descriptions only.** Required Available Context declares knowledge that must be present, never
   the content — do not expect a cartridge to carry private code, terraform, or data.
4. **Private keys never go inside a cartridge or into git.** `acx export` writes the key next to the file.

## Prove it works (reproducible)

```bash
npm test                                              # 88 conformance, workflow, and sharing tests
node --experimental-sqlite scripts/smoke.mjs          # export → verify → strip → tamper
node --experimental-sqlite scripts/prove-level.mjs    # earn + verify a provable level
```

Full documentation: the Zensical site under `docs-site/` (build with `zensical build`; see
`docs-site/docs/reference/for-agents.md` for this same guide in context, and `docs-site/docs/llms.txt`
for a machine-readable index). Normative spec: `SPEC.md`.

## Developing ACX

- Keep the core dependency-free: only Node built-ins (`node:sqlite`, `node:crypto`, `node:http`).
- Keep `SPEC.md`, `schemas/`, `src/`, tests, examples, and docs consistent whenever a format changes.
- Integrity is the load-bearing invariant: recompute object hashes from live content; never trust
  `objects.oid`, and never sign raw SQLite file bytes.
- Workflow integrity follows the same rule: exclude only top-level `integrity`, canonicalize the remaining
  CAL with RFC 8785/JCS, and bind its sha256 digest, id, version, publisher, and signing time in the
  in-toto statement.
- Anything added to cartridge ROM must be written before `finalizeAndSign`; field-learned data stays in
  SAVE and is never signed.
- Regenerate proofs/examples after format changes, and run `npm test`, the smoke proof, the level proof,
  `node --experimental-sqlite tools/build-registry-index.mjs`, `npm pack --dry-run`, and the docs build.
