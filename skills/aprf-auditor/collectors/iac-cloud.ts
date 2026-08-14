/**
 * Local IaC scanners for AWS/Azure/GCP signals — no cloud API calls.
 * Live APIs remain opt-in via imports/ or future authenticated plugins.
 */
import type { Collector, CollectorContext, EvidenceNode } from "./types.ts";
import {
  ageDays,
  matchAny,
  mtimeDate,
  mtimeIso,
  readText,
  redact,
  rel,
  walkFiles,
} from "./lib/fs.ts";
import { importIngestCollector } from "./import-ingest.ts";

type Cloud = "aws" | "azure" | "gcp";

const PATTERNS: Record<
  Cloud,
  { path: string[]; content: RegExp; signals: string[]; checks: string[] }
> = {
  aws: {
    path: ["aws", "bedrock", ".tf", "cdk"],
    content:
      /aws_secretsmanager|secretsmanager|aws_iam|bedrock|cloudwatch_metric_alarm/i,
    signals: ["secrets-manager", "iam", "cloudwatch", "bedrock"],
    checks: ["SEC2-M1", "INF-M1", "OBS-M1", "COST-M1"],
  },
  azure: {
    path: ["azure", "bicep", ".tf"],
    content: /azurerm_key_vault|key_vault|azure.?openai|monitor_diagnostic/i,
    signals: ["key-vault", "monitor", "aoai"],
    checks: ["SEC2-M1", "OBS-M1", "INF-M1"],
  },
  gcp: {
    path: ["gcp", "google", "vertex", ".tf"],
    content: /google_secret_manager|secret_manager|vertex|monitoring_alert/i,
    signals: ["secret-manager", "monitoring", "vertex"],
    checks: ["SEC2-M1", "OBS-M1", "MOD-M1"],
  },
};

function cloudCollector(cloud: Cloud): Collector {
  const cfg = PATTERNS[cloud];
  return {
    id: cloud,
    async collect(ctx: CollectorContext) {
      const ingest = await importIngestCollector(cloud).collect(ctx);
      const files = walkFiles(ctx.targetPath, {
        maxFiles: ctx.maxFiles ?? 4000,
        extensions: [".tf", ".bicep", ".json", ".yml", ".yaml", ".ts", ".py"],
      });
      const nodes: EvidenceNode[] = [...ingest.nodes];
      let i = 0;
      for (const file of files) {
        const r = rel(ctx.targetPath, file);
        if (!matchAny(r, cfg.path) && !r.endsWith(".tf")) continue;
        const text = readText(file, 64_000) ?? "";
        if (!cfg.content.test(text) && !matchAny(r, cfg.path)) continue;
        if (!cfg.content.test(text)) continue;
        const mt = mtimeDate(file);
        const hitSignals = cfg.signals.filter((s) =>
          new RegExp(s.replace(/-/g, "[-_]?"), "i").test(text),
        );
        // Underscore type IDs are observedEvidenceTypes for matched[] (APRF-RFC-0011).
        const evidenceTypeSignals = ["repo_signal", "cloud_configuration"];
        nodes.push({
          id: `${cloud}:iac:${i++}:${r}`,
          class: "iac",
          ref: r,
          excerpt: redact(text.slice(0, 400)),
          pluginId: cloud,
          lastModified: mtimeIso(file),
          gitCommit: ctx.gitCommit,
          evidenceAgeDays: ageDays(ctx.assessedAt, mt),
          signals: [
            ...(hitSignals.length ? hitSignals : ["iac-match"]),
            ...evidenceTypeSignals,
          ],
          relatedCheckIds: cfg.checks,
        });
      }
      if (nodes.length === 0) {
        return {
          pluginId: cloud,
          status: "needs-user",
          detail: `No ${cloud.toUpperCase()} IaC signals and no imports/${cloud}/ — add Terraform/Bicep or an export`,
          nodes: [],
        };
      }
      return {
        pluginId: cloud,
        status: "ran",
        detail: `${cloud.toUpperCase()} local/IaC nodes: ${nodes.length}`,
        nodes,
      };
    },
  };
}

export const awsCollector = cloudCollector("aws");
export const azureCollector = cloudCollector("azure");
export const gcpCollector = cloudCollector("gcp");
