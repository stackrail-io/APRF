/**
 * Smoke: ai-trace-quality-annotations needs tooling + ≥50/90d + eval/review feed for PASS.
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
  aiTraceQualityAnnotationsCollector,
  type AiTraceQualityAnnotationsReport,
} from "../collectors/ai-trace-quality-annotations.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiTraceQualityAnnotationsReport> {
  await aiTraceQualityAnnotationsCollector.collect({
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
        "ai-trace-quality-annotations",
        "ai-trace-quality-annotations-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-obs-r2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "span-annotation.md"),
      "Quality label annotation on production traces\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.obsR2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "tooling"), { recursive: true });
    writeFileSync(
      join(t2, "tooling", "annotation-schema.yaml"),
      "Secure annotation tool schema; annotations feed eval loop\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-trace-quality-annotations"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-trace-quality-annotations", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        qualityAnnotationToolingConfigured: true,
        annotationsLast90Days: 55,
        annotationsFeedEvalOrReviewLoop: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.obsR2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "closed-loop.md"),
      "Closed-loop review loop for span annotations\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-trace-quality-annotations"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-trace-quality-annotations", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        qualityAnnotationToolingConfigured: true,
        annotationsLast90Days: 12,
        annotationsFeedEvalOrReviewLoop: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.obsR2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-trace-quality-annotations smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
