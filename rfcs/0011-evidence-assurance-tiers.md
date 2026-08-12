# APRF-RFC-0011: Evidence Assurance Tiers (E0–E5)

| Field | Value |
| --- | --- |
| Status | in-review |
| Author(s) | StackRail |
| Created | 2026-08-11 |
| SemVer impact | MINOR |
| Index summary | Adds normative Evidence Assurance Tiers (E0–E5) and Check `evidencePolicy.minimumTier` so PASS requires evidence at or above a declared floor; UNVERIFIED is a verification outcome on PARTIAL, not a sixth control status. |

## Problem

Hybrid Checks already treat repository signals as incomplete and measured imports as required for PASS, but that distinction lives in collector folklore and report copy. Assessors and product UIs can still confuse “I found something in Git” with “the production control actually exists.” APRF needs a machine-checkable floor that does not invent new Checks.

## Proposal

1. Define **Evidence Assurance Tiers** (orthogonal to retention tiers `ephemeral` / `digest` / `attested` in ARCHITECTURE):

| Tier | Meaning |
| --- | --- |
| E0 | No evidence |
| E1 | Self-attestation |
| E2 | Repository evidence |
| E3 | Configuration evidence |
| E4 | Runtime evidence |
| E5 | Independent verification |

2. Add optional Check field `evidencePolicy`:
   - `minimumTier`: `E0`…`E5`
   - `acceptableEvidence`: evidence-type IDs (starter registry; full Evidence Type Registry remains future work)

3. Keep free-form `evidenceRequired: string[]` for human prose.

4. **Satisfaction rule:** a Check may be `PASS` only if `achievedTier >= minimumTier` **and** existing passCondition / collector metrics hold. Below-floor evidence cannot PASS.

5. **Control statuses stay the closed five** (`PASS` / `FAIL` / `PARTIAL` / `NOT_DEMONSTRATED` / `NOT_APPLICABLE`). When substance exists but `achievedTier < minimumTier`, status is `PARTIAL` with `evidenceTier.verification: UNVERIFIED`. Do not add `UNVERIFIED` as a sixth status (avoids scoring/SARIF/enum churn).

6. Default `minimumTier` when omitted: derive from `detection.capability` — `manual`→E1, `hybrid`→E3, `automated`→E4, `none`→E1.

7. Assessment emits per-control `evidenceTier` (`minimum`, `achieved`, `acceptable`, `matched`, `verification` ∈ `NONE` \| `UNVERIFIED` \| `VERIFIED` \| `NOT_APPLICABLE`). REPORT shows required vs achieved tier.

## Alternatives considered

- Sixth status `UNVERIFIED` — rejected; gate blockers already cover PARTIAL; enum churn across scoring, SARIF, HTML, and smokes is disproportionate.
- Replace `evidenceRequired` with structured-only types — rejected for v1; keep prose lists and add `evidencePolicy` beside them.
- Require every Check to annotate tiers before ship — rejected; defaults from capability unblocks the catalog while wave-1 hybrids (e.g. SEC-M4) set explicit floors.

## Compatibility

- Additive Check schema fields (`evidencePolicy` optional).
- Gate semantics unchanged: below-floor remains a blocker via `PARTIAL`.
- Confidence model unchanged (orthogonal floor vs score).
- Retention tiers unchanged (different axis).
- Check IDs and profiles unchanged.

## Security considerations

Raises honesty of production-readiness claims by preventing repo-only evidence from satisfying high-floor Checks. Does not certify third-party assessment; E5 is reserved for independent verification packs.

## Open questions

- When should CI fail on unknown `acceptableEvidence` IDs vs warn during registry growth?

## Resolved

- `aprf-spec.json` check rows **do** project `minimumTier` (resolved from YAML `evidencePolicy` or capability defaults) via `npm run aprf:sync-evidence-tiers`; integrity fails on drift.

## Checklist

- [x] Problem and affected parties
- [x] Proposed change stated
- [x] SemVer impact justified
- [x] Compatibility / deprecation plan
- [x] Checks remain measurable
- [x] Crosswalk impact noted (N/A — no crosswalk ID changes)
- [x] Security / safety considered
- [x] Open questions listed

---

Comment window: 14 days from `Created`. Interim contact: see `/aprf/rfc/`.
