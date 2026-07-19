# ACX registry pull-request contract

## Allowed changes

A registry-share PR should contain one logical artifact:

| Artifact | Required paths |
| --- | --- |
| Agent | `registry/cartridges/<publisher>/<id>/<version>/cartridge.acx`, generated `README.md`, `registry/index.json` |
| Workflow | `registry/cals/<publisher>/<id>/<version>.cal.json`, `registry/index.json` |
| Agent Graph | `registry/graphs/<publisher>/<id>/<version>.agent-graph.json`, `registry/index.json` |

Split schema, CLI, documentation, trust-registry, lifecycle status, and unrelated agent changes into
separate PRs. `dist/exchange/` is generated deployment output and must not be staged.

All signed-artifact coordinates are immutable. Different bytes at an existing publisher/id/version must
be rejected even with `--force`; assign a new SemVer instead. CI compares the proposal with its exact base
commit and rejects modification, deletion, or rename of an accepted artifact path. A lifecycle-only PR may update
`registry/status.json` to deprecate, withdraw, or supersede an exact type/publisher/id/version/digest
identity. It must not delete or rewrite the historical artifact.

## Required checks

Run from the repository root:

```bash
npm test
npm run smoke
npm run build:registry
npm run build:exchange -- --site-url https://acx.dev/exchange/
git diff --check
```

The generated index must be deterministic, include the submitted artifact and current lifecycle state,
and resolve every Agent Graph workflow dependency. The static build must complete without a backend and
produce pre-rendered artifact pages. Verification must recompute live content hashes; a stored digest is
never sufficient evidence.

## Review rules

- Require a reverse-DNS publisher matching the signed publisher identity.
- Require canonical publisher/id/version paths for agents, workflows, and Agent Graphs.
- Require a clean package specification for `.acx` or the complete publication profile for `.cal.json`.
- Require an agent cartridge to be ROM-only: SAVE memory, files, objects, and vectors must all be empty.
- Require the complete publication profile, reference-safe information architecture, and bounded convergence
  for `.agent-graph.json`.
- Reject private keys, secrets, `.env` files, credentials, unsigned artifacts, and path traversal.
- Reject Agent Graphs that embed knowledge content or secret-like metadata, omit a digest for an ACX
  workflow loop reference, fail to pin its publisher/id/version, or imply that communication routes grant
  runtime permissions, tools, or credentials.
- Resolve every Agent Graph workflow reference to the exact registered publisher/id/version/digest.
- For a remix, require signed lineage with the exact parent coordinate and digest. Never reuse a parent
  signature after editing.
- Treat `portable` as cryptographically valid against the included key, but not namespace-trusted.
- Treat `trusted` only as the result of a valid registry key plus namespace proof.
- Treat embedded levels and capability verification flags as claims unless issuer, revocation, ROM binding,
  and referenced evidence resolve successfully.

## Suggested PR metadata

- Title: `registry: share <publisher>/<id>@<version>`, `registry: share workflow <id>@<version>`, or
  `registry: share graph <id>@<version>`
- Base: `lboel/acx:main`
- Head: the submitter's focused share branch
- Labels when available: `registry` plus `agent`, `workflow`, or `agent-graph`
- Body: include the deterministic post-merge `https://acx.dev/exchange/artifacts/.../` URL emitted by
  `skills/acx-share-agent/scripts/render-pr-body.mjs`

The registry is PR-only; the static Exchange never accepts uploads. Do not auto-merge submissions. The
cryptographic gate proves artifact integrity, not publisher ownership or usefulness; human review still
decides namespace ownership, licensing, safety, and community fit.
