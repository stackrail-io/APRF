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

## Built-in highlight: `key-rotation-scope` (SEC2-M3)

```bash
npm run aprf:key-rotation-scope -- --target <app> --out <app>/aprf-assessment
```

Needs key inventory + least-privilege scope + rotation/short-lived coverage + 0 privileged keys in client apps (inventory/coverage measuredAt ≤90d). Rotation docs alone are not enough.

## Built-in highlight: `precommit-ci-secret-scan` (SEC2-R1)

```bash
npm run aprf:precommit-ci-secret-scan -- --target <app> --out <app>/aprf-assessment
```

Needs pre-commit + CI secret scanning covering prompts/fixtures, blocking on high-confidence secrets, and a ≤7-day green main/PR-merge scan. Config alone is not enough.

## Built-in highlight: `credential-egress-controls` (SEC2-R2)

```bash
npm run aprf:credential-egress-controls -- --target <app> --out <app>/aprf-assessment
```

Needs egress allowlist/policy for credential-holding runtimes, documented destinations, and ≥1 deny event ≤90 days. Allowlist docs alone are not enough. Distinct from SEC-M4 model-path egress.

## Built-in highlight: `dataset-secret-scan-gate` (SEC2-R3)

```bash
npm run aprf:dataset-secret-scan-gate -- --target <app> --out <app>/aprf-assessment
```

Needs a secret/PII scan gate before fine-tune/eval corpus publish, blocking on critical findings, and 100% linked scan reports ≤90 days. Dataset cards alone are not enough.

## Built-in highlight: `artifact-provenance-integrity` (SCI-M1)

```bash
npm run aprf:artifact-provenance-integrity -- --target <app> --out <app>/aprf-assessment
```

Needs cosign/Notation/SLSA/OCI/checksum verification + 100% verified production pulls + blocked unverified pulls (verification/enforcement measuredAt ≤90d). Digest pins alone are not enough.

## Built-in highlight: supply-chain SCI-M2–M4 / R1–R2

```bash
npm run aprf:ai-external-tool-inventory -- --target <app> --out <app>/aprf-assessment
npm run aprf:ai-vuln-scan-gate -- --target <app> --out <app>/aprf-assessment
npm run aprf:ai-deploy-policy-enforcement -- --target <app> --out <app>/aprf-assessment
npm run aprf:ai-verify-on-deploy -- --target <app> --out <app>/aprf-assessment
npm run aprf:ai-model-mbom -- --target <app> --out <app>/aprf-assessment
```

Hybrid collectors: signals → PARTIAL; measured imports (≤90d) unlock PASS. Lockfiles / Dependabot / CI signing / container-only SBOM alone are not enough.

## Built-in highlight: tool-safety TOL-M1–M5 / R1–R2

```bash
npm run aprf:tool-gateway-authz -- --target <app> --out <app>/aprf-assessment
npm run aprf:tool-allowlist -- --target <app> --out <app>/aprf-assessment
npm run aprf:high-impact-tool-gates -- --target <app> --out <app>/aprf-assessment
npm run aprf:tool-argument-schema -- --target <app> --out <app>/aprf-assessment
npm run aprf:signed-tool-catalog -- --target <app> --out <app>/aprf-assessment
npm run aprf:destructive-tool-dry-run -- --target <app> --out <app>/aprf-assessment
npm run aprf:tool-rate-limits -- --target <app> --out <app>/aprf-assessment
```

Hybrid collectors: signals → PARTIAL; measured imports (≤90d) unlock PASS. Open MCP "all tools" / prompt-only allowlists alone are not enough.

## Built-in highlight: `injection-policy-gate` (SEC-M1)

```bash
npm run aprf:injection-gate -- --target <app> --out <app>/aprf-assessment
```

Needs server-side policy + versioned corpus + CI gate (≥95% deny, 0 model-text privilege grants).
