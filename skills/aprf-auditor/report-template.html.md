# HTML report

Agents **must not** hand-write `REPORT.html`.

Always render from `assessment.json` using the shipped script (includes StackRail links + visualizations).

## From APRF repo root

```bash
cd /path/to/APRF
npm run aprf:report-html -- \
  --in /path/to/target/aprf-assessment/assessment.json \
  --out /path/to/target/aprf-assessment/REPORT.html
```

## From the assessed app (skill symlinked)

```bash
npx tsx "$(realpath .cursor/skills/aprf-auditor)/scripts/render-html-report.ts" \
  --in ./aprf-assessment/assessment.json \
  --out ./aprf-assessment/REPORT.html
```

## Acceptance

```bash
npm run aprf:verify-html -- /path/to/aprf-assessment/REPORT.html
```

Must pass. Required markers: `stackrail.io`, `Visual overview`, `Control status mix`.

If verification fails, the agent invented HTML — delete the file and re-run the render commands above.
