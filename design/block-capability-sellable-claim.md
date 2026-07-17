## Capability & Sellable-Claim Record

### 1. Purpose and placement
A **CapabilityRecord** is the unit that lets a cartridge assert "this agent performs well at *build-dag* on *Airflow+Snowflake* for *data-engineering*." Records live in the **ROM zone** of the `.acx` file (signed, immutable) in a table `capabilities(id TEXT PRIMARY KEY, json TEXT, content_hash TEXT)`. Each row's `json` is one CapabilityRecord and MUST be covered by the content-addressed integrity manifest (§6.4 of the constraint map). Records are derived only from the **transferable** memory tier; a record MUST NOT be minted from a memory artifact whose `portable` flag is false.

### 2. CapabilityRecord fields (normative)
Every record MUST carry `schemaVersion: "acx.capability/1"`. Fields:

- `id` (string, REQUIRED) — `cap-<sha256_16>` content address over `sha256(taskType + "|" + canonicalStack.join(",") + "|" + domain)`. Deterministic, so re-export and idempotent merge (id + fingerprint dedupe) reuse the same row.
- `taskType` (string, REQUIRED) — one token from the controlled vocabulary (§3).
- `stack` (array<string>, REQUIRED, MAY be empty) — normalized purl identifiers (§4). Order-insensitive; consumers MUST sort before hashing.
- `domain` (string, REQUIRED) — one `SkillDomain` value reused verbatim from AGENTIBUS: `frontend | backend | infrastructure | testing | architecture | leadership | product`.
- `proficiency` (object, REQUIRED) — `{ scale: "acx.proficiency/trueskill-1", mu: number, sigma: number, score: number (0..1), confidence: number (0..1), verified: boolean }`. `score` is advisory and MUST be treated as **unverified** unless `verified:true`, which is permitted ONLY when at least one `evidenceRefs` entry of `kind:"level-attestation"` resolves to a valid, non-revoked VC/Open-Badge issued after independent held-out re-execution (sibling PROVABLE-LEVEL block). `mu`/`sigma` reuse the σ-must-shrink TrueSkill gate; a consumer MAY reject records where `sigma` exceeds a policy threshold.
- `evidenceRefs` (array<object>, REQUIRED, non-empty for `verified:true`) — each `{ kind: "level-attestation" | "memory-artifact" | "trajectory", ref: string }`. `ref` is a VC `id` (URI), a memory `artifactFingerprint`, or an OCI Referrers digest (`sha256:…`). These are the anti-fake anchor: proficiency is only as good as what `evidenceRefs` resolves to.
- `sampleCount` (integer ≥ 0, REQUIRED) — number of distinct completed tasks backing the claim (deduped by task, not by run).
- `lastDemonstratedAt` (string, REQUIRED) — RFC 3339 UTC timestamp of the most recent backing task.
- `license` (string, OPTIONAL) — SPDX License Expression (SPDX License List) governing reuse of this claim's disclosed evidence; default `LicenseRef-acx-proprietary` (the priced-contents moat).
- `createdAt`, `updatedAt` (string, REQUIRED) — RFC 3339.

### 3. Controlled task-type vocabulary
`taskType` MUST match `^[a-z0-9]+(-[a-z0-9]+)*$`. Seed set (v1): `build-dag`, `write-migration`, `design-api`, `implement-feature`, `refactor`, `debug`, `review`, `test-authoring`, `optimize-performance`, `harden-security`, `write-docs`, `deploy`, `incident-response`, `data-modeling`, `schema-design`, `prompt-engineering`, `dependency-upgrade`. Extensibility: a publisher MAY introduce a private token by prefixing a reverse-DNS namespace and colon, e.g. `dev.acx.x:generate-terraform`. Unknown *seed-shaped* tokens (no namespace) MUST be rejected on import; namespaced tokens MUST be accepted and preserved. The seed list is versioned by `schemaVersion`.

### 4. Stack normalization rule
Each `stack` entry MUST be a **Package URL (purl)** per **ECMA-427 (Package URL Specification, 1st Edition)**, grammar `pkg:type/namespace/name@version?qualifiers#subpath`. `type` and the scheme are lowercased; `version` is OPTIONAL and, when present, uses the ecosystem's native version string. Normalization:
1. Resolve the tech to its canonical purl `type` from the purl type list (e.g. `pypi`, `npm`, `docker`, `oci`, `cargo`, `gem`, `maven`, `golang`, `huggingface`, `generic`).
2. Collapse casing/aliases to the ecosystem's registry name. `airflow`, `Airflow`, `apache-airflow` all normalize to **`pkg:pypi/apache-airflow`**; `snowflake` → `pkg:generic/snowflake` (a hosted service with no package) or `pkg:pypi/snowflake-connector-python` when the claim is about the connector. A record SHOULD prefer the most specific registered package; services with no package use `pkg:generic/<name>`.
3. An implementation MUST ship an alias table but MUST NOT invent purl `type`s outside the registered set; unresolvable tech uses `pkg:generic/`.
4. A human label MAY be carried out-of-band in the A2A skill name (§6); it is never authoritative.

### 5. Proficiency without evidence
A record with `verified:false` MAY still be published (marketplace "self-declared" tier) but consumers MUST render it as unproven and MUST NOT let it satisfy a re-run-gated purchase. This preserves the open-envelope / priced-contents split: the *shape* is free, the *signed evidence* is the sellable asset.

### 6. A2A AgentCard mapping (marketplace advertisement)
A cartridge advertises itself as an A2A agent by emitting an **AgentCard** (A2A Protocol v1.0; canonical source `specification/a2a.proto`). Verbatim A2A fields and the mapping:

- **AgentCard** (REQUIRED: `name`, `description`, `supportedInterfaces`, `version`, `capabilities`, `defaultInputModes`, `defaultOutputModes`, `skills`): set `provider` = `{ organization, url }` from the cartridge's reverse-DNS identity; `version` = cartridge semver; `signatures` = the JWS over the card (mirrors the DSSE core); `supportedInterfaces[]` = `AgentInterface{ url, protocolBinding:"JSONRPC", protocolVersion:"1.0" }` of the host.
- **AgentCard.skills[]** — **one AgentSkill per CapabilityRecord.** A2A `AgentSkill` REQUIRED fields `id`, `name`, `description`, `tags` map as: `id` ← `CapabilityRecord.id`; `name` ← `"<taskType> · <stack display>"`; `description` ← generated one-liner; `tags` (REQUIRED array of keywords) ← `[taskType, domain, ...purl names]`. Optional `examples` ← backing task titles from `evidenceRefs`.
- **Carrying the quantitative claim.** A2A `AgentSkill` has *no* proficiency/evidence/sampleCount field. Therefore the full CapabilityRecord MUST be attached through an A2A extension: declare `AgentCard.capabilities.extensions[] = AgentExtension{ uri:"https://acx.dev/a2a/ext/capability/v1", description:"ACX capability records", required:false, params:{ records:[…CapabilityRecord] } }`. Consumers that understand the extension read verified proficiency/evidence from `params`; plain A2A clients still get discoverable, descriptive skills. This is the exact seam that turns a cartridge into a first-class, self-advertising A2A agent while keeping the verifiable moat in a namespaced extension.

Note field-name skew: proto `security_schemes`/`security_requirements`/`default_input_modes` serialize to JSON as `securitySchemes`/`security`/`defaultInputModes`; emit the JSON camelCase form in the well-known `agent-card.json`.