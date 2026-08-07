# APRF-RFC-0004: Split PERF-M2 dashboards — metrics stay mandatory; dashboards → PERF-R4

| Field | Value |
| --- | --- |
| Status | accepted |
| Author(s) | StackRail (working-draft publisher) |
| Created | 2026-08-01 |
| SemVer impact | MINOR |
| Index summary | Rewrites PERF-M2 as mandatory ops metrics; adds PERF-R4 for near-real-time dashboards as recommended maturity. |
| Related | [APRF-RFC-0003](0003-observability-obs-m2-to-recommended.md) (recommended dashboards / FinOps maturity pattern) |

## Problem

**PERF-M2** required **online dashboards** for AI latency, error, and ≥1 quality/task-success signal as a **mandatory** Check (freshness ≤15 minutes). That conflates two different obligations:

| Concern | Why a single mandatory was too strong |
| --- | --- |
| **Emitting ops metrics** | Latency, error rate, and AI quality/task-success series are production-blocking: without them, PERF-M1 SLOs and PERF-M3 burn alerts cannot operate. |
| **Near-real-time dashboards** | Visualization, panel coverage (throughput, resource utilization), and ≤15m refresh are operator maturity — overlapping **OBS-R3** (SLO/burn dashboards) and **EVL-M3** (online eval/refusal signals) without adding a Core-level gate. |

Keeping dashboards mandatory over-weights presentation vs measurable contracts and emitted metrics. Assessors need a citable split.

## Proposal

1. **Rewrite PERF-M2** (same ID, still **mandatory** `must`): production AI services must **collect and make available** operational metrics for latency, error rate, and ≥1 AI-specific quality or task-success indicator; hybrid detection via `repo-ai-ops-metrics`.
2. **Add PERF-R4** (**recommended** `should`): near-real-time operational dashboards should visualize latency, error rate, throughput, resource utilization, and AI quality metrics; hybrid detection via `repo-ai-ops-dashboards`.
3. **Do not** remove PERF-M2 from Core/Regulated (it was never on those profiles as the sole PERF dashboard gate — Core lists **PERF-M1** only). Voice lens `additionalMandatoryCheckIds` keeps **PERF-M2** under the metrics meaning.
4. Keep **PERF-R2** as capacity/load tests (adversarial long-prompt / agent-loop) — dashboard obligation must not reuse that ID.

Normative pass conditions remain measurable (metric classes present + available; dashboard coverage + near-real-time freshness; `measuredAt` ≤90d).

## Alternatives considered

- **Demote entire PERF-M2 → PERF-R\*** — rejected; emitted latency/error/quality metrics remain a production minimum distinct from catalog (PERF-M1) and alerts (PERF-M3).
- **Keep dashboards mandatory; soften freshness** — rejected; still blocks assessments for teams with strong exporters but immature boards; duplicates OBS-R3/EVL-M3 presentation concerns.
- **Reuse PERF-R2 for dashboards** — rejected; PERF-R2 already means capacity/load tests.

## Compatibility

| Change | Impact |
| --- | --- |
| PERF-M2 rewritten (metrics) | Same ID; gate stays mandatory; obligation narrowed |
| PERF-R4 added | Recommended surface +1; catalog 177→178 |
| Core / Regulated mandatories | Unchanged (38 / 54) |
| Voice lens | Still lists PERF-M2; semantics = metrics, not dashboards |

SemVer: **MINOR** — new recommended Check ID and narrowed mandatory obligation while still on working-draft `0.10.x`.

**No ID retirement:** PERF-M2 was not vacated. No `id-gaps.md` row is required (unlike INC-M3/M4 or former OBS-M2). After first tagged release, further M→R moves must use deprecate+`replacedBy` per `ARCHITECTURE.md`.

## Security considerations

No weakening of SLO catalogs (PERF-M1) or burn alerting (PERF-M3). Moving dashboards to recommended reduces false fails for metrics-complete teams; residual risk is slower incident visualization, mitigated by high-severity PERF-R4 plus OBS-R3 / EVL-M3 / INC-R1 siblings.

## Open questions

- Should Regulated or the Voice lens later require PERF-R4 (or a freshness SLO) as additional mandatory once Level-5 ops maturity is ratified?
- Should “near-real-time” stay fixed at ≤15 minutes panel freshness, or become “appropriate for documented incident-response objectives”?

## Checklist

- [x] Problem and affected parties
- [x] Proposed change stated
- [x] SemVer impact justified
- [x] Compatibility / deprecation plan
- [x] Checks remain measurable
- [x] Crosswalk impact noted (informative; PERF-M1 crosswalks unchanged)
- [x] Security / safety considered
- [x] Open questions listed

---

Comment window: 14 days from `Created` (working-draft quorum applies). Interim contact: see `/aprf/rfc/`.
