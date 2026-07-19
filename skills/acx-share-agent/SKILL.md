---
name: acx-share-agent
description: Verify and prepare signed ACX agents (.acx), agent-team workflows (.cal.json), or Agent Graphs (.agent-graph.json) for sharing through the lboel/acx git registry and a reviewable pull request. Use when an agent should publish, share, update, or self-submit itself, its skills, a reusable loop, a team workflow, or a knowledge/reporting architecture without leaking private keys or bypassing registry verification.
---

# Share an ACX artifact

Prepare a small, cryptographically verifiable registry change. Keep artifact preparation local until the
user explicitly authorizes a push or pull request.

## 1. Establish the repository and artifact

1. Resolve the repository root with `git rev-parse --show-toplevel`.
2. Read `AGENTS.md` and `registry/README.md`.
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
5. Never add a `*.key.pem`, generic private-key PEM, `.env`, credential, SAVE-zone export, or secret-bearing
   source file to git.

## 2. Verify before creating PR files

For an agent:

```bash
acx verify path/to/agent.acx
acx spec path/to/agent.acx
acx share agent path/to/agent.acx --slug <safe-slug> --dry-run
```

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

Stop on any invalid, tampered, legacy/unsigned, unclean, publisher-mismatch, unsafe-path, dangling-reference,
unbounded-loop, or unbounded-convergence result. Do not weaken a verifier to make an artifact pass. An
Agent Graph routes descriptions and references to knowledge; it must not embed private knowledge content or
secret-like metadata, and must not claim that a route grants tools, credentials, or runtime authority.
Require every referenced ACX workflow loop to carry its signed digest.

## 3. Prepare the registry change

Create or reuse a focused branch. Do not work directly on the canonical `main` branch when a PR is
expected.

```bash
git switch -c registry/share-<slug>
acx share agent path/to/agent.acx --slug <slug>
# or
acx share workflow path/to/team.cal.json
# or
acx share graph path/to/team.agent-graph.json

node --experimental-sqlite tools/build-registry-index.mjs
npm test
git diff --check
git diff -- registry/
```

Use `--force` only for a consciously reviewed update to an existing artifact. Preserve the signed bytes;
never unpack and rewrite a cartridge in place.

## 4. Review the exact PR surface

Allow only the applicable paths:

- `registry/cartridges/<publisher>/<slug>/cartridge.acx`;
- its generated `README.md`;
- or `registry/cals/<workflow-id>.cal.json`;
- or `registry/graphs/<graph-id>.agent-graph.json`;
- `registry/index.json`.

Read [references/pr-contract.md](references/pr-contract.md) before staging or creating the PR. Generate a
ready-to-paste body from the verified artifact:

```bash
node --experimental-sqlite skills/acx-share-agent/scripts/render-pr-body.mjs \
  agent path/to/agent.acx --slug <slug>
```

Use `workflow` for a `.cal.json` or `graph` for a `.agent-graph.json`.

## 5. Publish only with explicit authority

Stage only the reviewed registry paths. Commit with a focused message such as
`registry: share <publisher>/<slug>`. Push the share branch and open a PR only when the user requested or
approved that external change.

In the PR, report:

- artifact type, stable id, publisher, version where applicable, and content digest;
- verification commands and outcomes;
- whether this is a new share or an update;
- confirmation that no private key or secret is included.

Never push, open a pull request, or merge without explicit authority for that external action. Even when
authorized to open the PR, do not merge merely because the submitter asks: require the registry CI gate and
human review.
