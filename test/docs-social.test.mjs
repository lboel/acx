import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { injectDocsSocial } from '../tools/inject-docs-social.mjs'

test('docs social injector adds deterministic previews and leaves Exchange pages alone', () => {
  const root = mkdtempSync(join(tmpdir(), 'acx-docs-social-'))
  try {
    mkdirSync(join(root, 'share'), { recursive: true })
    mkdirSync(join(root, 'exchange'), { recursive: true })
    const html = (title, description) => `<!doctype html><html><head><title>${title}</title><meta name="description" content="${description}"></head><body></body></html>`
    writeFileSync(join(root, 'index.html'), html('ACX &amp; agents', 'Portable &amp; signed.'))
    writeFileSync(join(root, 'share', 'index.html'), html('Share ACX', 'Publish via PR.'))
    writeFileSync(join(root, 'exchange', 'index.html'), html('Exchange', 'Owned by its builder.'))

    const first = injectDocsSocial({ siteRoot: root, siteUrl: 'https://example.test/acx/' })
    assert.equal(first.changed, 2)
    const home = readFileSync(join(root, 'index.html'), 'utf8')
    const share = readFileSync(join(root, 'share', 'index.html'), 'utf8')
    const exchange = readFileSync(join(root, 'exchange', 'index.html'), 'utf8')
    assert.match(home, /property="og:url" content="https:\/\/example\.test\/acx\/"/)
    assert.match(home, /property="og:image" content="https:\/\/example\.test\/acx\/exchange\/assets\/share-card\.png"/)
    assert.match(home, /name="twitter:title" content="ACX &amp; agents"/)
    assert.match(share, /property="og:url" content="https:\/\/example\.test\/acx\/share\/"/)
    assert.doesNotMatch(exchange, /ACX_SOCIAL_META/)

    const second = injectDocsSocial({ siteRoot: root, siteUrl: 'https://example.test/acx/' })
    assert.equal(second.changed, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
