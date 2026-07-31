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

AGN-M1 agent charters:
  npm run aprf:agent-charters -- --target <app> --out <app>/aprf-assessment
  # PASS needs complete inventory under imports/agent-charter-inventory/

AGN-M2 agent loop limits:
  npm run aprf:agent-limits -- --target <app> --out <app>/aprf-assessment
  # PASS needs measured abort suite under imports/agent-loop-limits/

AGN-M3 agent kill switch:
  npm run aprf:agent-kill -- --target <app> --out <app>/aprf-assessment
  # PASS needs cancel suite + drill under imports/agent-kill-switch/

AGN-M4 A2A peer auth:
  npm run aprf:a2a-auth -- --target <app> --out <app>/aprf-assessment
  # PASS needs deny suite under imports/a2a-peer-auth/

AGN-R1 goal-conflict plan policy:
  npm run aprf:agent-goal-policy -- --target <app> --out <app>/aprf-assessment
  # PASS needs synthetic deny under imports/agent-goal-policy/

AGN-R2 agent sandbox / simulation:
  npm run aprf:agent-sandbox -- --target <app> --out <app>/aprf-assessment
  # PASS needs linked ≤30d sim report under imports/agent-sandbox-sim/

AGN-R3 agent RACI ownership:
  npm run aprf:agent-raci -- --target <app> --out <app>/aprf-assessment
  # PASS needs register export under imports/agent-raci-ownership/

Human approval (HUM-M1–M4, R1, R3):
  npm run aprf:human-approval -- --target <app> --out <app>/aprf-assessment
  # PASS unlocks via imports/human-approval-*/ suite JSON per Check

COST-M1 AI spend / rate limits:
  npm run aprf:spend-limits -- --target <app> --out <app>/aprf-assessment
  # PASS needs enforce-on-exceed under imports/ai-spend-limits/

COST-M2 AI cost budget-burn / anomaly alerts:
  npm run aprf:cost-alerts -- --target <app> --out <app>/aprf-assessment
  # PASS needs notify proof under imports/ai-cost-alerts/

COST-M3 AI retry / loop cost amplification:
  npm run aprf:retry-amplification -- --target <app> --out <app>/aprf-assessment
  # PASS needs amplificationBounded under imports/ai-retry-amplification/

COST-R1 AI prompt/response cache:
  npm run aprf:prompt-cache -- --target <app> --out <app>/aprf-assessment
  # PASS needs ≥30-day hit-rate/savings under imports/ai-prompt-cache/

COST-R2 AI cheap-vs-premium model routing:
  npm run aprf:model-routing -- --target <app> --out <app>/aprf-assessment
  # PASS needs eval + misroute under imports/ai-model-routing/

COST-R3 AI FinOps unit economics:
  npm run aprf:finops-unit-economics -- --target <app> --out <app>/aprf-assessment
  # PASS needs quarterly metrics + review under imports/ai-finops-unit-economics/

DX-M1 AI golden-path documentation:
  npm run aprf:golden-path -- --target <app> --out <app>/aprf-assessment
  # PASS needs review attestation under imports/platform-golden-path/

DX-M2 AI pipeline auth/secret-scan/eval gates:
  npm run aprf:ai-pipeline-gates -- --target <app> --out <app>/aprf-assessment
  # PASS needs blockingOnFail under imports/platform-ai-pipeline-gates/

DX-R4 AI platform ownership + support:
  npm run aprf:platform-ownership -- --target <app> --out <app>/aprf-assessment
  # PASS needs owner+channel+(pingWithinSla|onCallListed) under imports/platform-ownership-support/

DX-R1 agent/RAG/MCP scaffolding templates:
  npm run aprf:scaffolding-templates -- --target <app> --out <app>/aprf-assessment
  # PASS needs three templates + defaults + adoption under imports/platform-scaffolding-templates/

DX-R2 inner-loop eval runners (pre-PR):
  npm run aprf:inner-loop-evals -- --target <app> --out <app>/aprf-assessment
  # PASS needs runner + one-command + pre-PR sample/waiver under imports/platform-inner-loop-evals/

DX-R3 DX metrics (TTSP + bypass rate):
  npm run aprf:dx-metrics -- --target <app> --out <app>/aprf-assessment
  # PASS needs formulas + ≥30d series + bypass alert/owner under imports/platform-dx-metrics/

DG-M1 production RAG corpus/index ownership + cadence:
  npm run aprf:rag-corpus -- --target <app> --out <app>/aprf-assessment
  # PASS needs complete inventory under imports/rag-corpus-governance/

DG-M2 eval/fine-tune dataset provenance + quality:
  npm run aprf:dataset-provenance -- --target <app> --out <app>/aprf-assessment
  # PASS needs inventory + promotionBlockedIfMissing under imports/dataset-provenance-governance/

DG-M3 feedback/memory promotion gates:
  npm run aprf:feedback-promotion -- --target <app> --out <app>/aprf-assessment
  # PASS needs gated paths + ungatedPromotionDenied under imports/feedback-promotion-governance/

DG-R1 critical corpus freshness metrics:
  npm run aprf:corpus-freshness -- --target <app> --out <app>/aprf-assessment
  # PASS needs SLOs + ≥95% meet-rate + alert under imports/corpus-freshness-metrics/

DG-R2 train/serve skew monitoring:
  npm run aprf:train-serve-skew -- --target <app> --out <app>/aprf-assessment
  # PASS needs recent skew job + threshold + breach ticket/page under imports/train-serve-skew-monitor/

DG-R3 major eval/fine-tune dataset cards:
  npm run aprf:dataset-cards -- --target <app> --out <app>/aprf-assessment
  # PASS needs purpose/source/PII + ≤12mo cards under imports/dataset-cards-registry/

PRI-M1 model payload classification:
  npm run aprf:payload-classification -- --target <app> --out <app>/aprf-assessment
  # PASS needs scheme + sensitive rules + 100% tagged audit under imports/model-payload-classification/

PRI-R1 pre-model tokenization/redaction:
  npm run aprf:payload-redaction -- --target <app> --out <app>/aprf-assessment
  # PASS needs field inventory + fail-closed pipeline + ≥50 clean samples under imports/model-payload-redaction/

PRI-R2 vendor model terms (training use + retention):
  npm run aprf:vendor-model-terms -- --target <app> --out <app>/aprf-assessment
  # PASS needs provider inventory + ≤12mo reviews under imports/vendor-model-terms/

PRI-M2 AI memory/log deletion and export:
  npm run aprf:ai-deletion-export -- --target <app> --out <app>/aprf-assessment
  # PASS needs AI-scoped procedure + within-SLA timed test under imports/ai-deletion-export/

PRI-M3 residency-constrained routing:
  npm run aprf:ai-residency-routing -- --target <app> --out <app>/aprf-assessment
  # PASS needs labeled regulated workloads + 100% in-region sample under imports/ai-residency-routing/

PRI-R3 DPIA/PIA before production:
  npm run aprf:ai-dpia -- --target <app> --out <app>/aprf-assessment
  # PASS needs major-feature inventory + signed pre-prod DPIAs under imports/ai-dpia/

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
