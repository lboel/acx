<!-- Use this template for one signed agent, workflow, or Agent Graph. Never include a private key. -->

## Artifact

- Type: agent / workflow / agent-graph
- Publisher:
- Stable id or slug:
- Version:
- ROM, workflow, or graph digest:
- Canonical registry path:
- New share or new immutable version:
- Remix lineage (parent publisher/id/version/digest/relation), if applicable:
- Expected post-merge Exchange URL:

## Why it is useful

<!-- In 2–4 sentences: who should reuse this agent/team and for which outcome? -->

## Verification

- [ ] Verification passed: `acx verify` + `acx spec` for an agent; `acx workflow verify` +
      `acx workflow lint --publish` for a workflow; or `acx graph verify` +
      `acx graph lint --publish` for an Agent Graph
- [ ] `npm run build:registry` regenerated the index
- [ ] `npm run build:exchange -- --site-url https://acx.dev/exchange/` built the static Exchange
- [ ] `npm test` passed
- [ ] The diff contains only one logical registry artifact, its generated card, and `registry/index.json`
- [ ] The agent, workflow, or Agent Graph uses its immutable publisher/id/version path; no existing
      artifact was modified, deleted, renamed, or replaced
- [ ] The agent cartridge contains ROM only; SAVE memory, files, objects, and vectors are empty
- [ ] No `*.key.pem`, private key, credential, `.env`, SAVE state, secret, build output, or unrelated source
      change is included
- [ ] A remix carries signed lineage to the exact parent digest, or this is not a remix
- [ ] An Agent Graph contains references and routing metadata only; it embeds no private knowledge or
      secret-like metadata, pins every workflow dependency by publisher/id/version/digest, and grants no
      runtime permissions
- [ ] Every Agent Graph workflow dependency resolves in the generated registry index
- [ ] Trust copy keeps a portable signature separate from namespace trust and labels unresolved level or
      capability evidence as claims
- [ ] `registry/status.json` was reviewed; lifecycle changes, if any, are in a separate exact-digest PR
- [ ] Licensing and publisher identity are accurate

## Reviewer notes

<!-- Namespace ownership, update rationale, compatibility, or migration notes. -->
