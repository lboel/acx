<!-- Use this template for one signed agent or workflow. Never include a private key. -->

## Artifact

- Type: agent / workflow
- Publisher:
- Stable id or slug:
- Version:
- ROM or workflow digest:
- New share or reviewed update:

## Why it is useful

<!-- In 2–4 sentences: who should reuse this agent/team and for which outcome? -->

## Verification

- [ ] `acx verify` + `acx spec` passed for an agent, or `acx workflow verify` +
      `acx workflow lint --publish` passed for a workflow
- [ ] `node --experimental-sqlite tools/build-registry-index.mjs` regenerated the index
- [ ] `npm test` passed
- [ ] The diff contains only one logical registry artifact, its generated card, and `registry/index.json`
- [ ] No `*.key.pem`, private key, credential, `.env`, secret, or unrelated source change is included
- [ ] Licensing and publisher identity are accurate

## Reviewer notes

<!-- Namespace ownership, update rationale, compatibility, or migration notes. -->
