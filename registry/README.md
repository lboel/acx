# Cartridge Exchange — git registry

An open, forkable, PR-reviewed registry of **Agent Cartridges** (`.acx`), signed **ACX Workflows**
(`.cal.json`), signed **ACX Agent Graphs** (`.agent-graph.json`), and agent-package **templates**,
shared entirely over git. No server, no accounts: fork the repo, push a signed artifact, open a pull
request. A CI gate cryptographically verifies every signed artifact before it can appear in the index.

> [!IMPORTANT]
> The registry never executes anything. Verification opens each `.acx` read-only and recomputes its
> signed, content-addressed ROM manifest. Workflows and Agent Graphs are canonicalized before their
> Ed25519/DSSE signatures and publication profiles are checked. No skill, prompt, task, or route is run;
> an Agent Graph describes communication and knowledge stewardship but grants no runtime permission.

## What lives here

| Path | What it is |
| --- | --- |
| `cartridges/<publisher>/<id>/<version>/cartridge.acx` | A signed Agent Cartridge at an immutable publisher/id/version coordinate |
| `cartridges/<publisher>/<id>/<version>/README.md` | A generated, non-authoritative discovery card for that exact release |
| `cals/<publisher>/<id>/<version>.cal.json` | A signed `acx.cal/1` agent-team workflow release |
| `graphs/<publisher>/<id>/<version>.agent-graph.json` | A signed `acx.agent-graph/1` information-architecture release |
| `templates/<id>/` | An indexed, unsigned agent-package starting point that recipients inspect and export themselves |
| `status.json` | A separate lifecycle projection for active, deprecated, revoked, or superseded immutable releases |
| `index.json` | **Generated — do not edit.** `acx.registry-index/1`, rebuilt deterministically from independently verified live bytes |

The universal signed-artifact coordinate is
`(artifactType, publisherId, id, version, digest)`. Paths bind the first four values; the generated index
binds the digest. An existing coordinate is never overwritten: publish a new SemVer and, when relevant,
record lifecycle or successor information in `status.json`.

## Browse

`index.json` is the machine-readable catalog. Its `cartridges`, `workflows`, and `agentGraphs`
collections contain safe discovery cards plus independent counts; no task or knowledge payload is copied
into the index. Cartridge cards include name, publisher, role, trust status, ROM hash, capabilities, and
(when present) the independently attested level. To inspect one locally (Node ≥ 22.5.0, zero dependencies):

```bash
node --experimental-sqlite src/cli.mjs inspect registry/cartridges/io.github.ridgeworks/ada-ridge/1.0.0/cartridge.acx
node --experimental-sqlite src/cli.mjs verify  registry/cartridges/io.github.ridgeworks/ada-ridge/1.0.0/cartridge.acx
node --experimental-sqlite src/cli.mjs spec    registry/cartridges/io.github.ridgeworks/ada-ridge/1.0.0/cartridge.acx
```

`spec` prints the cartridge's clean package spec (`acx.package-spec/1`, SPEC §7.7): a
ROM-signed manifest enumerating every artifact with its versioned schema id, so a cartridge is
self-describing before you trust anything inside it.

To inspect and verify a workflow:

```bash
node --experimental-sqlite src/cli.mjs workflow inspect registry/cals/io.github.lboel/ship-a-feature/1.0.0.cal.json
node --experimental-sqlite src/cli.mjs workflow verify registry/cals/io.github.lboel/ship-a-feature/1.0.0.cal.json
```

To browse the information architecture joining reusable loops:

```bash
node --experimental-sqlite src/cli.mjs graph inspect registry/graphs/io.github.lboel/product-delivery/1.0.0.agent-graph.json
node --experimental-sqlite src/cli.mjs graph verify  registry/graphs/io.github.lboel/product-delivery/1.0.0.agent-graph.json
```

## Push a cartridge

1. **Fork** this repository.
2. **Make a cartridge** from your agent package directory:

   ```bash
   node --experimental-sqlite src/cli.mjs export <agent-package-dir> <name>.acx --publisher <your-reverse-dns-id>
   ```

   This signs the ROM and writes the private key to `<name>.acx.key.pem` — **outside** the
   cartridge. Keep that file; never commit it.
3. **Preview and prepare the canonical paths**:

   ```bash
   node --experimental-sqlite src/cli.mjs share agent <name>.acx --dry-run
   node --experimental-sqlite src/cli.mjs share agent <name>.acx
   ```

   This re-verifies the signed bytes and PackageSpec, rejects SAVE data, binds the ROM-declared
   publisher/id/version, and writes
   `registry/cartridges/<publisher>/<id>/<version>/cartridge.acx` plus its generated discovery card.
   `--slug <id>` is optional and, when supplied, must equal the signed immutable artifact id.
4. **Open a pull request.** Commit no `.key.pem` file. CI verifies the cartridge and requires the
   committed deterministic `index.json` to match a fresh build.

A self-contained signature proves integrity and possession of its embedded key, so an otherwise valid
artifact can be exchanged as `portable`. It does **not** prove control of the claimed publisher namespace.
That upgrade requires a separately governed ACX trust registry with an active key, namespace proof,
validity window, and revocation status; it is not created implicitly by adding a file to this directory.

## Push a workflow

```bash
node --experimental-sqlite src/cli.mjs workflow lint team.cal.json --publish
node --experimental-sqlite src/cli.mjs workflow sign team.cal.json \
  --publisher io.github.yourhandle \
  --out team.signed.cal.json
node --experimental-sqlite src/cli.mjs workflow verify team.signed.cal.json
node --experimental-sqlite src/cli.mjs share workflow team.signed.cal.json --dry-run
node --experimental-sqlite src/cli.mjs share workflow team.signed.cal.json
```

Commit the signed JSON, but never its private `.key.pem`. CI rejects unsigned workflows, content or
publisher tampering, unknown fields, dangling references, unbounded cycles, missing terminal paths,
and incomplete publication metadata.

## Push an Agent Graph

An Agent Graph is a fuzzy, machine-checkable information architecture: roles may be selected by
description, while knowledge stewardship, reporting routes, expected responses, and the points where loops
converge remain explicit. It describes who should communicate with whom; it does not schedule tasks or
grant tools and credentials.

```bash
node --experimental-sqlite src/cli.mjs graph lint product-delivery.agent-graph.json --publish
node --experimental-sqlite src/cli.mjs graph sign product-delivery.agent-graph.json \
  --publisher io.github.yourhandle \
  --out product-delivery.signed.agent-graph.json
node --experimental-sqlite src/cli.mjs graph verify product-delivery.signed.agent-graph.json
node --experimental-sqlite src/cli.mjs share graph product-delivery.signed.agent-graph.json --dry-run
node --experimental-sqlite src/cli.mjs share graph product-delivery.signed.agent-graph.json
```

The share command re-verifies the signed bytes and prepares the canonical
`registry/graphs/<publisher>/<id>/<version>.agent-graph.json` path. `graph sign` writes a private
`*.key.pem` beside its output when no key is supplied: keep that key outside git. CI rejects unsigned or
tampered graphs, invalid publisher bindings, secret-like metadata, unknown fields, dangling
actor/knowledge/loop references, digest-unpinned ACX workflow loops, and unbounded convergence.

## Let an agent prepare its own submission

The bundled `skills/acx-share-agent/SKILL.md` gives a SKILL.md-aware agent the same fail-closed path:
verify, dry-run, prepare canonical paths, regenerate the index, run tests, inspect the diff, and draft a
PR for an agent, workflow, or Agent Graph. It never includes a private key, pushes, opens a PR, or merges
without explicit human authority.

## The verification gate

Every pull request first checks accepted history and then runs the index builder:

```bash
node tools/check-registry-immutability.mjs --base <full-base-commit-sha>
node --experimental-sqlite tools/build-registry-index.mjs
```

The history-aware check allows new canonical releases but rejects modification, deletion, or rename of
an already accepted signed-artifact path. For **every** cartridge under `cartridges/`, the index builder
then opens the file read-only, evaluates the trust
taxonomy (signature verification against the recomputed ROM manifest), and validates the
package spec. Any cartridge that is `tampered`, has an `invalid` signature, or carries an
unclean spec is **rejected** — the build exits non-zero and the PR cannot merge, so `index.json`
only ever lists cartridges whose signed ROM is byte-for-byte intact. This is verified live: a
deliberately tampered cartridge pushed to the registry fails the index build.

For every workflow under `cals/`, the same gate validates its public profile, recomputes the RFC
8785/JCS digest, verifies its Ed25519 DSSE/in-toto envelope and publisher binding, and indexes only a
safe discovery card. The gate never executes tasks from either artifact type.

For every Agent Graph under `graphs/`, the gate also validates the reference-safe information
architecture and bounded convergence, recomputes the JCS digest, verifies the Ed25519 DSSE/in-toto
envelope and publisher binding, and indexes only counts plus a discovery card. It never follows routes,
dispatches agents, or reads knowledge from a referenced locator.

## Push a template

Templates are unsigned starting points, not cartridges: a plain agent-package directory
(persona, skills, loop policy, seed memories) that others copy and `export` under their own
publisher id. Add one under `templates/<template-name>/` with a `README.md` describing what it
is for, and open a PR. Templates are reviewed like any code contribution and indexed as explicitly
unsigned editable source; they are never presented as signature-verified cartridges.

## How this fits with the other channels

The git registry complements the other two distribution channels — same `.acx` file, three
ways to move it:

- **Git (this directory)** — open, forkable, PR-reviewed sharing of cartridges and templates,
  with human review plus the CI verification gate.
- **OCI** — registry-grade distribution: the `.acx` is one layer in an OCI image manifest,
  pushable to any container registry.
- **Static Exchange** (`platform/static/`) — a browse, verify, download, remix, and share surface built
  entirely into files by `node --experimental-sqlite tools/build-static-exchange.mjs`; deploy the output
  directory to GitHub Pages, any object store, CDN, or ordinary static file host.

## Legacy paths

Unversioned paths such as `cartridges/<publisher>/<id>/cartridge.acx`,
`cals/<id>.cal.json`, and `graphs/<id>.agent-graph.json` are not accepted publication coordinates.
Keep historical copies outside `registry/`; verify them locally and re-export or re-sign them with a
stable id and SemVer before proposing them as a new immutable release.
