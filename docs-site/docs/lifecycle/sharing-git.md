---
title: Sharing over git
description: Publish immutable ACX agents, workflows, Agent Graphs, and templates through a verified pull request.
---

# Sharing over git

The `registry/` directory is the reviewable source behind the static Exchange. A contribution is an
ordinary pull request containing a signed artifact at its canonical immutable path, plus the deterministic
index update. CI re-verifies live bytes and refuses invalid identity, tampering, unsafe metadata, broken
dependencies, replacement of an accepted artifact path, or a stale index.

Git supplies forks, review, and history. ACX supplies the artifact identity and cryptographic verification.
Neither a repository path nor an approved PR proves namespace ownership by itself.

## Three transports, one artifact verifier

| | Git registry | [OCI distribution](distribution.md) | [Static Exchange](exchange.md) |
| --- | --- | --- | --- |
| Transport | git + pull request | OCI manifest, layer, and referrers | generated HTML/CSS/JS/JSON/files |
| Best for | open review, immutable versions, remix history | registry replication and digest transport | discover, inspect, verify, download, remix, export |
| Trust decision | verifier over submitted bytes | verifier over pulled bytes | browser JSON verifier or local cartridge CLI |
| Index | `registry/index.json` | OCI catalog/manifest | `data/index.json`, derived from the registry |
| Backend required | only the git forge | OCI registry | none |

The transport never turns `portable` into `trusted`. A namespace-proven trust-registry key is required for
that upgrade.

## Canonical registry layout

```text
registry/
├── cartridges/
│   └── <publisher>/<id>/<version>/
│       ├── cartridge.acx
│       └── README.md
├── templates/
│   └── <id>/...
├── cals/
│   └── <publisher>/<id>/<version>.cal.json
├── graphs/
│   └── <publisher>/<id>/<version>.agent-graph.json
├── status.json
└── index.json
```

The immutable agent, workflow, and Agent Graph coordinate is:

```text
(artifactType, publisherId, id, version, digest)
```

`version` is SemVer. `digest` is the cartridge ROM digest or the workflow/Agent Graph JCS digest. Every
path repeats the verified publisher, id, and version so a reviewer can spot identity drift in the diff.
Cartridges bind `acx.artifact_id` and `acx.artifact_version` inside signed ROM metadata.

Different bytes can never replace an existing coordinate — `--force` does not bypass this rule. Publish a
new PATCH, MINOR, or MAJOR version:

- PATCH: backward-compatible signed correction;
- MINOR: backward-compatible addition; or
- MAJOR: contract change that can break consumers, staffing, routing, or convergence.

Every version remains available. A generated `latest` marker is a browsing convenience, never a
dependency target.

## Publish a cartridge

Export and verify locally:

```bash
node --experimental-sqlite src/cli.mjs export \
  my-agent-package/ my-agent.acx \
  --publisher io.github.yourhandle

node --experimental-sqlite src/cli.mjs verify my-agent.acx
node --experimental-sqlite src/cli.mjs spec my-agent.acx
```

Export writes the Ed25519 private key beside the cartridge as `my-agent.acx.key.pem`. It is never stored
inside the cartridge. Keep it private and never stage it.

Preview and prepare only the public registry files:

```bash
node --experimental-sqlite src/cli.mjs share agent my-agent.acx \
  --slug my-agent --dry-run
node --experimental-sqlite src/cli.mjs share agent my-agent.acx \
  --slug my-agent
```

The result is the verified cartridge plus a generated discovery card under
`registry/cartridges/<publisher>/<id>/<version>/`.

## Publish a workflow

```bash
node --experimental-sqlite src/cli.mjs workflow lint my-team.cal.json --publish
node --experimental-sqlite src/cli.mjs workflow sign my-team.cal.json \
  --publisher io.github.yourhandle \
  --out my-team.signed.cal.json
node --experimental-sqlite src/cli.mjs workflow verify my-team.signed.cal.json
node --experimental-sqlite src/cli.mjs share workflow \
  my-team.signed.cal.json --dry-run
node --experimental-sqlite src/cli.mjs share workflow \
  my-team.signed.cal.json
```

The prepared path is:

```text
registry/cals/io.github.yourhandle/<id>/<version>.cal.json
```

Publication validation requires discovery metadata, a closed condition grammar, complete references,
typed completion contracts, terminal reachability, bounded cycles, a clean secret scan, and a valid
signature.

## Publish an Agent Graph

```bash
node --experimental-sqlite src/cli.mjs graph lint \
  product-delivery.agent-graph.json --publish
node --experimental-sqlite src/cli.mjs graph sign \
  product-delivery.agent-graph.json \
  --publisher io.github.yourhandle \
  --out product-delivery.signed.agent-graph.json
node --experimental-sqlite src/cli.mjs graph verify \
  product-delivery.signed.agent-graph.json
node --experimental-sqlite src/cli.mjs graph digest \
  product-delivery.signed.agent-graph.json
node --experimental-sqlite src/cli.mjs share graph \
  product-delivery.signed.agent-graph.json --dry-run
node --experimental-sqlite src/cli.mjs share graph \
  product-delivery.signed.agent-graph.json
```

The prepared path is:

```text
registry/graphs/io.github.yourhandle/<id>/<version>.agent-graph.json
```

The graph makes implicit team knowledge and reporting structure reviewable without converting it into
tasks. Fuzzy actor selectors describe logical seats. Knowledge modules name stewards and audiences without
embedding content. Routes make direction and returns explicit. Loop bindings attach the architecture to
whole workflows, while bounded convergence says where their knowledge is synthesized.

Every published ACX Workflow binding pins:

```json
{
  "publisherId": "io.github.example",
  "id": "research-council",
  "version": "1.0.0",
  "digest": "sha256:…"
}
```

The registry builder resolves that exact workflow. A missing path or digest mismatch fails publication;
there is no fallback to `latest`.

## Remix and preserve attribution

A workflow or Agent Graph remix may carry a signed lineage block:

```json
{
  "lineage": {
    "parents": [{
      "artifactType": "agent-graph",
      "publisherId": "io.github.original",
      "id": "product-delivery",
      "version": "1.0.0",
      "digest": "sha256:…",
      "relation": "remix",
      "source": "https://lboel.github.io/acx/exchange/"
    }],
    "note": "Adapted for a research-first product team."
  }
}
```

Lineage is inside the signed document. It provides a stable attribution and traversal edge, not inherited
trust or permission. The static [Studio](../exchange/studio/) removes the imported signature, adds the
parent coordinate, and exports an unsigned draft. You assign a new identity and sign locally.

## Publish a template

Templates are editable agent-package input directories, not signed artifacts. Add them under
`registry/templates/<publisher>/<id>/` for ordinary line-by-line review. A template listing must be clearly
marked unsigned, and a recipient must inspect and export it under their own publisher identity before use.

## Lifecycle status without rewriting history

`registry/status.json` is a separate `acx.registry-status/1` ledger. It can mark a full immutable
coordinate:

- `deprecated` — still available, but discouraged;
- `withdrawn` — the registry advises against use; or
- `superseded` — replaced by an explicitly named successor coordinate.

Every entry includes a reason and timestamp. The ledger does not alter the artifact or invalidate its
signature. It is registry advice, distinct from key revocation and level-credential revocation. The index
builder validates the ledger and projects status onto discovery cards; the Exchange shows it before
download.

## The CI gate

Run the exact local gate before opening a PR:

```bash
node --experimental-sqlite tools/build-registry-index.mjs
node tools/check-registry-immutability.mjs --base <full-base-commit-sha>
npm test
git diff --check
git diff -- registry/
```

The index builder:

1. opens cartridges read-only, recomputes the live ROM manifest, evaluates trust, validates the clean
   package specification, and resolves level/capability proof state;
2. validates workflow and Agent Graph publication structure, recomputes their JCS digests, and verifies
   Ed25519 DSSE/in-toto signatures;
3. checks canonical publisher/id/version paths;
4. validates signed lineage and resolves every pinned Agent Graph workflow dependency;
5. validates the status ledger;
6. emits safe discovery metadata for all versions and marks a SemVer `latest` entry; and
7. writes the deterministic `acx.registry-index/1`.

A separate history-aware pull-request gate compares the head with the exact accepted base commit. It
allows additions but rejects modification, deletion, or rename of an existing canonical signed-artifact
path. This closes the case a current-byte-only rebuild cannot detect: replacing one valid signed release
with different, also valid signed bytes at the same coordinate. Corrections use a new SemVer; lifecycle
changes use `registry/status.json`.

A generated index is a convenience and allowlist, not a trust root. Consumers still verify the downloaded
artifact bytes.

## Build the static Exchange

```bash
node --experimental-sqlite tools/build-static-exchange.mjs
# dist/exchange/
```

The builder consumes the validated index as an allowlist, then independently re-verifies the live bytes.
For JSON it checks signed identity, digest, and signature bindings. For `.acx` it opens SQLite read-only
and checks trust, the closed package profile, ROM-only publication state, ROM-bound
publisher/id/version, and the ROM digest. Only then does it copy bytes unchanged, produce stable detail
pages and relative links, and emit a manifest of output digests. Unsafe paths, symlinks, or any mismatch
fail the build.

For the docs deployment:

```bash
node --experimental-sqlite tools/build-static-exchange.mjs \
  --out docs-site/site/exchange \
  --site-url https://lboel.github.io/acx/exchange/
```

The result is backend-free and subpath-hostable. Browser verification is intentionally limited:
workflows and Agent Graphs can be JCS/Ed25519-verified with WebCrypto; SQLite cartridges must be downloaded
and verified with `acx verify` and `acx spec`.

## Namespace and review boundaries

A signed `publisherId` is a claim. `io.github.*` requires the GitHub-OIDC proof and domain-based names
require the DNS-TXT proof defined by the standard. A matching git path, username, approved PR, display
name, download count, or repository ownership does not independently satisfy that proof.

Human review still decides:

- whether namespace evidence has been supplied through the supported proof path;
- whether authorship, attribution, and license metadata are plausible and compatible;
- whether discovery copy is useful and public-safe; and
- whether the artifact belongs in this community registry.

The Exchange has no payment, entitlement, identity, or licensing-enforcement layer. A third-party service
may add one, but an ACX listing or signature is not proof of purchase or permission to use content.

### Agent-native submission

`skills/acx-share-agent/SKILL.md` packages this sequence as an Agent Skill. A SKILL.md-aware agent can
verify an artifact, prepare its immutable path, regenerate the index, run checks, and draft a focused PR.
Remote writes remain human-authorized and submissions are never auto-merged.

## See also

- [Explore and remix in the static Exchange](exchange.md).
- [Share ACX](../share.md) for the short, copyable flow.
- [Agent Graph](../format/agent-graph.md) for reporting, knowledge stewardship, and loop convergence.
- [Signing & trust](../format/signing-trust.md) for the trust taxonomy and namespace proof.
