# ACX Exchange

ACX Exchange is a zero-dependency, statically hostable catalog for portable agents, team workflows,
Agent Graphs, and starter templates. It turns the Git-reviewed ACX registry into plain HTML, CSS,
JavaScript, JSON, and artifact files. There is no account system, database, upload endpoint, or runtime
agent execution.

The public sharing loop is:

**discover → inspect → verify → download → remix → sign locally → publish by PR → share**

> **The Exchange never runs an agent or workflow.** It displays signed discovery metadata and offers
> local verification. Downloaded artifacts remain inert until a user deliberately loads them elsewhere.

## Build the static Exchange

Requires Node 22 or newer.

```bash
npm run build:registry
npm run build:exchange -- --site-url https://acx.dev/exchange/
```

The first command verifies every registry artifact and deterministically regenerates
`registry/index.json`. The second writes the deployable site to `dist/exchange/`.

`--site-url` sets canonical URLs plus Open Graph/Twitter metadata and the ACX social share card on
pre-rendered artifact pages. Omit it for a rehost-neutral local build, or use the final subpath for
another host:

```bash
npm run build:exchange -- --site-url https://example.org/community/acx/
```

Preview the result with any static file server. For example:

```bash
python3 -m http.server 8787 --directory dist/exchange
```

Then open `http://localhost:8787/`. JavaScript modules require HTTP(S); opening `index.html` directly via
`file:` is not a supported preview mode.

## What the build contains

| Output | Purpose |
| --- | --- |
| `index.html` | Searchable, filterable Exchange |
| `studio/` | Local-first workflow and Agent Graph draft/remix Studio |
| `data/index.json` | Static catalog with safe discovery cards and download paths |
| `data/artifacts/` | Allowlisted artifact bytes and template bundles |
| `artifacts/<type>/<slug>/index.html` | Pre-rendered, shareable detail pages with canonical/social metadata |
| `manifest.json` | Deterministic output inventory with byte sizes and SHA-256 digests |

The build copies only paths admitted by the verified registry index. It binds workflow and Agent Graph
paths to their publisher/id/version coordinates, re-verifies signed JSON with the browser-compatible
verifier, rejects traversal and symbolic links, and allowlists static and template file types.

The entire directory can be deployed to GitHub Pages, Cloudflare Pages, Netlify, S3-compatible object
storage, or any ordinary static host. No serverless function or environment variable is required at
runtime.

## Trust shown in the UI

The Exchange deliberately separates different claims:

- A **portable signature** proves that the displayed workflow or Agent Graph bytes were signed by the
  included Ed25519 key. It does not prove that the signer controls the claimed publisher namespace.
- **Trusted publisher** status additionally requires registry key resolution and namespace proof.
- Embedded agent levels and capability `verified` flags remain **claims** until issuer keys, revocation
  state, ROM binding, and referenced evidence resolve successfully.
- `.acx` agents are SQLite containers. Browsers can compare copied bytes and index hashes, but full
  cartridge/ROM verification uses the ACX CLI.
- Templates are unsigned editable source. Inspect every file before export.

For a downloaded agent:

```bash
acx verify agent.acx
acx spec agent.acx
acx load agent.acx --print-only
```

For signed JSON:

```bash
acx workflow verify team.cal.json
acx graph verify product.agent-graph.json
```

The browser verifier for workflows and Agent Graphs recomputes the RFC 8785/JCS digest, verifies the
Ed25519 DSSE signature, and checks the signed in-toto identity binding locally. It does not contact a
trust service or grant runtime authority.

## Discover and share

Each built artifact has a stable pre-rendered detail page under
`artifacts/<type>/<slug>/`. The Exchange's Share action uses that page when available, so links have
useful titles and descriptions even before the JavaScript catalog loads.

The catalog includes all accepted versions. `latest` is derived per publisher/id using SemVer; older
versions remain discoverable. Lifecycle state comes from the exact-digest `registry/status.json` ledger:
an artifact may be active, deprecated, withdrawn, or superseded without rewriting its signed bytes.

Publishing is PR-only:

1. Fork `lboel/acx`.
2. Verify and prepare one artifact with `acx share`.
3. Regenerate the registry and static Exchange.
4. Review the exact diff and open a focused pull request.
5. After CI, human review, merge, and deployment, share the generated Exchange detail URL.

The bundled `$acx-share-agent` skill makes that process safe for an agent to prepare on its own:

```bash
node --experimental-sqlite skills/acx-share-agent/scripts/render-pr-body.mjs \
  workflow ./team.cal.json
```

The script emits a ready-to-paste PR body and the deterministic post-merge
`https://acx.dev/exchange/artifacts/.../` URL. It does not commit, push, open, or merge a pull request.

## Canonical immutable coordinates

Registry publication uses:

```text
registry/cartridges/<publisher>/<id>/<version>/cartridge.acx
registry/cals/<publisher>/<id>/<version>.cal.json
registry/graphs/<publisher>/<id>/<version>.agent-graph.json
```

Every published signed-artifact coordinate is immutable. Changed bytes require a new SemVer; even
`--force` cannot replace an existing coordinate. Pull-request CI also refuses modification, deletion, or
rename of an accepted canonical artifact path relative to the exact base commit.

An Agent Graph loop that references an ACX workflow pins the exact dependency:

```json
{
  "workflowRef": {
    "publisherId": "io.github.example",
    "id": "ship-a-feature",
    "version": "1.2.0",
    "digest": "sha256:…"
  }
}
```

The registry build rejects missing and digest-mismatched dependencies. A remix records its signed parent
coordinate and digest in `lineage.parents[]`; lineage describes provenance and never transfers trust,
credentials, or permissions.

## Remix locally in Studio

The static Studio at `/studio/` creates and imports workflow or Agent Graph drafts entirely in the
browser. Importing a signed artifact removes its old integrity block and adds immutable remix lineage
before editing. The Studio can export JSON or copy a CLI handoff, but it never handles a publishing key
and never signs on the user's behalf.

Finish a draft locally:

```bash
acx workflow lint draft.cal.json --publish
acx workflow sign draft.cal.json --publisher io.github.yourname --out team.cal.json
acx share workflow team.cal.json --dry-run
```

Use the equivalent `acx graph` commands for an Agent Graph. Keep every generated `*.key.pem` outside git.

## Share an agent safely

Agent publication must contain ROM only. `acx share agent` rejects the cartridge when any SAVE-zone
memory, files, objects, or vectors are present.

```bash
acx export ./my-agent-package ./my-agent.acx --publisher io.github.yourname
acx verify ./my-agent.acx
acx spec ./my-agent.acx
acx share agent ./my-agent.acx --dry-run
acx share agent ./my-agent.acx
```

Never commit the generated private key. The signed cartridge is authoritative; its generated README and
Exchange card are discovery metadata.

## Local Studio server

The CLI can serve the exact static Studio shipped in the Exchange:

```bash
acx builder --port 8799
```

It has no write endpoint or server-side draft store. The browser exports unsigned local JSON downloads;
linting, signing, registry preparation, and publication remain explicit CLI and pull-request steps. The
public Exchange intentionally has no upload route; use a reviewed registry PR for publication.
