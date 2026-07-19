import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, ...path.split('/')), 'utf8')

test('share guide promises local preparation, not an automatic publication', () => {
  const share = read('docs-site/docs/share.md')

  assert.match(share, /Prepare in 60 seconds/)
  assert.match(share, /## Prepare in 60 seconds/)
  assert.doesNotMatch(share, /Publish in 60 seconds/)
  assert.match(share, /do \*\*not\*\* fork a repository, create a branch, commit, push, open a/)
  assert.match(share, /### Publish the prepared diff separately/)
  assert.match(share, /open a \*\*draft pull request\*\*/)
  assert.match(share, /require explicit authorization/)
  assert.match(share, /stop before every remote write/)
})

test('documentation navigation distinguishes the Exchange explainer from the catalog', () => {
  const config = read('docs-site/zensical.toml')
  const home = read('docs-site/docs/index.md')

  assert.match(config, /\{ "How the Exchange works" = "lifecycle\/exchange\.md" \}/)
  assert.doesNotMatch(config, /\{ "Explore Exchange" = "lifecycle\/exchange\.md" \}/)
  assert.match(home, /href="exchange\/">Explore the Exchange<\/a>/)
})

test('documentation hero answers the three beginner artifact questions', () => {
  const home = read('docs-site/docs/index.md')

  assert.match(home, /class="acx-hero-questions"/)
  assert.match(home, /<span>Agent<\/span>\s*<strong>Who can do the work\?<\/strong>/)
  assert.match(home, /<span>Workflow<\/span>\s*<strong>What should happen next\?<\/strong>/)
  assert.match(home, /<span>Agent Graph<\/span>\s*<strong>Who must tell whom what\?<\/strong>/)
})

test('release metadata remains an undated candidate until the tag exists', () => {
  const changelog = read('CHANGELOG.md')
  const citation = read('CITATION.cff')

  assert.match(changelog, /## 0\.1\.0 — release candidate \(untagged\)/)
  assert.match(changelog, /release date remains unset until `v0\.1\.0` is/)
  assert.match(citation, /version: "0\.1\.0-rc"/)
  assert.doesNotMatch(citation, /^date-released:/m)
})
