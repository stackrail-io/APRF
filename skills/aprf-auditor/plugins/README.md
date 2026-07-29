# Evidence collector plugins

Plugins turn environments into **Evidence Graph** nodes. They are portable contracts — an agent or host may implement them with scripts, MCP tools, or manual export intake.

## Contract

Every plugin directory/file must declare:

| Field | Meaning |
| --- | --- |
| `id` | Stable plugin id |
| `executor` | Path to TypeScript collector under `collectors/` (optional but preferred) |
| `evidenceClass` | Primary class emitted (`runtime`, `ci`, …) |
| `inputs` | What the user/host must provide |
| `collect` | Steps to gather artifacts |
| `emits` | Node shapes / signals |
| `mapsToChecks` | Hint Check ID prefixes or IDs |
| `whenUnavailable` | After search, ask YES / NO / DON'T KNOW (Phase 2b); map DON'T KNOW → NOT_DEMONSTRATED |

See `_contract.yaml`. Run executors:

```bash
npm run aprf:collect -- --target <project> --out ./aprf-assessment
```

## Adding a plugin

1. Copy `_contract.yaml` → `my-plugin.yaml`
2. Add `collectors/my-plugin.ts` implementing `Collector` (or reuse `import-ingest`)
3. Register in `collectors/index.ts` and `capabilities.yaml`
4. Prefer exporting files into `aprf-assessment/imports/<pluginId>/` for reproducible offline runs
