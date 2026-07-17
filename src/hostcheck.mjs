// Multi-host skill placement + harness preflight check (SPEC §8.5).
// "Can THIS host run the cartridge?" — required MCP tool roles, external binaries,
// model floors, protocol revision, and skill integrity.
import { existsSync, accessSync, constants, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { sha256Hex } from './canonical.mjs'

// Where each host reads Agent Skills. ~/.claude/skills is verified; the others are
// conventional defaults — override with --skills-dir.
export const HOSTS = {
  claude: { label: 'Claude Code', skillsDir: join(homedir(), '.claude', 'skills') },
  codex: { label: 'Codex', skillsDir: join(homedir(), '.codex', 'skills') },
  cursor: { label: 'Cursor', skillsDir: join(homedir(), '.cursor', 'skills') },
  generic: { label: 'generic', skillsDir: join(process.cwd(), '.acx', 'skills') },
}

export function resolveHost(host) {
  return HOSTS[host] || HOSTS.claude
}

/** Is a binary on PATH and executable? (no shell) */
export function whichSync(bin) {
  if (bin.includes('/')) return existsSync(bin)
  const dirs = (process.env.PATH || '').split(':').filter(Boolean)
  for (const d of dirs) {
    const p = join(d, bin)
    try { accessSync(p, constants.X_OK); return true } catch { /* keep looking */ }
  }
  return false
}

/**
 * Preflight the cartridge's harness requirements against this environment.
 * @param cart open Cartridge
 * @param opts { providedTools?: string[] (role or tool names the host offers), assumeAllTools?: bool }
 */
export function harnessCheck(cart, { providedTools = [], assumeAllTools = false } = {}) {
  const raw = cart.getFile('rom/manifest/harness-requirements.json')
  if (!raw) return { ok: false, verdict: 'refuse', unmet: ['missing harness-requirements manifest'], requiredTools: [], binaries: [], skills: [], model: {}, mcp: {} }
  const req = JSON.parse(raw.toString('utf8'))
  const provided = new Set(providedTools)
  const unmet = []

  const requiredTools = (req.requiredTools || []).map((t) => {
    const satisfied = assumeAllTools || provided.has(t.role) || provided.has(t.name)
    if (!satisfied) unmet.push('tool:' + t.role)
    return { role: t.role, name: t.name, scopes: t.capabilityScopes, satisfied, verified: assumeAllTools || provided.size > 0 }
  })

  const binaries = (req.externalTools || []).map((b) => {
    const bin = b.bin || b
    const present = whichSync(bin)
    if (!b.optional && !present) unmet.push('binary:' + bin)
    return { bin, optional: !!b.optional, present }
  })

  const skills = cart.db.prepare('SELECT sqlar_path, content_sha256 FROM acx_skill').all().map((s) => {
    const buf = cart.getFile(s.sqlar_path)
    const ok = !!buf && sha256Hex(buf) === s.content_sha256
    if (!ok) unmet.push('skill:' + s.sqlar_path)
    return { path: s.sqlar_path, ok }
  })

  return {
    ok: unmet.length === 0,
    verdict: unmet.length === 0 ? 'accept' : 'refuse',
    unmet,
    requiredTools,
    optionalTools: (req.optionalTools || []).map((t) => ({ role: t.role })),
    binaries,
    skills,
    model: req.model || {},
    mcp: req.mcp || {},
  }
}

/** Read every .acx in a directory as a compact overview row. */
export function listDir(dir, readCardFn) {
  if (!existsSync(dir)) return []
  const rows = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.acx')) continue
    try { rows.push({ file: f, ...readCardFn(join(dir, f)) }) } catch { /* skip */ }
  }
  return rows
}
