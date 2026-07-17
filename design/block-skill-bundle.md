# SKILL BUNDLE

Skills travel in the **ROM zone** of the `.acx` cartridge (signed, immutable). They are the vendor-neutral, codebase-agnostic capability layer; nothing skill-related lives in the SAVE zone.

## 1. On-disk / in-sqlar layout (MUST)

Every skill is a directory rooted at `skills/<name>/`, stored as individual rows in the reused `sqlar` table (`CREATE TABLE sqlar(name TEXT PRIMARY KEY, mode INT, mtime INT, sz INT, data BLOB)`; Deflate; `sz == length(data)` signals stored-uncompressed). `<name>` MUST equal the skill's frontmatter `name`.

```
skills/<name>/SKILL.md          # REQUIRED
skills/<name>/references/*.md    # OPTIONAL (Level-3 docs)
skills/<name>/scripts/*          # OPTIONAL (Level-3 executables)
skills/<name>/assets/*           # OPTIONAL (Level-3 templates/data)
```

`sqlite3 cartridge.acx -Ax skills/` MUST extract a directory tree that is a byte-identical, spec-valid Agent-Skill package installable at `~/.claude/skills/` or any agentskills.io runtime. Reference chains MUST stay one level deep from `SKILL.md`.

## 2. Frontmatter — agentskills.io spec, adopted VERBATIM (MUST)

`SKILL.md` MUST begin with YAML frontmatter containing **only** these six keys. Runtimes MUST reject unknown top-level keys.

| Field | Req | Constraint (verbatim from agentskills.io Specification) |
|---|---|---|
| `name` | MUST | 1–64 chars; `^[a-z0-9]+(-[a-z0-9]+)*$` (lowercase alnum + hyphen, no leading/trailing hyphen, no `--`); MUST match parent directory |
| `description` | MUST | 1–1024 chars, non-empty; states **what** the skill does **and when** to use it |
| `license` | MAY | License name or bundled-file reference |
| `compatibility` | MAY | 1–500 chars; environment requirements |
| `metadata` | MAY | Map string→string; `metadata.version` SHOULD carry SemVer |
| `allowed-tools` | MAY | Space-separated tool string (Experimental) |

Host-superset frontmatter (Claude Code `context`, `effort`, `hooks`, `model`, `agent`, `disable-model-invocation`, `user-invocable`, `when_to_use`, `disallowed-tools`, `paths`, `argument-hint`, `arguments`, `shell`) MUST NOT appear as top-level frontmatter keys in the stored `SKILL.md`. They travel in the namespaced extension of §4 and are projected back into frontmatter by a recognizing host at install time.

## 3. Skill index — enumerate without unpacking (MUST)

A host MUST be able to list and match skills reading only SQL rows, never inflating a `data` BLOB. Define one ROM-zone table:

```sql
CREATE TABLE acx_skill (
  name           TEXT PRIMARY KEY,   -- == frontmatter name, regex-checked
  description    TEXT NOT NULL,       -- Level-1 payload (≤1024)
  license        TEXT,
  compatibility  TEXT,
  skill_version  TEXT,                -- metadata.version
  sqlar_path     TEXT NOT NULL,       -- 'skills/<name>/SKILL.md'
  body_tokens    INTEGER,             -- estimated Level-2 cost
  content_sha256 TEXT NOT NULL,       -- sha256 of UNCOMPRESSED SKILL.md bytes
  resources      TEXT NOT NULL,       -- JSON array, resource inventory (§5)
  ext            TEXT,                -- JSON, namespaced superset (§4)
  schema_version TEXT NOT NULL        -- 'acx.skill/1'
);
```

`acx_skill` is a **derived cache** of parsed frontmatter; `SKILL.md` in `sqlar` is authoritative. `content_sha256` MUST equal the entry's hash in the cartridge's content-addressed integrity manifest, so the ROM signature (detached DSSE/ed25519 over the hash-of-hashes) covers skills transitively. On import a host MUST re-derive `acx_skill` and reject rows whose `content_sha256` ≠ recomputed hash.

## 4. Namespaced host-superset extension (MUST for vendor-neutrality)

`acx_skill.ext` is a JSON object whose keys are **reverse-DNS namespaces**. Core stays vendor-neutral; a host reads only namespaces it recognizes and ignores the rest.

```json
{
  "com.anthropic.claude-code": {
    "context": "fork",
    "agent": "Explore",
    "effort": "high",
    "model": "inherit",
    "disable-model-invocation": true,
    "when_to_use": "Trigger phrases: 'author DAG', 'new pipeline'.",
    "hooks": { "PostToolUse": [] },
    "paths": ["dags/**", "*.py"]
  }
}
```

Structured values (e.g. `hooks` arrays) are why the superset is NOT forced into the string-only `metadata` map. At install time a host MAY merge its recognized namespace's simple keys into the extracted frontmatter (re-projection), keeping the stored `SKILL.md` 100% agentskills.io-valid across Claude Code, the Claude API, and any compliant runtime.

## 5. Progressive-disclosure budget (MUST honor)

| Level | Loaded | Budget | Location |
|---|---|---|---|
| L1 Metadata | Always, at startup | ~100 tokens (`name`+`description`) | `acx_skill` row — no BLOB read |
| L2 Instructions | On activation | < 5000 tokens; body < 500 lines | `sqlar` `SKILL.md` |
| L3 Resources | On demand | 0 tokens until read | `references/` `scripts/` `assets/` |

`resources` inventories L3 so a host knows what exists without inflating: `[{"path":"references/backfill.md","bytes":2140,"sha256":"…"}]`. Authors MUST move detail below the 5000-token body into `references/`.

## 6. Example — data-engineering DAG skill

`skills/warehouse-dag-authoring/SKILL.md`:

```markdown
---
name: warehouse-dag-authoring
description: Author, backfill, and validate Airflow DAGs that load Snowflake
  from S3 with dbt transforms. Use when creating or editing files under dags/,
  wiring extract-load-transform pipelines, setting schedules/SLAs, or debugging
  a failed Airflow task.
license: Apache-2.0
compatibility: Requires Python 3.12+, apache-airflow>=2.9, dbt-snowflake, and
  network access to the Snowflake account.
metadata:
  author: data-platform
  version: "1.3.0"
allowed-tools: Bash(airflow:*) Bash(dbt:*) Read Grep
---

# Warehouse DAG authoring

## Workflow
1. Copy `assets/dag_template.py`; set `dag_id` = `<domain>_<table>_load`.
2. Define tasks in ELT order: `extract_s3 >> load_snowflake >> dbt_run >> test`.
3. Set `schedule`, `start_date` (UTC, static), `catchup=False` unless
   backfilling — see `references/backfill.md`.
4. Attach an `sla` and an `on_failure_callback`; never leave defaults.
5. Validate: run `scripts/validate_dag.py <file>` (checks cycles, naming,
   idempotent load keys) before committing.

## Rules
- Loads MUST be idempotent (MERGE on a natural key), never blind INSERT.
- One DAG = one target table. No cross-DAG task dependencies; use Datasets.
- Secrets come from the Airflow connection store, never inlined.

See `references/snowflake_patterns.md` for MERGE/staging idioms and
`references/backfill.md` for partitioned reruns.
```

Companion `references/backfill.md`, `references/snowflake_patterns.md`, `assets/dag_template.py`, and `scripts/validate_dag.py` ride in the same `sqlar` prefix and appear in `acx_skill.resources`.
