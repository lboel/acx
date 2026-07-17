## HARNESS REQUIREMENTS

### H.1 Purpose and placement

A cartridge MUST embed exactly one **harness-requirements manifest** stating the runtime contract a host MUST satisfy before the ROM zone may activate. It is a ROM-zone object stored in the `.acx` `sqlar` table at path `manifest/harness-requirements.json`, media type `application/vnd.acx.harness-requirements.v1+json`, covered by the signed `packageHash` (non-negotiable #4), immutable, and versioned via `schemaVersion: "acx.harness.v1"` (non-negotiable #5). A host MUST refuse activation if this object fails signature verification or its `schemaVersion` is unrecognized.

### H.2 Tool-role contracts (reuse of the AGENTIBUS shape)

Each tool is declared as a **tool-role contract**. It reuses the AGENTIBUS `McpToolDefinition` shape verbatim — `{ name, description, inputSchema }` (`agentibus/server/mcp/agentibus-mcp.ts:19`), where `inputSchema` is a raw JSON Schema object that defaults to draft 2020-12 per MCP — and adds three fields:

- `role` — a stable canonical id in the `acx:` namespace (e.g. `acx:execute`). Authored ROM content (skills, loop-policy) invokes tools by `role`, never by a host-specific name. This resolves constraint tension #8: a bare tool name is not portable across hosts, so the cartridge binds behaviour to a role + `inputSchema` contract, and the host maps one concrete tool onto each role at handshake time.
- `tier` — `"required"` or `"optional"`.
- `capabilityScopes` — one or more scope tokens the bound tool MUST be permitted to exercise.

The contract `name` is the informative canonical reference name; the concrete host tool name is supplied by the host in the compliance descriptor (H.5).

### H.3 Capability-scope vocabulary

Closed token set (extensible only under a vendor `x-` prefix), modelled on the externalized `ResourceLimits` kill-switch-scope precedent (`resource-limits.yaml`): `exec`, `dispatch`, `memory.write`, `memory.read`, `search`, `knowledge.write`, `fs.read`, `fs.write`, `net.fetch`.

### H.4 Required minimal contract vs. optional inventory

The **required minimal contract** is exactly four roles; absence of ANY one MUST cause refusal:

- `acx:execute` — scopes `["exec"]` (may add `fs.read`): run commands/code in a sandbox, returning the MCP `content:[{type:"text",text}]` envelope.
- `acx:dispatch` — scope `["dispatch"]`: spawn or route a sub-agent unit of work and collect its result.
- `acx:memory.write` — scope `["memory.write"]`: append a durable record to the SAVE zone (reference tool `agentibus_add_memory`).
- `acx:search` — scopes `["search","memory.read"]`: semantic/lexical retrieval over memory + knowledge (reference tool `agentibus_search_memory`).

Read-only **inventory tools** (reference tools `agentibus_list_agents`, `agentibus_list_repos`, `agentibus_project_status`, `agentibus_portfolio_overview`) MUST be declared `tier:"optional"`; their absence MUST NOT block activation. A cartridge MUST run in a degraded mode when optional tools are unbound.

### H.5 Host advertisement of compliance

Against the manifest a host MUST produce a **compliance descriptor** (media type `application/vnd.acx.harness-compliance.v1+json`, `schemaVersion:"acx.harness.compliance.v1"`), reusing MCP `initialize` semantics. It carries: `requirementsHash` (`sha256:` of the exact manifest evaluated, binding descriptor to manifest), `protocolRevision` (the negotiated MCP revision string), `model` facts (`toolUse`, `contextWindowTokens`, `structuredOutput`), a `bindings[]` array (one entry per declared role: `{ role, boundTool, scopesGranted[], satisfied }`), granted `filesystem` and `network` scopes, a `verdict` of `"accept"|"refuse"`, and an `unmet[]` list of requirement ids that failed.

### H.6 Capability-negotiation & refusal handshake

1. Host reads and signature-verifies `manifest/harness-requirements.json`.
2. Host performs MCP `initialize`, learning the server `protocolVersion` and `tools` capability (MCP 2025-11-25 §Lifecycle).
3. For each declared role the host binds a concrete tool whose advertised `inputSchema` is **structurally accepting** of the contract `inputSchema` — every property listed in the contract's `required` is present and type-compatible — and whose granted scopes ⊇ `capabilityScopes`.
4. The host MUST set `verdict:"refuse"` if ANY holds: negotiated `protocolRevision` < `mcp.minProtocolRevision`; `model.toolUse` is required but false; `contextWindowTokens` < `model.minContextWindowTokens`; any `tier:"required"` role is unbound or scope-denied; any required `filesystem`/`network` scope is denied.
5. On refusal the host MUST NOT activate the ROM and MUST NOT mutate the SAVE zone. It MUST emit the compliance descriptor and a JSON-RPC error reusing MCP's exact form for a failed handshake: `code -32602`, `message "Unsupported harness"`, `data:{ unmet, supported, requested }` — mirroring MCP's own `Unsupported protocol version` error whose `data` carries `{supported, requested}`.
6. The cartridge MUST carry a preflight self-check that aborts at activation if the persisted compliance descriptor shows any `tier:"required"` binding with `satisfied:false`, so a mis-advertising host cannot silently run a starved agent.

### H.7 Floors, not versions

`mcp.minProtocolRevision` is a **floor**: it MUST be the oldest MCP revision exposing the features the cartridge actually uses — `initialize` capability negotiation, `tools/list`/`tools/call`, and `inputSchema` — first available in `2024-11-05`. `mcp.preferredProtocolRevision` SHOULD name the current revision, `2025-11-25` (as of 2026-07-16; `2026-07-28` is a locked release candidate, not yet final). Structured `outputSchema`-validated returns (MCP ≥ `2025-06-18`) SHOULD be requested for `acx:search` but MUST remain optional. Likewise `model.minContextWindowTokens` is an integer token floor and MUST NOT be expressed as a model id; the host advertises its actual `contextWindowTokens` and is refused only when below the floor.