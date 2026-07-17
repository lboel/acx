// Builders for the ROM-zone declarative documents (SPEC §6, §8, §9).
import { sha256Hex } from './canonical.mjs'

// ---- Capability records (SPEC §6) ---------------------------------------
export const TASK_TYPES = new Set([
  'build-dag', 'write-migration', 'design-api', 'implement-feature', 'refactor', 'debug', 'review',
  'test-authoring', 'optimize-performance', 'harden-security', 'write-docs', 'deploy',
  'incident-response', 'data-modeling', 'schema-design', 'prompt-engineering', 'dependency-upgrade',
])

const PURL_ALIASES = new Map([
  ['airflow', 'pkg:pypi/apache-airflow'],
  ['apache-airflow', 'pkg:pypi/apache-airflow'],
  ['snowflake', 'pkg:generic/snowflake'],
  ['dbt', 'pkg:pypi/dbt-core'],
  ['postgres', 'pkg:generic/postgresql'],
  ['postgresql', 'pkg:generic/postgresql'],
  ['nuxt', 'pkg:npm/nuxt'],
  ['react', 'pkg:npm/react'],
  ['typescript', 'pkg:npm/typescript'],
  ['python', 'pkg:generic/python'],
])

/** Normalize a free-form tech token to a Package URL (SPEC §6.2). */
export function toPurl(token) {
  const t = String(token).trim().toLowerCase()
  if (t.startsWith('pkg:')) return t
  if (PURL_ALIASES.has(t)) return PURL_ALIASES.get(t)
  return 'pkg:generic/' + t.replace(/[^a-z0-9._-]+/g, '-')
}

/** Deterministic capability id (SPEC §6.2). */
export function capabilityId(taskType, stack, domain) {
  const sortedStack = [...stack].sort()
  return 'cap-' + sha256Hex(taskType + '|' + sortedStack.join(',') + '|' + domain).slice(0, 16)
}

export function buildCapability({ taskType, stack = [], domain, proficiency, evidenceRefs = [], sampleCount = 0, lastDemonstratedAt, license = 'LicenseRef-acx-proprietary' }) {
  if (!TASK_TYPES.has(taskType) && !taskType.includes(':')) {
    throw new Error(`unknown seed taskType '${taskType}' (use a reverse-DNS-prefixed token for private types)`)
  }
  const purlStack = stack.map(toPurl).sort()
  const now = lastDemonstratedAt ?? '1970-01-01T00:00:00.000Z'
  const verified = proficiency?.verified === true
  if (verified && evidenceRefs.length === 0) throw new Error('verified capability requires evidenceRefs')
  const rec = {
    schemaVersion: 'acx.capability/1',
    id: capabilityId(taskType, purlStack, domain),
    taskType,
    stack: purlStack,
    domain,
    proficiency: proficiency ?? { scale: 'acx.proficiency/trueskill-1', mu: 25, sigma: 8.333, score: 0, confidence: 0, verified: false },
    evidenceRefs,
    sampleCount,
    lastDemonstratedAt: now,
    license,
    createdAt: now,
    updatedAt: now,
  }
  return rec
}

// ---- Harness requirements (SPEC §8) -------------------------------------
export function defaultHarnessRequirements() {
  return {
    schemaVersion: 'acx.harness.v1',
    mcp: { minProtocolRevision: '2024-11-05', preferredProtocolRevision: '2025-11-25' },
    model: { toolUse: true, minContextWindowTokens: 100000, structuredOutput: false },
    requiredTools: [
      { role: 'acx:execute', tier: 'required', capabilityScopes: ['exec', 'fs.read'], name: 'execute', description: 'Run commands/code in a sandbox.', inputSchema: { type: 'object', required: ['command'], properties: { command: { type: 'string' } } } },
      { role: 'acx:dispatch', tier: 'required', capabilityScopes: ['dispatch'], name: 'dispatch', description: 'Spawn/route a sub-agent unit of work.', inputSchema: { type: 'object', required: ['task'], properties: { task: { type: 'string' } } } },
      { role: 'acx:memory.write', tier: 'required', capabilityScopes: ['memory.write'], name: 'add_memory', description: 'Append a durable SAVE-zone record.', inputSchema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } } },
      { role: 'acx:search', tier: 'required', capabilityScopes: ['search', 'memory.read'], name: 'search_memory', description: 'Retrieval over memory + knowledge.', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } } },
    ],
    optionalTools: [
      { role: 'acx:list_agents', tier: 'optional', capabilityScopes: ['memory.read'], name: 'list_agents', description: 'Inventory of available agents (nice-to-have).', inputSchema: { type: 'object', properties: {} } },
    ],
    filesystem: ['fs.read'],
    network: [],
    // external binaries the host must provide on PATH (checked by `acx check`)
    externalTools: [
      { bin: 'git', optional: false },
      { bin: 'node', optional: false },
    ],
  }
}

// ---- Loop + context policy (SPEC §9) ------------------------------------
export function defaultLoopContextPolicy({ embeddingEngineId = 'local-hash-128' } = {}) {
  return {
    // v1.1 incorporates Lilian Weng, "Harness Engineering for Self-Improvement"
    // (2026-07-04): plan/reflect loop phases, held-in/held-out regression in
    // verification, an observability surface, async sub-agent jobs, and a
    // structured playbook store. All additive over v1.
    schemaVersion: 'acx.loop-context-policy/1.1',
    loop: {
      maxTurns: 40,
      // Weng's canonical loop: "plan, execute, observe/test, improve ... until the goal is achieved".
      cycle: ['plan', 'gather_context', 'act', 'verify', 'reflect'],
      verification: {
        commands: ['lint', 'typecheck', 'test:touched'],
        maxAttempts: 3,
        scope: 'touched',
        passIntent: 'lint+types+touched tests green',
        blockOnFailure: true,
        // "Candidates are accepted only if they have no regression on both held-in
        // and held-out data." (Weng 2026) — the same acceptance criterion the
        // provable-level protocol enforces cryptographically (SPEC §10).
        regression: { heldInSuite: null, heldOutSuite: null, acceptIf: 'no-regression-on-held-in-and-held-out' },
      },
      stopConditions: [
        { when: 'completed', action: 'stop' },
        { when: 'pr_ready', action: 'handoff' },
        { when: 'blocked', action: 'await_human' },
        { when: 'max_turns', action: 'report_continue' },
        { when: 'guardrail_stop', action: 'await_human' },
      ],
      handoff: { emits: 'OperatorCommandReport', returnWindows: ['phase_exit', 'blocker', 'pr_ready', 'destructive_change'] },
      // subAgents: mode 'sync' returns a condensed summary inline; 'backend' spawns
      // a monitorable long-running job (Weng Pattern 3 — "make parallelism explicit
      // and inspectable"). Writers default single_threaded.
      subAgents: [],
    },
    context: {
      retrieval: 'just_in_time',
      identifierKinds: ['file_path', 'stored_query', 'memory_ref', 'symbol'],
      compaction: { preserve: ['architectural_decisions', 'unresolved_bugs', 'user_intent', 'task_state'], discard: ['redundant_output', 'tool_output'], targetTokenBudget: 60000 },
      toolResultTruncation: { maxTokens: 4000, keepLastN: 20 },
      // "keep durable state in files" — file-system-as-memory (Weng Pattern 2).
      memoryFiles: ['CLAUDE.md'],
      // ACE "evolving playbook": itemized (id, description) insights, not a rewritten blob.
      playbook: { store: 'save/playbook.jsonl', entryShape: '{ id, description }' },
      embeddingEngineId,
    },
    // AHE observability pillars: component / experience / decision (Weng 2026).
    observability: { tracer: 'save/trace/', decisionLog: 'save/decisions.jsonl', pillars: ['component', 'experience', 'decision'] },
    rules: [
      { id: 'stop-destructive', category: 'quality', title: 'Halt before destructive ops', trigger: 'about to drop/delete production data or force-push', action: 'raise stop gate and await human', severity: 'critical' },
      { id: 'ask-on-ambiguity', category: 'question', title: 'Ask on unresolved ambiguity', trigger: 'requirement is ambiguous and not resolvable from repo', action: 'emit a question guardrail', severity: 'warn' },
      // Weng's over-optimism failure mode ("numerical duct tape"): never declare success on noisy runs.
      { id: 'no-numerical-duct-tape', category: 'quality', title: 'No success on unverified/noisy results', trigger: 'about to report success without the verification suite passing', action: 'block and re-run verification', severity: 'critical' },
    ],
    guardrailContract: {
      signalKinds: ['milestone', 'checkpoint', 'question', 'blocked', 'stop'],
      outcomeReport: 'OperatorCommandReport',
    },
    hints: {},
  }
}
