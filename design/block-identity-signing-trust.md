## Identity, Signing & Trust

### 1. Signing core (reused, wrapped)

The AGENTIBUS hash-of-hashes discipline is retained verbatim as the **integrity core**: a self-excluding `checksum.sha256` in canonical `sha256sum` format (`<hex>␠␠<relpath>`, `localeCompare`-sorted), then `manifestHash` and `checksumHash`, then one `packageHash = sha256(JSON.stringify({packageSlug, manifestHash, checksumHash, files[]}))`. For an `.acx` file the integrity manifest MUST address **ROM-zone objects only** (the `sqlar`/`vec0` rows of the immutable core); the SAVE zone MUST be excluded so that field learning does not invalidate the signature. Implementations MUST NOT sign raw container bytes — the SQLite change-counter (offset 24), freelist, and `VACUUM` mutate them. `packageHash` is the single content-addressed digest that gets signed.

Ed25519 stays the default algorithm, but the raw `signature.json` is replaced by a **DSSE envelope** (`application/vnd.dsse.envelope.v1+json`) whose payload is an **in-toto Statement v1**. The signing input is the DSSE Pre-Authentication Encoding, verbatim:

```
PAE = "DSSEv1" SP LEN(payloadType) SP payloadType SP LEN(payload) SP payload
```

where `payload` is the raw (pre-base64) Statement bytes. The signer computes `sig = Ed25519(privkey, PAE)`.

### 2. DSSE + in-toto envelope

The envelope MUST be exactly:

```json
{
  "payloadType": "application/vnd.in-toto+json",
  "payload": "<base64(canonical-json(Statement))>",
  "signatures": [
    { "keyid": "ed25519:af3c…", "sig": "<base64(Ed25519-sig-over-PAE)>" }
  ]
}
```

- `payloadType` MUST be the in-toto constant `application/vnd.in-toto+json`.
- `payload` MUST be standard-or-URL-safe base64 of the canonical Statement JSON; verifiers MUST accept either base64 variant.
- `keyid` MUST be `"ed25519:" + lowercasehex(sha256(DER SubjectPublicKeyInfo))` — deterministic, algorithm-tagged, and directly lookupable in the trust registry. It is a hint only; verification MUST NOT depend on it beyond registry lookup.
- `sig` is base64 of the 64-byte Ed25519 signature over the PAE.

The decoded Statement:

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [
    { "name": "acx:agent-package-scenario-research-designer-v4.1",
      "digest": { "sha256": "92041afe2446a0d0…b7b06d1" } }
  ],
  "predicateType": "https://acx.dev/attestation/cartridge/v1",
  "predicate": {
    "acxSchemaVersion": "1.0",
    "publisherId": "com.example.teamx",
    "romDigest": "sha256:92041afe…",
    "manifestHash": "864c1707…",
    "checksumHash": "c0e7a445…",
    "fileCount": 17,
    "embeddingEngine": "local-hash-128",
    "signedAt": "2026-04-03T13:35:46Z",
    "provenanceInstanceId": "agentibus-macbookpro-fritz-box-a2fc10"
  }
}
```

- `subject[0].digest.sha256` MUST equal the ROM-zone `packageHash`. Subjects are matched purely by digest.
- `predicateType` MUST be the versioned cartridge URI `https://acx.dev/attestation/cartridge/v1`.
- `provenanceInstanceId` is retained ONLY as informational provenance; it MUST NOT participate in trust decisions (see §3).

### 3. Portable publisher identity

Trust binds to `publisherId` + `keyid`, never to the hostname-derived `instanceId`. `publisherId` MUST be a reverse-DNS label (`com.example.teamx`, `io.github.alice`). Ownership of the namespace MUST be proven by one of:

- **DNS-TXT challenge** (`com.*`, `org.*`, `net.*`): the publisher signs a registry challenge with the cartridge key and publishes the public key at TXT record `_acx-challenge.<domain>`; the registrar verifies the signature against the TXT-published key. Grants `com.<domain>/*`.
- **GitHub OIDC** (`io.github.*`): a GitHub Actions OIDC id-token (`id-token: write`) binds `io.github.<user>/*` or `io.github.<org>/*` to the workflow subject, with no interactive step.

A verified `publisherId` supersedes `originInstanceId`/`signerInstanceId`/`signerInstanceLabel`, which become non-authoritative provenance strings. Reserved-name blocking and full-SHA pinning of evaluated work apply.

### 4. Standalone trust registry (public keys ONLY)

This fixes the git-tracked-plaintext-private-key defect: private key material MUST NEVER appear in a cartridge, a `signature.json`, or the registry, and MUST NEVER be git-tracked. The registry is a separate artifact — published at `https://<domain>/.well-known/acx-trust-registry.json` or as OCI `application/vnd.acx.trust-registry.v1` — containing public keys only. Each entry carries `keyid`, `publisherId`, `algorithm`, `publicKeyPem` (SPKI), `status` (`active`|`revoked`|`expired`), `notBefore`/`notAfter` (RFC 3339), `namespaceProof`, optional `rotatedFrom`/`rotatedTo`, and `revokedAt`/`revocationReason`.

- **Rotation**: a successor entry sets `rotatedFrom`=<old keyid>; the predecessor overlaps until its `notAfter`. Cartridges whose `signedAt` falls within the predecessor's validity remain trusted after rotation.
- **Expiry**: `now > notAfter` ⇒ `status=expired`; verification MUST NOT return `trusted`.
- **Revocation**: `revocationReason == "key-compromise"` ⇒ never `trusted`, regardless of `signedAt`. For any other reason, a cartridge with `signedAt < revokedAt` MAY remain `trusted`; otherwise it downgrades to `portable` with a revocation warning.

### 5. Trust taxonomy — DSSE mapping

The taxonomy `local / trusted / portable / legacy / tampered` is preserved verbatim; `AgentPackageVerification` remains the return type. Evaluation order:

1. **tampered** — DSSE signature fails PAE verification, OR any recomputed ROM object digest ≠ its recorded `checksum.sha256` entry, OR `subject.digest.sha256 ≠ packageHash`. Reject.
2. **legacy** — no DSSE envelope; a bare pre-standard `signature.json` verifies against its embedded `publicKeyPem`. Importable at `trust=legacy` with warning.
3. **portable** — DSSE verifies, but `keyid` absent from the registry, or `namespaceProof` unverified, or key revoked/expired under the §4 downgrade rules. Importable with warning (graceful degradation preserved).
4. **trusted** — DSSE verifies AND `keyid` is `active` in the registry AND `publisherId` namespace-proof is valid AND not expired/revoked.
5. **local** — as `trusted`, and `keyid` equals the verifying instance's own key (self-authored).

### 6. Stock cosign / oras verification via OCI Referrers

The `.acx` is pushed as an OCI image manifest, `artifactType: application/vnd.acx.cartridge.v1`, one layer = the `.acx` blob, config = the empty descriptor `application/vnd.oci.empty.v1+json` (`sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`, size 2). The DSSE envelope is attached as a **referrer**: a second image manifest whose `subject` = the cartridge manifest descriptor and whose single layer has `mediaType: application/vnd.dsse.envelope.v1+json`. Because this is stock DSSE + in-toto + OCI Referrers, no ACX-specific tooling is required:

```
# discover the attestation (Referrers API / fallback tag sha256-<hex>)
oras discover --artifact-type application/vnd.dsse.envelope.v1+json \
  registry.example.com/acx/scenario-research-designer:v4.1

# attach & verify with stock cosign (keyless or key-based)
cosign attest --predicate predicate.json \
  --type https://acx.dev/attestation/cartridge/v1 --key cosign.key <ref>
cosign verify-attestation \
  --type https://acx.dev/attestation/cartridge/v1 --key cosign.pub <ref>
```

Harness/Gitness stores this today with zero code change (`dbPutManifestV2` accepts arbitrary `artifactType`/config/layers).