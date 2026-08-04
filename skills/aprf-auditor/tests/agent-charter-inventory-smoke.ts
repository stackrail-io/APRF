/**
 * Smoke: agent-charter-inventory needs inventory fields + complete import for PASS.
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
  agentCharterInventoryCollector,
  type AgentCharterInventoryReport,
} from "../collectors/agent-charter-inventory.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): AgentCharterInventoryReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "agent-charter-inventory",
        "agent-charter-inventory-report.json",
      ),
      "utf8",
    ),
  ) as AgentCharterInventoryReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-agn1-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-agn1-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await agentCharterInventoryCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "agents"), { recursive: true });
  writeFileSync(
    join(targetDir, "agents", "inventory.yaml"),
    `
agents:
  - id: support-agent
    purpose: Resolve customer support tickets
    tool_allowlist: [search_kb, create_ticket]
    data_scope: support_corpus_v2
    autonomy_limits: { max_steps: 20, spawn_depth: 0 }
    owner: platform-oncall
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "agents", "charter.md"),
    `# Support agent charter
purpose: help customers
tool allowlist: search_kb
data scope: tenant support docs
autonomy limits: max_steps 20
owner: platform-oncall
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-agn1-1-"));
  await agentCharterInventoryCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = readReport(out1);
  if (r1.summary.statusHint !== "partial" || !r1.summary.inventoryPresent) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-agn1-2-"));
  mkdirSync(join(out2, "imports", "agent-charter-inventory"), {
    recursive: true,
  });
  writeFileSync(
    join(out2, "imports", "agent-charter-inventory", "inventory.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      coversAllProductionAgents: true,
      agents: [
        {
          id: "support-agent",
          purpose: "Resolve tickets",
          allowedTools: ["search_kb"],
          forbiddenTools: ["shell"],
          dataScope: "support_corpus",
          autonomy: { maxSteps: 20, wallClockSeconds: 60, spawnDepth: 0 },
          owner: "engineering",
          approvalPolicy: "approved",
          identityPolicy: "workload identity",
          loggingPolicy: "retain 90d",
          memoryPolicy: "session only",
          networkPolicy: "internal only",
          reviewDate: "2026-07-01",
          lastUpdated: "2026-07-10T09:00:00Z",
          expiryDate: "2027-07-01",
          agentVersion: 1,
        },
      ],
    }),
    "utf8",
  );
  await agentCharterInventoryCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.agnM1Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }
  if (r2.summary.severityHint !== "high") {
    throw new Error(`expected severityHint=high on pass, got ${r2.summary.severityHint}`);
  }

  // Incomplete inventory attestation → critical escalation
  const out3 = mkdtempSync(join(tmpdir(), "aprf-agn1-3-"));
  mkdirSync(join(out3, "imports", "agent-charter-inventory"), {
    recursive: true,
  });
  writeFileSync(
    join(out3, "imports", "agent-charter-inventory", "inventory.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      coversAllProductionAgents: false,
      agents: [
        {
          id: "orphan-agent",
          purpose: "Unknown",
          tool_allowlist: ["shell"],
          data_scope: "all",
          autonomy: { max_steps: 100 },
          owner: "platform-oncall",
          review_date: "2026-07-01",
          last_updated: "2026-07-10T09:00:00Z",
          charter_version: "1.0.0",
          approval_status: "approved",
        },
      ],
    }),
    "utf8",
  );
  await agentCharterInventoryCollector.collect({ ...baseCtx, outputDir: out3 });
  const r3 = readReport(out3);
  if (r3.summary.statusHint !== "partial") {
    throw new Error(`expected partial for incomplete coverage, got ${r3.summary.statusHint}`);
  }
  if (r3.summary.severityHint !== "critical") {
    throw new Error(
      `expected severityHint=critical when completeness unproven, got ${r3.summary.severityHint}`,
    );
  }

  console.log("agent-charter-inventory smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
