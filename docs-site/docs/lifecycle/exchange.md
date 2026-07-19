---
title: Static Exchange
description: Discover, verify, download, remix, export, and publish signed ACX agents, workflows, and Agent Graphs without a backend.
---

<div class="acx-exchange-hero" markdown="1">
<span class="acx-eyebrow">ACX EXCHANGE · STATIC BY DESIGN</span>

# Find a better agent loop. Verify it. Make it yours.

Browse agents, workflows, Agent Graphs, and editable starters without an account or runtime backend. The
Exchange ships as ordinary HTML, CSS, JavaScript, JSON, and artifact files, so it works on GitHub Pages,
an object store, a CDN, or a project subpath.

<div class="acx-actions">
<a class="acx-button acx-button--primary" href="../exchange/">Explore the Exchange</a>
<a class="acx-button" href="../exchange/studio/">Open remix Studio</a>
<a class="acx-button acx-button--quiet" href="sharing-git/">Publish through a PR</a>
</div>
</div>

## One public loop, end to end

<div class="acx-exchange-flow" aria-label="Discover, inspect, verify, download, remix, export, and publish">
<div><span>01</span><strong>Discover</strong><small>filter safe index cards</small></div>
<div><span>02</span><strong>Inspect</strong><small>identity, status, lineage</small></div>
<div><span>03</span><strong>Verify</strong><small>recompute before trust</small></div>
<div><span>04</span><strong>Download</strong><small>authoritative bytes</small></div>
<div><span>05</span><strong>Remix</strong><small>unsigned local draft</small></div>
<div><span>06</span><strong>Export</strong><small>JSON or CLI handoff</small></div>
<div><span>07</span><strong>Publish</strong><small>signed, reviewed PR</small></div>
</div>

The useful viral loop is not “copy a screenshot.” It is a reproducible chain where each recipient can
understand the artifact quickly, verify the bytes independently, preserve attribution, change the design,
and publish a new immutable version.

```text
stable detail link
  → verified download
  → remix with signed parent lineage
  → local signature
  → focused pull request
  → new stable detail link
```

## What is exchanged

| Artifact | What travels | What the browser can establish |
| --- | --- | --- |
| Agent cartridge | One signed `.acx` SQLite file: skills, portable memory, capability claims, policies, attestations | Download hash and discovery metadata only; use the CLI for full SQLite, ROM, package, level, and capability verification |
| Workflow | One signed `.cal.json`: roles, bounded tasks, structured conditions, required context, safety declarations | JCS digest, Ed25519 DSSE/in-toto signature, and publisher claim |
| Agent Graph | One signed `.agent-graph.json`: fuzzy seats, knowledge stewards, direction, reports, loop bindings, convergence | JCS digest, Ed25519 DSSE/in-toto signature, publisher claim, and pinned workflow references |
| Template | Diffable unsigned source material for an agent package | File digest and manifest shape; never signature trust |

The Exchange does not execute any artifact. Opening a card, verifying JSON, downloading bytes, or creating
a draft never dispatches an agent, evaluates a workflow, follows a route, or resolves private knowledge.

## The identity that survives sharing

Every published agent, workflow, or Agent Graph is addressed by:

```text
artifact type + publisher id + artifact id + SemVer + digest
```

Agents, workflows, and Agent Graphs live at immutable paths:

```text
registry/cartridges/<publisher>/<id>/<version>/cartridge.acx
registry/cals/<publisher>/<id>/<version>.cal.json
registry/graphs/<publisher>/<id>/<version>.agent-graph.json
```

Changing signed bytes requires a new SemVer and a new path. An existing coordinate cannot be silently
overwritten, including with `--force`. “Latest” is only a discovery shortcut; dependencies and lineage
always pin a concrete digest. A cartridge carries `acx.artifact_id` and `acx.artifact_version` inside its
signed ROM metadata; its coordinate digest remains the ROM digest.

Signed `lineage.parents[]` records whether the new artifact is a `fork`, `remix`, `derived-from`, or
`supersedes` publication. A parent reference carries the artifact type, publisher, id, optional version,
and required sha256 digest. It preserves attribution, but it does not transfer namespace ownership,
signature trust, license permission, or runtime authority.

## Agent Graph: the information layer between loops

**A CAL says what happens next. An Agent Graph says who owns the context, who can direct whom, where
reports return, and where separate loops meet.**

This is deliberately fuzzy in the useful places:

- actors are logical seats selected by role, capability, tags, or prose rather than named machines;
- knowledge modules describe intent, decisions, evidence, status, risk, and tacit context without
  embedding the private content;
- routes make direction, advice, reporting, review, approval, and escalation expectations visible;
- loop bindings pin whole workflows without copying their task nodes; and
- convergence points say which steward combines knowledge from at least two loops, under bounded waits
  and rounds.

The strict parts are references, return routes, dependency coordinates, direction conflicts, and bounds.
That combination lets a Product Owner seat tell whichever developer agents are staffed what outcome is
needed, while developers return status, evidence, risks, and blockers through an explicit reporting path.
Research and delivery can remain separate CALs and still converge into one product decision.

[Read the animated Agent Graph guide](../format/agent-graph.md) or open the
[Studio](../exchange/studio/) to describe one in plain language first and add structure as it becomes
useful.

## Browser verification: precise boundaries

The static app can recompute the canonical JCS digest and verify the Ed25519 DSSE/in-toto signature of a
workflow or Agent Graph with WebCrypto. That proves that the JSON matches the signed digest and binds the
publisher **claim** inside the artifact.

It does **not** prove:

- that the signer controls the claimed reverse-DNS or GitHub namespace;
- that a workflow is safe to execute or locally staffable;
- that an Agent Graph grants a real organizational permission;
- that a cartridge's SQLite ROM, package specification, level credential, or capability evidence is
  valid; or
- that a license, payment, entitlement, or identity transaction occurred.

A valid unknown signer is therefore shown as **portable**, not trusted. Namespace trust requires a
verified trust-registry key and the DNS-TXT or GitHub-OIDC proof defined by the standard.

For a cartridge, download first and verify locally:

```bash
acx verify downloaded-agent.acx
acx spec downloaded-agent.acx
acx load downloaded-agent.acx --print-only
```

For JSON artifacts, repeat the browser result with the CLI before operational use:

```bash
acx workflow verify downloaded.cal.json
acx graph verify downloaded.agent-graph.json
acx graph digest downloaded.agent-graph.json
```

`graph digest` hashes the unsigned JCS form — the entire document with only top-level `integrity` removed.
It is the digest pinned by Agent Graph lineage and workflow dependencies.

## Remix safely in Studio

Studio is a local-first authoring surface included in the static build. It can start an Agent Graph or
workflow from scratch, import a signed JSON artifact, and turn it into an unsigned remix:

1. the parent's `integrity` block is removed;
2. the parent publisher/id/version/digest is retained under signed `lineage`;
3. the draft receives a new identity before signing;
4. edits stay in browser memory unless you explicitly save locally; and
5. export produces JSON and an exact CLI handoff, never a registry write.

No private key belongs in a browser editor. Sign and verify the exported file locally:

```bash
acx graph lint my-remix.agent-graph.json --publish
acx graph sign my-remix.agent-graph.json \
  --publisher io.github.yourhandle \
  --out my-remix.signed.agent-graph.json
acx graph verify my-remix.signed.agent-graph.json
acx share graph my-remix.signed.agent-graph.json --dry-run
```

The same sequence works with `workflow lint`, `workflow sign`, `workflow verify`, and `share workflow`.

## Lifecycle status and dependency safety

Published bytes remain immutable. The separate `registry/status.json` ledger can mark their digest-pinned
identity `deprecated`, `withdrawn`, or `superseded`, with a reason and optional successor. The Exchange
shows that warning before download. Status is registry advice, not cryptographic revocation; key and level
credential revocation have their own verification paths.

A published Agent Graph pins each ACX Workflow dependency by publisher, id, version, and digest. The
registry build resolves that exact coordinate and fails on a missing or mismatched dependency. It never
falls forward to “latest.” This keeps a graph's reporting and convergence architecture attached to the
exact task loops its author reviewed.

## Build it anywhere

Build the validated registry projection and then the static app:

```bash
node --experimental-sqlite tools/build-registry-index.mjs
node --experimental-sqlite tools/build-static-exchange.mjs
# output: dist/exchange/
```

Choose any output directory and an optional public base URL for canonical/Open Graph metadata:

```bash
node --experimental-sqlite tools/build-static-exchange.mjs \
  --out docs-site/site/exchange \
  --site-url https://acx.dev/exchange/
```

All runtime links are relative, so copying the output directory to another host or subpath does not
require a JavaScript rebuild. The optional `--site-url` affects share metadata, not routing.

The build treats `registry/index.json` as an allowlist but never trusts it blindly. It independently
re-verifies signed workflow/graph JSON and opens each cartridge read-only to check live ROM trust, its
closed package profile, ROM-only publication state, publisher/id/version binding, and ROM digest. It then
refuses traversal and symlink escapes, copies authoritative bytes unchanged, and writes `manifest.json`
with output digests. Stable detail pages remain understandable without JavaScript and carry useful share
metadata.

## Publish the remix

The browser never writes to the registry. Publication stays an ordinary reviewable git operation:

```bash
acx share graph my-remix.signed.agent-graph.json --dry-run
acx share graph my-remix.signed.agent-graph.json
node --experimental-sqlite tools/build-registry-index.mjs
npm test
git diff --check
git diff -- registry/
```

The pull-request gate compares canonical artifact paths with the exact base commit, refuses modification,
deletion, or rename of an accepted release, and then re-verifies live bytes, publication metadata,
signatures, lineage, pinned dependencies, the status ledger, and the generated index. Human review
decides namespace evidence, license fit, usefulness, and community policy.

!!! info "Exchange is not commerce"
    ACX defines artifact identity, integrity, discovery, remix lineage, and transport. The static Exchange
    has no accounts, checkout, payments, custody, refunds, access entitlements, or licensing enforcement.
    A separate service may add commerce, but an ACX listing or signature never proves a purchase or usage
    right.

## See also

- [Share ACX](../share.md) — the short human and agent-native PR flow.
- [Sharing over git](sharing-git.md) — immutable paths, index, status ledger, and CI contract.
- [Agent Graph](../format/agent-graph.md) — fuzzy information architecture with hard invariants.
- [Conditional Agentic Loops](../format/loops-cal.md) — bounded multi-agent task graphs.
- [Signing & trust](../format/signing-trust.md) — what portable, trusted, and tampered mean.
