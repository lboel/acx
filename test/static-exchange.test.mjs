import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildStaticExchange,
  parseBuildArgs,
} from '../tools/build-static-exchange.mjs'
import {
  jcs,
  pae,
  registryCoordinateIssues,
  sha256Hex,
  verifyArtifact,
} from '../platform/static/assets/verify.js'
import { Cartridge } from '../src/container.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY = join(ROOT, 'registry')
const STATIC = join(ROOT, 'platform', 'static')
const temporaryDirectories = []
const REGISTRY_INDEX = JSON.parse(readFileSync(join(REGISTRY, 'index.json'), 'utf8'))

function registryArtifact(group, id) {
  const entry = REGISTRY_INDEX[group].find((candidate) => candidate.id === id)
  assert.ok(entry, `missing ${group} fixture ${id}`)
  return join(REGISTRY, ...entry.path.split('/'))
}

function tempDirectory(label) {
  const path = mkdtempSync(join(tmpdir(), `${label}-`))
  temporaryDirectories.push(path)
  return path
}

test.after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('browser JCS and DSSE PAE match the canonical ACX rules', async () => {
  assert.equal(
    jcs({ z: 1, a: ['x', true, null], omitted: undefined }),
    '{"a":["x",true,null],"z":1}',
  )
  assert.equal(
    await sha256Hex(jcs({ hello: 'world' })),
    '93a23971a914e5eacbf0a8d25154cda309c3c1c72fbb9914d47c60f3cb681588',
  )
  assert.deepEqual(
    [...pae('application/test', new TextEncoder().encode('hello'))],
    [...new TextEncoder().encode('DSSEv1 16 application/test 5 hello')],
  )
  assert.throws(() => jcs({ invalid: Number.NaN }), /non-finite/)
})

test('browser verifier validates signed workflow bytes but never grants namespace trust', async () => {
  const workflow = JSON.parse(readFileSync(registryArtifact('workflows', 'ship-a-feature'), 'utf8'))
  const result = await verifyArtifact(workflow)
  assert.equal(result.ok, true, result.issues.join('; '))
  assert.equal(result.signed, true)
  assert.equal(result.status, 'verified')
  assert.equal(result.trust, 'portable')
  assert.equal(result.publisherNamespaceTrusted, false)
  assert.equal(result.publisherId, 'io.github.lboel')
  assert.match(result.issues.join(' '), /namespace ownership is not proven/i)
})

test('browser verification is bound to the selected registry coordinate', async () => {
  const selected = REGISTRY_INDEX.workflows.find((entry) => entry.id === 'ship-a-feature')
  const selectedArtifact = JSON.parse(readFileSync(join(REGISTRY, ...selected.path.split('/')), 'utf8'))
  const selectedResult = await verifyArtifact(selectedArtifact)
  assert.deepEqual(registryCoordinateIssues(selectedArtifact, selectedResult, {
    type: 'workflow',
    publisher: selected.publisher,
    id: selected.id,
    version: selected.version,
    digest: selected.digest,
  }), [])

  const substituted = JSON.parse(readFileSync(registryArtifact('workflows', 'research-council'), 'utf8'))
  const substitutedResult = await verifyArtifact(substituted)
  assert.equal(substitutedResult.ok, true)
  const issues = registryCoordinateIssues(substituted, substitutedResult, {
    type: 'workflow',
    publisher: selected.publisher,
    id: selected.id,
    version: selected.version,
    digest: selected.digest,
  })
  assert.ok(issues.some((issue) => issue.includes('artifact id mismatch')))
  assert.ok(issues.some((issue) => issue.includes('digest mismatch')))
})

test('browser verifier validates Agent Graph bindings and rejects modified content', async () => {
  const graph = JSON.parse(readFileSync(registryArtifact('agentGraphs', 'product-delivery'), 'utf8'))
  const valid = await verifyArtifact(graph)
  assert.equal(valid.ok, true, valid.issues.join('; '))
  assert.equal(valid.type, 'agent-graph')

  graph.routes[0].purpose = 'Maliciously changed after signing'
  const tampered = await verifyArtifact(graph)
  assert.equal(tampered.ok, false)
  assert.equal(tampered.trust, 'tampered')
  assert.match(tampered.issues.join(' '), /digest mismatch/)
})

test('browser verifier is explicitly limited to workflow and Agent Graph JSON', async () => {
  const result = await verifyArtifact({ schemaVersion: 'acx.cartridge/1' })
  assert.equal(result.ok, false)
  assert.match(result.issues.join(' '), /unsupported JSON artifact/)
})

test('static exchange app uses safe DOM construction and subpath-relative resources', () => {
  const html = readFileSync(join(STATIC, 'index.html'), 'utf8')
  const app = readFileSync(join(STATIC, 'assets', 'app.js'), 'utf8')
  const css = readFileSync(join(STATIC, 'assets', 'app.css'), 'utf8')
  const studioHtml = readFileSync(join(STATIC, 'studio', 'index.html'), 'utf8')
  const studio = readFileSync(join(STATIC, 'studio', 'studio.js'), 'utf8')
  const studioCss = readFileSync(join(STATIC, 'studio', 'studio.css'), 'utf8')
  assert.doesNotMatch(html, /(?:href|src)="\//)
  assert.doesNotMatch(html, /\son[a-z]+=/i)
  assert.doesNotMatch(app, /\.innerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function/)
  assert.doesNotMatch(studio, /\.innerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new Function|\.style\./)
  assert.match(studio, /import \{ verifyArtifact \}/)
  assert.match(studio, /failed portable verification/)
  assert.doesNotMatch(app, /levelClaim/)
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /rel="icon" href="\.\/assets\/icon\.svg"/)
  assert.match(html, /object-src 'none'/)
  assert.doesNotMatch(html, /frame-ancestors/)
  assert.match(studioHtml, /Content-Security-Policy/)
  assert.match(studioHtml, /rel="icon" href="\.\.\/assets\/icon\.svg"/)
  assert.doesNotMatch(studioHtml, /frame-ancestors/)
  assert.match(html, /href="\.\/studio\/"/)
  assert.match(html, /href="\.\.\/share\/">Publish via PR/)
  assert.match(html, /Install and safe-receive guide/)
  assert.match(app, /studio\/\?source=/)
  assert.match(app, /registryCoordinateIssues/)
  assert.match(app, /acx spec \$\{id\}-\$\{version\}\.acx/)
  assert.match(app, /--print-only/)
  assert.match(studio, /acx share graph .*--dry-run/)
  assert.match(studio, /acx share workflow .*--dry-run/)
  assert.doesNotMatch(app, /studio\/\?(?:type|from)=/)
  assert.match(app, /cartridges.*cartridge\\\.acx/)
  assert.match(app, /entry\?\.latest !== false/)
  assert.match(app, /workflow:\$\{publisher\}\/\$\{id\}@/)
  assert.match(app, /agent-graph:\$\{publisher\}\/\$\{id\}@/)
  assert.match(css, /\.verify-result[\s\S]*overflow-wrap:\s*anywhere/)
  assert.match(css, /\.fact-grid dd[\s\S]*overflow-wrap:\s*anywhere/)
  assert.match(studioCss, /\.publish-handoff > \* \{\s*min-width:\s*0/)
  assert.match(studioCss, /pre \{\s*max-width:\s*100%;\s*overflow:\s*auto/)
})

test('static build emits a complete, deterministic exchange with pre-rendered cards', async () => {
  const first = join(tempDirectory('acx-static-build-a'), 'exchange')
  const second = join(tempDirectory('acx-static-build-b'), 'exchange')
  const options = {
    projectRoot: ROOT,
    registryRoot: REGISTRY,
    staticRoot: STATIC,
    siteUrl: 'https://example.test/tools/acx/',
    quiet: true,
  }
  const buildA = await buildStaticExchange({ ...options, outputRoot: first })
  const buildB = await buildStaticExchange({ ...options, outputRoot: second })

  assert.equal(buildA.index.exchangeSchemaVersion, 'acx.static-exchange/1')
  assert.equal(buildA.index.cartridges.length, 2)
  assert.equal(buildA.index.workflows.length, 2)
  assert.equal(buildA.index.agentGraphs.length, 1)
  assert.equal(buildA.index.templates.length, 1)
  assert.equal(buildA.manifest.artifactCount, 6)
  assert.equal(buildA.manifest.artifacts.length, 6)
  assert.match(buildA.manifest.exchangeIndexDigest, /^sha256:[0-9a-f]{64}$/)
  assert.ok(buildA.manifest.artifacts.every((artifact) => artifact.downloadPath && artifact.detailPath))
  assert.equal(
    buildA.index.workflows.find((entry) => entry.id === 'ship-a-feature').path,
    'cals/io.github.lboel/ship-a-feature/1.0.0.cal.json',
  )
  assert.equal(
    buildA.index.agentGraphs.find((entry) => entry.id === 'product-delivery').path,
    'graphs/io.github.lboel/product-delivery/1.0.0.agent-graph.json',
  )
  assert.equal(
    buildA.index.cartridges.find((entry) => entry.id === 'ada-ridge').path,
    'cartridges/io.github.ridgeworks/ada-ridge/1.0.0/cartridge.acx',
  )
  assert.ok(buildA.index.cartridges.every((entry) => entry.version && entry.latest === true))
  assert.ok(buildA.manifest.artifacts
    .filter((artifact) => artifact.type === 'agent')
    .every((artifact) => artifact.version === '1.0.0' && artifact.key.includes('@1.0.0')))
  assert.ok(buildA.manifest.artifacts
    .filter((artifact) => ['agent', 'workflow', 'agent-graph'].includes(artifact.type))
    .every((artifact) => artifact.key.includes(`${artifact.publisher}/${artifact.id}@${artifact.version}`)))
  assert.equal(
    new Set(buildA.manifest.artifacts.map((artifact) => artifact.key)).size,
    buildA.manifest.artifacts.length,
  )
  assert.deepEqual(buildA.manifest, buildB.manifest)
  assert.equal(
    readFileSync(join(first, 'data', 'index.json'), 'utf8'),
    readFileSync(join(second, 'data', 'index.json'), 'utf8'),
  )

  const workflow = buildA.index.workflows.find((entry) => entry.id === 'ship-a-feature')
  const detailFile = join(first, ...workflow.exchange.detailPath.split('/'), 'index.html')
  const detail = readFileSync(detailFile, 'utf8')
  assert.match(detail, /property="og:title"/)
  assert.match(detail, /name="twitter:card" content="summary_large_image"/)
  assert.match(detail, /property="og:image" content="https:\/\/example\.test\/tools\/acx\/assets\/share-card\.png"/)
  assert.match(detail, /property="og:image:type" content="image\/png"/)
  assert.match(detail, /property="og:image:width" content="1200"/)
  assert.match(detail, /property="og:image:height" content="630"/)
  assert.match(detail, /name="twitter:image" content="https:\/\/example\.test\/tools\/acx\/assets\/share-card\.png"/)
  assert.match(detail, /name="twitter:image:alt"/)
  assert.match(detail, /href="\.\.\/\.\.\/\.\.\/assets\/app\.css\?v=20260719"/)
  assert.match(detail, /type="application\/ld\+json"/)
  assert.match(detail, /<noscript>/)
  assert.match(detail, /rel="icon" href="\.\.\/\.\.\/\.\.\/assets\/icon\.svg"/)
  assert.match(detail, /https:\/\/example\.test\/tools\/acx\/artifacts\/workflow\//)
  assert.doesNotMatch(detail, /(?:href|src)="\/(?!\/)/)
  const workflowDownloadHref = `../../../${workflow.exchange.downloadPath}`
  const workflowCanonicalDownload = new URL(workflow.exchange.downloadPath, options.siteUrl).href
  const workflowCoordinate = `workflow:${workflow.publisher}/${workflow.id}@${workflow.version}`
  const workflowRemixHref = `../../../studio/?source=${encodeURIComponent(`../${workflow.exchange.downloadPath}`)}`
  assert.ok(detail.includes(`href="${workflowDownloadHref}" download`))
  assert.ok(detail.includes(`href="${workflowDownloadHref}">`))
  assert.ok(detail.includes(`"contentUrl":"${workflowCanonicalDownload}"`))
  assert.ok(!detail.includes(`href="${workflowCanonicalDownload}" download`))
  assert.ok(detail.includes(`data-coordinate="${workflowCoordinate}"`))
  assert.ok(detail.includes(`data-digest="${workflow.digest}"`))
  assert.match(detail, /<dt>Artifact id<\/dt><dd>ship-a-feature<\/dd>/)
  assert.match(detail, /<dt>Lifecycle<\/dt><dd>active<\/dd>/)
  assert.match(detail, /class="button button-primary"[^>]*>Inspect &amp; verify<\/a>/)
  assert.ok(detail.indexOf('>Inspect &amp; verify</a>') < detail.indexOf('>Download artifact</a>'))
  assert.ok(detail.includes(`href="${workflowRemixHref}"`))
  assert.match(detail, /Team workflow at a glance/)
  assert.match(detail, /architect · architect/)
  assert.match(detail, /href="https:\/\/lboel\.github\.io\/acx\/share\/">Share or publish via PR<\/a>/)

  const graph = buildA.index.agentGraphs.find((entry) => entry.id === 'product-delivery')
  const graphDetail = readFileSync(
    join(first, ...graph.exchange.detailPath.split('/'), 'index.html'),
    'utf8',
  )
  const graphCoordinate = `agent-graph:${graph.publisher}/${graph.id}@${graph.version}`
  const graphRemixHref = `../../../studio/?source=${encodeURIComponent(`../${graph.exchange.downloadPath}`)}`
  assert.ok(graphDetail.includes(`data-coordinate="${graphCoordinate}"`))
  assert.ok(graphDetail.includes(`data-digest="${graph.digest}"`))
  assert.ok(graphDetail.includes(`href="${graphRemixHref}"`))
  assert.match(graphDetail, /Information flow at a glance/)
  assert.match(graphDetail, /Product Owner → Developer team · direct/)
  assert.match(graphDetail, /Developer team → Product Owner · report/)
  assert.match(graphDetail, /Loop: research-council@1\.0\.0/)

  const typedEntries = [
    ...buildA.index.cartridges.map((entry) => ({ type: 'agent', entry })),
    ...buildA.index.workflows.map((entry) => ({ type: 'workflow', entry })),
    ...buildA.index.agentGraphs.map((entry) => ({ type: 'agent-graph', entry })),
    ...buildA.index.templates.map((entry) => ({ type: 'template', entry })),
  ]
  for (const { type, entry } of typedEntries) {
    const page = readFileSync(
      join(first, ...entry.exchange.detailPath.split('/'), 'index.html'),
      'utf8',
    )
    const expectedCoordinate = type === 'template'
      ? `template:${entry.id}`
      : `${type}:${entry.publisher}/${entry.id}@${entry.version}`
    const expectedDigest = entry.digest || entry.romHash || `sha256:${entry.exchange.sha256}`
    const runtimeDownloadHref = `../../../${entry.exchange.downloadPath}`
    const canonicalDownloadHref = new URL(entry.exchange.downloadPath, options.siteUrl).href
    assert.ok(page.includes(`data-coordinate="${expectedCoordinate}"`), `${type} detail must expose its full coordinate`)
    assert.ok(page.includes(`data-digest="${expectedDigest}"`), `${type} detail must expose its full digest`)
    assert.match(page, /<dt>Lifecycle<\/dt><dd>active<\/dd>/)
    assert.ok(page.includes(`href="${runtimeDownloadHref}" download`), `${type} runtime download must remain relative`)
    assert.ok(!page.includes(`href="${canonicalDownloadHref}" download`), `${type} runtime download must ignore --site-url`)
    assert.match(page, />Inspect &amp; verify<\/a>/)
    assert.match(page, />Share or publish via PR<\/a>/)
    if (type === 'workflow' || type === 'agent-graph') assert.match(page, />Remix in Studio<\/a>/)
    else assert.doesNotMatch(page, />Remix in Studio<\/a>/)
  }

  const exchangeHome = readFileSync(join(first, 'index.html'), 'utf8')
  assert.match(exchangeHome, /property="og:url" content="https:\/\/example\.test\/tools\/acx\/"/)
  assert.match(exchangeHome, /property="og:image" content="https:\/\/example\.test\/tools\/acx\/assets\/share-card\.png"/)
  assert.match(exchangeHome, /property="og:image:type" content="image\/png"/)
  assert.match(exchangeHome, /property="og:image:width" content="1200"/)
  assert.match(exchangeHome, /property="og:image:height" content="630"/)
  assert.match(exchangeHome, /name="twitter:image" content="https:\/\/example\.test\/tools\/acx\/assets\/share-card\.png"/)
  assert.match(exchangeHome, /name="twitter:image:alt"/)
  assert.match(exchangeHome, /href="\.\/assets\/app\.css\?v=20260719"/)
  assert.deepEqual(
    readFileSync(join(first, 'assets', 'share-card.png')).subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  )
  assert.match(exchangeHome, /rel="canonical" href="https:\/\/example\.test\/tools\/acx\/"/)
  assert.doesNotMatch(exchangeHome, /ACX_SITE_META/)
  const builtStudio = readFileSync(join(first, 'studio', 'index.html'), 'utf8')
  assert.match(builtStudio, /property="og:url" content="https:\/\/example\.test\/tools\/acx\/studio\/"/)
  assert.match(builtStudio, /property="og:image" content="https:\/\/example\.test\/tools\/acx\/assets\/share-card\.png"/)
  assert.match(builtStudio, /name="twitter:title"/)
  assert.match(builtStudio, /name="twitter:description"/)
  assert.match(builtStudio, /name="twitter:image"/)
  assert.match(builtStudio, /rel="canonical" href="https:\/\/example\.test\/tools\/acx\/studio\/"/)
  assert.doesNotMatch(builtStudio, /ACX_STUDIO_META/)

  const bundle = JSON.parse(readFileSync(
    join(first, ...buildA.index.templates[0].exchange.downloadPath.split('/')),
    'utf8',
  ))
  assert.equal(bundle.schemaVersion, 'acx.template-bundle/1')
  assert.ok(bundle.files.some((file) => file.path === 'manifest.json'))
  assert.ok(bundle.files.every((file) => file.digest.startsWith('sha256:')))

  const unresolvedAgent = buildA.index.cartridges.find((entry) => entry.id === 'ada-ridge')
  assert.equal(unresolvedAgent.level, null)
  const agentDetail = readFileSync(
    join(first, ...unresolvedAgent.exchange.detailPath.split('/'), 'index.html'),
    'utf8',
  )
  assert.doesNotMatch(agentDetail, /distinguished|Lv\.30/)
})

test('static build refuses traversal and symbolic-link registry artifacts', async () => {
  const traversalRegistry = join(tempDirectory('acx-static-traversal'), 'registry')
  cpSync(REGISTRY, traversalRegistry, { recursive: true })
  const traversalIndexPath = join(traversalRegistry, 'index.json')
  const traversalIndex = JSON.parse(readFileSync(traversalIndexPath, 'utf8'))
  traversalIndex.workflows[0].path = '../outside.cal.json'
  writeFileSync(traversalIndexPath, `${JSON.stringify(traversalIndex, null, 2)}\n`)
  await assert.rejects(
    buildStaticExchange({
      registryRoot: traversalRegistry,
      staticRoot: STATIC,
      outputRoot: join(tempDirectory('acx-static-traversal-out'), 'exchange'),
      quiet: true,
    }),
    /POSIX-relative|unsafe segment|outside its allowlist/,
  )

  const identityRegistry = join(tempDirectory('acx-static-identity'), 'registry')
  cpSync(REGISTRY, identityRegistry, { recursive: true })
  const identityIndexPath = join(identityRegistry, 'index.json')
  const identityIndex = JSON.parse(readFileSync(identityIndexPath, 'utf8'))
  identityIndex.workflows[0].publisher = 'io.github.attacker'
  writeFileSync(identityIndexPath, `${JSON.stringify(identityIndex, null, 2)}\n`)
  await assert.rejects(
    buildStaticExchange({
      registryRoot: identityRegistry,
      staticRoot: STATIC,
      outputRoot: join(tempDirectory('acx-static-identity-out'), 'exchange'),
      quiet: true,
    }),
    /path is not bound to publisher\/id\/version/,
  )

  const symlinkRegistry = join(tempDirectory('acx-static-symlink'), 'registry')
  cpSync(REGISTRY, symlinkRegistry, { recursive: true })
  const symlinkIndex = JSON.parse(readFileSync(join(symlinkRegistry, 'index.json'), 'utf8'))
  const workflowPath = symlinkIndex.workflows.find((entry) => entry.id === 'ship-a-feature').path
  const linkedPath = join(symlinkRegistry, ...workflowPath.split('/'))
  rmSync(linkedPath)
  symlinkSync(join(REGISTRY, ...workflowPath.split('/')), linkedPath)
  await assert.rejects(
    buildStaticExchange({
      registryRoot: symlinkRegistry,
      staticRoot: STATIC,
      outputRoot: join(tempDirectory('acx-static-symlink-out'), 'exchange'),
      quiet: true,
    }),
    /symbolic links are forbidden/,
  )
})

test('static build independently rejects a tampered indexed cartridge', async () => {
  const registry = join(tempDirectory('acx-static-tampered-agent'), 'registry')
  cpSync(REGISTRY, registry, { recursive: true })
  const index = JSON.parse(readFileSync(join(registry, 'index.json'), 'utf8'))
  const path = join(registry, ...index.cartridges[0].path.split('/'))
  const cartridge = Cartridge.open(path)
  cartridge.db.prepare(
    "UPDATE objects SET oid='sha256:deadbeef' WHERE oid=(SELECT oid FROM objects WHERE zone='rom' LIMIT 1)",
  ).run()
  cartridge.close()

  await assert.rejects(
    buildStaticExchange({
      registryRoot: registry,
      staticRoot: STATIC,
      outputRoot: join(tempDirectory('acx-static-tampered-agent-out'), 'exchange'),
      quiet: true,
    }),
    /cartridge trust verification failed/,
  )
})

test('static build CLI parser is strict', () => {
  assert.deepEqual(parseBuildArgs([
    '--out', './dist/custom',
    '--site-url', 'https://example.test/acx/',
    '--quiet',
  ]), {
    outputRoot: resolve('./dist/custom'),
    siteUrl: 'https://example.test/acx/',
    quiet: true,
  })
  assert.throws(() => parseBuildArgs(['--wat']), /unknown option/)
  assert.throws(() => parseBuildArgs(['--out']), /requires a value/)
})
