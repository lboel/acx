// `acx init` — scaffold a fillable agent-package, or generate a whole AGENT SET
// from the current codebase (detect roles + a CAL + RAC describing the code
// knowledge — descriptions only, in the spirit of an Open Knowledge Format).
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ---- a single fillable package -------------------------------------------
export function scaffoldManifest({ name = 'TODO Agent', role = 'backend_dev', provider = 'claude', model = 'claude-opus-4-8', techStack = ['node'], topics = ['TODO expertise'] } = {}) {
  return {
    schemaVersion: '1.1', packageVersion: '2.0', exportedAt: '1970-01-01T00:00:00.000Z', exportedFrom: 'agentibus',
    originInstanceId: 'init', originInstanceLabel: 'init', agentId: 'init-' + role,
    sourceFingerprint: `${provider}:${model}:${role}:0:${techStack.slice(0, 3).join('+')}`,
    name, provider, model, role, careerTier: 'intern', level: 1, xp: 0, skillPoints: 2, completedProjects: 0,
    stats: { intelligence: 5, speed: 5, quality: 5, creativity: 5, endurance: 5, teamwork: 5 },
    baseStats: { intelligence: 5, speed: 5, quality: 5, creativity: 5, endurance: 5, teamwork: 5 },
    traits: ['curious'], appearance: { bodyType: 1, skinTone: 1, hairStyle: 3, hairColor: 3, eyeShape: 3, accessories: [], outfitAccent: '#22c55e' },
    topSkills: [], unlockedSkills: [], unlockedSkillCount: 0, memoryRecordCount: 1, memoryTopics: topics,
    vectorEngine: 'local-hash-128', portableFormats: ['json'], techStack,
    personality: { communicationStyle: 'direct', codingPhilosophy: ['pragmatic', 'explicit-errors'], knownForIn: topics[0] },
    achievements: [],
  }
}

export function scaffoldPackage(dir, opts = {}) {
  mkdirSync(dir, { recursive: true })
  const m = scaffoldManifest(opts)
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m, null, 2))
  writeFileSync(join(dir, 'memory-records.json'), JSON.stringify([
    { id: 'm1', title: `${m.memoryTopics[0]}`, summary: `TODO: one transferable, codebase-agnostic lesson about ${m.memoryTopics[0]}.`, sourceType: 'knowledge', repoId: null, repoLabel: '', projectLabel: '', markdownPath: 'k.md', timestamp: '2026-01-01T00:00:00.000Z', impact: 'positive', xpAwarded: 10, tags: m.memoryTopics },
  ], null, 2))
  writeFileSync(join(dir, 'IDENTITY.md'), `# ${m.name}\n\nRole: ${m.role}. TODO: describe this agent.\n`)
  writeFileSync(join(dir, 'SKILLS.md'), `# Skills\n\n${m.techStack.map((t) => `- ${t}`).join('\n')}\n`)
  return dir
}

// ---- codebase analysis (heuristic, no LLM) --------------------------------
function has(root, rel) { return existsSync(join(root, rel)) }
function pkgDeps(root) {
  try { const p = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); return { ...p.dependencies, ...p.devDependencies } } catch { return null }
}
function globExists(root, pred, maxDepth = 3) {
  const walk = (dir, d) => {
    let out = false
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return false }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = join(dir, e.name)
      if (e.isFile() && pred(e.name)) return true
      if (e.isDirectory() && d < maxDepth && walk(p, d + 1)) out = true
    }
    return out
  }
  return walk(root, 0)
}

/** Detect an agent set + RAC from a codebase. */
export function analyzeCode(root) {
  const roles = new Map() // role -> {role, capabilities:Set, techStack:Set, reason}
  const add = (role, caps, tech, reason) => {
    const r = roles.get(role) || { role, capabilities: new Set(), techStack: new Set(), reasons: [] }
    caps.forEach((c) => r.capabilities.add(c)); tech.forEach((t) => r.techStack.add(t)); r.reasons.push(reason)
    roles.set(role, r)
  }
  const rac = []
  const deps = pkgDeps(root)

  if (deps) {
    const d = Object.keys(deps).join(' ')
    if (/react|vue|svelte|nuxt|next|@angular/.test(d) || has(root, 'src/components')) add('frontend_dev', ['implement-feature'], ['typescript', 'react'], 'frontend framework in package.json')
    if (/express|fastify|nest|koa|prisma|drizzle|typeorm/.test(d)) add('backend_dev', ['design-api', 'implement-feature'], ['node', 'postgres'], 'backend framework in package.json')
    add('backend_dev', ['implement-feature'], ['node'], 'node package.json present')
  }
  if (has(root, 'pyproject.toml') || has(root, 'requirements.txt')) add('backend_dev', ['implement-feature'], ['python'], 'python project')
  if (globExists(root, (n) => n.endsWith('.tf'))) { add('devops_engineer', ['deploy', 'harden-security'], ['terraform'], 'terraform files'); rac.push({ id: 'infra-arch', kind: 'terraform', required: true, description: 'Terraform describing the infrastructure/architecture (structure only, not contents).', check: { type: 'file-glob', hint: '**/*.tf' } }) }
  if (has(root, 'Dockerfile') || has(root, '.github/workflows')) add('devops_engineer', ['deploy'], ['docker'], 'Dockerfile / CI workflows')
  if (globExists(root, (n) => /airflow|dags?/.test(n)) || (deps && /airflow/.test(Object.keys(deps).join(' ')))) add('devops_engineer', ['build-dag'], ['airflow'], 'airflow / dags detected')
  if (globExists(root, (n) => /\.(test|spec)\.[jt]sx?$/.test(n)) || has(root, 'tests') || has(root, 'test')) add('qa_engineer', ['test-authoring'], ['vitest'], 'test files/dir')
  if (has(root, 'SECURITY.md') || (deps && /oauth|passport|jsonwebtoken|helmet/.test(Object.keys(deps).join(' ')))) add('security_expert', ['harden-security'], ['oauth'], 'security signals')
  if (has(root, 'docs') || globExists(root, (n) => n.toLowerCase() === 'readme.md', 1)) rac.push({ id: 'code-wiki', kind: 'wiki', required: true, description: 'An LLM-readable knowledge map / wiki of the codebase: modules, data flows, conventions (structure only).', check: { type: 'mcp-resource', hint: 'wiki://project/overview' } })

  if (roles.size === 0) add('fullstack_dev', ['implement-feature'], ['node'], 'default (no strong signals)')
  const agentSet = [...roles.values()].map((r) => ({ role: r.role, capabilities: [...r.capabilities], techStack: [...r.techStack], reasons: r.reasons }))
  return { agentSet, rac }
}

function calFromAgentSet(agentSet, rac) {
  const participants = agentSet.map((a) => ({ alias: a.role, bind: 'slot', slot: { role: a.role, capabilities: a.capabilities.map((c) => ({ taskType: c })) } }))
  const nodes = [{ id: 'start', type: 'event', event: 'start' }]
  const edges = []
  let prev = 'start'
  agentSet.forEach((a, i) => {
    const id = a.role
    nodes.push({ id, type: 'task', agent: a.role, action: `TODO: ${a.role} step`, requires: { capabilities: a.capabilities, rac: rac.map((r) => r.id) }, completion: { type: 'verification', commands: ['lint', 'test:touched'], passIntent: 'touched checks green' } })
    edges.push({ from: prev, to: id }); prev = id
  })
  nodes.push({ id: 'done', type: 'event', event: 'end' }); edges.push({ from: prev, to: 'done' })
  return { schemaVersion: 'acx.cal/1', id: 'from-code', name: 'Generated loop from codebase', description: 'Auto-generated agent set + loop. Fill in actions/conditions, then export each agent and pin by romDigest.', participants, rac, start: 'start', nodes, edges }
}

/** Generate a whole agent set + CAL + RAC from a codebase into outDir. */
export function initFromCode(codeDir, outDir) {
  const { agentSet, rac } = analyzeCode(codeDir)
  mkdirSync(join(outDir, 'agents'), { recursive: true })
  mkdirSync(join(outDir, 'cal'), { recursive: true })
  for (const a of agentSet) {
    scaffoldPackage(join(outDir, 'agents', a.role), { name: `TODO ${a.role}`, role: a.role, techStack: a.techStack.length ? a.techStack : ['node'], topics: [a.capabilities[0] || 'engineering'] })
  }
  const cal = calFromAgentSet(agentSet, rac)
  writeFileSync(join(outDir, 'cal', 'from-code.cal.json'), JSON.stringify(cal, null, 2))
  writeFileSync(join(outDir, 'README.md'), [
    '# Generated agent set', '',
    `Detected ${agentSet.length} role(s) from the codebase:`, '',
    ...agentSet.map((a) => `- **${a.role}** — capabilities ${a.capabilities.join(', ')} (${a.reasons.join('; ')})`), '',
    '## Required Available Context (descriptions only)', '',
    ...rac.map((r) => `- **${r.id}** [${r.kind}]: ${r.description}`), '',
    '## Next steps', '',
    '1. Fill each `agents/<role>/manifest.json` + `memory-records.json`.',
    '2. Export each to a signed cartridge:',
    '   `node --experimental-sqlite src/cli.mjs export agents/<role> <role>.acx --publisher io.github.you`',
    '3. Wire the loop in `cal/from-code.cal.json` (pin agents by romDigest or keep slots).',
    '4. Check readiness: `node --experimental-sqlite src/cli.mjs cal cal/from-code.cal.json --cartridges .`', '',
  ].join('\n'))
  return { agentSet, rac, outDir }
}
