/**
 * Smoke: ai-independent-assessment needs L5 coverage + sample + owners for PASS.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aiIndependentAssessmentCollector,
  type AiIndependentAssessmentReport,
} from "../collectors/ai-independent-assessment.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function runCollector(
  target: string,
  outDir: string,
): Promise<AiIndependentAssessmentReport> {
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  };
  await aiIndependentAssessmentCollector.collect(ctx);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-independent-assessment",
        "ai-independent-assessment-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-cmp-r3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "independent_assessment.md"),
      `# Independent assessment
Internal audit of Level 5 AI systems against APRF gates.
Sampled check IDs, findings, and remediation owners recorded.
`,
    );
    const out1 = join(root, "o1");
    const r1 = await runCollector(t1, out1);
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.cmpR3Satisfied !== false
    ) {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "assurance.md"),
      "independent assessment and internal audit for level 5 systems\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-independent-assessment"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-independent-assessment", "report.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        coversAllLevel5Systems: true,
        level5SystemCount: 2,
        level5SystemsMissing: 0,
        sampledCheckIds: ["CMP-M1", "CMP-M2", "SEC2-M1"],
        findingsHaveRemediationOwners: true,
        assessmentAgeDays: 60,
      }),
    );
    const r2 = await runCollector(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.cmpR3Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "level5_audit.md"),
      "level 5 external audit with sampled check findings\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-independent-assessment"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-independent-assessment", "report.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        coversAllLevel5Systems: false,
        level5SystemsMissing: 1,
        sampledCheckIdCount: 5,
        findingsHaveRemediationOwners: true,
        assessmentAgeDays: 30,
      }),
    );
    const r3 = await runCollector(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.cmpR3Satisfied !== false) {
      throw new Error(`expected fail, got ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-independent-assessment smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
