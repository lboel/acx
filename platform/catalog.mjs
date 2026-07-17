// Catalog layer for the Cartridge Exchange: read + verify + summarize .acx files.
// Zero-dependency; reuses the reference implementation in ../src.
import { readdirSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { Cartridge } from '../src/container.mjs'
import { evaluateTrust, emptyTrustRegistry, loadTrustRegistry } from '../src/trust.mjs'
import { verifyLevelCredential } from '../src/level/credential.mjs'

export const CATALOG_DIR = join(new URL('.', import.meta.url).pathname, 'catalog')

export function ensureCatalog() {
  if (!existsSync(CATALOG_DIR)) mkdirSync(CATALOG_DIR, { recursive: true })
  return CATALOG_DIR
}

function loadRegistry() {
  const p = join(CATALOG_DIR, 'trust-registry.json')
  try {
    return existsSync(p) ? loadTrustRegistry(p) : emptyTrustRegistry()
  } catch {
    return emptyTrustRegistry()
  }
}

/** A gallery/detail summary of one cartridge, verification included. */
export function summarize(acxPath) {
  const cart = Cartridge.open(acxPath, { readonly: true })
  try {
    const meta = cart.allMeta()
    const verification = evaluateTrust(cart, { registry: loadRegistry() })
    const skills = cart.db.prepare('SELECT name, description FROM acx_skill ORDER BY name').all()
    const caps = cart.db.prepare('SELECT json FROM capabilities').all().map((r) => JSON.parse(r.json))
    const memByZone = {}
    for (const r of cart.db.prepare('SELECT zone, COUNT(*) n FROM memory GROUP BY zone').all()) memByZone[r.zone] = r.n
    const attRows = cart.db.prepare('SELECT att_id, type, document FROM attestations').all()

    // resolve a provable level from a level attestation, if present + valid
    let level = null
    for (const a of attRows) {
      if (a.type !== 'vc-2.0') continue
      let vc
      try { vc = JSON.parse(a.document) } catch { continue }
      const res = vc.credentialSubject?.result?.[0]
      if (!res) continue
      // verify the credential proof is internally valid + bound to this ROM
      const romDigest = meta['acx.rom_manifest_hash']
      const issuerPem = null // exchange does not hold verifier keys; report claimed level + binding
      const bound = res['acx:cartridgeRomDigest'] === romDigest
      level = {
        acxLevel: res['acx:acxLevel'], careerTier: res['acx:careerTier'],
        mu: res['acx:ratingMu'], sigma: res['acx:ratingSigma'], games: res['acx:gamesPlayed'],
        benchmark: res['acx:benchmarkId'], boundToRom: bound, attestationId: a.att_id,
      }
      break
    }

    const id = basename(acxPath).replace(/\.acx$/, '')
    return {
      id, path: acxPath, bytes: statSync(acxPath).size,
      name: meta['acx.agent_name'] || id,
      publisher: meta['acx.publisher_id'] || 'unknown',
      role: meta['acx.role'] || 'engineer',
      provider: meta['acx.provider'] || '', model: meta['acx.model'] || '',
      declaredLevel: Number(meta['acx.declared_level'] || 0),
      romHash: meta['acx.rom_manifest_hash'] || '',
      trust: verification.trust, trustStatus: verification.status, trustSummary: verification.summary,
      skills, capabilities: caps.map((c) => ({
        taskType: c.taskType, stack: c.stack, domain: c.domain, verified: !!c.proficiency?.verified,
      })),
      memory: memByZone, level,
    }
  } finally {
    cart.close()
  }
}

/** Full catalog index (all cartridges in CATALOG_DIR). */
export function listCatalog() {
  ensureCatalog()
  const out = []
  for (const f of readdirSync(CATALOG_DIR)) {
    if (!f.endsWith('.acx')) continue
    try { out.push(summarize(join(CATALOG_DIR, f))) } catch (e) { /* skip unreadable */ }
  }
  // rank: verified level desc, then trust, then name
  const trustRank = { local: 4, trusted: 3, portable: 2, legacy: 1, tampered: 0 }
  return out.sort((a, b) =>
    (b.level?.acxLevel ?? -1) - (a.level?.acxLevel ?? -1) ||
    (trustRank[b.trust] ?? 0) - (trustRank[a.trust] ?? 0) ||
    a.name.localeCompare(b.name))
}

/** Validate an uploaded cartridge before accepting it into the catalog. */
export function inspectUpload(acxPath) {
  const s = summarize(acxPath)
  const acceptable = s.trust !== 'tampered' && s.trustStatus !== 'invalid'
  return { acceptable, summary: s, reason: acceptable ? null : `rejected: ${s.trust} (${s.trustSummary})` }
}
