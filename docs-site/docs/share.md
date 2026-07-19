---
title: Share ACX
description: Verify, remix, sign, and prepare an ACX agent, workflow, or Agent Graph for one focused pull request.
hide:
  - toc
---

<div class="acx-share-hero" markdown="1">
<span class="acx-eyebrow">ACX SHARE</span>

# Your agent team found a better way to work. Let it travel.

Share a learned agent, reusable workflow, or team information architecture as a signed artifact. Send it
directly or submit it to the open `lboel/acx` registry through a pull request. Recipients verify the bytes
before they trust the claim.

<div class="acx-actions">
<a class="acx-button acx-button--primary" href="exchange/">Explore before sharing</a>
<a class="acx-button" href="exchange/studio/">Remix in Studio</a>
<a class="acx-button acx-button--quiet" href="#prepare-in-60-seconds">Prepare in 60 seconds</a>
<button class="acx-button acx-button--quiet" type="button" data-acx-share>Tell another builder</button>
</div>

<p class="acx-share-status" role="status" aria-live="polite" data-acx-share-status></p>
</div>

## Pick what should travel

<div class="acx-choice-grid" markdown="1">

<a class="acx-choice" href="#share-an-agent">
<span class="acx-choice__icon" aria-hidden="true">◈</span>
<strong>A learned agent</strong>
<small>One signed `.acx` with skills, capabilities, transferable memory, harness requirements, and an optional provable level.</small>
<span>Share agent →</span>
</a>

<a class="acx-choice" href="#share-a-workflow-or-team">
<span class="acx-choice__icon" aria-hidden="true">⌘</span>
<strong>A workflow or team</strong>
<small>One readable `.cal.json` with agent slots, bounded control flow, context requirements, safety intent, and a signature.</small>
<span>Share workflow →</span>
</a>

<a class="acx-choice" href="#share-an-agent-graph">
<span class="acx-choice__icon" aria-hidden="true">⌁</span>
<strong>An Agent Graph</strong>
<small>One signed `.agent-graph.json`: context owners, direction, reporting returns, knowledge routes, and the points where loops converge.</small>
<span>Share team architecture →</span>
</a>

<a class="acx-choice" href="#let-an-agent-prepare-its-own-share-pr">
<span class="acx-choice__icon" aria-hidden="true">↗</span>
<strong>Let the agent self-share</strong>
<small>The bundled Agent Skill verifies an agent, workflow, or graph; prepares canonical paths; rebuilds the index; and drafts a focused PR description.</small>
<span>Use the skill →</span>
</a>

</div>

## Prepare in 60 seconds

Already have a signed artifact? In about a minute you can verify it and prepare a reviewable **local
registry diff**. Want a remix first? Open the static
[Studio](exchange/studio/), import a workflow or Agent Graph, export the unsigned draft, then sign it
locally. Studio never receives a private key or writes to the registry.

!!! important "Preparation is not publication"
    The commands in this section do **not** fork a repository, create a branch, commit, push, open a
    draft pull request, or merge anything. Those GitHub and Git operations happen separately, after you
    inspect the prepared bytes and explicitly choose to publish them.

```bash
git clone https://github.com/lboel/acx.git && cd acx && npm test
```

<div class="acx-copy-row">
<button class="acx-button acx-button--primary" type="button"
  data-acx-copy="git clone https://github.com/lboel/acx.git && cd acx && npm test">
  Copy checkout command
</button>
<span role="status" aria-live="polite" data-acx-copy-status></span>
</div>

The artifact preparation itself creates no network write:

=== "Agent"

    ```bash
    # 1. Verify the signed bytes and clean package contract
    node --experimental-sqlite src/cli.mjs verify my-agent.acx
    node --experimental-sqlite src/cli.mjs spec my-agent.acx

    # 2. Preview the exact registry destination — no files written
    node --experimental-sqlite src/cli.mjs share agent my-agent.acx \
      --slug my-agent --dry-run

    # 3. Prepare the artifact + generated discovery card locally
    node --experimental-sqlite src/cli.mjs share agent my-agent.acx \
      --slug my-agent
    ```

=== "Workflow / team"

    ```bash
    # 1. Verify structure, safety profile, digest, signature, and publisher
    node --experimental-sqlite src/cli.mjs workflow lint team.cal.json --publish
    node --experimental-sqlite src/cli.mjs workflow verify team.cal.json

    # 2. Preview, then prepare the canonical registry file
    node --experimental-sqlite src/cli.mjs share workflow team.cal.json --dry-run
    node --experimental-sqlite src/cli.mjs share workflow team.cal.json
    ```

=== "Agent Graph"

    ```bash
    # 1. Verify the information architecture and its signed identity
    node --experimental-sqlite src/cli.mjs graph lint \
      team.agent-graph.json --publish
    node --experimental-sqlite src/cli.mjs graph verify \
      team.agent-graph.json

    # 2. Preview, then prepare the canonical registry file
    node --experimental-sqlite src/cli.mjs share graph \
      team.agent-graph.json --dry-run
    node --experimental-sqlite src/cli.mjs share graph \
      team.agent-graph.json
    ```

Finish every path with:

```bash
node --experimental-sqlite tools/build-registry-index.mjs
npm test
git diff --check
git diff -- registry/
```

### Publish the prepared diff separately

Only after the local checks pass:

1. fork `lboel/acx` into an account you control;
2. create a focused branch from the current upstream `main`;
3. commit only the reviewed artifact, generated discovery metadata, and deterministic index;
4. push that branch to your fork; and
5. open a **draft pull request** back to `lboel/acx`.

You perform those steps yourself or explicitly authorize a GitHub-capable agent to perform them. The
`acx share` command and the 60-second preparation path stop before every remote write.

Each reviewed and merged PR creates an immutable, shareable detail link in the static Exchange. The next person can
inspect and verify it, preserve its signed lineage in a remix, and publish a new version — without an
account or proprietary API.

## What the pull request proves

<div class="acx-pr-flow" aria-label="Pull-request verification sequence">
<div><span>1</span><strong>Author</strong><small>exports or signs locally</small></div>
<div><span>2</span><strong>PR</strong><small>one artifact, tiny surface</small></div>
<div><span>3</span><strong>CI</strong><small>recomputes live digests</small></div>
<div><span>4</span><strong>Review</strong><small>checks identity + usefulness</small></div>
<div><span>5</span><strong>Index</strong><small>makes it discoverable</small></div>
</div>

The registry never executes a submitted agent, workflow, or graph. CI opens cartridges read-only,
recomputes content-addressed digests, verifies Ed25519 DSSE/in-toto signatures, validates each publication
profile, and regenerates `registry/index.json`. Human review checks the supplied namespace-proof evidence,
licensing metadata, quality, and community fit; the PR path itself is not a namespace proof.

!!! danger "A private key never travels"
    `acx export`, `acx workflow sign`, and `acx graph sign` may write `*.key.pem` beside the artifact.
    Keep that file private. The Self‑Share flow copies only the signed artifact and generated public
    metadata.

## Share an agent

Use an `.acx` when the reusable unit is an agent that has learned a domain, carries skills, or has an
independently proven level.

The canonical PR surface is:

```text
registry/cartridges/<publisher>/<id>/<version>/
├── cartridge.acx   # signed authority
└── README.md       # generated discovery card
registry/index.json # deterministic index
```

`<id>` and SemVer `<version>` come from the cartridge's ROM-bound `acx.artifact_id` and
`acx.artifact_version`; a requested `--slug` must equal that id. Display names never determine the
coordinate.

Recipients can inspect without installing:

```bash
acx verify registry/cartridges/<publisher>/<id>/<version>/cartridge.acx
acx load registry/cartridges/<publisher>/<id>/<version>/cartridge.acx --print-only
```

## Share a workflow or team

Use a `.cal.json` when the reusable unit is a repeatable outcome: a research council, release loop,
incident team, review circuit, or any other bounded collaboration.

Workflows bind roles and capabilities, not local machine identities. A recipient first verifies the shared
graph, then staffs its slots from their own cartridges:

```bash
acx workflow verify \
  registry/cals/io.github.lboel/research-council/1.0.0.cal.json
acx workflow ready \
  registry/cals/io.github.lboel/research-council/1.0.0.cal.json \
  --cartridges ./my-roster
```

Explore the signed [Research Council](https://github.com/lboel/acx/blob/main/registry/cals/io.github.lboel/research-council/1.0.0.cal.json)
for a non-coding team or the [Ship a Feature walkthrough](format/loops-cal.md#worked-example-ship-a-feature)
for an iterative engineering loop.

Published workflows use `publisher + id + SemVer + digest` as their immutable identity:

```text
registry/cals/<publisher>/<id>/<version>.cal.json
```

If you change signed bytes, increment SemVer. Do not replace an existing coordinate. A remix may add a
signed `lineage.parents[]` entry with the parent's publisher, id, version, digest, and relation.

## Share an Agent Graph

Use an `.agent-graph.json` when the reusable insight is the team's information architecture rather than a
task sequence:

- who stewards product intent, evidence, delivery status, decisions, or tacit context;
- who can direct, request, advise, report, review, approve, or escalate to whom;
- what knowledge each route carries and which declared route brings a response back;
- where several workflows or informal loops converge into one bounded synthesis.

<p class="acx-graph-one-liner"><strong>A CAL says what happens next. An Agent Graph says who owns the
context, who can direct whom, where reports return, and where separate loops meet.</strong></p>

The canonical PR surface is one readable signed file:

```text
registry/graphs/<publisher>/<id>/<version>.agent-graph.json
registry/index.json
```

```bash
acx graph lint product-delivery.agent-graph.json --publish
acx graph sign product-delivery.agent-graph.json \
  --publisher io.github.yourhandle \
  --out product-delivery.signed.agent-graph.json
acx graph verify product-delivery.signed.agent-graph.json
acx graph digest product-delivery.signed.agent-graph.json
acx share graph product-delivery.signed.agent-graph.json --dry-run
acx share graph product-delivery.signed.agent-graph.json
```

The graph contains descriptions and references, never the actual roadmap, private messages, credentials, or
knowledge payloads. `authority` describes a relationship; it never grants a tool permission. Reporting
cycles are useful, while mandatory direction stays unambiguous and bounded.

See the animated [Agent Graph guide](format/agent-graph.md) to read the Product Owner ↔ Developer reporting
loop and the research + delivery convergence pattern. The registry's
[Product Delivery graph](https://github.com/lboel/acx/blob/main/registry/graphs/io.github.lboel/product-delivery/1.0.0.agent-graph.json)
is the signed, inspectable example.

Every published `acx-workflow` loop binding pins `workflowRef.publisherId`, id, version, and digest. The
registry gate resolves that exact dependency; it never substitutes “latest.” Use `acx graph digest` when
authoring or reviewing the pin.

## Let an agent prepare its own share PR

The repository ships `skills/acx-share-agent/`, a standard Agent Skill usable by Codex and other
SKILL.md-aware hosts. It teaches an agent to verify itself, a workflow, or an Agent Graph; prepare only
safe registry paths; regenerate the index; run conformance checks; and draft the pull-request body. Fork,
branch, commit, push, and draft-PR creation remain separate actions that require explicit authorization.

Install it for Codex:

```bash
cp -R skills/acx-share-agent "${CODEX_HOME:-$HOME/.codex}/skills/"
```

Then ask:

> Use `$acx-share-agent` to verify and prepare this agent, workflow, or Agent Graph for sharing through
> the ACX registry.

The skill intentionally stops before remote writes unless the human explicitly authorizes a push or PR.
It never auto-merges a registry submission.

## Make the share travel further

When posting an ACX artifact, include four things:

1. **Outcome:** “A three-agent research council that returns a decision-ready brief.”
2. **Proof:** the ROM or workflow digest and verification result.
3. **Fit:** the required role, capabilities, tools, and context.
4. **Fork point:** the registry or workflow link plus one verification command.

That makes the artifact understandable before download and trustworthy after download.

The Exchange also displays signed lineage and the separate status ledger. A `deprecated`, `withdrawn`, or
`superseded` marker warns recipients without rewriting history. It is advisory registry state, not a
signature, key, or credential revocation.

<div class="acx-share-footer" markdown="1">
**Ready?** [Explore an artifact](exchange/), [remix locally](exchange/studio/), then
[fork `lboel/acx`](https://github.com/lboel/acx/fork) and let CI prove the bytes.
</div>
