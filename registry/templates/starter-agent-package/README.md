# Starter Agent Package

A fillable template for contributing a cartridge to the git registry. Fork the
repo, copy this directory, replace every `TODO` value, export it to a signed
`.acx`, and open a pull request under `registry/cartridges/`.

## Files in this template

| File | Purpose |
| --- | --- |
| `manifest.json` | The AGENTIBUS agent-package manifest (identity, stats, skills, stack). |
| `memory-records.json` | Transferable memory records that become the cartridge's portable memory. |
| `IDENTITY.md` | Short knowledge document: who the agent is. |
| `SKILLS.md` | Short knowledge document: what the agent can do. |
| `README.md` | This guide. Not packaged into the cartridge. |

Optional extra knowledge files (`MEMORY.md`, `CAREER.md`, `EQUIPMENT.md`,
`LEARNING_PATH.md`, `EXCHANGE.md`, `STYLE.md`) are packaged too if present.

## manifest.json fields

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Manifest schema version. Keep `"1.1"`. |
| `packageVersion` | Agent-package format version. Keep `"2.0"`. |
| `exportedAt` | ISO-8601 timestamp of the export. |
| `exportedFrom` | Producing system. Keep `"agentibus"`. |
| `originInstanceId` / `originInstanceLabel` | Stable id and human label of the machine or instance that produced the package. |
| `agentId` | Stable id of the agent inside its origin system. |
| `sourceFingerprint` | Provenance string: `provider:model:role:seed:stack`. |
| `name` | Display name of the agent. Also used to derive the cartridge id slug. |
| `provider` / `model` | Which model family and model id the agent runs on. |
| `role` | One of `backend_dev`, `frontend_dev`, `fullstack_dev`, `designer`, `ux_researcher`, `devops_engineer`, `security_expert`, `qa_engineer`, `architect`, `lead_developer`, `cto`, `product_owner`, `product_expert`. Determines the capability domain. |
| `careerTier`, `level`, `xp`, `skillPoints`, `completedProjects` | Career progression numbers. Honest defaults for a new agent: `intern`, `1`, `0`, `0`, `0`. |
| `stats` / `baseStats` | Current and baseline attribute scores (1-10) for intelligence, speed, quality, creativity, endurance, teamwork. |
| `traits` | Free-form personality traits. |
| `appearance` | Avatar parameters (integers plus an `outfitAccent` hex color). Cosmetic only. |
| `topSkills`, `unlockedSkills`, `unlockedSkillCount` | Skill-tree state. Empty is fine for a starter. |
| `memoryRecordCount` | Must match the number of entries in `memory-records.json`. |
| `memoryTopics` | Tag summary of the memory records. |
| `vectorEngine` | Embedding engine id. Keep `"local-hash-128"` (the reference 128-dim engine). |
| `portableFormats` | Memory formats this package declares. `["json"]` — the JSON baseline is authoritative; any LanceDB table is a derived, re-indexed projection built by the importing host. |
| `techStack` | Technologies the agent has demonstrated (e.g. `["postgres", "node"]`). Seeds the exported capability record. |
| `personality` | `communicationStyle` (string), `codingPhilosophy` (string array), `knownForIn` (string). |
| `achievements` | Earned achievements. Empty is fine. |

## memory-records.json fields

Each record is one memory. Fields: `id` (unique string), `title`, `summary`
(these two become the embedded text as `title + "\n\n" + summary`),
`sourceType` (e.g. `knowledge`, `agent_hired`, `project_completed`), `repoId`,
`repoLabel`, `projectLabel`, `markdownPath`, `timestamp` (ISO-8601), `impact`
(`positive` | `neutral` | `negative`), `xpAwarded` (number), `tags` (string
array).

Keep `repoId: null` for every record in a public template. A null `repoId`
marks the record as transferable, so it lands in the portable ROM memory zone.
Records with a `repoId` are codebase-bound and quarantined on export by
default.

## Export

From the repository root (Node >= 22):

```bash
node --experimental-sqlite src/cli.mjs export registry/templates/starter-agent-package my-agent.acx --publisher io.github.you
```

Use your own reverse-DNS publisher id (for GitHub users:
`io.github.<username>`). This produces:

- `my-agent.acx` — a signed cartridge. It carries the clean package spec
  (`rom/package-spec.json`, schema `acx.package-spec/1`) enumerating every
  artifact with versioned schema ids, and the pinned LanceDB memory descriptor
  (`rom/schema/lance-memory.json`, schema `acx.lance-memory/1`) that a
  LanceDB-capable host uses to materialize the derived vector table.
- `my-agent.acx.key.pem` — your ed25519 PRIVATE signing key, written outside
  the cartridge. Keep it secret; never commit it.

The scrub gate runs before signing and fails closed: exports containing
private keys, credential-shaped strings, high-entropy secrets, or leaked repo
identifiers are blocked, not redacted.

Check your cartridge:

```bash
node --experimental-sqlite src/cli.mjs spec my-agent.acx      # package spec must print CLEAN
node --experimental-sqlite src/cli.mjs verify my-agent.acx    # signature status
node --experimental-sqlite src/cli.mjs inspect my-agent.acx   # contents overview
```

## Publish to the git registry

1. Copy your cartridge to `registry/cartridges/<publisher>/<name>/cartridge.acx`
   and add a short `README.md` next to it describing the agent.
2. Add your PUBLIC key to `registry/trust-registry.json` (public keys only —
   the `.key.pem` private key never enters the repo).
3. Run the index build; it opens and verifies every cartridge and rejects any
   tampered or invalid one:

   ```bash
   node --experimental-sqlite tools/build-registry-index.mjs
   ```

4. Commit the cartridge, its README, and the regenerated
   `registry/index.json`, then open a pull request.
