# APRF-RFC-0001: Establish working-draft RFC process and public Open RFCs list

| Field | Value |
| --- | --- |
| Status | in-review |
| Author(s) | StackRail (working-draft publisher) |
| Created | 2026-07-24 |
| SemVer impact | MINOR |

## Problem

APRF documents an RFC process in stewardship, but adopters could not see any live RFCs. Without a public Open RFCs list, stewardship looks inactive and “working draft” claims lack a visible change path.

## Proposal

1. Publish this editorial RFC as **APRF-RFC-0001** under `in-review` with the standard 14-day window.
2. Ship a machine-readable RFC index (`APRF_RFCS`) and render **Open RFCs** on `/aprf/rfc/`.
3. Keep APRF-RFC-0000 as the submission template.
4. No changes to domains, pillars, check IDs, or gate semantics in this RFC.

## Alternatives considered

- Wait for an external contributor to file the first RFC — rejected; publisher should demonstrate the path.
- Only document the process without an index — rejected; opacity remains.

## Compatibility

Additive only. Existing check IDs and profiles unchanged. Spec consumers gain an optional `rfcs` (or site index) surface; normative gate behavior unchanged.

## Security considerations

None beyond clarifying that RFCs and self-assessments are not certification.

## Open questions

- Should accepted RFCs auto-bump `APRF_GOVERNANCE.version` via release notes only, or require a paired implementation PR before `accepted`?
- Interim advisory board membership criteria for the next stewardship phase.

## Checklist

- [x] Problem and affected parties
- [x] Proposed change stated
- [x] SemVer impact justified
- [x] Compatibility / deprecation plan
- [x] Checks remain measurable (N/A — editorial)
- [x] Crosswalk impact noted (N/A)
- [x] Security / safety considered
- [x] Open questions listed

---

Comment window: 14 days from `Created`. Interim contact: see `/aprf/rfc/`.
