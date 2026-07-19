# Agent Cartridge — documentation site

The official docs for the Agent Cartridge (`.acx`) standard, built with
[Zensical](https://zensical.org) (the modern static site generator from the Material for MkDocs team).

## Build & serve

```bash
cd docs-site

# one-time: create a venv and install Zensical
uv venv && uv pip install zensical      # or: python3 -m venv .venv && .venv/bin/pip install zensical

# live-reload dev server
.venv/bin/zensical serve

# static docs + validated Exchange -> ./site/
.venv/bin/zensical build
cd ..
node --experimental-sqlite tools/build-registry-index.mjs
node --experimental-sqlite tools/build-static-exchange.mjs \
  --out docs-site/site/exchange \
  --site-url https://acx.dev/exchange/
```

The combined output is entirely static. The Exchange uses relative runtime links and can be copied to a
different host or subpath; `--site-url` only sets canonical/Open Graph share metadata.

## Structure

- `zensical.toml` — site config (nav, theme, markdown extensions; teal/cyan cartridge palette).
- `docs/` — the content tree (`index.md`, `concepts/`, `format/`, `leveling/`, `lifecycle/`, `reference/`, `proofs.md`).
- `docs/_assets/` — the cartridge illustration (`cartridge.svg`), the verbatim proof transcript, and a real level credential example.
- `docs/stylesheets/extra.css` — the cartridge-inspired theme.
- `docs/llms.txt` — the concise machine-readable entry point for agents and language models.
- `../platform/static/` — the source for the browser Exchange and local-first remix Studio.
- `../tools/build-static-exchange.mjs` — independently re-verifies allowlisted JSON and SQLite
  artifacts, then writes `site/exchange/`.

## Compatibility

Zensical natively reads `mkdocs.yml` too and is Material-for-MkDocs compatible, so the same content
also builds with `mkdocs build` after `pip install mkdocs-material` (rename/port `zensical.toml` to
`mkdocs.yml` if you go that route).

Everything the docs claim is backed by a runnable proof — see the **Proofs** page, or run `npm test`,
`node --experimental-sqlite scripts/smoke.mjs`, `scripts/prove-level.mjs`, and the two static-build
commands from the repository root.
