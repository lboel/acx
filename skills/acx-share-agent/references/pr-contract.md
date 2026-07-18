# ACX registry pull-request contract

## Allowed changes

An agent-share PR should contain one logical artifact:

| Artifact | Required paths |
| --- | --- |
| Agent | `registry/cartridges/<publisher>/<slug>/cartridge.acx`, generated `README.md`, `registry/index.json` |
| Workflow | `registry/cals/<id>.cal.json`, `registry/index.json` |

Split schema, CLI, documentation, trust-registry, and unrelated agent changes into separate PRs.

## Required checks

Run from the repository root:

```bash
npm test
npm run smoke
node --experimental-sqlite tools/build-registry-index.mjs
git diff --check
```

The generated index must be deterministic and include the submitted artifact. Verification must recompute
live content hashes; a stored digest is never sufficient evidence.

## Review rules

- Require a reverse-DNS publisher matching the signed publisher identity.
- Require a clean package specification for `.acx` or the complete publication profile for `.cal.json`.
- Reject private keys, secrets, `.env` files, credentials, unsigned artifacts, and path traversal.
- Treat `portable` as cryptographically valid but not yet namespace-trusted.
- Treat `trusted` only as the result of a valid registry key plus namespace proof.
- Use `--force` only when the PR clearly declares an update and reviewers compare old and new digests.

## Suggested PR metadata

- Title: `registry: share <publisher>/<slug>` or `registry: share workflow <id>@<version>`
- Base: `lboel/acx:main`
- Head: the submitter's focused share branch
- Labels when available: `registry`, `agent` or `workflow`

Do not auto-merge registry submissions. The cryptographic gate proves artifact integrity; human review
still decides namespace ownership, usefulness, licensing, and community fit.
