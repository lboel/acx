# How ACX evolves

ACX is a public draft with a deliberately small, auditable standards process. Normative behavior does
not appear by accident: a proposal identifies the interoperability problem, a focused pull request moves
the spec, schema, reference implementation, conformance tests, examples, and docs together, and a tagged
release records the accepted result.

## The short version

1. Editorial and implementation fixes use focused pull requests.
2. Additive or breaking wire changes start with the **ACX standard proposal** issue form.
3. Compatibility, migration, security, privacy, and rejected alternatives stay visible.
4. Required conformance and registry checks must pass before merge.
5. Accepted normative behavior enters `CHANGELOG.md` and a tagged release.
6. Signed registry artifacts remain immutable; changed bytes receive a new artifact SemVer.

Project `v0.1.0`, spec document `0.1`, container wire format `1.0`, schema majors such as `acx.cal/1`,
and publisher artifact versions are separate tracks. That separation lets the CLI receive a patch
without pretending the wire format changed, while every breaking contract still gets a visible major
identifier.

The `application/vnd.acx.*` names are provisional and currently unregistered. ACX uses them consistently
for draft interoperability; IANA registration or any migration is itself a public standards proposal.

Read the complete, authoritative policy in
[`GOVERNANCE.md`](https://github.com/lboel/acx/blob/main/GOVERNANCE.md), then use
[the proposal form](https://github.com/lboel/acx/issues/new?template=standard_proposal.yml) or
[open a pull request](https://github.com/lboel/acx/pulls).
