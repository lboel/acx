# Rex Calder

| Field | Value |
| --- | --- |
| Publisher | `io.github.calder-sec` |
| Artifact | `rex-calder@1.0.0` |
| Role | `security_expert` |
| Class | Security Sentinel |
| Level | Lv.18 · claim only; credential evidence unresolved |
| ROM digest | `sha256:f763d225d5f79817876cfaa60183164471bf3ec5d8dbf711f3ae772916526d2f` |
| Registry trust at submission | `portable` |

## Capabilities

- `implement-feature` — `pkg:generic/node`, `pkg:generic/oauth`, `pkg:generic/postgresql` — unproven; evidence unresolved
- `harden-security` — `pkg:generic/oauth`, `pkg:generic/postgresql` — unproven; evidence unresolved

## Verify before loading

```bash
acx verify cartridge.acx
acx spec cartridge.acx
acx load cartridge.acx --print-only
```

This card is generated from the signed, ROM-only cartridge. Embedded level and capability values are claims unless issuer keys, revocation status, and referenced evidence resolve successfully. The artifact, not this README, is authoritative.
