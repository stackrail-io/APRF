# APRF Assessment Report (excerpt)

**APRF:** 0.11.0 · **Skill:** 0.1.0 · **Profile:** Core · **Gate:** FAIL

## Executive Summary

| Field | Value |
| --- | --- |
| Overall Score (recommended, non-gate) | 0 |
| Overall Grade | F |
| Risk Level | high |
| Assessment Confidence | low |

Illustrative fixture: SEC2-M1 NOT_DEMONSTRATED; AGN-M1 NOT_APPLICABLE.

## Domain Scores

| Domain | Score | Mandatory gate |
| --- | --- | --- |
| Security | 0 | FAIL |
| Agent Safety | 100 | PASS (N/A satisfied exclusion) |

## Controls & Findings (sample)

| Check | Title | Category | Domain | Status | Confidence | Tags | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC2-M1 | Production secrets must live in a secrets manager… | Secrets | Security | NOT_DEMONSTRATED | low | Production blocker · Critical | P1 |

### SEC2-M1 — Production secrets must live in a secrets manager…

| Field | Value |
| --- | --- |
| Status | NOT_DEMONSTRATED |
| Evidence Found | _(none)_ |
| Reasoning | No secrets-manager configuration or CI secret-scan report found. |
| Confidence | low |
| Recommended Action | Wire secrets manager + CI secret scanning; re-assess. |
| Priority | P1 |

**Evidence required to pass:** Secrets-manager / sealed-secrets / cloud secret-ref wiring for production runtime; CI/repo secret-scan config covering prompts and fixtures; latest secret-scan report with 0 privileged findings (measuredAt ≤90 days); attest or inventory showing 100% of production runtime secrets resolve from the secrets manager.
