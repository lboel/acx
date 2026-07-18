// `acx builder` — a zero-dependency visual CAL/RAC loop builder.
// Serves a single-page, n8n-style drag-and-drop editor in the browser. It reads
// the local cartridge catalog to populate participants/capabilities/skills, and
// validates a CAL with the same lintCal() the CLI uses. It never executes anything.
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Cartridge } from './container.mjs'
import { readCard } from './load.mjs'
import { lintCal } from './cal.mjs'
import { REPO_ROOT } from './paths.mjs'

const APP = join(REPO_ROOT, 'platform', 'builder', 'app.html')
const CATALOG = join(REPO_ROOT, 'platform', 'catalog')
const DRAFTS = join(REPO_ROOT, 'platform', 'builder', 'drafts')
const safeName = (s) => String(s || 'loop').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 64) || 'loop'

function catalogEntries() {
  if (!existsSync(CATALOG)) return []
  const out = []
  for (const f of readdirSync(CATALOG)) {
    if (!f.endsWith('.acx')) continue
    const c = Cartridge.open(join(CATALOG, f), { readonly: true })
    try {
      const card = readCard(c)
      out.push({ file: f, path: join(CATALOG, f), card, name: card.name, role: card.role, romHash: card.romHash,
        capabilities: card.moves.map((m) => m.taskType), skills: card.skills.map((s) => s.name),
        level: card.level.proven ? `${card.level.tier} Lv.${card.level.acxLevel}` : `Lv.${card.level.acxLevel}` })
    } finally { c.close() }
  }
  return out
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0
    req.on('data', (c) => { size += c.length; if (size > 2 * 1024 * 1024) { req.destroy(); reject(new Error('too large')) } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function startBuilder(port = 8799) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(body) }

      if (req.method === 'GET' && url.pathname === '/') return send(200, readFileSync(APP), 'text/html; charset=utf-8')
      if (req.method === 'GET' && url.pathname === '/api/catalog') {
        return send(200, JSON.stringify(catalogEntries().map(({ path, card, ...rest }) => rest)))
      }
      if (req.method === 'POST' && url.pathname === '/api/validate') {
        const cal = JSON.parse(await readBody(req))
        const cartridges = catalogEntries().map((e) => ({ path: e.path, card: e.card }))
        return send(200, JSON.stringify(lintCal(cal, cartridges, { resolve: cartridges.length > 0, publish: true })))
      }
      if (req.method === 'POST' && url.pathname === '/api/save') {
        const { name, cal } = JSON.parse(await readBody(req))
        const cartridges = catalogEntries().map((e) => ({ path: e.path, card: e.card }))
        const lint = lintCal(cal, cartridges, { resolve: cartridges.length > 0, publish: true })
        mkdirSync(DRAFTS, { recursive: true })
        const dest = join(DRAFTS, safeName(name || cal.id) + '.cal.json')
        writeFileSync(dest, JSON.stringify(cal, null, 2) + '\n')
        return send(200, JSON.stringify({ saved: dest, lint }))
      }
      send(404, JSON.stringify({ error: 'not found' }))
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.message }))
    }
  })
  server.listen(port, () => {
    console.log(`acx builder → http://localhost:${port}`)
    console.log('  Visual CAL/RAC loop builder. Reads platform/catalog, saves unsigned drafts to platform/builder/drafts/.')
    console.log('  Publish with: acx workflow sign <draft> --publisher <id> --out registry/cals/<id>.cal.json')
    console.log('  Ctrl-C to stop.')
  })
  return server
}
