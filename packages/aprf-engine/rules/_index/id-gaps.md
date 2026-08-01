# Check ID gaps

Numbering gaps in Check IDs are **intentional**. Do not fill gaps by reusing retired IDs.

## Policy

- After a **tagged release**, never delete a published Check ID. Deprecate with `status: deprecated`, `replacedBy`, and `deprecationNote` (N−1 MINOR support window). See `CONTRIBUTING.md` and `ARCHITECTURE.md`.
- **Mandatory → recommended** always needs an RFC (`ARCHITECTURE.md`).

## Pre-release exception (before first tagged version)

APRF `0.10.x` is a working draft; **no release versions have been tagged yet**. For this window only, stewards may remove or renumber a Check ID when remapping **if** an RFC (or this file) records the change.

| Retired / vacated ID | Replaced by / current holder | RFC / note | Notes |
| --- | --- | --- | --- |
| `INC-M3` | `INC-R2` | [APRF-RFC-0002](../../../rfcs/0002-incident-readiness-mandatory-to-recommended.md) | Post-incident APRF-pillar actions; was never on Core/Regulated |
| `INC-M4` | `INC-R4` | [APRF-RFC-0002](../../../rfcs/0002-incident-readiness-mandatory-to-recommended.md) | AI-focused tabletop ≤180d; removed from Regulated mandatories |
| Former `OBS-M2` (token/cost attribution) | `OBS-R4` | [APRF-RFC-0003](../../../rfcs/0003-observability-obs-m2-to-recommended.md) | Demoted; ID vacated then reused |

**After the first tagged release**, this exception closes. New demotions must keep deprecated stubs (pattern: `INF-R1` → `SCI-R1`).
