# Adapter — MCP-compatible agents

The APRF Auditor skill is **instruction + data**, not a remote MCP server. MCP agents should load it as resources/prompts.

## Suggested MCP resource URIs (local files)

| URI | File |
| --- | --- |
| `file:///…/APRF/skills/aprf-auditor/system.md` | System prompt |
| `file:///…/APRF/skills/aprf-auditor/workflow.md` | Workflow |
| `file:///…/APRF/skills/aprf-auditor/evidence-map.yaml` | Evidence strategies |
| `file:///…/APRF/skills/aprf-auditor/scoring.yaml` | Scoring |
| `file:///…/APRF/skills/aprf-auditor/output-schema.json` | Output contract |
| `file:///…/APRF/packages/aprf-engine/rules/` | Normative Checks |

## Tooling the host should provide

- `filesystem.read` / `filesystem.glob` (required)
- `filesystem.write` (for report artifacts)
- Optional: `git.status`, `git.log` for commit pinning in `subject.gitCommit`

## Do not

- Do not implement an MCP tool that “calls StackRail cloud.”
- Do not fetch Check definitions from unofficial mirrors.

## LangGraph / CrewAI / AutoGen

Load `system.md` as the system message for an **Auditor** agent; give a **Collector** agent the discovery globs from `workflow.md` Phase 1; give an **Evaluator** agent Check YAML + evidence bundles; give a **Reporter** agent `output-schema.json` + templates. Keep a single shared `aprfVersion` in state.
