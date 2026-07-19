---
name: acx-share-agent
description: Verify, remix, and prepare signed ACX agents (.acx), team workflows (.cal.json), or Agent Graphs (.agent-graph.json) for PR-only publication to the lboel/acx registry and static ACX Exchange. Use when an agent should share or self-submit itself, a reusable loop, an agent team, or a reporting/knowledge architecture with immutable coordinates, lineage, resolved dependencies, and no private state or keys.
---

# Share an ACX artifact

Prepare one small, cryptographically verifiable registry change. Publication happens only by reviewed pull
request; the static Exchange has no upload API. Keep preparation local until the user explicitly authorizes
a push or pull request.

## 1. Establish scope

1. Resolve the repository root with `git rev-parse --show-toplevel`.
2. Read `AGENTS.md`, `registry/README.md`, `registry/status.json`, and
   [references/pr-contract.md](references/pr-contract.md).
3. Confirm the target is the canonical `lboel/acx` repository or a fork of it.
4. Classify the input:
   - signed agent: `*.acx`;
   - signed workflow/team: `*.cal.json`;
   - signed communication and knowledge architecture: `*.agent-graph.json`;
   - agent-package source: export it first with `acx export`;
   - unsigned workflow: lint and sign it first with `acx workflow lint --publish` and
     `acx workflow sign`.
   - unsigned Agent Graph: lint and sign it first with `acx graph lint --publish` and
     `acx graph sign`.
5. Never add a `*.key.pem`, generic private-key PEM, `.env`, credential, SAVE-zone export, build output, or
   secret-bearing source file to git.

## 2. Preserve provenance when remixing

For a workflow or Agent Graph derived from a published artifact:

1. Record the parent's signed `publisherId`, `id`, `version`, and `sha256:` digest before editing.
2. Remove the parent's `integrity`, choose the new artifact's publisher/id/version, and make the changes.
3. Add signed `lineage.parents[]` with `artifactType`, `publisherId`, `id`, `version`, `digest`, and one of
   `fork`, `remix`, `derived-from`, or `supersedes`. An optional `source` must be credential-free HTTPS.
4. Lint and sign the new artifact. Never reuse the parent's signature or overwrite its coordinate.

Every published `acx-workflow` loop in an Agent Graph must pin the dependency with
`workflowRef.publisherId`, `workflowRef.id`, `workflowRef.version`, and `workflowRef.digest`. The registry
build must resolve all four fields to the exact signed workflow.

## 3. Verify before creating PR files

For an agent:

```bash
acx verify path/to/agent.acx
acx spec path/to/agent.acx
acx share agent path/to/agent.acx --dry-run
```

The dry run must confirm that all SAVE-zone memory, files, objects, and vectors are empty. Public agents
are ROM-only.

For a workflow:

```bash
acx workflow verify path/to/team.cal.json
acx workflow lint path/to/team.cal.json --publish
acx share workflow path/to/team.cal.json --dry-run
```

For an Agent Graph:

```bash
acx graph verify path/to/team.agent-graph.json
acx graph lint path/to/team.agent-graph.json --publish
acx share graph path/to/team.agent-graph.json --dry-run
```

Stop on any invalid, tampered, legacy/unsigned, unclean, publisher-mismatch, unsafe-path, dangling or
digest-mismatched dependency, unbounded-loop, or unbounded-convergence result. Do not weaken a verifier to
make an artifact pass. An Agent Graph carries descriptions and references, not private knowledge content,
secrets, tools, credentials, or runtime authority.

Treat trust fields precisely:

- `portable` proves that the artifact bytes match a signature by the included key; it does not prove
  publisher namespace ownership.
- `trusted` requires a valid registry key and namespace proof.
- embedded level and `verified` capability labels are claims until issuer key, revocation state, ROM
  binding, and referenced evidence resolve. Discovery metadata must label unresolved claims as unproven.

## 4. Prepare immutable registry paths

Create or reuse a focused branch. Do not work directly on the canonical `main` branch when a PR is
expected.

```bash
git switch -c registry/share-<slug>
acx share agent path/to/agent.acx
# or
acx share workflow path/to/team.cal.json
# or
acx share graph path/to/team.agent-graph.json

npm run build:registry
npm run build:exchange -- --site-url https://lboel.github.io/acx/exchange/
npm test
npm run smoke
git diff --check
git diff -- registry/
```

The share commands choose these canonical paths:

- agent: `registry/cartridges/<publisher>/<id>/<version>/cartridge.acx`;
- workflow: `registry/cals/<publisher>/<id>/<version>.cal.json`;
- Agent Graph: `registry/graphs/<publisher>/<id>/<version>.agent-graph.json`.

Every signed-artifact coordinate is immutable. If the destination already contains different bytes, stop
and publish a new SemVer; `--force` cannot replace it. Preserve signed bytes and never unpack and rewrite
a cartridge in place. The pull-request gate also compares the branch with the exact base commit and
refuses modification, deletion, or rename of accepted artifact paths.

`npm run build:registry` must regenerate a deterministic `registry/index.json`, resolve Agent Graph
workflow dependencies, apply the exact-digest lifecycle state from `registry/status.json`, and distinguish
current from older versions. `npm run build:exchange` must produce `dist/exchange/` with the static app,
artifact downloads, templates, and pre-rendered share pages. Inspect it, but do not stage `dist/`.

## 5. Review the exact PR surface

Allow one artifact plus generated metadata:

- the applicable canonical artifact path;
- the generated agent `README.md`, when sharing an agent;
- `registry/index.json`.

Do not mix a lifecycle change into an artifact share. Deprecation, withdrawal, and supersession belong in
a separate focused PR changing `registry/status.json`; each entry must bind the exact artifact type,
publisher, id, version when applicable, and digest. Never erase history to hide an old release.

Generate a ready-to-paste PR body and deterministic post-merge share URL:

```bash
node --experimental-sqlite skills/acx-share-agent/scripts/render-pr-body.mjs \
  agent path/to/agent.acx
```

Use `workflow` for a `.cal.json` or `graph` for a `.agent-graph.json`.

## 6. Publish only with explicit authority

Stage only the reviewed registry paths. Commit with a focused message such as
`registry: share <publisher>/<id>@<version>`. Push the share branch and open a PR only when the user
requested or approved that external change.

In the PR, report:

- artifact type, stable id, publisher, version, and content digest;
- lineage when the artifact is a remix, and exact workflow dependencies for an Agent Graph;
- verification commands and outcomes;
- whether this is a new share or an update;
- confirmation that no private key, SAVE state, or secret is included;
- the expected `https://lboel.github.io/acx/exchange/artifacts/.../` share URL from the render script.

The artifact becomes public only after the PR passes CI, receives human review, merges, and the static
Exchange deploys. Never publish through the legacy HTTP demo. Never push, open a PR, or merge without
explicit authority for that external action; authorization to open a PR is not authorization to merge.
