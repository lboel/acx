#!/usr/bin/env python3
"""Write a REAL LanceDB dataset (acx.lance-memory/1) from precomputed rows.

Reads a JSON array of memory rows (each already carrying a 128-d `vector`, computed
by src/embed.mjs so vectors match the JS engine byte-for-byte) on stdin, and writes
a Lance dataset with the fixed acx.lance-memory/1 schema to argv[1].

Depends on pylance + pyarrow (installed into tools/lance/.venv). This is the ONE
optional dependency in the project; the CLI core stays zero-dependency.
"""
import sys, json, shutil
import pyarrow as pa
import lance

DIM = 128
SCHEMA = pa.schema([
    ("id", pa.string()),
    ("zone", pa.string()),
    ("portable", pa.bool_()),
    ("artifact_fingerprint", pa.string()),
    ("codebase_fingerprint", pa.string()),
    ("title", pa.string()),
    ("summary", pa.string()),
    ("source_type", pa.string()),
    ("tags", pa.list_(pa.string())),
    ("impact", pa.string()),
    ("xp_awarded", pa.int32()),
    ("timestamp", pa.string()),
    ("text", pa.string()),
    ("vector", pa.list_(pa.float32(), DIM)),
], metadata={
    b"acx.schema_version": b"acx.lance-memory/1",
    b"acx.embedding_engine": b"local-hash-128",
    b"acx.distance_metric": b"cosine",
    b"acx.partition_by": b"zone",
})

def col(rows, key, default=None):
    return [r.get(key, default) for r in rows]

def main():
    out = sys.argv[1]
    rows = json.load(sys.stdin)
    for r in rows:
        v = r.get("vector") or [0.0] * DIM
        if len(v) != DIM:
            raise SystemExit(f"row {r.get('id')}: vector dim {len(v)} != {DIM}")
    table = pa.table({
        "id": col(rows, "id", ""),
        "zone": col(rows, "zone", "rom"),
        "portable": col(rows, "portable", True),
        "artifact_fingerprint": col(rows, "artifactFingerprint", ""),
        "codebase_fingerprint": col(rows, "codebaseFingerprint", None),
        "title": col(rows, "title", ""),
        "summary": col(rows, "summary", ""),
        "source_type": col(rows, "sourceType", "knowledge"),
        "tags": col(rows, "tags", []),
        "impact": col(rows, "impact", "neutral"),
        "xp_awarded": pa.array([int(r.get("xpAwarded", 0) or 0) for r in rows], type=pa.int32()),
        "timestamp": col(rows, "timestamp", ""),
        "text": col(rows, "text", ""),
        "vector": pa.array([r.get("vector") for r in rows], type=pa.list_(pa.float32(), DIM)),
    }, schema=SCHEMA)
    shutil.rmtree(out, ignore_errors=True)
    lance.write_dataset(table, out)
    ds = lance.dataset(out)
    print(json.dumps({"rows": ds.count_rows(), "path": out, "vectorType": str(ds.schema.field("vector").type)}))

if __name__ == "__main__":
    main()
