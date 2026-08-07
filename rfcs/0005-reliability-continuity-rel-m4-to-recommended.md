# APRF-RFC-0005: Demote reliability-continuity REL-M4 to recommended (REL-R3)

| Field | Value |
| --- | --- |
| Status | accepted |
| Author(s) | StackRail (working-draft publisher) |
| Created | 2026-08-01 |
| SemVer impact | MINOR |
| Index summary | Demotes REL-M4→REL-R3 (process continuity options with owners); pre-release ID-removal exception. |
| Related | [APRF-RFC-0002](0002-incident-readiness-mandatory-to-recommended.md), [APRF-RFC-0003](0003-observability-obs-m2-to-recommended.md) (pre-release M→R pattern) |

## Problem

**REL-M4** required every process marked critical-AI-dependent to have ≥1 documented continuity option with a named owner as a **catalog mandatory** (`must`). That over-weights process-level continuity **documentation** relative to production-blocking reliability gates already covered elsewhere:

| Stronger / adjacent control | What it already proves |
| --- | --- |
| **REL-M2** | Critical journeys define degraded mode when AI is unavailable, with failover-test evidence |
| **REL-M6** | Business-critical AI services have numeric RTO/RPO linked to tested restore/failover |
| **REL-M5** | Backups include AI control-plane artifacts needed to restore service |
| **REL-M7 / REL-M8** | Chaos and continuity drills for higher-tier / regulated workloads |

Documented continuity options with owners remain valuable operator maturity, but failing a catalog mandatory for missing a process register when journeys already degrade safely (REL-M2) and services have RTO/RPO (REL-M6) blocks assessments for the wrong reason. REL-M4 was never on Core or Regulated `mandatoryCheckIds`; keeping it as a catalog `must` still forces full-catalog and custom-gate consumers to treat documentation as a hard fail.

## Proposal

1. **Demote** REL-M4 → **REL-R3** (recommended `should` language; hybrid detection via `repo-ai-continuity-options` unchanged in substance).
2. **Remove** REL-M4 from the reliability-continuity **mandatoryChecks** list in `aprf-spec.json`; add REL-R3 under **recommendedChecks**.
3. **Do not** change Core (38) or Regulated (54) profile counts — REL-M4 was never listed there.
4. Pass condition unchanged in substance: 100% of critical-AI-dependent processes have ≥1 documented continuity option with a named owner; attest `measuredAt` ≤90d.
5. Keep **REL-M1–M3**, **REL-M5–M8** as the reliability-continuity mandatory spine (timeouts, degraded mode, partial-failure outcome, backups, RTO/RPO, chaos/continuity drills as applicable).

## Alternatives considered

- Soften passCondition but keep mandatory — rejected; still treats documentation coverage as a hard gate overlapping REL-M2/REL-M6.
- Demote in place (`gate: recommended` on REL-M4) — rejected; recommended Checks use the `*-R*` namespace.
- Merge into REL-M2 — rejected; journey degraded-mode + failover tests are not the same as a process-level owned continuity-options register.
- Merge into REL-M6 — rejected; RTO/RPO service objectives are not process continuity-option docs with owners.

## Compatibility

| Change | Impact |
| --- | --- |
| REL-M4 removed; REL-R3 added | Catalog mandatory −1; recommended +1; total Checks unchanged (178) |
| Core / Regulated mandatories | Unchanged (38 / 54) |
| Crosswalk / relatedRules | Remapped REL-M4 → REL-R3 |
| Collector / plugin | `ai-continuity-options` maps to REL-R3 |

SemVer: **MINOR** — M→R remapping while still on working-draft `0.10.x`.

**Pre-release exception:** no tagged release yet — REL-M4 YAML removed rather than deprecated stub. Recorded in [`id-gaps.md`](../packages/aprf-engine/rules/_index/id-gaps.md). After first tagged release, future demotions must use `deprecated` + `replacedBy`.

## Security considerations

No weakening of runtime degraded mode (REL-M2), partial-failure outcome tests (REL-M3), backups (REL-M5), or RTO/RPO (REL-M6). Residual risk is thinner process-level ownership documentation; mitigated by keeping REL-R3 high-severity recommended with hybrid collectors and by retaining REL-M2/REL-M6 as mandatories where applicable.

## Open questions

- Should Regulated later re-include process continuity-option documentation as an additional mandatory once Level-5 ops maturity is ratified?
- Should REL-R3 require periodic review of owners (≤90d) beyond documentation freshness?

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
