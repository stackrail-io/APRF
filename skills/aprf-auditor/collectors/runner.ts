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
  } = {
    target: process.cwd(),
    outDir: resolve(process.cwd(), "aprf-assessment"),
    live: process.env.APRF_AUDITOR_LIVE === "1",
    maxFiles: 4000,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target") out.target = resolve(argv[++i] ?? ".");
    else if (a === "--out") out.outDir = resolve(argv[++i] ?? out.outDir);
    else if (a === "--live") out.live = true;
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
  --max-files <n>     Cap filesystem walk (default: 4000)

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
