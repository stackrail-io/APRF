# Examples

Illustrative artifacts produced by the APRF Auditor skill. They are **not** live assessments of this repository.

| File | Description |
| --- | --- |
| `minimal-assessment.json` | Tiny valid `assessment.json` (schema + N/A invariant) |
| `sample-issues.json` | Shape of GitHub-issue export |
| `snippet-REPORT.md` | Excerpt of executive + one control row |

Validate the JSON fixture:

```bash
# from APRF repo root
npx tsx skills/aprf-auditor/tests/validate-fixture.ts
```
