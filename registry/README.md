# Cartridge Exchange — git registry

An open, forkable, PR-reviewed registry of **Agent Cartridges** (`.acx`), signed **ACX Workflows**
(`.cal.json`), and agent-package **templates**, shared entirely over git. No server, no accounts:
fork the repo, push a signed artifact, open a pull request. A CI gate cryptographically verifies
every signed artifact before it can appear in the index.

> [!IMPORTANT]
> The registry never executes anything. Verification opens each `.acx` read-only and checks
> **metadata and signatures only**: the ed25519/DSSE envelope, the content-addressed ROM
> manifest recomputed from live bytes, and the package spec. No skill, prompt, or code inside a
> cartridge is ever run.

## What lives here

| Path | What it is |
| --- | --- |
| `cartridges/<publisher>/<name>/cartridge.acx` | A signed Agent Cartridge, namespaced by the publisher's reverse-DNS id (e.g. `io.github.ridgeworks/ada-ridge/`) |
| `cartridges/<publisher>/<name>/README.md` | The cartridge's card: what it does, stack, how it was trained |
| `templates/` | Agent-package templates — plain directories you can copy, edit, and `export` into your own cartridge |
| `cals/<id>.cal.json` | A signed `acx.cal/1` agent-team workflow, portable across rosters |
| `trust-registry.json` | **Public keys only** (`{ keys: [{ keyid, publisherId, algorithm, publicKeyPem }] }`). Never a private key. |
| `index.json` | **Generated — do not edit.** `acx.registry-index/1`, rebuilt deterministically by CI from verified cartridges and workflows |

## Browse

`index.json` is the machine-readable catalog: one entry per verified cartridge with name,
publisher, role, trust status, ROM hash, capabilities, and (when present) the independently
attested level. To inspect a cartridge locally (Node ≥ 22, zero dependencies):

```bash
node --experimental-sqlite src/cli.mjs inspect registry/cartridges/io.github.ridgeworks/ada-ridge/cartridge.acx
node --experimental-sqlite src/cli.mjs verify  registry/cartridges/io.github.ridgeworks/ada-ridge/cartridge.acx --registry registry/trust-registry.json
node --experimental-sqlite src/cli.mjs spec    registry/cartridges/io.github.ridgeworks/ada-ridge/cartridge.acx
```

`spec` prints the cartridge's clean package spec (`acx.package-spec/1`, SPEC §7.7): a
ROM-signed manifest enumerating every artifact with its versioned schema id, so a cartridge is
self-describing before you trust anything inside it.

To inspect and verify a workflow:

```bash
node --experimental-sqlite src/cli.mjs workflow inspect registry/cals/ship-a-feature.cal.json
node --experimental-sqlite src/cli.mjs workflow verify registry/cals/ship-a-feature.cal.json --registry registry/trust-registry.json
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
   node --experimental-sqlite src/cli.mjs share agent <name>.acx --slug <name> --dry-run
   node --experimental-sqlite src/cli.mjs share agent <name>.acx --slug <name>
   ```

   This re-verifies the signed bytes and package specification, then writes only
   `registry/cartridges/<publisher>/<name>/cartridge.acx` and a generated discovery `README.md`.
4. **Optionally add your public key** to `trust-registry.json` (keyid, publisherId, algorithm,
   PEM public key). With your key registered, verifiers see `trusted`; without it the cartridge
   still verifies as `portable` (valid signature, publisher not yet in the registry).
5. **Open a pull request.** CI verifies your cartridge and regenerates `index.json`.

## Push a workflow

```bash
node --experimental-sqlite src/cli.mjs workflow lint team.cal.json --publish
node --experimental-sqlite src/cli.mjs workflow sign team.cal.json \
  --publisher io.github.yourhandle \
  --out registry/cals/team.cal.json
node --experimental-sqlite src/cli.mjs workflow verify registry/cals/team.cal.json
node --experimental-sqlite src/cli.mjs share workflow registry/cals/team.cal.json --dry-run
```

Commit the signed JSON, but never its private `.key.pem`. CI rejects unsigned workflows, content or
publisher tampering, unknown fields, dangling references, unbounded cycles, missing terminal paths,
and incomplete publication metadata.

## Let an agent prepare its own submission

The bundled `skills/acx-share-agent/SKILL.md` gives a SKILL.md-aware agent the same fail-closed path:
verify, dry-run, prepare canonical paths, regenerate the index, run tests, inspect the diff, and draft a
PR. It never includes a private key, pushes, opens a PR, or merges without explicit human authority.

## The verification gate

Every push runs the index builder:

```bash
node --experimental-sqlite tools/build-registry-index.mjs
```

For **every** cartridge under `cartridges/` it opens the file read-only, evaluates the trust
taxonomy (signature verification against the recomputed ROM manifest), and validates the
package spec. Any cartridge that is `tampered`, has an `invalid` signature, or carries an
unclean spec is **rejected** — the build exits non-zero and the PR cannot merge, so `index.json`
only ever lists cartridges whose signed ROM is byte-for-byte intact. This is verified live: a
deliberately tampered cartridge pushed to the registry fails the index build.

For every workflow under `cals/`, the same gate validates its public profile, recomputes the RFC
8785/JCS digest, verifies its Ed25519 DSSE/in-toto envelope and publisher binding, and indexes only a
safe discovery card. The gate never executes tasks from either artifact type.

## Push a template

Templates are unsigned starting points, not cartridges: a plain agent-package directory
(persona, skills, loop policy, seed memories) that others copy and `export` under their own
publisher id. Add one under `templates/<template-name>/` with a `README.md` describing what it
is for, and open a PR. Templates are reviewed like any code contribution; they are not indexed
or signature-checked.

## How this fits with the other channels

The git registry complements the other two distribution channels — same `.acx` file, three
ways to move it:

- **Git (this directory)** — open, forkable, PR-reviewed sharing of cartridges and templates,
  with human review plus the CI verification gate.
- **OCI** — registry-grade distribution: the `.acx` is one layer in an OCI image manifest,
  pushable to any container registry.
- **HTTP exchange** (`platform/`) — a live browse/verify/trade UI over the same cartridges.
