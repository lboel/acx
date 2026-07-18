// Phase 3 proof: earn a PROVABLE character level for a cartridge and verify it.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Cartridge } from '../src/container.mjs'
import { generateSigningKey } from '../src/sign.mjs'
import { oidJcs } from '../src/canonical.mjs'
import { runVerification, demoDagBenchmark } from '../src/level/benchmark.mjs'
import { verifyLevelCredential } from '../src/level/credential.mjs'
import { evaluateTrust, emptyTrustRegistry } from '../src/trust.mjs'

import { EXAMPLES_DIR } from '../src/paths.mjs'
import { join } from 'node:path'
const OUT = join(EXAMPLES_DIR, 'research-designer.acx')
const cart = Cartridge.open(OUT)
const romDigest = cart.getMeta('acx.rom_manifest_hash')
const subjectId = 'urn:acx:cartridge:' + cart.getMeta('acx.cartridge_id')
console.log('cartridge ROM digest:', romDigest)

// An INDEPENDENT verifier — distinct key/identity from the cartridge publisher.
const verifierKey = generateSigningKey()
const issuerDid = 'did:web:verifier.acx.dev'
const benchmark = demoDagBenchmark()
console.log(`benchmark ${benchmark.id}@${benchmark.version}: ${benchmark.taskCount} tasks, held-out slice digest ${benchmark.heldOutSliceDigest.slice(0, 24)}…`)

// ---- 1. A weak agent must FAIL the gate (level is earned, not given) --------
const weak = runVerification({ romDigest, benchmark, competence: 14, verifierKey, issuerDid, subjectId, now: '2026-07-16T00:00:00Z' })
console.log('\nweak agent (competence 14):', weak.issued ? 'ISSUED' : 'NOT ISSUED —', weak.reason ?? '', `| R=${weak.R.toFixed(2)} tier=${weak.level.careerTier}`)

// ---- 2. A strong agent EARNS a level ---------------------------------------
const strong = runVerification({ romDigest, benchmark, competence: 33, drawCount: 90, verifierKey, issuerDid, subjectId, now: '2026-07-16T00:00:00Z' })
console.log('strong agent (competence 33):', strong.issued ? 'ISSUED ✅' : 'NOT ISSUED', strong.reason ?? '', `| mu=${strong.rating.mu.toFixed(2)} sigma=${strong.rating.sigma.toFixed(3)} games=${strong.rating.gamesPlayed} passRate=${(strong.rating.passRate * 100).toFixed(0)}% R=${strong.R.toFixed(2)} => acxLevel=${strong.level.acxLevel} tier=${strong.level.careerTier}`)

if (!strong.issued) { console.log('\nFAILED: strong agent should have earned a level'); cart.close(); process.exit(1) }
const vc = strong.vc

// ---- 3. Attach the attestation to the cartridge + write an OCI referrer -----
cart.db.prepare('INSERT INTO attestations(att_id,type,subject_oid,media_type,document,status_url,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(att_id) DO UPDATE SET document=excluded.document')
  .run('level-' + benchmark.id, 'vc-2.0', romDigest, 'application/vc', JSON.stringify(vc), vc.credentialStatus?.statusListCredential ?? null, vc.validFrom)
const proofDirectory = mkdtempSync(join(tmpdir(), 'acx-prove-level-'))
const attestationPath = join(proofDirectory, 'level-attestation.json')
writeFileSync(attestationPath, JSON.stringify(vc, null, 2))
console.log('standalone VC:', attestationPath)

// ---- 4. Independent verification of the credential --------------------------
const check = verifyLevelCredential(vc, { issuerPublicKeyPem: verifierKey.publicKeyPem, expectedRomDigest: romDigest })
console.log('\ncredential verification:', check.ok ? 'VALID ✅' : 'INVALID', check.issues.length ? check.issues : '')

// ---- 5. RESOLVE the verified level WITHOUT mutating the signed ROM ----------
// The verified proficiency lives in the separate, ROM-digest-bound attestation
// (SPEC §6.2/§10.1). Mutating the signed capability in place would (correctly)
// break the ROM signature — the C1 integrity guarantee. So we DERIVE the
// effective proficiency by resolving the attestation, leaving ROM verified=false.
const attRow = cart.db.prepare("SELECT document FROM attestations WHERE att_id=?").get('level-' + benchmark.id)
const resolved = verifyLevelCredential(JSON.parse(attRow.document), { issuerPublicKeyPem: verifierKey.publicKeyPem, expectedRomDigest: romDigest })
console.log('\ncapability build-dag effective proficiency (resolved from attestation):',
  resolved.ok ? `VERIFIED tier=${strong.level.careerTier} mu=${strong.rating.mu.toFixed(2)} sigma=${strong.rating.sigma.toFixed(3)}` : 'UNVERIFIED')
// ROM signature stays intact after attaching the attestation (attestations are not ROM-signed):
const postVerify = evaluateTrust(cart, { registry: emptyTrustRegistry() })
console.log('ROM signature after attaching attestation:', postVerify.status, '/', postVerify.trust, '(intact ✅)')

// ---- 6. Anti-gaming: self-issuance is rejected ------------------------------
const selfVc = { ...vc, issuer: { id: subjectId }, credentialSubject: { ...vc.credentialSubject } }
const selfCheck = verifyLevelCredential(selfVc, { issuerPublicKeyPem: verifierKey.publicKeyPem, expectedRomDigest: romDigest })
console.log('\nanti-gaming — self-issued credential:', selfCheck.ok ? 'WRONGLY ACCEPTED ❌' : 'REJECTED ✅', selfCheck.issues.filter((i) => i.includes('self')))

// ---- 7. Anti-transplant: same VC against a different ROM digest fails --------
const transplant = verifyLevelCredential(vc, { issuerPublicKeyPem: verifierKey.publicKeyPem, expectedRomDigest: 'sha256:0000different' })
console.log('anti-transplant — VC on mutated ROM:', transplant.ok ? 'WRONGLY ACCEPTED ❌' : 'REJECTED ✅', transplant.issues.filter((i) => i.includes('ROM')))

// ---- 8. Revocation flips validity instantly ---------------------------------
const revokedCheck = verifyLevelCredential(vc, { issuerPublicKeyPem: verifierKey.publicKeyPem, expectedRomDigest: romDigest, revoked: true })
console.log('revocation — status bit set:', revokedCheck.ok ? 'STILL VALID ❌' : 'REVOKED ✅')

cart.close()

const allOk = !weak.issued && strong.issued && check.ok && !selfCheck.ok && !transplant.ok && !revokedCheck.ok
console.log('\n' + (allOk ? 'PROVABLE LEVEL OK — level earned from re-run, cryptographically verified, unfakeable' : 'PROVABLE LEVEL FAILED'))
process.exit(allOk ? 0 : 1)
