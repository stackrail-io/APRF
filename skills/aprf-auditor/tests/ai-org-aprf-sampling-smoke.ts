import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aiOrgAprfSamplingCollector,
  type AiOrgAprfSamplingReport,
} from "../collectors/ai-org-aprf-sampling.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(target: string, outDir: string): Promise<AiOrgAprfSamplingReport> {
  await aiOrgAprfSamplingCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-org-aprf-sampling", "ai-org-aprf-sampling-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-org-r5-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "internal_audit_aprf.md"),
      "Internal audit APRF evidence sampling with sampled check findings\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (r1.summary.statusHint !== "partial" || r1.summary.orgR5Satisfied !== false) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(join(t2, "docs", "independent_assessment.md"), "independent assessment org sample\n");
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-org-aprf-sampling"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-org-aprf-sampling", "report.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        assessmentAgeDays: 90,
        sampledCheckIds: ["ORG-M1", "CMP-M1"],
        findingsListed: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.orgR5Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(join(t3, "docs", "aprf_sample.md"), "org APRF evidence sampling\n");
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-org-aprf-sampling"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-org-aprf-sampling", "report.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        assessmentAgeDays: 400,
        sampledCheckIdCount: 5,
        findingsListed: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.orgR5Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }
    console.log("ai-org-aprf-sampling smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
