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

# static build -> ./site/
.venv/bin/zensical build
```

The build is clean (`No issues found`) and produces the complete static site under `site/`.

## Structure

- `zensical.toml` — site config (nav, theme, markdown extensions; teal/cyan cartridge palette).
- `docs/` — the content tree (`index.md`, `concepts/`, `format/`, `leveling/`, `lifecycle/`, `reference/`, `proofs.md`).
- `docs/_assets/` — the cartridge illustration (`cartridge.svg`), the verbatim proof transcript, and a real level credential example.
- `docs/stylesheets/extra.css` — the cartridge-inspired theme.
- `docs/llms.txt` — the concise machine-readable entry point for agents and language models.

## Compatibility

Zensical natively reads `mkdocs.yml` too and is Material-for-MkDocs compatible, so the same content
also builds with `mkdocs build` after `pip install mkdocs-material` (rename/port `zensical.toml` to
`mkdocs.yml` if you go that route).

Everything the docs claim is backed by a runnable proof — see the **Proofs** page, or run
`npm test`, `node --experimental-sqlite scripts/smoke.mjs`, and `scripts/prove-level.mjs` from the
repository root.
