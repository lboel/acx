# Cartridge Exchange — git registry

An open, forkable, PR-reviewed registry of **Agent Cartridges** (`.acx`) and agent-package
**templates**, shared entirely over git. No server, no accounts: fork the repo, push a signed
cartridge, open a pull request. A CI gate cryptographically verifies every cartridge before it
can appear in the index — a tampered push cannot be listed.

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
| `trust-registry.json` | **Public keys only** (`{ keys: [{ keyid, publisherId, algorithm, publicKeyPem }] }`). Never a private key. |
| `index.json` | **Generated — do not edit.** `acx.registry-index/1`, rebuilt by CI from the verified cartridges |

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

## Push a cartridge

1. **Fork** this repository.
2. **Make a cartridge** from your agent package directory:

   ```bash
   node --experimental-sqlite src/cli.mjs export <agent-package-dir> <name>.acx --publisher <your-reverse-dns-id>
   ```

   This signs the ROM and writes the private key to `<name>.acx.key.pem` — **outside** the
   cartridge. Keep that file; never commit it.
3. **Drop it in place** with a short card:

   ```
   registry/cartridges/<your-reverse-dns-id>/<name>/cartridge.acx
   registry/cartridges/<your-reverse-dns-id>/<name>/README.md
   ```
4. **Optionally add your public key** to `trust-registry.json` (keyid, publisherId, algorithm,
   PEM public key). With your key registered, verifiers see `trusted`; without it the cartridge
   still verifies as `portable` (valid signature, publisher not yet in the registry).
5. **Open a pull request.** CI verifies your cartridge and regenerates `index.json`.

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
