// Shared test helpers. NOT a test file (no `.test.` in the name) so the
// node:test runner ignores it; imported by the *.test.mjs suites.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cartridge } from '../src/container.mjs'
import { generateSigningKey } from '../src/sign.mjs'
import { putCapability, bindRomMeta, finalizeAndSign } from '../src/assemble.mjs'
import { buildCapability } from '../src/builders.mjs'

const _tmpDirs = []

/** Fresh temp .acx path; the containing dir is tracked for cleanup(). */
export function tmpAcxPath(name = 'c.acx') {
  const dir = mkdtempSync(join(tmpdir(), 'acx-test-'))
  _tmpDirs.push(dir)
  return join(dir, name)
}

/** Remove every temp dir created via tmpAcxPath(). Call from test teardown. */
export function cleanup() {
  for (const d of _tmpDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

const SKILL_MD = `---
name: demo-skill
description: A demo skill used by the conformance suite. Use when exercising the sqlar skill layer.
license: Apache-2.0
metadata:
  version: 1.0.0
---

# Demo skill

Portable expertise for the conformance test.
`

/**
 * Build a minimal, fully-signed ROM cartridge on disk.
 * Returns { cart, key, path, publisherId }. Caller must cart.close().
 */
export function buildSignedCartridge({ publisherId = 'io.github.acxtest', signedAt = '2026-01-01T00:00:00.000Z', key = generateSigningKey() } = {}) {
  const path = tmpAcxPath()
  const cart = Cartridge.create(path)
  cart.tx(() => {
    cart.setMeta('acx.spec_version', '0.1')
    cart.setMeta('acx.cartridge_id', `${publisherId}/demo@fixed-id`)
    cart.setMeta('acx.created_at', signedAt)
    cart.setMeta('acx.embedding_engine', JSON.stringify({ id: 'local-hash-128', dim: 128 }))
    cart.setMeta('acx.publisher_id', publisherId)
    cart.setMeta('acx.agent_name', 'Demo Agent')
    cart.setMeta('acx.role', 'backend_dev')
    cart.putFile('rom/skills/demo-skill/SKILL.md', Buffer.from(SKILL_MD, 'utf8'))
    cart.putFile('rom/knowledge/IDENTITY.md', Buffer.from('# Demo\n', 'utf8'))
    putCapability(cart, buildCapability({ taskType: 'implement-feature', stack: ['typescript'], domain: 'backend', lastDemonstratedAt: signedAt }))
    bindRomMeta(cart, ['acx.spec_version', 'acx.cartridge_id', 'acx.created_at', 'acx.embedding_engine', 'acx.publisher_id', 'acx.agent_name', 'acx.role'])
    finalizeAndSign(cart, key, { publisherId, embeddingEngine: { id: 'local-hash-128', dim: 128 }, signedAt })
  })
  return { cart, key, path, publisherId }
}

/** A trust registry entry object for a signer key that is fully valid & namespace-proven. */
export function trustedRegistry(key, publisherId = 'io.github.acxtest') {
  const byKeyId = new Map()
  const githubOwner = publisherId.match(/^io\.github\.([a-z0-9-]+)/)?.[1] ?? null
  const namespaceProof = githubOwner
    ? {
        method: 'github-oidc',
        oidcSubject: `repo:${githubOwner}/acx:ref:refs/heads/main`,
        oidcIssuer: 'https://token.actions.githubusercontent.com',
        verifiedAt: '2026-01-01T00:00:00Z',
      }
    : {
        method: 'dns-txt',
        txtRecord: `_acx-challenge.${publisherId.split('/')[0].split('.').reverse().join('.')}`,
        verifiedAt: '2026-01-01T00:00:00Z',
      }
  byKeyId.set(key.keyid, {
    keyid: key.keyid, publisherId, algorithm: 'ed25519',
    publicKeyPem: key.publicKeyPem, status: 'active',
    namespaceProof,
    notBefore: '2020-01-01T00:00:00Z', notAfter: '2030-01-01T00:00:00Z',
  })
  return { raw: { schemaVersion: 'acx.trust-registry/1', keys: [...byKeyId.values()] }, byKeyId }
}

export { SKILL_MD }
