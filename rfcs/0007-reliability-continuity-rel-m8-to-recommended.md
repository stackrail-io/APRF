# APRF-RFC-0007: Demote reliability-continuity REL-M8 to recommended (REL-R7)

| Field | Value |
| --- | --- |
| Status | accepted |
| Author(s) | StackRail (working-draft publisher) |
| Created | 2026-08-01 |
| SemVer impact | MINOR |
| Related | [APRF-RFC-0006](0006-reliability-continuity-rel-m7-to-recommended.md), [APRF-RFC-0005](0005-reliability-continuity-rel-m4-to-recommended.md) (pre-release M→R pattern) |

## Problem

**REL-M8** required Level-5 workloads to have documented alternate provider/path **and** a successful failover test ≤180 days as a **Regulated mandatory** (`must`, `minCriticality: 3`, `requiredFromLevel: 5`). That over-weights **contractual multi-provider continuity** relative to production-blocking reliability gates:

| Stronger / adjacent control | What it already proves |
| --- | --- |
| **REL-M2** | Critical journeys define degraded mode when AI is unavailable |
| **REL-M6** | Business-critical services have numeric RTO/RPO linked to tested restore/failover |
| **REL-M4** | AI control-plane backup inventory + restore test |
| **REL-R2** | Multi-provider/multi-region fallback with eval coverage (recommended) |
| **REL-R5** | AI-dependency chaos exercises (recommended; former REL-M7) |
| **REL-R6** | Warm standby for self-hosted inference where required (recommended) |

Contractual + technical multi-provider options remain valuable Level-5 maturity, but failing Regulated for missing a second-provider contract and 180-day failover drill when RTO/RPO, degraded mode, and backups already hold creates false fails for teams with single-provider commercial constraints or staged multi-cloud programs.

## Proposal

1. **Demote** REL-M8 → **REL-R7** (recommended `should` language; hybrid detection via `repo-ai-multi-provider-continuity` / `ai-multi-provider-continuity` collector).
2. **Remove** REL-M8 from Regulated `mandatoryCheckIds` (Regulated 53→52; tier3-only 15→14). Core unchanged (38).
3. **Remove** REL-M8 from reliability-continuity **mandatoryChecks** in `aprf-spec.json`; add REL-R7 under **recommendedChecks**.
4. Pass condition unchanged in substance: Level-5 workloads have a documented alternate provider/path and a successful failover test ≤180 days; attest `measuredAt` ≤90d.
5. Keep **REL-M1–M4**, **REL-M6** as the reliability-continuity mandatory spine (timeouts, degraded mode, partial-failure, backups, RTO/RPO).

## Alternatives considered

- Soften passCondition but keep Regulated mandatory — rejected; still blocks Tier-3 for multi-provider commercial maturity.
- Demote in place (`gate: recommended` on REL-M8) — rejected; recommended Checks use the `*-R*` namespace.
- Merge into REL-R2 — rejected; REL-R2 centers on fallback **eval** quality/safety bars; REL-R7 centers on contractual + technical alternate path with failover test ≤180d for Level-5 continuity.
- Merge into REL-M6 — rejected; RTO/RPO objectives are not multi-provider contractual options.

## Compatibility

| Change | Impact |
| --- | --- |
| REL-M8 removed; REL-R7 added | Catalog mandatory −1; recommended +1; total Checks unchanged (178) |
| Core | Unchanged (38) |
| Regulated | 53→52 (REL-M8 removed) |
| Crosswalk / relatedRules | Remapped REL-M8 → REL-R7 |
| Collector / plugin | `ai-multi-provider-continuity` maps to REL-R7 |

SemVer: **MINOR** — profile gate set and Check ID remapping while still on working-draft `0.10.x`.

**Pre-release exception:** no tagged release yet — REL-M8 YAML removed rather than deprecated stub. Recorded in [`id-gaps.md`](../packages/aprf-engine/rules/_index/id-gaps.md). After first tagged release, future demotions must use `deprecated` + `replacedBy`.

## Security considerations

No weakening of degraded mode, backups, or RTO/RPO. Residual risk is longer recovery if the sole provider fails without a contracted alternate; mitigated by high-severity REL-R7 plus REL-R2/REL-R5/REL-R6 recommended siblings and REL-M2/REL-M6 mandatories.

## Open questions

- Should Regulated later re-include multi-provider contractual continuity as additional mandatory once Level-5 commercial maturity is ratified?
- Should “alternate provider/path” accept multi-region same-provider failover, or require a distinct commercial provider?

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
