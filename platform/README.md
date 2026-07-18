# Cartridge Exchange

A zero-dependency **reference exchange** for `.acx` agent cartridges. Run it
locally to **browse** a roster, **verify** signatures and trust status,
**acquire** (download) cartridges, and **publish** (upload) your own — all
served from a single `node:http` process with no external dependencies.

It is the companion demo to the `agent-cartridge` reference implementation: it
reuses `../src` to read and verify cartridges, and renders everything as
server-side HTML with a cartridge theme.

> **This never runs an agent.** The Exchange only reads cartridge metadata and
> verifies cryptographic signatures. It does not, and cannot, execute a
> cartridge. See [Security model](#security-model).

---

## What it is

The Exchange is a small trading floor for cartridges:

- **Browse** a gallery (the *roster*) ranked by verified level and trust.
- **Inspect** any cartridge's skills, capabilities, memory zones, and level
  credential on a detail page.
- **Verify** each cartridge's signature and SPEC §4.5 trust taxonomy status.
- **Acquire** a cartridge by downloading the raw `.acx` file.
- **Publish** your own cartridge by uploading it — it is verified on the way in,
  and tampered uploads are rejected.

It is intentionally minimal: an in-memory catalog on disk, server-rendered
pages, and a handful of endpoints. It is a *reference implementation*, not a
production service (see [Not production](#not-production)).

## Quickstart

Requires **Node >= 22** (for the built-in `node:sqlite`). Run everything with
the `--experimental-sqlite` flag.

```bash
# 1. Seed the catalog with a sample roster
node --experimental-sqlite platform/seed.mjs

# 2. Serve the Exchange
node --experimental-sqlite platform/server.mjs
```

Then open:

```
http://localhost:8787
```

Override the port with the `PORT` environment variable:

```bash
PORT=9000 node --experimental-sqlite platform/server.mjs
```

Seeding writes a handful of signed sample cartridges into `platform/catalog/`.
Some of the roster carries an independently issued **level credential**; the
rest are shown at their declared level only. The catalog directory is the
Exchange's entire persistence — deleting it resets the floor.

## Visual workflow builder

The same package includes a local visual authoring surface for ACX Workflows:

```bash
node --experimental-sqlite src/cli.mjs builder --port 8799
```

Open `http://localhost:8799`. The builder validates the full publication profile and local roster,
including metadata, bounds, safety/approval intent, completion contracts, and terminal reachability.
It saves unsigned drafts under `platform/builder/drafts/`; publishing is always an explicit CLI signing
step, so the browser never silently creates or retains a publishing key.

## Endpoints

| Method     | Path              | Purpose                                                                                     |
| ---------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `GET`      | `/`               | Roster gallery — all cartridges, ranked by verified level then trust.                       |
| `GET`      | `/c/:id`          | Cartridge detail page (skills, capabilities, memory, level, verification).                  |
| `GET`      | `/api/cartridges` | JSON index of the full catalog.                                                             |
| `GET`      | `/download/:id`   | Serves the raw `.acx` file (`content-type: application/vnd.acx.cartridge`, as attachment).  |
| `GET`      | `/verify/:id`     | Re-verifies the cartridge and renders its trust status.                                     |
| `GET`      | `/publish`        | Publish form / upload instructions.                                                         |
| `POST`     | `/publish`        | Accepts an uploaded `.acx` (raw body), verifies it, and adds it to the catalog if accepted. |

`:id` is always sanitized to a safe slug before it touches the filesystem (see
below).

## Security model

The Exchange is built so that hosting untrusted cartridges is safe.

> ### The Exchange never executes a cartridge
>
> - **No execution, ever.** The server only opens a cartridge read-only, reads
>   its metadata, and verifies signatures via `../src`. A cartridge is data, not
>   a program to the Exchange.
> - **Signatures are verified.** Every cartridge is run through the SPEC §4.5
>   trust taxonomy (`local` / `trusted` / `portable` / `legacy` / `tampered`).
>   Status and a human summary are shown on the gallery and detail pages.
> - **Uploads are untrusted and verified on publish.** A `POST /publish` upload
>   is inspected before it is accepted. Anything that verifies as **tampered**,
>   or whose credential status is **invalid**, is **rejected** — this is the C1
>   content-integrity check. Rejections bounce back to the publish page with the
>   reason.
> - **SQLite-magic check on upload.** The upload must begin with the
>   `SQLite format 3` magic bytes (and be at least 100 bytes) or it is refused
>   with `400` before any parsing.
> - **8 MB upload cap.** The request body is streamed and aborted with `413`
>   the moment it exceeds 8 MB.
> - **Path-traversal-safe ids.** Every `:id` and upload id is lowercased and
>   stripped to `[a-z0-9._-]` (max 64 chars), and the resolved catalog path is
>   asserted to stay inside the catalog directory. Traversal attempts cannot
>   escape `platform/catalog/`.

Uploaded bytes are staged in a temp file, verified, and only copied into the
catalog if they pass. The temp file is removed either way.

## Publishing your own cartridge

Make a cartridge with the reference CLI, then upload it. From the repository
root:

```bash
# 1. Build a signed .acx from an agent-package directory
node --experimental-sqlite src/cli.mjs export ./my-agent-package ./my-agent.acx \
  --publisher io.github.yourname

# 2. (optional) Inspect / verify it locally first
node --experimental-sqlite src/cli.mjs verify ./my-agent.acx

# 3. Publish it to a running Exchange (raw body upload)
curl -X POST http://localhost:8787/publish \
  -H 'x-cartridge-id: my-agent' \
  --data-binary @./my-agent.acx
```

The `x-cartridge-id` header sets the catalog id (sanitized to a safe slug); omit
it to get an auto-generated `upload-xxxx` id. On success the response redirects
to the new detail page at `/c/:id`. If the cartridge is tampered, unreadable,
too large, or not a SQLite file, publish is refused with the reason.

No agent-package handy? Use the bundled sample under
`examples/sample-agent-package/` (resolved by `src/paths.mjs`), or run
`platform/seed.mjs` to populate a full roster.

## How it fits together

| File           | Role                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| `catalog.mjs`  | Read + verify + summarize `.acx` files; rank the roster; inspect uploads.  |
| `views.mjs`    | Server-rendered HTML (gallery, detail, publish pages) with cartridge theme.|
| `server.mjs`   | `node:http` server, routing, upload handling, and all safety checks.       |
| `seed.mjs`     | Seeds `platform/catalog/` with a varied sample roster.                     |
| `catalog/`     | On-disk catalog directory (the Exchange's only persistence).               |

## Not production

This is a **reference implementation** meant to demonstrate the cartridge
format and trust model — not a hardened service. In particular:

- **In-memory / on-disk catalog only** — the catalog is just the `catalog/`
  directory; there is no database of record, indexing, or backup.
- **No authentication or authorization** — anyone who can reach the port can
  publish or download.
- **No rate limiting** — beyond the 8 MB body cap, there is no throttling.
- **No persistence or availability guarantees** — deleting `catalog/` resets
  everything; there is no migration or durability story.

Do not expose it to untrusted networks or treat it as a real registry. It exists
so you can browse, collect, and trade cartridges against the reference
implementation and see the verification pipeline in action.
