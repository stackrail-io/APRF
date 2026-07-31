/**
 * Smoke: all six human-approval collectors (HUM-M1..M4, R1, R3).
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  humanApprovalAuditCollector,
  humanApprovalBypassCollector,
  humanApprovalGatesCollector,
  humanApprovalSlaCollector,
  humanApprovalUiCollector,
  humanDualControlCollector,
} from "../collectors/human-approval.ts";
import type { Collector, CollectorContext } from "../collectors/types.ts";

function readSummary(outDir: string, plugin: string, report: string) {
  return JSON.parse(
    readFileSync(join(outDir, "imports", plugin, report), "utf8"),
  ).summary as { statusHint: string; [k: string]: unknown };
}

async function expectNa(c: Collector, plugin: string, report: string) {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-hum-empty-"));
  const out = mkdtempSync(join(tmpdir(), "aprf-hum-o-"));
  const ctx: CollectorContext = {
    targetPath: targetDir,
    outputDir: out,
    assessedAt: new Date(),
    live: false,
    maxFiles: 100,
  };
  await c.collect(ctx);
  const s = readSummary(out, plugin, report);
  if (s.statusHint !== "not_applicable") {
    throw new Error(`${plugin}: expected N/A, got ${s.statusHint}`);
  }
}

async function main() {
  await expectNa(
    humanApprovalGatesCollector,
    "human-approval-gates",
    "human-approval-gates-report.json",
  );

  const targetDir = mkdtempSync(join(tmpdir(), "aprf-hum-t-"));
  mkdirSync(join(targetDir, "ops"), { recursive: true });
  writeFileSync(
    join(targetDir, "ops", "high_impact_inventory.yaml"),
    `
# high-impact action inventory + human-approval gate
actions:
  - class: send_email
    approval_gate: hitl-email
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "ops", "approval_audit.py"),
    `
# approval audit log: actor_id, action context, approve/deny outcome
def emit_approval(actor_id, context, outcome): ...
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "ops", "test_approval_bypass.py"),
    `
def test_api_bypass_without_approval_denied():
    assert not ungated_high_impact_via_api()
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "ops", "dual_control.yaml"),
    `
# dual-control / four-eyes for irreversible actions
require_second_approver: true
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "ops", "ApprovalModal.tsx"),
    `
// approval UI: tool args, change diff, confidence / risk score
export function ApprovalModal({ toolArgs, changeDiff, confidence }) { ... }
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "ops", "approval_queue_sla.md"),
    `
# Approval queue SLA: p95 queue age ≤ 15 minutes
`,
    "utf8",
  );

  const base: Omit<CollectorContext, "outputDir"> = {
    targetPath: targetDir,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };
  const now = new Date().toISOString();

  // M1 partial then pass
  const o1 = mkdtempSync(join(tmpdir(), "aprf-hum-m1-"));
  await humanApprovalGatesCollector.collect({ ...base, outputDir: o1 });
  if (readSummary(o1, "human-approval-gates", "human-approval-gates-report.json").statusHint !== "partial") {
    throw new Error("M1 expected partial");
  }
  const o1p = mkdtempSync(join(tmpdir(), "aprf-hum-m1p-"));
  mkdirSync(join(o1p, "imports", "human-approval-gates"), { recursive: true });
  writeFileSync(
    join(o1p, "imports", "human-approval-gates", "suite.json"),
    JSON.stringify({
      measuredAt: now,
      inventoryComplete: true,
      ungatedDenyRatePct: 100,
      results: [{ ungatedDenied: true }],
    }),
  );
  await humanApprovalGatesCollector.collect({ ...base, outputDir: o1p });
  if (readSummary(o1p, "human-approval-gates", "human-approval-gates-report.json").statusHint !== "pass") {
    throw new Error("M1 expected pass");
  }

  // M2
  const o2 = mkdtempSync(join(tmpdir(), "aprf-hum-m2-"));
  mkdirSync(join(o2, "imports", "human-approval-audit"), { recursive: true });
  writeFileSync(
    join(o2, "imports", "human-approval-audit", "samples.json"),
    JSON.stringify({
      measuredAt: now,
      schemaValidationPassed: true,
      samples: [
        { actorId: "u1", context: "send_email", outcome: "approve" },
      ],
    }),
  );
  await humanApprovalAuditCollector.collect({ ...base, outputDir: o2 });
  if (readSummary(o2, "human-approval-audit", "human-approval-audit-report.json").statusHint !== "pass") {
    throw new Error("M2 expected pass");
  }

  // M3
  const o3 = mkdtempSync(join(tmpdir(), "aprf-hum-m3-"));
  mkdirSync(join(o3, "imports", "human-approval-bypass"), { recursive: true });
  writeFileSync(
    join(o3, "imports", "human-approval-bypass", "suite.json"),
    JSON.stringify({
      measuredAt: now,
      ungatedSuccessCount: 0,
      cases: [{ path: "api", ungatedSucceeded: false }],
    }),
  );
  await humanApprovalBypassCollector.collect({ ...base, outputDir: o3 });
  if (readSummary(o3, "human-approval-bypass", "human-approval-bypass-report.json").statusHint !== "pass") {
    throw new Error("M3 expected pass");
  }

  // M4
  const o4 = mkdtempSync(join(tmpdir(), "aprf-hum-m4-"));
  mkdirSync(join(o4, "imports", "human-dual-control"), { recursive: true });
  writeFileSync(
    join(o4, "imports", "human-dual-control", "samples.json"),
    JSON.stringify({
      measuredAt: now,
      irreversibleInventoryPresent: true,
      dualApprovalPct: 100,
      singleApproverCount: 0,
      samples: [{ dualApproval: true, approvers: ["a", "b"] }],
    }),
  );
  await humanDualControlCollector.collect({ ...base, outputDir: o4 });
  if (readSummary(o4, "human-dual-control", "human-dual-control-report.json").statusHint !== "pass") {
    throw new Error("M4 expected pass");
  }

  // R1
  const o5 = mkdtempSync(join(tmpdir(), "aprf-hum-r1-"));
  mkdirSync(join(o5, "imports", "human-approval-ui"), { recursive: true });
  const samples = Array.from({ length: 10 }, (_, i) => ({
    toolArgs: { i },
    diff: "d",
    confidence: 0.9,
  }));
  writeFileSync(
    join(o5, "imports", "human-approval-ui", "samples.json"),
    JSON.stringify({ measuredAt: now, samples }),
  );
  await humanApprovalUiCollector.collect({ ...base, outputDir: o5 });
  if (readSummary(o5, "human-approval-ui", "human-approval-ui-report.json").statusHint !== "pass") {
    throw new Error("R1 expected pass");
  }

  // R3
  const o6 = mkdtempSync(join(tmpdir(), "aprf-hum-r3-"));
  mkdirSync(join(o6, "imports", "human-approval-sla"), { recursive: true });
  writeFileSync(
    join(o6, "imports", "human-approval-sla", "metrics.json"),
    JSON.stringify({
      measuredAt: now,
      p95QueueAgeMs: 60_000,
      slaMs: 900_000,
      withinSla: true,
    }),
  );
  await humanApprovalSlaCollector.collect({ ...base, outputDir: o6 });
  if (readSummary(o6, "human-approval-sla", "human-approval-sla-report.json").statusHint !== "pass") {
    throw new Error("R3 expected pass");
  }

  console.log("human-approval suite smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
