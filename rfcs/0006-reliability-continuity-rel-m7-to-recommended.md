# APRF-RFC-0006: Demote reliability-continuity REL-M7 to recommended (REL-R5)

| Field | Value |
| --- | --- |
| Status | accepted |
| Author(s) | StackRail (working-draft publisher) |
| Created | 2026-08-01 |
| SemVer impact | MINOR |
| Index summary | Demotes REL-M7→REL-R5 (AI-dependency chaos); removes from Regulated mandatories; pre-release ID-removal exception. |
| Related | [APRF-RFC-0005](0005-reliability-continuity-rel-m4-to-recommended.md), [APRF-RFC-0002](0002-incident-readiness-mandatory-to-recommended.md) (pre-release M→R pattern) |

## Problem

**REL-M7** required at least one AI-dependency chaos exercise in the last 180 days with retained actions as a **Regulated mandatory** (`must`, `minCriticality: 3`, `requiredFromLevel: 5`). That over-weights **proactive chaos experimentation** relative to production-blocking reliability gates:

| Stronger / adjacent control | What it already proves |
| --- | --- |
| **REL-M1 / REL-M2 / REL-M3** | Timeouts/retries, journey degraded mode, partial-failure outcome evidence |
| **REL-M4** | AI control-plane backup inventory + restore test |
| **REL-M6** | Business-critical service RTO/RPO linked to tested restore/failover |
| **REL-M8** | Contractual/technical multi-provider options for Level-5 continuity |
| **REL-R4** | Periodic continuity drills including provider loss (recommended) |
| **INC-M1 / INC-M2** | Incident playbooks and containment drills |

Chaos covering AI provider/tool failure modes is valuable Level-5 maturity, but failing Regulated for missing a dated chaos after-action when degraded mode, RTO/RPO, backups, and containment already hold creates false fails for teams still building chaos programs.

## Proposal

1. **Demote** REL-M7 → **REL-R5** (recommended `should` language; hybrid detection via `repo-chaos-tests` / `ai-chaos-dependency` collector).
2. **Remove** REL-M7 from Regulated `mandatoryCheckIds` (Regulated 54→53; tier3-only −1). Core unchanged (38).
3. **Remove** REL-M7 from reliability-continuity **mandatoryChecks** in `aprf-spec.json`; add REL-R5 under **recommendedChecks**.
4. Pass condition unchanged in substance: ≥1 AI-dependency chaos exercise completed in the last 180 days with retained actions; attest `measuredAt` ≤90d.
5. Keep **REL-M1–M4**, **REL-M6**, **REL-M8** as the reliability-continuity mandatory spine (timeouts, degraded mode, partial-failure, backups, RTO/RPO, multi-provider Level-5 options as applicable).

## Alternatives considered

- Soften passCondition but keep Regulated mandatory — rejected; still blocks Tier-3 for chaos-program maturity.
- Demote in place (`gate: recommended` on REL-M7) — rejected; recommended Checks use the `*-R*` namespace.
- Merge into REL-R4 — rejected; REL-R4 is provider-loss continuity drills with RTO/RPO results; REL-R5 is chaos covering AI dependency failure modes with retained actions.
- Merge into INC-R4 — rejected; incident tabletops are not dependency chaos experiments.

## Compatibility

| Change | Impact |
| --- | --- |
| REL-M7 removed; REL-R5 added | Catalog mandatory −1; recommended +1; total Checks unchanged (178) |
| Core | Unchanged (38) |
| Regulated | 54→53 (REL-M7 removed) |
| Crosswalk / relatedRules | Remapped REL-M7 → REL-R5 |
| Collector / plugin | `ai-chaos-dependency` maps to REL-R5 |

SemVer: **MINOR** — profile gate set and Check ID remapping while still on working-draft `0.10.x`.

**Pre-release exception:** no tagged release yet — REL-M7 YAML removed rather than deprecated stub. Recorded in [`id-gaps.md`](../packages/aprf-engine/rules/_index/id-gaps.md). After first tagged release, future demotions must use `deprecated` + `replacedBy`.

## Security considerations

No weakening of timeouts, degraded mode, partial-failure handling, backups, RTO/RPO, or multi-provider Level-5 options. Residual risk is less proactive discovery of AI-dependency failure modes; mitigated by high-severity REL-R5 plus REL-R4 continuity drills and INC containment mandatories.

## Open questions

- Should Regulated later re-include AI-dependency chaos as additional mandatory once Level-5 ops maturity is ratified?
- Should the chaos window stay at 180 days, or align to 90 days with other continuity drills (REL-R4)?

## Checklist

- [x] Problem and affected parties
- [x] Proposed change stated
- [x] SemVer impact justified
- [x] Compatibility / deprecation plan
- [x] Checks remain measurable
- [x] Crosswalk impact noted
- [x] Security / safety considered
- [x] Open questions listed

---

Comment window: 14 days from `Created` (working-draft quorum applies). Interim contact: see `/aprf/rfc/`.
