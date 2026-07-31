/**
 * Smoke: agent-raci-ownership needs RACI + zero-orphan import for PASS.
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
  agentRaciOwnershipCollector,
  type AgentRaciOwnershipReport,
} from "../collectors/agent-raci-ownership.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): AgentRaciOwnershipReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "agent-raci-ownership",
        "agent-raci-ownership-report.json",
      ),
      "utf8",
    ),
  ) as AgentRaciOwnershipReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-agnr3-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-agnr3-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await agentRaciOwnershipCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "governance"), { recursive: true });
  writeFileSync(
    join(targetDir, "governance", "agent-raci.yaml"),
    `
# Agent RACI ownership register
# responsible / accountable roles across teams
agents:
  - id: support-agent
    responsible: platform-oncall
    accountable: product-owner
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-agnr3-1-"));
  await agentRaciOwnershipCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = readReport(out1);
  if (r1.summary.statusHint !== "partial" || !r1.summary.raciPresent) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-agnr3-2-"));
  mkdirSync(join(out2, "imports", "agent-raci-ownership"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "agent-raci-ownership", "register.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      coversAllProductionIds: true,
      orphanCount: 0,
      responsibleAccountableComplete: true,
      agents: [
        {
          id: "support-agent",
          responsible: "platform-oncall",
          accountable: "product-owner",
        },
      ],
    }),
    "utf8",
  );
  await agentRaciOwnershipCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.agnR3Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("agent-raci-ownership smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
