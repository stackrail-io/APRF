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

## Built-in highlight: `http-auth-probe` (AUTHN-M1)

```bash
npm run aprf:auth-probe -- --target <app> --out <app>/aprf-assessment --base-url http://127.0.0.1:8080
```

Probes discovered AI HTTP routes without credentials; expects 401/403. See `collectors/README.md`.

## Built-in highlight: `mcp-s2s-inventory` (AUTHN-M2)

```bash
npm run aprf:mcp-s2s -- --target <app> --out <app>/aprf-assessment \
  --base-url http://127.0.0.1:8080 --admin-token "$APRF_ADMIN_TOKEN"
# or email/password: --admin-email "$APRF_ADMIN_EMAIL" --admin-password "$APRF_ADMIN_PASSWORD"
```

Or drop redacted `tool_servers.json` under `imports/mcp-s2s-inventory/`.

## Built-in highlight: `authz-entry-tests` (AUTHZ-M1)

```bash
npm run aprf:authz-tests -- --target <app> --out <app>/aprf-assessment
```

Scores automated 401/403 denial-test coverage of AI entry points. Server-side RBAC helpers alone are not a PASS.

## Built-in highlight: `cross-tenant-tests` (AUTHZ-M2)

```bash
npm run aprf:cross-tenant -- --target <app> --out <app>/aprf-assessment
```

Requires ≥10 automated cross-tenant attack cases with 0 unauthorized successes on AI data/memory paths.

## Built-in highlight: `secrets-hygiene` (SEC2-M1)

```bash
npm run aprf:secrets -- --target <app> --out <app>/aprf-assessment
```

Needs secrets-manager wiring + clean secret-scan. GitHub Actions `${{ secrets.* }}` alone is not enough.

## Built-in highlight: `secret-redaction` (SEC2-M2)

```bash
npm run aprf:secret-redaction -- --target <app> --out <app>/aprf-assessment
```

Needs redaction config + canary harness at 100% detection in logs/traces.

## Built-in highlight: `injection-policy-gate` (SEC-M1)

```bash
npm run aprf:injection-gate -- --target <app> --out <app>/aprf-assessment
```

Needs server-side policy + versioned corpus + CI gate (≥95% deny, 0 model-text privilege grants).
