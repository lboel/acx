# Security Policy

Agent Cartridge is a **security-sensitive format**: cartridges are signed, verified, and traded, and the
tooling makes trust decisions about them. Please report vulnerabilities responsibly.

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting** (Security → *Report a vulnerability*) on this repository,
or open a minimal private report. Please do **not** file a public issue for a security problem.

Include: the affected component (spec, `src/`, `platform/`, `tools/`, `registry/`), a reproduction, and the
impact. We aim to acknowledge a private report within **five business days**.

If GitHub's private reporting form is unavailable, open a public issue containing only the sentence that
you need a private security contact; include no vulnerability detail, exploit, affected path, or secret.
A maintainer will establish a private channel.

## Supported versions

| Version | Security support |
| --- | --- |
| Latest `0.1.x` release | Supported |
| Older public-draft snapshots and untagged builds | Best effort; reproduce against the latest release |

## Scope — what we care about most

- **Integrity bypass.** Any way to make a *tampered* cartridge verify as `trusted`/`local`, or to alter
  signed ROM content without detection. (The reference impl recomputes every object hash from live content
  and signs a per-object manifest, never raw SQLite bytes — reports that defeat this are high priority.)
- **Trust confusion.** Making the trust taxonomy (`local/trusted/portable/legacy/tampered`) report a
  stronger level than warranted, or accepting an unverified signature as valid.
- **Level forgery.** Issuing or accepting a provable-level credential without the required independent
  held-out re-run, self-issuance, or transplanting a level onto a mutated cartridge.
- **Scrub-gate escape.** Getting a secret past the fail-closed export scrub.
- **Exchange/registry.** Path traversal, publishing a tampered cartridge or workflow, workflow
  signature/publisher bypass, XSS via artifact metadata, or making the platform execute artifact content
  during inspection (it must only read metadata and verify signatures).

## Not in scope

- The reference benchmark *solver* is deterministic and pluggable (documented); "the demo solver is not a
  real agent" is expected, not a vulnerability.
- Denial-of-service against the local reference servers (`platform/`, `acx builder`) run as documented,
  non-production reference implementations.
