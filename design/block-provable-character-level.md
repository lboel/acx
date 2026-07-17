## Provable Character Level

An agent's level in an Agent Cartridge (`.acx`) is **never self-asserted**. It is a W3C Verifiable Credential 2.0 embedding an Open Badges 3.0 achievement, issued by an **independent verifier** only after re-executing the exact cartridge on a **held-out task slice it could not pre-see**, and it is content-addressed and revocable. This section is normative (RFC 2119).

### 1. The credential (`LevelCredential`)

The level attestation MUST be a Verifiable Credential with media type `application/vc`, secured by a Data Integrity proof. It MUST be distributed as an OCI **Referrers** artifact whose `subject` is the cartridge image manifest digest and whose `artifactType` is `application/vnd.acx.level-attestation.v1` (the cartridge itself is `application/vnd.acx.cartridge.v1`). The credential MUST bind to the exact **ROM-zone digest** via `credentialSubject.result[].acx:cartridgeRomDigest`, so a level cannot be transplanted onto a mutated cartridge.

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
    "https://acx.dev/ns/level/v1"
  ],
  "id": "urn:uuid:6f0c…",
  "type": ["VerifiableCredential", "OpenBadgeCredential"],
  "issuer": { "id": "did:web:verifier.acx.dev", "type": ["Profile"] },
  "validFrom": "2026-07-16T09:00:00Z",
  "validUntil": "2027-07-16T09:00:00Z",
  "name": "ACX Character Level — senior",
  "credentialSubject": {
    "id": "did:web:acme.example:agents:dagster-wrangler",
    "type": ["AchievementSubject"],
    "achievement": {
      "id": "https://acx.dev/achievements/level",
      "type": ["Achievement"],
      "name": "ACX Character Level",
      "description": "Level earned by independent re-execution on a held-out benchmark slice.",
      "criteria": {
        "narrative": "Awarded when an independent verifier re-runs the pinned cartridge ROM on the sealed held-out slice of benchmark acx-bench-swe:2026.2 (post-cutoff, time-sliced), and the TrueSkill posterior satisfies sigma < 1.5 over >= 30 games with conservative rating (mu - 3*sigma) mapped to an AGENTIBUS level."
      },
      "resultDescription": [
        { "id": "urn:uuid:rd-tier", "type": ["ResultDescription"], "name": "Career tier",
          "resultType": "RubricCriterionLevel",
          "rubricCriterionLevel": [
            {"id":"https://acx.dev/levels/intern","type":["RubricCriterionLevel"],"name":"intern","level":"1"},
            {"id":"https://acx.dev/levels/senior","type":["RubricCriterionLevel"],"name":"senior","level":"15"},
            {"id":"https://acx.dev/levels/legend","type":["RubricCriterionLevel"],"name":"legend","level":"35"}
          ] },
        { "id": "urn:uuid:rd-rating", "type": ["ResultDescription"],
          "name": "TrueSkill conservative rating (mu-3sigma)",
          "resultType": "ScaledScore", "valueMin": "0", "valueMax": "50" },
        { "id": "urn:uuid:rd-pass", "type": ["ResultDescription"],
          "name": "Held-out pass@1", "resultType": "Percent", "valueMin": "0", "valueMax": "100" }
      ]
    },
    "result": [
      { "type": ["Result"], "resultDescription": "urn:uuid:rd-tier",
        "achievedLevel": "https://acx.dev/levels/senior" },
      { "type": ["Result"], "resultDescription": "urn:uuid:rd-rating", "value": "31.4",
        "acx:ratingMu": "37.9", "acx:ratingSigma": "2.17", "acx:gamesPlayed": 41,
        "acx:acxLevel": 17, "acx:careerTier": "senior",
        "acx:cartridgeRomDigest": "sha256:9c1e…",
        "acx:benchmarkId": "acx-bench-swe", "acx:benchmarkVersion": "2026.2",
        "acx:benchmarkDigest": "sha256:aa02…", "acx:heldOutSliceDigest": "sha256:be7f…" },
      { "type": ["Result"], "resultDescription": "urn:uuid:rd-pass", "value": "83" }
    ]
  },
  "evidence": [
    { "id": "https://evidence.acx.dev/traj/0e9a…",
      "type": ["Evidence", "acx:AcxTrajectoryEvidence"],
      "name": "Held-out run #17 signed trajectory",
      "acx:digestMultibase": "uEiA0…",
      "acx:dsseEnvelope": "https://evidence.acx.dev/traj/0e9a…/dsse.json" }
  ],
  "credentialStatus": {
    "id": "https://verifier.acx.dev/status/3#94212",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "94212",
    "statusListCredential": "https://verifier.acx.dev/status/3"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-rdfc-2022",
    "created": "2026-07-16T09:00:03Z",
    "verificationMethod": "did:web:verifier.acx.dev#key-1",
    "proofPurpose": "assertionMethod",
    "proofValue": "z3FXQ…"
  }
}
```

`proof.cryptosuite` MUST be `eddsa-rdfc-2022` (RDF canonicalization) or `eddsa-jcs-2022`; `proofValue` MUST be multibase `base58-btc` (`z` prefix). Verifiers MUST reject a credential whose `issuer.id` equals the `credentialSubject.id` controller, or whose `issuer` is not present in the ACX public-key trust registry.

### 2. Issuance protocol (unfakeable)

1. **Benchmark = bundled, versioned task-suite** (`acx-bench-*`, its own `.acx` with `artifactType application/vnd.acx.benchmark.v1`). It has a **public slice** and a **sealed held-out slice** — encrypted at rest, `acx:heldOutSliceDigest` published, plaintext keyed to the verifier enclave only. Tasks in the held-out slice MUST be **time-sliced post-model-cutoff** (SWE-bench "verified" pattern) so training-set contamination is structurally impossible. Every task pins graded artifacts by full SHA-256.
2. **Independent verifier** (an accredited `did:web` distinct from the subject's controller) MUST re-run the pinned cartridge ROM in a sandbox on a randomly drawn held-out subset. Each run's full trajectory is captured, content-addressed (sha256 multihash → `acx:digestMultibase`), signed as a **DSSE/in-toto** envelope, and its URL placed in `evidence[]`.
3. **TrueSkill/Elo gating.** The verifier maintains a Bayesian skill posterior `N(mu, sigma^2)`. A credential MUST NOT issue unless `sigma < sigma_max` (default `1.5`) AND `gamesPlayed >= N_min` (default `30`). The conservative rating `R = mu - 3*sigma` is what maps to level — **one lucky run cannot level up** because a single win barely moves `mu` while `sigma` stays high, failing the gate.
4. **Level → careerTier** reuses AGENTIBUS verbatim: `acxLevel = levelFromXp`-equivalent bucketing of `R`, then `careerTierForLevel` (`intern <5, junior >=5, mid >=10, senior >=15, staff >=20, principal >=25, distinguished >=30, legend >=35`). `credentialSubject.result[].acx:careerTier` MUST be one of the 8 `CareerTier` enum values.

### 3. Anti-gaming (all MUST)

- Held-out slice is never revealed; only its digest is public. Re-derivation attempts are detectable by digest.
- Post-cutoff time-slicing prevents memorization.
- Subject binds to `cartridgeRomDigest`; editing the SAVE zone or ROM invalidates the level.
- σ-shrink + `N_min` gate defeats variance farming; a per-cartridge-digest **cooldown** and logging of *failed* attempts defeats resubmission-until-lucky.
- Self-issuance is rejected (issuer ≠ subject; issuer ∈ trust registry).
- On discovered contamination or benchmark defect, the verifier flips the `BitstringStatusListEntry` bit (`statusPurpose: revocation`), instantly invalidating the level without recall.

### 4. Minimal prover

A conformant prover: (a) fetches `acx-bench` + sealed slice, (b) runs the ROM producing signed trajectories, (c) updates `mu/sigma`, (d) if the gate passes, emits the `LevelCredential` above and signs it with `eddsa-rdfc-2022`, (e) publishes it as an OCI referrer to the cartridge and appends the evidence digests to the cartridge `signatures` table.