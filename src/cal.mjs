// Conditional Agentic Loop (CAL) + Required Available Context (RAC).
// A CAL connects MULTIPLE cartridges — referenced by content hash (romDigest) or by
// a role SLOT to be staffed — into a BPMN-like process: who (which agent) may do
// what, when, under which conditions, and what counts as completion. RAC declares
// the knowledge that MUST be available — as a DESCRIPTION only, never the content.
//
// Data model (all connected):
//   CartridgeRef  -> a hash/slot reference to an agent that fills a participant alias
//   RacItem       -> required available context (description + how to confirm; no content)
//   CalNode       -> a task/gateway/event; a task binds an agent + required skills/caps/rac + completion
//   CalEdge       -> a conditional transition (structured condition, no eval)
//   Cal           -> participants[] + rac[] + variables[] + nodes[] + edges[] + start
//   CalSkillSet   -> stored IN a cartridge: which roles it plays, which agents it references (by hash)

// ---- structured conditions (safe; no expression eval) --------------------
export function evalCondition(cond, ctx = {}) {
  if (cond == null || cond.always === true) return true
  if ('all' in cond) return cond.all.every((c) => evalCondition(c, ctx))
  if ('any' in cond) return cond.any.some((c) => evalCondition(c, ctx))
  if ('not' in cond) return !evalCondition(cond.not, ctx)
  if ('racAvailable' in cond) return !!(ctx.rac && ctx.rac[cond.racAvailable]?.available)
  if ('var' in cond) {
    const actual = cond.var.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx.vars ?? ctx)
    const v = cond.value
    switch (cond.op) {
      case 'eq': return actual === v
      case 'ne': return actual !== v
      case 'lt': return actual < v
      case 'gt': return actual > v
      case 'le': return actual <= v
      case 'ge': return actual >= v
      case 'in': return Array.isArray(v) && v.includes(actual)
      default: return false
    }
  }
  return false
}

// ---- structural validation ------------------------------------------------
export function validateCalStructure(cal) {
  const issues = []
  if (cal.schemaVersion !== 'acx.cal/1') issues.push(`unexpected schemaVersion ${cal.schemaVersion}`)
  const aliases = new Set((cal.participants || []).map((p) => p.alias))
  const racIds = new Set((cal.rac || []).map((r) => r.id))
  const nodeIds = new Set((cal.nodes || []).map((n) => n.id))
  if (!nodeIds.has(cal.start)) issues.push(`start node '${cal.start}' does not exist`)
  for (const p of cal.participants || []) {
    if (!p.alias) issues.push('participant missing alias')
    if (p.bind === 'hash' && !p.romDigest) issues.push(`participant ${p.alias} bind=hash needs romDigest`)
    if (p.bind === 'slot' && !p.slot) issues.push(`participant ${p.alias} bind=slot needs a slot`)
  }
  for (const r of cal.rac || []) {
    if (!r.description) issues.push(`rac ${r.id} missing description`)
    if ('content' in r) issues.push(`rac ${r.id} MUST NOT carry content — description only`)
  }
  for (const n of cal.nodes || []) {
    if (n.type === 'task') {
      if (!aliases.has(n.agent)) issues.push(`node ${n.id} references unknown agent alias '${n.agent}'`)
      for (const rid of n.requires?.rac || []) if (!racIds.has(rid)) issues.push(`node ${n.id} requires unknown rac '${rid}'`)
      if (!n.completion) issues.push(`task ${n.id} missing a completion condition`)
    }
  }
  for (const e of cal.edges || []) {
    if (!nodeIds.has(e.from)) issues.push(`edge from unknown node '${e.from}'`)
    if (!nodeIds.has(e.to)) issues.push(`edge to unknown node '${e.to}'`)
  }
  // reachability from start
  const reach = new Set([cal.start])
  let changed = true
  while (changed) {
    changed = false
    for (const e of cal.edges || []) if (reach.has(e.from) && !reach.has(e.to)) { reach.add(e.to); changed = true }
  }
  for (const id of nodeIds) if (!reach.has(id)) issues.push(`node ${id} is unreachable from start`)
  return issues
}

// ---- participant resolution against available cartridges ------------------
// cartridges: [{ path, card }] where card = readCard() output.
function matchesSlot(slot, card) {
  if (slot.role && card.role !== slot.role) return false
  if (slot.minLevel?.acxLevel != null && (card.level?.acxLevel ?? 0) < slot.minLevel.acxLevel) return false
  for (const need of slot.capabilities || []) {
    const has = (card.moves || []).some((m) => m.taskType === need.taskType)
    if (!has) return false
  }
  return true
}

export function resolveParticipants(cal, cartridges) {
  return (cal.participants || []).map((p) => {
    if (p.bind === 'hash') {
      const hit = cartridges.find((c) => c.card.romHash === p.romDigest)
      return { alias: p.alias, bind: 'hash', bound: hit || null, reason: hit ? 'matched by romDigest' : 'no cartridge with that romDigest' }
    }
    const candidates = cartridges.filter((c) => matchesSlot(p.slot || {}, c.card))
    candidates.sort((a, b) => (b.card.level?.acxLevel ?? 0) - (a.card.level?.acxLevel ?? 0))
    return { alias: p.alias, bind: 'slot', bound: candidates[0] || null, candidates: candidates.length, reason: candidates.length ? `staffed best of ${candidates.length} match(es)` : 'no cartridge matches the slot' }
  })
}

// ---- full lint (structure + resolution + per-node capability coverage) ----
export function lintCal(cal, cartridges = []) {
  const issues = validateCalStructure(cal)
  const resolved = resolveParticipants(cal, cartridges)
  const byAlias = Object.fromEntries(resolved.map((r) => [r.alias, r]))
  for (const p of resolved) {
    const wanted = (cal.participants.find((x) => x.alias === p.alias))
    if ((wanted.required !== false) && !p.bound) issues.push(`participant '${p.alias}' unresolved: ${p.reason}`)
  }
  // per-task capability/skill coverage against the bound agent
  for (const n of cal.nodes || []) {
    if (n.type !== 'task') continue
    const agent = byAlias[n.agent]?.bound
    if (!agent) continue
    for (const cap of n.requires?.capabilities || []) {
      if (!(agent.card.moves || []).some((m) => m.taskType === cap)) issues.push(`node ${n.id}: agent '${n.agent}' lacks required capability '${cap}'`)
    }
    for (const sk of n.requires?.skills || []) {
      if (!(agent.card.skills || []).some((s) => s.name === sk)) issues.push(`node ${n.id}: agent '${n.agent}' lacks required skill '${sk}'`)
    }
  }
  return { ok: issues.length === 0, issues, resolved }
}

// ---- CalSkillSet: the per-agent BPM participation declaration -------------
export function buildCalSkillSet(cart) {
  const meta = cart.allMeta()
  const caps = cart.db.prepare('SELECT json FROM capabilities').all().map((r) => JSON.parse(r.json))
  const skills = cart.db.prepare('SELECT name FROM acx_skill').all().map((r) => r.name)
  return {
    schemaVersion: 'acx.cal-skillset/1',
    plays: [{ role: meta['acx.role'] || 'engineer', providesCapabilities: [...new Set(caps.map((c) => c.taskType))], canComplete: skills }],
    references: [], // other agents this one hands off to (by romDigest) — filled by authors
    processes: [], // CAL ids this agent participates in
  }
}

/** Emit the CalSkillSet into the ROM zone (signed). */
export function emitCalSkillSet(cart) {
  cart.putFile('rom/cal/skillset.json', Buffer.from(JSON.stringify(buildCalSkillSet(cart), null, 2), 'utf8'))
  cart.setMeta('acx.cal_skillset', 'rom/cal/skillset.json')
}
