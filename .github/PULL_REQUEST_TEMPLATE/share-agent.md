<!-- Use this template for one signed agent, workflow, or Agent Graph. Never include a private key. -->

## Artifact

- Type: agent / workflow / agent-graph
- Publisher:
- Stable id or slug:
- Version:
- ROM, workflow, or graph digest:
- New share or reviewed update:

## Why it is useful

<!-- In 2–4 sentences: who should reuse this agent/team and for which outcome? -->

## Verification

- [ ] Verification passed: `acx verify` + `acx spec` for an agent; `acx workflow verify` +
      `acx workflow lint --publish` for a workflow; or `acx graph verify` +
      `acx graph lint --publish` for an Agent Graph
- [ ] `node --experimental-sqlite tools/build-registry-index.mjs` regenerated the index
- [ ] `npm test` passed
- [ ] The diff contains only one logical registry artifact, its generated card, and `registry/index.json`
- [ ] No `*.key.pem`, private key, credential, `.env`, secret, or unrelated source change is included
- [ ] An Agent Graph contains references and routing metadata only; it embeds no private knowledge or
      secret-like metadata, digest-pins each ACX workflow loop, and grants no runtime permissions
- [ ] Licensing and publisher identity are accurate

## Reviewer notes

<!-- Namespace ownership, update rationale, compatibility, or migration notes. -->
