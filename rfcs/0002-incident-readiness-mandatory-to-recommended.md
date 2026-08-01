# APRF-RFC-0002: Demote incident-readiness INC-M3 and INC-M4 to recommended

| Field | Value |
| --- | --- |
| Status | accepted |
| Author(s) | StackRail (working-draft publisher) |
| Created | 2026-08-01 |
| SemVer impact | MINOR |
| Implements | PR [#14](https://github.com/stackrail-io/APRF/pull/14) (`feat/incident-readiness-hybrid`) |

## Problem

Two incident-readiness Checks were published as **mandatory** while the framework is still a pre-release working draft (`0.10.0`, no tagged release versions yet):

| Former ID | Title (obligation) | Why mandatory was too strong |
| --- | --- | --- |
| **INC-M3** | Post-incident reviews must produce tracked actions against APRF pillars | Valuable learning loop, but not a production-blocking gate for Core/Regulated (was never in those profiles). Treating 100% SEV coverage as mandatory over-weights process maturity vs containment. |
| **INC-M4** | Regular tabletop exercises must cover AI-specific incidents | Tabletop cadence is important for Regulated maturity, but forcing it as a Tier-3 mandatory before adopters have stable playbooks/containment (INC-M1/M2) creates false fails. |

Assessors and profile consumers need a clear, citable rationale for the gate change and for how IDs were remapped.

## Proposal

1. **Demote** the obligations from mandatory (`must`) to recommended (`should`):
   - **INC-M3 → INC-R2** — post-incident reviews should produce tracked APRF-pillar actions (or explicit no-action rationale); hybrid detection via `repo-post-incident-aprf-actions`.
   - **INC-M4 → INC-R4** — production systems should run AI-focused tabletops ≤180 days with retained owned actions; hybrid detection via `repo-ai-incident-tabletop`.
2. **Keep** INC-M1 (playbooks) and INC-M2 (containment drill) as the incident-readiness **mandatory** Core gates.
3. **Update** the Regulated profile: remove **INC-M4** from `mandatoryCheckIds` (56→55; tier3-only 17→16). INC-M3 was never on Core/Regulated, so demotion does not change those counts.
4. **Rewrite** sibling recommended Checks INC-R1 / INC-R3 from stubs to hybrid collectors in the same change set (editorial + measurable, not gate demotions).

Normative pass conditions remain measurable (coverage %, ages, owners, measuredAt ≤90d attest freshness).

## Alternatives considered

- **Keep mandatory; soften passCondition** — rejected; still fails Regulated assessments for teams with strong containment but immature tabletops/PIR process.
- **Demote in place (same IDs, change `gate` only)** — rejected for M→R semantics clarity; recommended Checks use the `*-R*` namespace by convention.
- **Deprecate INC-M3/M4 stubs with `replacedBy` and retain files** — preferred after first tagged release; see Compatibility for the intentional pre-release exception.

## Compatibility

### Gate / profile impact

| Change | Impact |
| --- | --- |
| INC-M3 removed; INC-R2 added | Additive recommended Check; no Core/Regulated mandatory delta |
| INC-M4 removed; INC-R4 added | Regulated mandatories −1; recommended surface +1 |
| Catalog size | Net same incident-readiness Check count (M3/M4 → R2/R4) |

SemVer: **MINOR** — profile gate set and Check IDs changed while still on working-draft `0.10.x` before any tagged release.

### Intentional exception — no deprecated stubs for INC-M3 / INC-M4

Per `ARCHITECTURE.md` / `CONTRIBUTING.md`, published Check IDs are normally retained as `status: deprecated` with `replacedBy` for an N−1 MINOR window.

**Exception (pre-release only):** APRF has **not** shipped any tagged release versions yet. Retaining empty deprecated mandatories would create noise for early adopters without protecting a published baseline. Therefore INC-M3 and INC-M4 YAML were **removed** and replaced by INC-R2 / INC-R4 rather than left as deprecated stubs.

This exception is recorded in [`packages/aprf-engine/rules/_index/id-gaps.md`](../packages/aprf-engine/rules/_index/id-gaps.md). **After the first tagged release**, future mandatory→recommended moves must use deprecate+`replacedBy` (or an explicit new RFC amending this exception).

## Security considerations

No weakening of containment or playbook mandatories (INC-M1/M2). Demoting tabletops and post-incident APRF-action mapping reduces false Regulated fails; residual risk is delayed learning loops, mitigated by keeping both as high-severity recommended Checks with hybrid collectors.

## Open questions

- Should Regulated re-include an AI tabletop Check as mandatory once Level-5 maturity guidance is ratified?
- After `v1.0.0`, should a one-time migration note in release notes list INC-M3/M4 → INC-R2/R4 for any private forks that copied pre-release IDs?

## Checklist

- [x] Problem and affected parties
- [x] Proposed change stated
- [x] SemVer impact justified
- [x] Compatibility / deprecation plan (incl. intentional pre-release exception)
- [x] Checks remain measurable
- [x] Crosswalk impact noted (N/A — informative crosswalks unchanged)
- [x] Security / safety considered
- [x] Open questions listed

---

Comment window: 14 days from `Created` (working-draft quorum applies). Interim contact: see `/aprf/rfc/`.
