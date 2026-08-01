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
| `REL-M4` (former continuity-options mandatory) | `REL-R3` | [APRF-RFC-0005](../../../rfcs/0005-reliability-continuity-rel-m4-to-recommended.md) | Process continuity-option docs; was never on Core/Regulated |
| Former `REL-M5` (AI control-plane backups) | `REL-M4` | Pre-release renumber into vacated mandatory slot | Backup inventory + restore test; fills ID vacated by RFC-0005 |
| `REL-M7` | `REL-R5` | [APRF-RFC-0006](../../../rfcs/0006-reliability-continuity-rel-m7-to-recommended.md) | AI-dependency chaos; removed from Regulated mandatories |
| `REL-M8` | `REL-R7` | [APRF-RFC-0007](../../../rfcs/0007-reliability-continuity-rel-m8-to-recommended.md) | Multi-provider Level-5 continuity; removed from Regulated mandatories |
| Former `REL-M6` (business-critical RTO/RPO) | `REL-M5` | Pre-release renumber into vacated mandatory slot | RTO/RPO catalog; fills ID vacated when backups moved to REL-M4 |

**After the first tagged release**, this exception closes. New demotions must keep deprecated stubs (pattern: `INF-R1` → `SCI-R1`).
