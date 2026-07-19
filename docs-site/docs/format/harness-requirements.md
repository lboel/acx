# Harness requirements

A cartridge ships a signed, machine-readable manifest that tells any host the exact tools, protocol, and model floor it needs before the ROM is allowed to boot — so activation is a negotiated contract, not a hope.

Lilian Weng defines a **harness** as "the system surrounding a base model that orchestrates execution and decides how the model thinks and plans, calls tools and acts, perceives and manages context, stores artifacts, and evaluates results" ([_Harness Engineering for Self-Improvement_](https://lilianweng.github.io/posts/2026-07-04-harness/), 2026-07-04). She argues "the layer between the raw model and the real-world context seems to be as important as the model's raw intelligence." A `.acx` cartridge is a self-contained, signed harness — the agent-OS image — and this manifest is the socket it plugs into. Everything here is SPEC §8.

!!! info "Where this lives in the cartridge"
    Exactly one manifest at `sqlar` path `rom/manifest/harness-requirements.json`, media type
    `application/vnd.acx.harness-requirements.v1+json`, `schemaVersion: "acx.harness.v1"`. It sits in the
    **ROM zone**, so it is covered by the ROM integrity manifest and the ed25519/DSSE signature (see
    [signing & trust](signing-trust.md)). A host **MUST** refuse activation if it fails signature
    verification or if its `schemaVersion` is unrecognized.

## What the manifest declares

Four things, each a hard gate at handshake time:

1. **Four required tool-roles**, each a portable role id the ROM invokes by name-independent contract.
2. **Optional inventory tools** the cartridge is happy to run without.
3. An **MCP minimum protocol revision** — a floor, not a pinned version.
4. **Model floors** — tool-use capability and a minimum context-window token count.

Here is the manifest the reference builder emits (`defaultHarnessRequirements()` in `src/builders.mjs`):

```json
{
  "schemaVersion": "acx.harness.v1",
  "mcp": { "minProtocolRevision": "2024-11-05", "preferredProtocolRevision": "2025-11-25" },
  "model": { "toolUse": true, "minContextWindowTokens": 100000, "structuredOutput": false },
  "requiredTools": [
    { "role": "acx:execute",      "tier": "required", "capabilityScopes": ["exec", "fs.read"],       "name": "execute",       "description": "Run commands/code in a sandbox.",        "inputSchema": { "type": "object", "required": ["command"], "properties": { "command": { "type": "string" } } } },
    { "role": "acx:dispatch",     "tier": "required", "capabilityScopes": ["dispatch"],              "name": "dispatch",      "description": "Spawn/route a sub-agent unit of work.",  "inputSchema": { "type": "object", "required": ["task"],    "properties": { "task":    { "type": "string" } } } },
    { "role": "acx:memory.write", "tier": "required", "capabilityScopes": ["memory.write"],          "name": "add_memory",    "description": "Append a durable SAVE-zone record.",     "inputSchema": { "type": "object", "required": ["summary"], "properties": { "summary": { "type": "string" } } } },
    { "role": "acx:search",       "tier": "required", "capabilityScopes": ["search", "memory.read"], "name": "search_memory", "description": "Retrieval over memory + knowledge.",     "inputSchema": { "type": "object", "required": ["query"],   "properties": { "query":   { "type": "string" } } } }
  ],
  "optionalTools": [
    { "role": "acx:list_agents", "tier": "optional", "capabilityScopes": ["memory.read"], "name": "list_agents", "description": "Inventory of available agents (nice-to-have).", "inputSchema": { "type": "object", "properties": {} } }
  ],
  "filesystem": ["fs.read"],
  "network": []
}
```

This manifest is one of the 21 ROM objects in the reference cartridge (`sqlar:11`), so a byte-tamper on it fails DSSE verification exactly like any other signed object.

## Tool-role contracts

Each tool entry is a **tool-role contract**: it reuses the MCP `McpToolDefinition` shape — `{name, description, inputSchema}`, where `inputSchema` is a raw JSON Schema (default draft 2020-12) — and adds three fields (SPEC §8.2):

| Field | Meaning |
| --- | --- |
| `role` | A stable canonical id in the `acx:` namespace (e.g. `acx:execute`). **Authored ROM content invokes tools by `role`, never by host-specific name.** The host maps one concrete tool onto each role at handshake time. |
| `tier` | `"required"` or `"optional"`. |
| `capabilityScopes` | One or more scope tokens the bound tool **MUST** be permitted to exercise. |

!!! tip "Why `role`, not tool name"
    A bare tool name is not portable — one host calls it `execute`, another `run_shell`, a third `bash`. The ROM never hard-codes any of them. It references `acx:execute` and the host binds whatever concrete tool it advertises. This is what makes a cartridge boot unchanged on a host that has never heard of the publisher.

### Capability-scope vocabulary

A closed set (extensible only under a vendor `x-` prefix), SPEC §8.3:

```
exec  dispatch  memory.write  memory.read  search  knowledge.write  fs.read  fs.write  net.fetch
```

## The required minimal contract

Exactly **four roles**. Absence of any one **MUST** cause refusal (SPEC §8.4):

=== "acx:execute"

    Scopes `["exec"]` (may add `fs.read`). Runs commands/code in a sandbox, returning the MCP `content:[{type:"text",text}]` envelope. This is the "calls tools and acts" surface of the harness.

=== "acx:dispatch"

    Scope `["dispatch"]`. Spawns/routes a sub-agent unit of work. Backs the loop policy's `subAgents` — Weng's Pattern 3, "make parallelism explicit and inspectable" (see [loop & context policy](loop-context.md)).

=== "acx:memory.write"

    Scope `["memory.write"]`. Appends a durable SAVE-zone record. This is Weng's file-system-as-memory pattern made a first-class tool: "keep durable state in files." See the [memory partition](memory.md).

=== "acx:search"

    Scopes `["search","memory.read"]`. Retrieval over memory + knowledge — the "perceives and manages context" surface.

!!! warning "All four or nothing"
    These four are the irreducible contract for a self-improving loop: act, fan out, remember, retrieve. A host missing any one cannot run the cartridge, and the handshake **MUST** refuse rather than silently degrade.

## Optional inventory tools

Read-only inventory tools (e.g. `list_agents`, and the AGENTIBUS `list_repos` / `project_status` / `portfolio_overview` family) **MUST** be `tier:"optional"`. Their absence **MUST NOT** block activation, and the cartridge **MUST** run **degraded** when they are unbound (SPEC §8.4). They make the agent smarter about its surroundings; they are never a prerequisite for booting.

## Floors, not versions

Two floors, both deliberately conservative (SPEC §8.6):

- **`mcp.minProtocolRevision`** — the oldest MCP revision exposing `initialize` capability negotiation, `tools/list` / `tools/call`, and `inputSchema`: `2024-11-05`. `mcp.preferredProtocolRevision` SHOULD name the current revision (`2025-11-25` as of 2026-07-16). Structured `outputSchema`-validated returns (MCP ≥ `2025-06-18`) SHOULD be requested for `acx:search` but **MUST** remain optional.
- **`model.minContextWindowTokens`** — an integer token floor (here `100000`). It **MUST NOT** be a model id. `model.toolUse:true` requires tool-calling; `model.structuredOutput` is optional.

A floor says "at least this," never "exactly this," so a cartridge keeps booting on newer hosts. As Weng puts it, "many harness improvements will be internalized into core model behavior, but the interface with external context and tools should remain" — the floors describe that durable interface.

## The capability-negotiation handshake

When a host loads a cartridge it runs a handshake and produces a **compliance descriptor** (`application/vnd.acx.harness-compliance.v1+json`, `schemaVersion:"acx.harness.compliance.v1"`), SPEC §8.5.

```mermaid
sequenceDiagram
    participant H as Host
    participant C as Cartridge (ROM)
    participant M as MCP server(s)
    H->>C: read rom/manifest/harness-requirements.json
    H->>H: signature-verify manifest (ROM integrity)
    H->>M: MCP initialize (negotiate protocolRevision)
    loop each required role
        H->>M: bind a concrete tool to the role
        H->>H: inputSchema structurally accepting? scopes ⊇ capabilityScopes?
    end
    alt all satisfied
        H->>H: verdict "accept" → activate ROM
    else any unmet
        H-->>H: verdict "refuse" → JSON-RPC -32602 "Unsupported harness"
        note over H,C: ROM NOT activated; SAVE zone NOT mutated
    end
```

The descriptor carries:

- `requirementsHash` — `sha256:` of the exact manifest bytes, **binding the descriptor to the manifest**.
- `protocolRevision` — the negotiated MCP revision.
- `model` facts — `toolUse`, `contextWindowTokens`, `structuredOutput`.
- `bindings[]` — one `{role, boundTool, scopesGranted[], satisfied}` per role.
- granted filesystem / network scopes.
- `verdict` — `accept` or `refuse` — and an `unmet[]` list.

A binding counts only when the bound tool's advertised `inputSchema` is **structurally accepting** of the contract `inputSchema` (every contract-`required` property present and type-compatible) and the granted scopes ⊇ the contract's `capabilityScopes`.

### When the host must refuse

`verdict:"refuse"` if any of these hold (SPEC §8.5):

- negotiated `protocolRevision < mcp.minProtocolRevision`
- `model.toolUse` required but false
- `contextWindowTokens < model.minContextWindowTokens`
- any required role unbound or scope-denied
- any required filesystem/network scope denied

!!! danger "Refusal must never touch SAVE"
    On refusal the host **MUST NOT** activate the ROM and **MUST NOT** mutate the SAVE zone. It **MUST** emit the compliance descriptor plus a JSON-RPC error reusing MCP's exact form:

    ```json
    { "code": -32602, "message": "Unsupported harness",
      "data": { "unmet": [], "supported": [], "requested": [] } }
    ```

    And the cartridge itself carries a **preflight self-check** that aborts activation if the persisted descriptor shows any required binding with `satisfied:false`. A cartridge that cannot get its tools does nothing — it does not half-run and it does not learn.

## What actually runs today

!!! note "Honesty: the handshake is host-side and specified, not shipped in the reference impl"
    The manifest is **real, built, signed, and schema-validated** in the zero-dependency reference implementation (Node ≥ 22, `node --experimental-sqlite`). The handshake **runtime** — the live MCP `initialize`, tool binding, and compliance-descriptor emission — is **specified normatively and is host-side**; it is not part of the reference build. Treat the negotiation as a contract every conforming host implements, not as code that executes in this repo.

What the reference implementation does prove is that the manifest is well-formed and tamper-evident. From the proof suite (`docs-site/docs/_assets/proofs-transcript.txt`):

```text
✔ §8 harness-requirements manifest matches its schema (requiredTools, no forbidden keys)
```

And because the manifest is a ROM object, its integrity is bound to the same signed ROM hash as everything else in the cartridge:

```text
rom hash:  sha256:f479be021b8ea2e55cc6e3e33b95df9d151196548dfc854dedbe578be7120642
== ROM objects ==
  total: 21  (memory:1, cartridge:9, sqlar:11)
```

Any edit to the four required roles, the scopes, or the floors changes those bytes and fails DSSE verification — the manifest cannot be quietly downgraded after signing.

## Related

- [Container format](container.md) — where the manifest lives in the `sqlar` table and the ROM/SAVE boundary.
- [Signing & trust](signing-trust.md) — how the manifest is covered by the ed25519/DSSE ROM signature.
- [Loop & context policy](loop-context.md) — how the four roles are exercised inside the plan → act → verify → reflect cycle.
- [Memory partition](memory.md) — the SAVE-zone store behind `acx:memory.write` and `acx:search`.
