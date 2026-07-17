## Loop + Context Policy

### 1. Location, identity, integrity

Every Agent Cartridge (`.acx`) MUST carry exactly one **Loop + Context Policy** document in the **ROM zone**. It is stored as a `sqlar` row named `rom/policy/loop-context-policy.json`, media type `application/vnd.acx.loop-context-policy.v1+json`. Because it is behavior-defining shareable core, it is immutable: it MUST be listed in the content-addressed, self-excluding `checksum.sha256` manifest and covered by the cartridge's detached DSSE/ed25519 signature over `packageHash`. Hosts MUST NOT mutate it at runtime. Field-learned rule additions (§4) MUST be written to a SAVE-zone overlay (`save/policy/rule-overlay.json`), never back into ROM.

The document MUST declare `"schemaVersion": "acx.loop-context-policy/1"`. A document without a recognized `schemaVersion` MUST be rejected.

This block turns AGENTIBUS's hardcoded `buildMissionRules()` / routing / guardrail-derivation TypeScript into data. Hosts MUST evaluate it as data and MUST NOT require recompilation to change loop behavior.

### 2. Loop policy (`loop`)

`loop` declares the agentic loop shape. Portable, standardized fields:

- `maxTurns` (integer ≥ 1, REQUIRED) — hard turn ceiling; maps 1:1 to Claude Agent SDK `maxTurns`.
- `cycle` (REQUIRED) — ordered subset of the canonical phases `["gather_context","act","verify"]` (the "gather context → take action → verify work → repeat" loop). `verify` SHOULD be present; a cartridge that omits it MUST justify in `hints`.
- `verification` — the "smallest valid verification loop before every commit or handoff" as config: `{ commands[], maxAttempts, scope: "touched"|"all", passIntent, blockOnFailure }`. `passIntent` is prose intent ("lint+types+touched tests green"), never a scored threshold.
- `stopConditions` (REQUIRED, ≥1) — array of `{ when, action }`. `when ∈ {completed, pr_ready, blocked, max_turns, guardrail_stop, budget_exhausted, needs_input}`; `action ∈ {stop, handoff, await_human, report_continue}`. `guardrail_stop` fires on a `MissionGuardrailSignal` of kind `stop`; `blocked` on kind `blocked`.
- `handoff` — `{ emits: "OperatorCommandReport", returnWindows[] }` where `returnWindows ⊆ {phase_exit, blocker, pr_ready, ambiguity, destructive_change}`. On any terminating `stopConditions` entry with `action ∈ {handoff, await_human}`, the loop MUST emit exactly one `OperatorCommandReport` (§4) as its outcome.
- `subAgents` — array of `SubAgentDefinition` reusing the Agent SDK `AgentDefinition` triple `{description, prompt, tools}`, here `{ id, description, promptRef, tools[], maxTurns?, retrieval?, contextReturnBudgetTokens?, concurrency }`. Sub-agents MUST return a single condensed summary; `contextReturnBudgetTokens` SHOULD default to 1000–2000. Per Cognition ("Actions carry implicit decisions"), sub-agents that write or make design decisions MUST default `concurrency: "single_threaded"`; only read-only fan-out (search, review) MAY set `parallel`.

### 3. Context policy (`context`)

Declarable knobs — all portable:

- `retrieval` (REQUIRED) — `"just_in_time" | "preload" | "hybrid"`. `just_in_time` keeps lightweight identifiers (file paths, stored queries, web links) and loads at runtime; `preload` front-loads `preload[]` references; `hybrid` combines both.
- `identifierKinds` — for `just_in_time`, the permitted identifier kinds `{file_path, stored_query, web_link, memory_ref, symbol}`.
- `compaction` — expressed strictly as **intent**: `{ preserve[], discard[], targetTokenBudget }` over a fixed `ContextCategory` vocabulary (`architectural_decisions`, `unresolved_bugs`, `implementation_details`, `user_intent`, `task_state`, `tool_output`, `redundant_output`, `file_contents`). `targetTokenBudget` is a target, not a trigger. The cartridge MUST NOT specify a summarization algorithm — that is host/model-specific (§5).
- `toolResultTruncation` — intent knobs `{ maxTokens?, keepLastN?, headBytes?, tailBytes? }`. These express desired shape only; they MUST NOT reference any vendor strategy identifier.
- `memoryFiles` — references to structured-note-taking / memory files (CLAUDE.md-style) that persist state outside the window.
- `embeddingEngineId` (REQUIRED) — reuses the manifest `vectorEngine` pattern. Consumers MUST re-index against their own engine and MUST NOT trust foreign vectors; the JSON memory baseline is always authoritative.

### 4. Rule + outcome contracts (reused verbatim)

- `rules` — `MissionRule[]`, reused **verbatim**: `{ id, category ∈ {question,checkpoint,devtools,quality,coordination}, title, trigger, action, severity ∈ {info,warn,critical} }`. This is the declarative form of the former hardcoded rules; hosts evaluate `trigger`→`action` as data.
- `guardrailContract.signalKinds` — the emittable `MissionGuardrailSignal` kinds, verbatim: `milestone | checkpoint | question | blocked | stop`.
- `guardrailContract.outcomeReport` — MUST be `"OperatorCommandReport"`. The loop's terminal outcome MUST conform to `OperatorCommandReport` verbatim (`outcome ∈ {progressed,completed,blocked,handoff,needs-input}`, `quality`, `confidence`, `artifacts[]`, `learnings[]`, `blockers[]`, `nextAction`, `recommendedFollowUp`, `userAttentionRequired`).

### 5. Budget layer and opaque hints

- `budget` — OPTIONAL, reuses `ResourceLimits` **verbatim** (`tokenSpend`, `concurrency`, `timeouts`, `killSwitch`). It supplies cartridge-authored **defaults**. At runtime the host's `meta/game/resource-limits.yaml` MUST take precedence; enforcement order is host policy > cartridge default.
- `hints` — opaque, model-specific escape hatch. Hosts MUST be able to **ignore every field under `hints` and still run a conformant loop**, and no field under `hints` may alter the §4 outcome contracts. The following MUST appear only here, never as normative loop fields: reasoning/`effort` scales; KV-cache / prefix-stability signals; the summarization algorithm; and any vendor context-editing strategy identifier or its numeric token triggers (e.g. Anthropic `clear_tool_uses_20250919`, `compact_20260112`, beta header `context-management-2025-06-27`). A host MAY map `context.compaction` intent onto such a mechanism, but that mapping is host-side and non-portable.
