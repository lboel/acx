import test from 'node:test'
import assert from 'node:assert/strict'
import { createBuilderServer } from '../src/builder.mjs'

function request(method, url) {
  const server = createBuilderServer()
  const handler = server.listeners('request')[0]
  const result = { status: null, headers: null, body: null }
  handler(
    { method, url },
    {
      writeHead(status, headers) {
        result.status = status
        result.headers = new Map(
          Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]),
        )
      },
      end(body = null) {
        result.body = body
      },
    },
  )
  server.close()
  return result
}

test('acx builder serves the same static Studio with effective security headers', () => {
  const redirect = request('GET', '/')
  assert.equal(redirect.status, 302)
  assert.equal(redirect.headers.get('location'), './studio/')

  const studio = request('GET', '/studio/')
  assert.equal(studio.status, 200)
  assert.match(studio.headers.get('content-type'), /^text\/html/)
  assert.match(studio.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal(studio.headers.get('x-content-type-options'), 'nosniff')
  assert.match(studio.body.toString('utf8'), /ACX Studio/)

  const script = request('GET', '/studio/studio.js')
  assert.equal(script.status, 200)
  assert.match(script.headers.get('content-type'), /^text\/javascript/)
})

test('acx builder is read-only and refuses non-static or traversal-shaped requests', () => {
  const write = request('POST', '/studio/')
  assert.equal(write.status, 405)
  assert.equal(write.headers.get('allow'), 'GET, HEAD')

  assert.equal(request('GET', '/api/save').status, 404)
  assert.equal(request('GET', '/%2e%2e/SPEC.md').status, 404)
  assert.equal(request('GET', '/studio/%5c..%5cSPEC.md').status, 404)
})
