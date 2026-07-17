// acx.embed/local-hash-128/1 — a deterministic, dependency-free embedding.
// 128-dim signed-hash bag-of-tokens over SHA-1. Byte-reproducible across runs and
// languages, so a LanceDB `vector` column can be materialized identically. Vectors
// are re-indexable on import (SPEC §7.6), so semantic quality is not the point —
// portability and reproducibility are.
import { createHash } from 'node:crypto'

export const ENGINE_ID = 'local-hash-128'
export const DIM = 128

function tokenize(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9]+/g) || []
}

/** Embed a text into a 128-dim L2-normalized Float array. */
export function embed(text) {
  const vec = new Array(DIM).fill(0)
  for (const tok of tokenize(text)) {
    const h = createHash('sha1').update(tok).digest() // 20 bytes
    const idx = h.readUInt32BE(0) % DIM
    vec[idx] += (h[4] & 1) ? 1 : -1
  }
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm)
  if (norm > 0) for (let i = 0; i < DIM; i++) vec[i] = vec[i] / norm
  return vec
}

/** The document text a memory record embeds: title + "\n\n" + summary (SPEC §7.7). */
export function memoryText(rec) {
  return `${rec.title || ''}\n\n${rec.summary || ''}`
}

export function embedMemory(rec) {
  return embed(memoryText(rec))
}
