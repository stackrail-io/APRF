/**
 * Smoke: ai-control-evidence-matrix needs 100% coverage + fresh review for PASS.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aiControlEvidenceMatrixCollector,
  type AiControlEvidenceMatrixReport,
} from "../collectors/ai-control-evidence-matrix.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function runCollector(
  target: string,
  outDir: string,
): Promise<AiControlEvidenceMatrixReport> {
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  };
  await aiControlEvidenceMatrixCollector.collect(ctx);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-control-evidence-matrix",
        "ai-control-evidence-matrix-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-cmpmat-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "control_evidence_matrix.md"),
      `# Control to evidence matrix
obligation GDPR -> evidence_id: CMP-M1-art
`,
    );
    const out1 = join(root, "o1");
    const r1 = await runCollector(t1, out1);
    if (r1.summary.statusHint !== "partial" || r1.summary.cmpM2Satisfied !== false) {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "compliance"), { recursive: true });
    writeFileSync(
      join(t2, "compliance", "matrix.yaml"),
      "control_evidence_matrix:\n  - obligation: x\n    evidence_id: y\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-control-evidence-matrix"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-control-evidence-matrix", "matrix.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        coversAllInScopeObligations: true,
        orphanObligationCount: 0,
        matrixReviewAgeDays: 30,
        inScopeObligationCount: 5,
      }),
    );
    const r2 = await runCollector(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.cmpM2Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "matrix.md"),
      "evidence matrix control to evidence mapping\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-control-evidence-matrix"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-control-evidence-matrix", "matrix.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        coversAllInScopeObligations: true,
        orphanObligationCount: 2,
        matrixReviewAgeDays: 30,
      }),
    );
    const r3 = await runCollector(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.cmpM2Satisfied !== false) {
      throw new Error(`expected fail, got ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-control-evidence-matrix smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
