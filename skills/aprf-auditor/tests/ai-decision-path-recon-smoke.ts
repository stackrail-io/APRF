/**
 * Smoke: ai-decision-path-recon needs procedure + ≥3 samples within time budget.
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aiDecisionPathReconCollector,
  type AiDecisionPathReconReport,
} from "../collectors/ai-decision-path-recon.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiDecisionPathReconReport> {
  await aiDecisionPathReconCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-decision-path-recon",
        "ai-decision-path-recon-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-exp-m2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "decision-path-runbook.md"),
      "Operator decision_path reconstruction for model retrieval outcome\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.expM2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "drills"), { recursive: true });
    writeFileSync(
      join(t2, "drills", "timed_recon_drill.md"),
      "reconstruction_drill timed on sampled_trace three_traces\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-decision-path-recon"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-decision-path-recon", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        reconstructionProcedureDocumented: true,
        reconstructedSampleCount: 3,
        allSamplesWithinDocumentedTimeBudget: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.expM2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "drills"), { recursive: true });
    writeFileSync(
      join(t3, "drills", "explainability_drill.md"),
      "operator_drill production_trace_sample\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-decision-path-recon"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-decision-path-recon", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        reconstructionProcedureDocumented: true,
        reconstructedSampleCount: 2,
        allSamplesWithinDocumentedTimeBudget: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.expM2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-decision-path-recon smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
