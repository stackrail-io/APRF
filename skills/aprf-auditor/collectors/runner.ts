#!/usr/bin/env npx tsx
/**
 * APRF Auditor evidence collectors — local CLI (no StackRail backend).
 *
 * Usage:
 *   npx tsx skills/aprf-auditor/collectors/runner.ts --target . --out ./aprf-assessment
 *   APRF_AUDITOR_LIVE=1 GITHUB_TOKEN=... npx tsx ... --live
 *
 * Modes:
 *   - Default: local filesystem / IaC / CI YAML + imports/<plugin>/ exports
 *   - --live: optional authenticated APIs (e.g. GitHub Actions runs)
 */
import { resolve } from "node:path";
import { COLLECTORS } from "./index.ts";
import type { CollectorContext, EvidenceGraph, EvidenceNode } from "./types.ts";
import {
  ensureDir,
  projectName,
  tryGitCommit,
  writeJson,
} from "./lib/fs.ts";

function parseArgs(argv: string[]) {
  const out: {
    target: string;
    outDir: string;
    live: boolean;
    plugins?: string[];
    maxFiles: number;
    baseUrl?: string;
    adminToken?: string;
    adminEmail?: string;
    adminPassword?: string;
  } = {
    target: process.cwd(),
    outDir: resolve(process.cwd(), "aprf-assessment"),
    live: process.env.APRF_AUDITOR_LIVE === "1",
    maxFiles: 4000,
    baseUrl: process.env.APRF_AUTH_PROBE_BASE_URL,
    adminToken: process.env.APRF_ADMIN_TOKEN,
    adminEmail: process.env.APRF_ADMIN_EMAIL || process.env.APRF_ADMIN_USER,
    adminPassword: process.env.APRF_ADMIN_PASSWORD,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target") out.target = resolve(argv[++i] ?? ".");
    else if (a === "--out") out.outDir = resolve(argv[++i] ?? out.outDir);
    else if (a === "--live") out.live = true;
    else if (a === "--base-url") out.baseUrl = argv[++i];
    else if (a === "--admin-token") out.adminToken = argv[++i];
    else if (a === "--admin-email" || a === "--admin-user")
      out.adminEmail = argv[++i];
    else if (a === "--admin-password") out.adminPassword = argv[++i];
    else if (a === "--plugins") {
      out.plugins = (argv[++i] ?? "").split(",").filter(Boolean);
    } else if (a === "--max-files") {
      out.maxFiles = Number(argv[++i] ?? 4000);
    } else if (a === "--help" || a === "-h") {
      console.log(`APRF Auditor collectors

Options:
  --target <path>     Project root to scan (default: cwd)
  --out <path>        Output dir (default: ./aprf-assessment)
  --plugins a,b,c     Subset of collector ids (default: all)
  --live              Allow credentialed API calls (also APRF_AUDITOR_LIVE=1)
  --base-url <url>    Running app URL (AUTHN-M1 probe / AUTHN-M2 live fetch)
                      (also APRF_AUTH_PROBE_BASE_URL)
  --admin-token <tok> Admin bearer token for MCP/S2S inventory live fetch
                      (also APRF_ADMIN_TOKEN) — never commit this value
  --admin-email <e>   Admin email for password sign-in (also APRF_ADMIN_EMAIL /
                      APRF_ADMIN_USER). Open WebUI uses email, not username.
  --admin-password <p> Admin password (also APRF_ADMIN_PASSWORD) — never commit
  --max-files <n>     Cap filesystem walk (default: 4000)

AUTHN-M1 live probe:
  npm run aprf:auth-probe -- --target <app> --out <app>/aprf-assessment \\
    --base-url http://127.0.0.1:8080

AUTHN-M2 MCP/S2S inventory:
  npm run aprf:mcp-s2s -- --target <app> --out <app>/aprf-assessment \\
    --base-url http://127.0.0.1:8080 --admin-token "$APRF_ADMIN_TOKEN"
  # or sign in with email/password (obtains JWT, does not store password):
  npm run aprf:mcp-s2s -- --target <app> --out <app>/aprf-assessment \\
    --base-url http://127.0.0.1:8080 \\
    --admin-email "$APRF_ADMIN_EMAIL" --admin-password "$APRF_ADMIN_PASSWORD"
  # or drop redacted JSON under imports/mcp-s2s-inventory/

Import runtime evidence without live APIs:
  mkdir -p <out>/imports/langsmith && cp traces.json <out>/imports/langsmith/
`);
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  ensureDir(args.outDir);
  ensureDir(resolve(args.outDir, "imports"));

  const assessedAt = new Date();
  const gitCommit = tryGitCommit(args.target);
  const ctx: CollectorContext = {
    targetPath: args.target,
    outputDir: args.outDir,
    assessedAt,
    gitCommit,
    live: args.live,
    maxFiles: args.maxFiles,
    baseUrl: args.baseUrl,
    adminToken: args.adminToken,
    adminEmail: args.adminEmail,
    adminPassword: args.adminPassword,
  };

  const selected = args.plugins
    ? COLLECTORS.filter((c) => args.plugins!.includes(c.id))
    : COLLECTORS;

  const collectorsMeta: EvidenceGraph["collectors"] = [];
  const nodes: EvidenceNode[] = [];

  for (const c of selected) {
    const result = await c.collect(ctx);
    collectorsMeta.push({
      pluginId: result.pluginId,
      status: result.status,
      detail: result.detail,
    });
    nodes.push(...result.nodes);
    console.log(
      `[${result.status}] ${result.pluginId}: ${result.detail ?? ""} (${result.nodes.length} nodes)`,
    );
  }

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  collectorsMeta.sort((a, b) => a.pluginId.localeCompare(b.pluginId));

  const graph: EvidenceGraph = {
    schemaVersion: "0.2.0",
    assessedAt: assessedAt.toISOString(),
    subject: {
      path: args.target,
      name: projectName(args.target),
      gitCommit,
    },
    collectors: collectorsMeta,
    nodes,
    edges: [],
  };

  const outPath = resolve(args.outDir, "evidence-graph.json");
  writeJson(outPath, graph);
  console.log(`\nWrote ${outPath} (${nodes.length} nodes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
