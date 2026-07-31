/**
 * Smoke: ai-deletion-export needs AI-scoped procedure + within-SLA timed test.
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
  aiDeletionExportCollector,
  type AiDeletionExportReport,
} from "../collectors/ai-deletion-export.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): AiDeletionExportReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-deletion-export",
        "ai-deletion-export-report.json",
      ),
      "utf8",
    ),
  ) as AiDeletionExportReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-prim2del-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-prim2del-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await aiDeletionExportCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "privacy"), { recursive: true });
  writeFileSync(
    join(targetDir, "privacy", "ai-deletion-export-runbook.md"),
    `
# Tenant deletion / export

Covers AI memory (conversation memory, durable memory, vector store) and
AI logs (prompt logs, model logs).

## SLA
Deletion completes within 72 hours.

## Test
Sample tenant purge records completion time.
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-prim2del-1-"));
  await aiDeletionExportCollector.collect({
    ...baseCtx,
    outputDir: out1,
  });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.procedureSignalsPresent
  ) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-prim2del-2-"));
  mkdirSync(join(out2, "imports", "ai-deletion-export"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "ai-deletion-export", "test.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 2,
      procedureCoversAiMemory: true,
      procedureCoversAiLogs: true,
      sampleTestCompleted: true,
      completedWithinSla: true,
      measuredDurationSeconds: 3600,
    }),
    "utf8",
  );
  await aiDeletionExportCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.priM2Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  const out3 = mkdtempSync(join(tmpdir(), "aprf-prim2del-3-"));
  mkdirSync(join(out3, "imports", "ai-deletion-export"), { recursive: true });
  writeFileSync(
    join(out3, "imports", "ai-deletion-export", "test.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      procedureCoversAiMemory: true,
      procedureCoversAiLogs: true,
      sampleTestCompleted: true,
      completedWithinSla: false,
      measuredDurationSeconds: 999999,
    }),
    "utf8",
  );
  await aiDeletionExportCollector.collect({
    ...baseCtx,
    outputDir: out3,
  });
  const r3 = readReport(out3);
  if (r3.summary.statusHint !== "fail") {
    throw new Error(`expected fail on SLA miss, got ${r3.summary.statusHint}`);
  }

  console.log("ai-deletion-export smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
