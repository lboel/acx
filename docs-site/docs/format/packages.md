# Package specification

Every cartridge is **cleanly specified**: it carries a signed, closed package spec with exactly eight
normative artifact roles and versioned schema ids — MCP-style self-describing — and pins a fixed LanceDB
schema for the optional vector memory payload.

This page covers SPEC §7.7. The reference logic lives in `src/packagespec.mjs` (build, emit, validate); the JSON Schemas are `schemas/package-spec.schema.json` and `schemas/lance-memory.schema.json`.

---

## Why packages are cleanly specified

A `.acx` file is one SQLite database holding many kinds of content: identity metadata, a memory table, skills in `sqlar`, capability rows, a harness manifest, a loop policy, attestations. Without a manifest of *what is in here and what format each thing claims to be*, a consumer has to guess — probe tables, sniff paths, hope the versions line up.

The package spec removes the guessing. It borrows the pattern MCP uses for tool declarations: **every artifact self-describes with a stable role and a versioned schema id**, so a consumer can

1. enumerate what the package contains,
2. check every `required` artifact is actually present, and
3. validate each artifact against the exact schema version it declares —

all before activating anything. Because the spec lives in the ROM zone (`rom/package-spec.json`), it is covered by the [ROM manifest and DSSE signature](signing-trust.md): a publisher cannot claim one set of artifacts and ship another without the cartridge verifying as `tampered`.

!!! note "Where the spec lives"
    - `rom/package-spec.json` — the package spec, `schemaVersion: "acx.package-spec/1"`, ROM-signed.
    - `rom/schema/lance-memory.json` — the pinned LanceDB memory descriptor, `schemaVersion: "acx.lance-memory/1"`, ROM-signed.
    - Meta keys `acx.package_spec` and `acx.lance_schema` point at both paths.

    Both files are emitted automatically on export (`emitPackageSpec` in `src/packagespec.mjs`) — authors never write them by hand.

---

## Inspecting a package: `acx spec`

The `spec` command prints the package spec and runs full validation: the closed eight-role profile and
cartridge metadata agree exactly, every stored archive path is portable and traversal-safe, required
artifacts exist, memory and capability records conform, and the LanceDB descriptor matches the
cartridge's embedding engine.

```console
$ node --experimental-sqlite src/cli.mjs spec examples/research-designer.acx
package-spec: acx.package-spec/1  engine={"id":"local-hash-128","dim":128}
artifacts:
  * identity         acx.cartridge-meta/1         meta
  * memory-baseline  acx.memory-record.v1         table (1)
    memory-vectors   acx.lance-memory/1           lance
    skills           acx.skill/1                  sqlar (1)
    capabilities     acx.capability/1             table (2)
  * harness          acx.harness.v1               sqlar
  * loop-context     acx.loop-context-policy/1.1  sqlar
    level            acx.level-credential.v1      attestation (0)

validation: CLEAN ✓
```

A `*` marks a **required** artifact; counts in parentheses are live row/file counts. A cartridge that fails any check is not clean, and downstream tooling treats it accordingly — for example, the git registry's index builder (`tools/build-registry-index.mjs`) rejects any pushed cartridge whose package spec fails validation, alongside signature and tamper checks.

??? example "The raw `rom/package-spec.json` behind that output"
    ```json
    {
      "schemaVersion": "acx.package-spec/1",
      "cartridgeId": "io.github.agentibus/scenario-research-designer@3bb15e93-4ab3-437a-9de0-8e4282547cb6",
      "specVersion": "0.1",
      "embeddingEngine": { "id": "local-hash-128", "dim": 128 },
      "artifacts": [
        { "role": "identity", "kind": "meta", "schema": "acx.cartridge-meta/1", "required": true },
        { "role": "memory-baseline", "kind": "table", "table": "memory",
          "mediaType": "application/json", "schema": "acx.memory-record.v1",
          "required": true, "count": 1 },
        { "role": "memory-vectors", "kind": "lance", "path": "vectors/memories.lance",
          "schema": "acx.lance-memory/1", "required": false, "signed": false,
          "reindexOnImport": true, "descriptor": "rom/schema/lance-memory.json" },
        { "role": "skills", "kind": "sqlar", "path": "rom/skills/",
          "schema": "acx.skill/1", "required": false, "count": 1 },
        { "role": "capabilities", "kind": "table", "table": "capabilities",
          "schema": "acx.capability/1", "required": false, "count": 2 },
        { "role": "harness", "kind": "sqlar", "path": "rom/manifest/harness-requirements.json",
          "schema": "acx.harness.v1", "required": true },
        { "role": "loop-context", "kind": "sqlar", "path": "rom/policy/loop-context-policy.json",
          "schema": "acx.loop-context-policy/1.1", "required": true },
        { "role": "level", "kind": "attestation",
          "schema": "acx.level-credential.v1", "required": false, "count": 0 }
      ]
    }
    ```

    Publisher ids like `io.github.agentibus` are illustrative handles, not real organizations.

---

## Artifact roles and schema ids

Each artifact entry is `{role, kind, schema, required, …}`. The `role` is stable, the `kind` says *where
in the container* the artifact lives, and `schema` is one of the registered, versioned ids:

| Role | Schema id | Kind | Required | Format page |
|---|---|---|---|---|
| `identity` | `acx.cartridge-meta/1` | meta | yes | [Container](container.md) |
| `memory-baseline` | `acx.memory-record.v1` | table (`memory`) | yes | [Memory](memory.md) |
| `memory-vectors` | `acx.lance-memory/1` | lance (`vectors/memories.lance`) | no | this page, below |
| `skills` | `acx.skill/1` | sqlar (`rom/skills/`) | no | [Skills](skills.md) |
| `capabilities` | `acx.capability/1` | table (`capabilities`) | no | [Capabilities](capabilities.md) |
| `harness` | `acx.harness.v1` | sqlar (`rom/manifest/harness-requirements.json`) | yes | [Harness requirements](harness-requirements.md) |
| `loop-context` | `acx.loop-context-policy/1.1` | sqlar (`rom/policy/loop-context-policy.json`) | yes | [Loop + context policy](loop-context.md) |
| `level` | `acx.level-credential.v1` | attestation | no | [Leveling](../leveling/provable-level.md) |

`acx.package-spec/1` contains **one and only one of every row in this table**. Each role has a fixed set of
fields and fixed values for its kind, schema, required flag, locator, and import policy. Unknown top-level
or role fields, unknown roles, duplicates, omissions, or a changed role profile make the package unclean.
The manifest's `cartridgeId`, `specVersion`, and closed `{id, dim}` `embeddingEngine` must exactly match
the signed cartridge metadata. “Required: no” means that role's payload may be absent; its role declaration
still appears in the eight-entry manifest with a zero count or the fixed re-index policy.

The full schema index — `$id`s, media types, and the files under `schemas/` — is on the [JSON schemas & media types](../reference/schemas.md) reference page.

---

## The fixed LanceDB memory schema (`acx.lance-memory/1`)

The optional vector payload has exactly one allowed shape. It is pinned in `rom/schema/lance-memory.json` (ROM-signed, pointed to by `acx.lance_schema`) and validated by `schemas/lance-memory.schema.json`:

- **Table**: `memories`
- **Partitioned by**: `zone` (`rom` | `save` — the [two container zones](container.md))
- **Distance metric**: `cosine`
- **Embedding engine**: `{id, dim}` recorded in the descriptor; the `vector` column dimension comes from `dim`

A conforming `.lance` payload **MUST** use exactly these columns:

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `utf8` | no | |
| `zone` | `utf8` | no | enum `rom` \| `save` |
| `portable` | `bool` | no | the [tier selector](memory.md) |
| `artifact_fingerprint` | `utf8` | no | |
| `codebase_fingerprint` | `utf8` | **yes** | `null` for portable records |
| `title` | `utf8` | no | |
| `summary` | `utf8` | no | |
| `source_type` | `utf8` | no | |
| `tags` | `list<utf8>` | no | |
| `impact` | `utf8` | no | enum `positive` \| `neutral` \| `negative` |
| `xp_awarded` | `int32` | no | |
| `timestamp` | `utf8` | no | |
| `text` | `utf8` | no | the embedded document: `title + "\n\n" + summary` |
| `vector` | `fixed_size_list<float32, dim>` | no | `engine(text)`; `dim` from the embedding engine |

The columns map 1:1 to `acx.memory-record.v1` (snake_case in the table, camelCase in JSON), so the derivation is deterministic:

```
text   = title + "\n\n" + summary
vector = embeddingEngine(text)          # fixed_size_list<float32, dim>
```

### Baseline is authoritative; vectors are derived

!!! warning "The JSON baseline wins — always"
    The JSON memory baseline (`acx.memory-record.v1`, SPEC §7.6) is **authoritative**. The LanceDB table is a **derived, re-indexable projection** that is **never signed** and **MUST be rebuilt on import** against the consumer's own embedding engine (`reindexOnImport: true` in the package spec, `signed: false` because the ROM manifest cannot cover bytes that legitimately differ per engine). If the baseline and the vectors ever disagree, the vectors are wrong by definition — drop and re-index.

Because the projection is deterministic, the `.lance` payload can be materialized from the baseline at any time, and a registry can ship the `.lance` file alongside the JSON baseline without ambiguity about which is the source of truth.

!!! example "Materialize a real LanceDB file: `acx lance`"
    ```bash
    # one-time: the optional materializer (the project's single dependency, isolated here)
    uv venv tools/lance/.venv --python 3.12
    uv pip install --python tools/lance/.venv pylance pyarrow numpy

    node --experimental-sqlite src/cli.mjs lance my-agent.acx
    #  materialized a real LanceDB dataset (acx.lance-memory/1): N rows, fixed_size_list<item: float>[128]
    #    embedded in cartridge → save/vectors/memories.lance  (SAVE zone, unsigned)
    #    standalone dataset    → my-agent.memories.lance
    ```
    `acx lance` computes the `local-hash-128` vectors in JS (`src/embed.mjs`, `acx.embed/local-hash-128/1`),
    writes a **genuine LanceDB dataset** with the exact `acx.lance-memory/1` schema via `pylance`, embeds it
    in the cartridge **SAVE zone** (so it never affects the ROM signature — verified by the test suite), and
    leaves a standalone `<file>.memories.lance/` dataset that any LanceDB runtime opens directly.

!!! note "What the zero-dependency core ships"
    The CLI core runs on Node's builtin `node:sqlite` with **no runtime dependencies**: it ships the JSON
    baseline, the pinned `acx.lance-memory/1` descriptor, and the validator (`validatePackageSpec` checks the
    descriptor's `dim` against the cartridge's engine and its column set against the normative list). The
    real `.lance` bytes are produced by the **optional** `acx lance` tool above (one dependency, `pylance`,
    kept out of the core) or by any LanceDB-capable runtime such as the AGENTIBUS studio — all building the
    identical table from the same descriptor + embedding definition.

---

## Validation rules

`acx spec` (and `validatePackageSpec` in `src/packagespec.mjs`) reports a cartridge as **CLEAN** only when all of the following hold:

1. `rom/package-spec.json` exists, declares `schemaVersion: "acx.package-spec/1"`, contains only the five
   defined top-level fields, and exactly matches cartridge id, spec version, and embedding-engine metadata.
2. `artifacts` contains exactly the eight role profiles above — no unknown, duplicate, missing, extended,
   or altered entries.
3. Every stored `sqlar` name begins with `rom/` or `save/` and uses only non-empty portable ASCII
   segments matching `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`. Absolute paths, `.`, `..`, empty segments,
   backslashes, NUL, and other traversal/platform-specific forms are rejected before extraction.
4. Every record in the `memory` table structurally conforms to `acx.memory-record.v1` — all mandatory
   fields present, `portable` boolean, valid `impact`/`zone` enums, and the tier invariant:
   `portable: true` ⇒ `codebaseFingerprint` is `null`, `portable: false` ⇒ a fingerprint is present.
5. Capability records conform and their locally resolvable evidence references exist.
6. `rom/schema/lance-memory.json` exists, its embedding engine matches the cartridge's engine, and its
   column count matches the normative 14-column list.
7. Every `required` SQLAR artifact path in the spec resolves to a real file.

Anything less is reported as a list of issues and a non-clean verdict.

---

## Related pages

- [Container](container.md) — the SQLite file format, zones, and the `sqlar` layout the spec paths refer to.
- [Memory](memory.md) — the two-tier memory model behind `portable`, `zone`, and the fingerprints.
- [Signing & trust](signing-trust.md) — how the ROM manifest covers `rom/package-spec.json` and `rom/schema/lance-memory.json`.
- [JSON schemas & media types](../reference/schemas.md) — the consolidated schema index.
