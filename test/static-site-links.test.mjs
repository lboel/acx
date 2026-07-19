import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkStaticSite } from '../tools/check-static-site.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'acx-static-links-'))
  mkdirSync(join(root, 'guide'), { recursive: true })
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'assets', 'site.css'), 'body{}')
  writeFileSync(
    join(root, 'index.html'),
    '<link href="./assets/site.css"><a href="./guide/#safe">Guide</a><a href="#home">Home</a><main id="home"></main>',
  )
  writeFileSync(
    join(root, 'guide', 'index.html'),
    '<a href="/acx/">Home</a><a href="../#home">Back</a><h1 id="safe">Safe</h1>',
  )
  writeFileSync(join(root, '404.html'), '<a href="/acx/">Home</a><a href="#__skip">Skip</a>')
  return root
}

test('static site checker resolves relative, base-path, asset, and fragment links', () => {
  const root = fixture()
  try {
    assert.deepEqual(checkStaticSite({ siteRoot: root, basePath: '/acx/' }), {
      pages: 3,
      references: 7,
      fragments: 3,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('static site checker fails closed on missing, escaping, and foreign root links', () => {
  const root = fixture()
  try {
    writeFileSync(
      join(root, 'broken.html'),
      '<a href="./missing/">Missing</a><script src="../outside.js"></script><a href="/other/">Other</a>',
    )
    assert.throws(
      () => checkStaticSite({ siteRoot: root, basePath: '/acx/' }),
      /missing .*URL escapes.*root-relative URL is outside/s,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
