# ACX governance

ACX is developed in public as an Apache-2.0 licensed specification, schema set, reference implementation,
and git-reviewed exchange. This document defines how the public draft evolves and how decisions become
part of a release.

## Maturity and scope

ACX `0.x` releases are **public drafts**. They are usable and conformance-tested, but they are not a
promise that every interface is permanently frozen. Maintainers still treat compatibility as a design
requirement: breaking changes need an explicit migration, a new version identifier, and release notes.

Governance covers:

- the normative `SPEC.md` and schemas;
- the zero-dependency reference implementation and conformance tests;
- the static Exchange and Studio;
- registry policy, lifecycle records, and immutable shared artifacts;
- project documentation, security policy, and release metadata.

It does not grant authority over an artifact publisher's keys, agents, deployments, data, or runtime.

## Roles

- **Contributors** propose issues, artifacts, tests, documentation, or pull requests.
- **Editors** keep the specification, schemas, terminology, and compatibility story coherent.
- **Maintainers** review and merge changes, operate releases, handle security reports, and enforce registry
  policy. Current ownership is recorded in [`.github/CODEOWNERS`](./.github/CODEOWNERS); `@lboel` is the
  initial editor and maintainer.

Roles are earned through sustained, constructive contribution. A maintainer change is made in a focused
pull request updating this document and `CODEOWNERS`, so authority remains visible in git history.

## Change classes

1. **Editorial** — wording, examples, accessibility, or corrections that do not change conformant
   behavior. A focused pull request is sufficient.
2. **Implementation** — reference CLI, Exchange, tooling, or test behavior that does not change the
   normative wire contract. It requires tests and documentation where users observe the change.
3. **Additive normative** — an optional field, capability, media profile, or rule that preserves existing
   valid artifacts. It starts with an ACX standard proposal and must update the spec, schema, code, tests,
   and compatibility notes together.
4. **Breaking normative** — a change that can invalidate, reinterpret, or weaken verification of an
   existing artifact. It requires a standard proposal, an explicit migration, a new affected major
   schema/wire identifier, and prominent release notes.
5. **Registry publication** — a new signed artifact version under an immutable coordinate. It follows the
   registry PR contract; lifecycle changes are separate exact-digest proposals.

Security fixes may be developed privately and merged on an expedited path. Their compatibility and
decision record are published as soon as disclosure is safe.

## Proposal and decision process

For additive or breaking normative changes:

1. Open the **ACX standard proposal** issue form. State the problem, affected sections/schemas,
   interoperability impact, security/privacy impact, alternatives, and migration.
2. Discuss the smallest interoperable contract. Unresolved material objections and alternatives remain
   visible in the issue.
3. Open a focused pull request linking the proposal. Normative text, schemas, reference behavior,
   conformance tests, examples, and docs move together.
4. Required CI and review gates pass. The maintainer records **accepted**, **rejected**, or **deferred**
   with a short rationale in the issue or pull request.
5. Accepted behavior enters the next changelog and tagged release. A merge before a tag means “accepted
   for the next release,” not “silently standardized.”

ACX currently uses maintainer rough consensus rather than a formal vote. When maintainers disagree, the
change remains deferred; security and interoperability evidence outweigh preference. Anyone may request
reconsideration with new evidence in the original proposal.

## Version tracks

ACX has intentionally separate version axes:

| Track | Example | Meaning |
| --- | --- | --- |
| Project/CLI release | `v0.1.0` | SemVer snapshot of the repository, npm package, docs, and tools |
| Specification document | `0.1` | Public-draft document revision printed by `acx --version` |
| Container wire header | `1.0` | `PRAGMA user_version` major/minor understood by a cartridge reader |
| Schema identifier | `acx.cal/1` | Major contract for one JSON artifact family |
| Shared artifact | `publisher/id@1.2.0` | Publisher-controlled SemVer at an immutable registry coordinate |

A project patch can fix code or prose without changing a wire identifier. An additive schema change may
retain its major identifier only when old valid documents keep their meaning and validators have a safe
compatibility rule. Breaking interpretation requires a new affected major identifier. The first
container generation being `1.0` does not change the project's `0.x` public-draft maturity.

The `application/vnd.acx.*` media names are provisional vendor-tree names and are not currently registered
with IANA. Implementations use the exact draft names for interoperability; registration or any migration
is a standard proposal and release-note item, never an implied status claim.

## Registry decisions

The signed-artifact identity is
`(artifactType, publisherId, id, version, digest)`. Once merged, those bytes are append-only and cannot be
replaced, renamed, or deleted. A publisher releases changed bytes at a new SemVer. Deprecation, revocation,
and supersession are projections in `registry/status.json` bound to the exact digest; history remains
available.

Cryptographic validity does not prove namespace ownership, usefulness, safety to execute, or permission
to act. CI verifies mechanical invariants. Human review separately considers publisher evidence,
licensing, privacy, usefulness, and the absence of embedded private knowledge.

## Releases

A maintainer may tag a release only from protected `main` after:

- all required PR checks pass;
- `npm test`, smoke proofs, deterministic registry/Exchange builds, packed-tarball installation, and docs
  build pass;
- `CHANGELOG.md`, package metadata, citation metadata, and version output agree;
- public links and the static sharing loop are checked;
- known limitations and provisional registrations are stated.

Tags use `vMAJOR.MINOR.PATCH`. A GitHub Release points to the exact tag and summarizes compatibility,
security, verification commands, and known limitations. Publishing to npm is a separate, explicitly
authorized operation and must use the already-tested tarball contents.

## Licensing and contributions

Repository contents are provided under Apache-2.0 unless a file states otherwise. By contributing, you
confirm that you have the right to submit the contribution and agree to license it under the repository's
Apache-2.0 terms. References to external standards remain subject to their respective terms. ACX does not
claim that third-party standards, implementations, names, or patents are unencumbered.

Changes to this governance document use the same public proposal and pull-request process.
