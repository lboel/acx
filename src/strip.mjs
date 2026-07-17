// strip-to-ROM re-export (SPEC §3.4). Proves field learning never mutated ROM:
// the recomputed manifest hash MUST equal the original signed hash.
import { buildRomManifest } from './sign.mjs'

export function stripToRom(cartridge) {
  const before = cartridge.getMeta('acx.rom_manifest_hash')
  cartridge.db.exec(`
    DELETE FROM memory  WHERE zone='save';
    DELETE FROM sqlar   WHERE name GLOB 'save/*';
    DELETE FROM vectors WHERE zone='save';
    DELETE FROM objects WHERE zone='save';
  `)
  cartridge.db.prepare("DELETE FROM cartridge WHERE key='acx.save_codebase_fingerprint'").run()
  cartridge.db.exec('VACUUM')
  const after = buildRomManifest(cartridge).manifestHash
  return { before, after, equal: before === after }
}
