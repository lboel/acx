# Optional LanceDB materializer

The CLI core is zero-dependency. Producing a **real LanceDB dataset** (`acx.lance-memory/1`) needs one
dependency — `pylance` — isolated here so the core stays clean.

## Setup (once)

```bash
uv venv tools/lance/.venv --python 3.12
uv pip install --python tools/lance/.venv pylance pyarrow numpy
```

(or point `acx lance --python <path>` / `ACX_PYTHON` at any Python that has `pylance` + `pyarrow`.)

## Use

```bash
node --experimental-sqlite src/cli.mjs lance my-agent.acx
```

- Computes `local-hash-128` vectors in JS (`src/embed.mjs`, `acx.embed/local-hash-128/1`).
- Writes a genuine Lance dataset (`data/`, `_versions/`, `_transactions/`) with the fixed 14-column
  `acx.lance-memory/1` schema and a `fixed_size_list<float, 128>` `vector` column.
- Embeds it in the cartridge **SAVE zone** at `save/vectors/memories.lance/` — unsigned, so the ROM
  signature is unaffected.
- Leaves a standalone `<file>.memories.lance/` dataset any LanceDB runtime opens directly.

`tools/lance/.venv/` and `*.memories.lance/` are git-ignored; the JSON memory baseline in the cartridge
remains the source of truth and is re-indexed on import.
