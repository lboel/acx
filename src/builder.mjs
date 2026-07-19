// `acx builder` serves the exact dependency-free ACX Studio that can be hosted
// statically. It has no catalog API, upload endpoint, draft write endpoint, or
// execution capability: drafts stay in the browser and export as JSON.
import { createServer } from 'node:http'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { REPO_ROOT } from './paths.mjs'

const STATIC_ROOT = join(REPO_ROOT, 'platform', 'static')
const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json'],
  ['.webp', 'image/webp'],
])
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._@+-]*$/
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'cross-origin-opener-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

function safeFile(pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0')) return null
  const segments = decoded.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..' || !SEGMENT_RE.test(segment))) return null
  if (decoded.endsWith('/')) segments.push('index.html')
  const destination = resolve(STATIC_ROOT, ...segments)
  const rel = relative(resolve(STATIC_ROOT), destination)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) return null

  let current = resolve(STATIC_ROOT)
  for (const segment of rel.split(sep)) {
    current = join(current, segment)
    if (!existsSync(current) || lstatSync(current).isSymbolicLink()) return null
  }
  if (!lstatSync(destination).isFile() || !MIME_TYPES.has(extname(destination))) return null
  return destination
}

function respond(response, status, body, headers = {}) {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'cache-control': 'no-store',
    ...headers,
  })
  if (body != null) response.end(body)
  else response.end()
}

export function createBuilderServer() {
  return createServer((request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      if (!['GET', 'HEAD'].includes(request.method || '')) {
        respond(response, 405, 'Method not allowed\n', {
          allow: 'GET, HEAD',
          'content-type': 'text/plain; charset=utf-8',
        })
        return
      }
      if (url.pathname === '/') {
        respond(response, 302, null, { location: './studio/' })
        return
      }
      const file = safeFile(url.pathname)
      if (!file) {
        respond(response, 404, 'Not found\n', { 'content-type': 'text/plain; charset=utf-8' })
        return
      }
      const body = request.method === 'HEAD' ? null : readFileSync(file)
      respond(response, 200, body, { 'content-type': MIME_TYPES.get(extname(file)) })
    } catch {
      respond(response, 400, 'Bad request\n', { 'content-type': 'text/plain; charset=utf-8' })
    }
  })
}

export function startBuilder(port = 8799, { quiet = false } = {}) {
  const server = createBuilderServer()
  server.listen(port, '127.0.0.1', () => {
    if (quiet) return
    const address = server.address()
    const boundPort = typeof address === 'object' && address ? address.port : port
    console.log(`acx builder → http://127.0.0.1:${boundPort}/studio/`)
    console.log('  Static, local-first ACX Studio. No uploads, backend writes, private keys, or agent execution.')
    console.log('  Export JSON in the browser; lint, sign, verify, and publish it with the ACX CLI.')
    console.log('  Ctrl-C to stop.')
  })
  return server
}
