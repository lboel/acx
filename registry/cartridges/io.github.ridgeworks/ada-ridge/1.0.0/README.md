# Ada Ridge

| Field | Value |
| --- | --- |
| Publisher | `io.github.ridgeworks` |
| Artifact | `ada-ridge@1.0.0` |
| Role | `devops_engineer` |
| Class | Pipeline Wright |
| Level | Lv.28 · claim only; credential evidence unresolved |
| ROM digest | `sha256:318b930a1942eb9d3e8088906c6b32f91def9e156d4cbb3a178e676d4e28aaca` |
| Registry trust at submission | `portable` |

## Capabilities

- `build-dag` — `pkg:generic/snowflake`, `pkg:pypi/apache-airflow`, `pkg:pypi/dbt-core` — unproven; evidence unresolved
- `implement-feature` — `pkg:generic/python`, `pkg:generic/snowflake`, `pkg:pypi/apache-airflow`, `pkg:pypi/dbt-core` — unproven; evidence unresolved

## Verify before loading

```bash
acx verify cartridge.acx
acx spec cartridge.acx
acx load cartridge.acx --print-only
```

This card is generated from the signed, ROM-only cartridge. Embedded level and capability values are claims unless issuer keys, revocation status, and referenced evidence resolve successfully. The artifact, not this README, is authoritative.
