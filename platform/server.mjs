// Cartridge Exchange — a zero-dependency reference exchange for .acx cartridges.
// Browse, verify, acquire (download), and publish (upload, verified) cartridges.
// It NEVER executes a cartridge; it only reads metadata and verifies signatures.
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { listCatalog, summarize, inspectUpload, ensureCatalog, CATALOG_DIR } from './catalog.mjs'
import { galleryPage, detailPage, publishPage } from './views.mjs'

const PORT = Number(process.env.PORT || 8787)
const MAX_UPLOAD = 8 * 1024 * 1024 // 8 MB
const safeId = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 64)

function send(res, code, body, type = 'text/html; charset=utf-8') {
  res.writeHead(code, { 'content-type': type }); res.end(body)
}

function catalogPath(id) {
  const p = join(CATALOG_DIR, safeId(id) + '.acx')
  // defense-in-depth: ensure the resolved path stays inside the catalog dir
  if (!p.startsWith(CATALOG_DIR)) return null
  return p
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const path = url.pathname

    if (req.method === 'GET' && path === '/') return send(res, 200, galleryPage(listCatalog()))

    if (req.method === 'GET' && path === '/api/cartridges')
      return send(res, 200, JSON.stringify(listCatalog(), null, 2), 'application/json')

    if (req.method === 'GET' && path === '/publish') return send(res, 200, publishPage(url.searchParams.get('msg')))

    let m
    if (req.method === 'GET' && (m = path.match(/^\/c\/([^/]+)$/))) {
      const p = catalogPath(m[1])
      if (!p || !existsSync(p)) return send(res, 404, publishPage('not found'))
      return send(res, 200, detailPage(summarize(p)))
    }

    if (req.method === 'GET' && (m = path.match(/^\/verify\/([^/]+)$/))) {
      const p = catalogPath(m[1])
      if (!p || !existsSync(p)) return send(res, 404, 'not found')
      const s = summarize(p)
      return send(res, 200, detailPage(s))
    }

    if (req.method === 'GET' && (m = path.match(/^\/download\/([^/]+)$/))) {
      const p = catalogPath(m[1])
      if (!p || !existsSync(p)) return send(res, 404, 'not found')
      res.writeHead(200, {
        'content-type': 'application/vnd.acx.cartridge',
        'content-disposition': `attachment; filename="${safeId(m[1])}.acx"`,
      })
      return res.end(readFileSync(p))
    }

    if (req.method === 'POST' && path === '/publish') {
      const chunks = []; let size = 0; let tooBig = false
      for await (const ch of req) {
        size += ch.length
        if (size > MAX_UPLOAD) { tooBig = true; break } // stop consuming, respond below
        chunks.push(ch)
      }
      if (tooBig) { res.writeHead(413, { 'content-type': 'text/plain' }); res.end('cartridge too large (max 8 MB)'); req.destroy(); return }
      const buf = Buffer.concat(chunks)
      // SQLite magic: first 16 bytes "SQLite format 3\0"
      if (buf.length < 100 || buf.toString('latin1', 0, 15) !== 'SQLite format 3') return send(res, 400, 'not a SQLite/.acx file')
      const tmp = join(tmpdir(), `acx-upload-${randomBytes(6).toString('hex')}.acx`)
      writeFileSync(tmp, buf)
      let verdict
      try { verdict = inspectUpload(tmp) } catch (e) { rmSync(tmp, { force: true }); return send(res, 400, 'unreadable cartridge: ' + e.message) }
      if (!verdict.acceptable) { rmSync(tmp, { force: true }); return redirect(res, `/publish?msg=${encodeURIComponent(verdict.reason)}`) }
      // Identity is claimed once. Prefer an explicit id, else DERIVE it from the
      // VERIFIED publisher + agent name (provenance-bound), never a blank/dotfile id;
      // and never silently overwrite an existing entry (id squatting).
      const s = verdict.summary
      const id = safeId(req.headers['x-cartridge-id'] || '') || safeId(`${s.publisher}-${s.name}`) || ('upload-' + randomBytes(4).toString('hex'))
      const dest = catalogPath(id)
      if (!dest) { rmSync(tmp, { force: true }); return send(res, 400, 'invalid id') }
      if (existsSync(dest)) { rmSync(tmp, { force: true }); return redirect(res, `/publish?msg=${encodeURIComponent('id already taken: ' + id + ' — remove it from the catalog to replace')}`) }
      ensureCatalog()
      writeFileSync(dest, buf); rmSync(tmp, { force: true })
      return redirect(res, `/c/${id}`)
    }

    return send(res, 404, 'not found')
  } catch (e) {
    return send(res, 500, 'error: ' + e.message)
  }
})

function redirect(res, location) { res.writeHead(302, { location }); res.end() }

server.listen(PORT, () => console.log(`Cartridge Exchange on http://localhost:${PORT}  (catalog: ${CATALOG_DIR})`))
