# Examples

Illustrative artifacts produced by the APRF Auditor skill. They are **not** live assessments of this repository.

| File | Description |
| --- | --- |
| `minimal-assessment.json` | Tiny valid `assessment.json` (schema + N/A invariant) |
| `sample-issues.json` | Shape of GitHub-issue export |
| `snippet-REPORT.md` | Excerpt of executive + one control row |
| `pass-samples/AGN-M1.inventory.json` | Measured inventory export that unlocks AGN-M1 PASS (attached in report flyout) |
| `agent-charter/agent-charter.spec.yaml` | APRF agent charter specification (v1) — copy as a template |
| `agent-charter/support-agent.charter.yaml` | Filled example charter matching the spec |

Validate the JSON fixture:

```bash
# from APRF repo root
npx tsx skills/aprf-auditor/tests/validate-fixture.ts
```
