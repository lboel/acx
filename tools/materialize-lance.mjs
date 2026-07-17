// Materialize a REAL LanceDB dataset (acx.lance-memory/1) for a cartridge.
// Computes local-hash-128 vectors in JS (src/embed.mjs), writes a genuine Lance
// dataset via pylance, embeds it into the cartridge SAVE zone, and also leaves a
// standalone `<file>.memories.lance/` dataset on disk. Never touches the signed ROM.
//   node --experimental-sqlite tools/materialize-lance.mjs <file.acx> [--python <py>]
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync, readFileSync, rmSync, mkdtempSync, existsSync, mkdirSync, writeFileSync, cpSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { Cartridge } from '../src/container.mjs'
import { embedMemory, memoryText, ENGINE_ID, DIM } from '../src/embed.mjs'
import { REPO_ROOT } from '../src/paths.mjs'

function resolvePython(override) {
  const candidates = [override, process.env.ACX_PYTHON, join(REPO_ROOT, 'tools', 'lance', '.venv', 'bin', 'python')].filter(Boolean)
  for (const p of candidates) if (existsSync(p)) return p
  return null
}

function walk(dir, base = dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p, base))
    else out.push({ abs: p, rel: relative(base, p) })
  }
  return out
}

export function materializeLance(acxPath, { python, keepStandalone = true } = {}) {
  const py = resolvePython(python)
  if (!py) {
    throw new Error('No Lance Python found. Set up the optional tool:\n' +
      '  uv venv tools/lance/.venv --python 3.12\n' +
      '  uv pip install --python tools/lance/.venv pylance pyarrow numpy\n' +
      'or pass --python <path> / set ACX_PYTHON.')
  }
  const cart = Cartridge.open(acxPath)
  try {
    const engine = safeJson(cart.getMeta('acx.embedding_engine')) || { id: ENGINE_ID, dim: DIM }
    if (engine.id !== ENGINE_ID || engine.dim !== DIM) {
      throw new Error(`this materializer only supports ${ENGINE_ID}/${DIM}, cartridge declares ${engine.id}/${engine.dim}`)
    }
    // Build rows with the fixed columns + a reproducible vector.
    const rows = cart.db.prepare('SELECT payload FROM memory').all().map((r) => {
      const rec = JSON.parse(r.payload)
      return { ...rec, text: memoryText(rec), vector: embedMemory(rec) }
    })
    if (rows.length === 0) throw new Error('cartridge has no memory records to embed')

    // Write a genuine Lance dataset via pylance.
    const workdir = mkdtempSync(join(tmpdir(), 'acx-lance-'))
    const outDs = join(workdir, 'memories.lance')
    const res = spawnSync(py, [join(REPO_ROOT, 'tools', 'lance', 'materialize.py'), outDs], {
      input: JSON.stringify(rows), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    })
    if (res.status !== 0) { rmSync(workdir, { recursive: true, force: true }); throw new Error('pylance failed: ' + (res.stderr || res.stdout)) }
    const info = JSON.parse(res.stdout.trim().split('\n').pop())

    // Embed the dataset into the cartridge SAVE zone (never signed).
    cart.tx(() => {
      cart.db.prepare("DELETE FROM sqlar WHERE name GLOB 'save/vectors/memories.lance/*'").run()
      cart.db.prepare("DELETE FROM objects WHERE source_ref GLOB 'save/vectors/memories.lance/*'").run()
      for (const f of walk(outDs)) {
        cart.putFile(`save/vectors/memories.lance/${f.rel}`, readFileSync(f.abs))
      }
      cart.setMeta('acx.lance_present', 'true')
      cart.setMeta('acx.lance_path', 'save/vectors/memories.lance')
      cart.setMeta('acx.lance_rows', String(info.rows))
    })

    let standalone = null
    if (keepStandalone) {
      standalone = acxPath.replace(/\.acx$/, '') + '.memories.lance'
      rmSync(standalone, { recursive: true, force: true })
      cpSync(outDs, standalone, { recursive: true })
    }
    rmSync(workdir, { recursive: true, force: true })
    return { rows: info.rows, vectorType: info.vectorType, standalone, embedded: 'save/vectors/memories.lance', python: py }
  } finally {
    cart.close()
  }
}

function safeJson(s) { try { return JSON.parse(s) } catch { return null } }

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  const pyIdx = args.indexOf('--python')
  const python = pyIdx >= 0 ? args[pyIdx + 1] : undefined
  if (!file) { console.error('usage: materialize-lance.mjs <file.acx> [--python <py>]'); process.exit(2) }
  const r = materializeLance(file, { python })
  console.log(`materialized a real LanceDB dataset: ${r.rows} rows, ${r.vectorType}`)
  console.log(`  embedded in cartridge → ${r.embedded}  (SAVE zone, unsigned)`)
  if (r.standalone) console.log(`  standalone dataset    → ${r.standalone}`)
}
