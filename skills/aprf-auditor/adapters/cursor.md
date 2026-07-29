# Adapter — Cursor

## Install

### Option A — Project skill (recommended on the **app under assessment**)

```bash
cd /path/to/your-ai-app   # NOT required to be cloudOps
mkdir -p .cursor/skills
ln -sf /path/to/APRF/skills/aprf-auditor .cursor/skills/aprf-auditor
```

### Option B — Personal skill (all projects)

```bash
mkdir -p ~/.cursor/skills
ln -sf /path/to/APRF/skills/aprf-auditor ~/.cursor/skills/aprf-auditor
```

Confirm Cursor lists **aprf-auditor** under Skills (Settings → Rules / Skills, or `@` menu).

Symlinks are fine if `SKILL.md` resolves. If discovery fails, copy instead of symlink.

## Invoke (important)

Just saying “Run an APRF assessment” is **ambiguous** if the open workspace is **something related to assessments** — the agent often runs the **product** assessment instead of this skill.

Do one of:

1. **@-mention the skill** in chat: `@aprf-auditor Run an APRF assessment`
2. Or say explicitly:  
   > Use the **aprf-auditor** Cursor skill (local portable skill). Do **not** use the StackRail console or Assessments UI. Write `./aprf-assessment/`.
3. Prefer opening the **customer AI app repo** as the Cursor workspace (not cloudOps), then run the skill there.
   - If the target is cloudOps / a console / APRF catalog, use **`systemType=non-ai-platform`** and `scopes/non-ai-platform.yaml` — do **not** claim Core AI production readiness.

## Success looks like

- Files under `./aprf-assessment/` (`evidence-graph.json`, `REPORT.md`, `REPORT.html`, `assessment.json`, …)
- Agent may ask for missing evidence / `imports/custom/`
- **No** `http://127.0.0.1:3001`, **no** `run_ms…` IDs

Render HTML after `assessment.json` exists — **required; do not hand-write HTML**:

```bash
# From APRF repo root:
npm run aprf:report-html -- \
  --in /path/to/target/aprf-assessment/assessment.json \
  --out /path/to/target/aprf-assessment/REPORT.html

# Or from the assessed app with skill symlink:
npx tsx "$(realpath .cursor/skills/aprf-auditor)/scripts/render-html-report.ts" \
  --in ./aprf-assessment/assessment.json \
  --out ./aprf-assessment/REPORT.html
```

Confirm the file contains `stackrail.io` and `Visual overview`, or run:

```bash
npm run aprf:verify-html -- ./aprf-assessment/REPORT.html
```

## Failure (wrong pipeline)

- “Console is at http://127.0.0.1:3001”
- “registered source …”
- Gate result from product Findings UI  

→ That was cloudOps product assess, not this skill. Re-run with `@aprf-auditor` and the wording above.

## Agent load order

1. Read this package’s `SKILL.md`
2. Read `system.md`, `workflow.md`, `scoring.yaml`, `evidence-map.yaml`
3. Resolve APRF catalog: sibling/clone `APRF/packages/aprf-engine/rules` or `@stackrail-io/aprf-engine`
4. Optionally `npm run aprf:collect` from the APRF checkout with `--target` = app path
5. Write artifacts into the **target app’s** `aprf-assessment/`

## Notes

- Use **Agent** mode with repo read access.
- Assessing the APRF framework repo itself will correctly fail most production Checks (it is not an AI app).
