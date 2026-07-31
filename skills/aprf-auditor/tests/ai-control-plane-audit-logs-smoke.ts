/**
 * Smoke: ai-control-plane-audit-logs needs retention + ≤5min smoke for PASS.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aiControlPlaneAuditLogsCollector,
  type AiControlPlaneAuditLogsReport,
} from "../collectors/ai-control-plane-audit-logs.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function runCollector(
  target: string,
  outDir: string,
): Promise<AiControlPlaneAuditLogsReport> {
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  };
  await aiControlPlaneAuditLogsCollector.collect(ctx);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-control-plane-audit-logs",
        "ai-control-plane-audit-logs-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-cmpaud-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "infra"), { recursive: true });
    writeFileSync(
      join(t1, "infra", "audit_retention.tf"),
      `# audit log retention for control-plane model promotion events
resource "aws_cloudwatch_log_group" "ai_cp" {
  retention_in_days = 365
}
`,
    );
    const out1 = join(root, "o1");
    const r1 = await runCollector(t1, out1);
    if (r1.summary.statusHint !== "partial" || r1.summary.cmpM3Satisfied !== false) {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "control_plane_audit.md"),
      "control-plane kill-switch changes go to audit trail with retention\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-control-plane-audit-logs"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-control-plane-audit-logs", "smoke.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        retentionConfiguredDays: 365,
        policyMinimumDays: 365,
        syntheticAppearMinutes: 2,
        remainsQueryableAfterSmoke: true,
      }),
    );
    const r2 = await runCollector(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.cmpM3Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "audit.md"),
      "AI control-plane audit log retention smoke\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-control-plane-audit-logs"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-control-plane-audit-logs", "smoke.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        retentionConfiguredDays: 365,
        policyMinimumDays: 365,
        syntheticAppearMinutes: 12,
        remainsQueryableAfterSmoke: true,
      }),
    );
    const r3 = await runCollector(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.cmpM3Satisfied !== false) {
      throw new Error(`expected fail, got ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-control-plane-audit-logs smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
