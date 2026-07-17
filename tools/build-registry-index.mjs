// Build registry/index.json by verifying every pushed cartridge.
// Run in CI on every push: it REJECTS (non-zero exit) any tampered cartridge, so a
// git-based registry cannot list a cartridge whose signed ROM was altered.
//   node --experimental-sqlite tools/build-registry-index.mjs
import { readdirSync, existsSync, writeFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Cartridge } from '../src/container.mjs'
import { evaluateTrust, emptyTrustRegistry, loadTrustRegistry } from '../src/trust.mjs'
import { validatePackageSpec } from '../src/packagespec.mjs'

const REGISTRY = join(new URL('.', import.meta.url).pathname, '..', 'registry')
const CARTRIDGES = join(REGISTRY, 'cartridges')

function registry() {
  const p = join(REGISTRY, 'trust-registry.json')
  try { return existsSync(p) ? loadTrustRegistry(p) : emptyTrustRegistry() } catch { return emptyTrustRegistry() }
}

function findCartridges(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...findCartridges(p))
    else if (e.name.endsWith('.acx')) out.push(p)
  }
  return out
}

function summarize(acxPath, reg) {
  const cart = Cartridge.open(acxPath, { readonly: true })
  try {
    const meta = cart.allMeta()
    const v = evaluateTrust(cart, { registry: reg })
    const spec = validatePackageSpec(cart)
    const caps = cart.db.prepare('SELECT json FROM capabilities').all()
      .map((r) => JSON.parse(r.json)).map((c) => ({ taskType: c.taskType, stack: c.stack, domain: c.domain, verified: !!c.proficiency?.verified }))
    let level = null
    for (const a of cart.db.prepare("SELECT document FROM attestations WHERE type='vc-2.0'").all()) {
      const res = JSON.parse(a.document).credentialSubject?.result?.[0]
      if (res) { level = { acxLevel: res['acx:acxLevel'], careerTier: res['acx:careerTier'], boundToRom: res['acx:cartridgeRomDigest'] === meta['acx.rom_manifest_hash'] }; break }
    }
    return {
      slug: relative(CARTRIDGES, acxPath).replace(/\.acx$/, '').replace(/\//g, '__'),
      path: relative(REGISTRY, acxPath),
      name: meta['acx.agent_name'], publisher: meta['acx.publisher_id'], role: meta['acx.role'],
      provider: meta['acx.provider'], model: meta['acx.model'],
      trust: v.trust, trustStatus: v.status, specClean: spec.ok,
      romHash: meta['acx.rom_manifest_hash'], bytes: statSync(acxPath).size,
      capabilities: caps, level,
    }
  } finally { cart.close() }
}

const reg = registry()
const files = findCartridges(CARTRIDGES)
const entries = []
const rejected = []
for (const f of files) {
  const s = summarize(f, reg)
  if (s.trust === 'tampered' || s.trustStatus === 'invalid' || !s.specClean) rejected.push({ path: s.path, trust: s.trust, specClean: s.specClean })
  else entries.push(s)
}
entries.sort((a, b) => (b.level?.acxLevel ?? -1) - (a.level?.acxLevel ?? -1) || a.name.localeCompare(b.name))

const index = {
  schemaVersion: 'acx.registry-index/1',
  generatedAt: new Date().toISOString(),
  count: entries.length,
  cartridges: entries,
}
writeFileSync(join(REGISTRY, 'index.json'), JSON.stringify(index, null, 2) + '\n')
console.log(`indexed ${entries.length} cartridge(s) -> registry/index.json`)
for (const e of entries) console.log(`  ${e.name.padEnd(16)} ${e.publisher.padEnd(24)} trust=${e.trust.padEnd(8)} level=${e.level ? e.level.careerTier + ' Lv.' + e.level.acxLevel : '—'} spec=${e.specClean ? 'clean' : 'ISSUES'}`)
if (rejected.length) {
  console.error(`\nREJECTED ${rejected.length} cartridge(s) (tampered / invalid / unclean spec):`)
  for (const r of rejected) console.error(`  ✗ ${r.path}  trust=${r.trust} specClean=${r.specClean}`)
  process.exit(1)
}
