# Changelog

Notable ACX project changes are recorded here. Project releases use Semantic Versioning; format and
artifact version tracks are explained in [`GOVERNANCE.md`](./GOVERNANCE.md#version-tracks).

## Unreleased

No unreleased changes.

## 0.1.1-rc.1 — release candidate (untagged)

Candidate for the first patch after the `v0.1.0` public draft. It remains untagged until the release
metadata and final version decision are approved.

### Changed

- Reworked the README into a beginner-first path that distinguishes Agent Cartridges, bounded workflows,
  and Agent Graphs, with runnable clean-clone examples and visual explanations of knowledge routing and
  the static share/remix loop.
- Made Exchange and Studio documentation links safe for standalone static deployments instead of
  assuming they are always mounted beneath the full documentation site.
- Reframed the fast share path as local preparation, separated every remote GitHub action, added
  canonical copy-link controls to generated artifact pages, and made the documentation entry points
  clearer for first-time readers.

### Verified

- Re-ran the conformance, smoke, signed-artifact, registry, standalone Exchange, documentation-link, and
  packed-npm-CLI release gates on the supported Node.js baseline.

## 0.1.0 — 2026-07-19

Initial public-draft release.

### Added

- The single-file `.acx` SQLite cartridge with signed ROM, local SAVE, PackageSpec, portable skills,
  capabilities, memory, harness requirements, and loop/context policy.
- Ed25519 DSSE/in-toto verification, explicit portable-versus-trusted taxonomy, namespace-proof model,
  scrub gates, and ROM-only public sharing.
- Signed Conditional Agentic Loops for bounded, portable agent-team workflows.
- Signed Agent Graphs for fuzzy role selection, knowledge stewardship, reporting routes, expected
  responses, loop bindings, and bounded convergence.
- Immutable `(artifact type, publisher, id, version, digest)` registry coordinates, lifecycle ledger,
  signed remix lineage, deterministic index, and history-aware PR gate.
- Fully static Exchange and local-first Studio: discover, inspect, browser-verify JSON artifacts, remix,
  export, sign locally, and prepare a reviewable registry PR.
- A SKILL.md workflow that lets an agent verify and prepare its own focused share proposal without
  publishing a key, private state, or remote mutation.
- Reproducible conformance, tamper, leveling, registry, static-build, and packed-npm-CLI proofs.

### Security and release hardening

- Browser verification is bound to the selected registry type, publisher, id, version, and digest.
- Published registry coordinates are append-only; lifecycle changes never rewrite signed bytes.
- The npm release gate packs, installs, and executes the real bin shim and rejects generated/private
  files, missing imports, and writes into an installed npm cache.
- SQLite reads normalize the original Node 22.5 `StatementSync#get()` null-row sentinel, so missing or
  malformed package data fails closed consistently across the supported Node range.
- `main` is designed for PR-only changes with required conformance and registry checks.

### Public-draft notes

- Project release `v0.1.0`, spec document `0.1`, container wire format `1.0`, schema majors, and artifact
  SemVer are separate version tracks.
- `application/vnd.acx.*` names are provisional vendor-tree media names and are not yet IANA-registered.
- A portable signature proves integrity and key possession, not publisher namespace ownership or runtime
  authority.
