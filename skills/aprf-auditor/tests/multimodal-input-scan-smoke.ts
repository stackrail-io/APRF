/**
 * Smoke: multimodal-input-scan needs pre-ingest + type coverage + 0 unscanned.
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
  multimodalInputScanCollector,
  type MultimodalInputScanReport,
} from "../collectors/multimodal-input-scan.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<MultimodalInputScanReport> {
  await multimodalInputScanCollector.collect({
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
        "multimodal-input-scan",
        "multimodal-input-scan-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sec-r2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "image-upload.md"),
      "multimodal image_upload with malware_scan before_model_ingest\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.secR2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "gateway"), { recursive: true });
    writeFileSync(
      join(t2, "gateway", "file-ingest.ts"),
      "// file_upload clamav content_safety_scan pre_ingest\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "multimodal-input-scan"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "multimodal-input-scan", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        multimodalInputsAccepted: true,
        scannerRunsBeforeModelIngest: true,
        imageFileTypesInUseCoveredInLastReport: true,
        unscannedProductionMultimodalPaths: 0,
        lastReportAgeDays: 14,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.secR2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "multimodal-input-scan"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "multimodal-input-scan", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        multimodalInputsAccepted: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`n/a expected: ${JSON.stringify(rNa.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ops"), { recursive: true });
    writeFileSync(
      join(t3, "ops", "vision-input.md"),
      "vision_input image_moderation unscanned paths\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "multimodal-input-scan"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "multimodal-input-scan", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        multimodalInputsAccepted: true,
        scannerRunsBeforeModelIngest: true,
        imageFileTypesInUseCoveredInLastReport: true,
        unscannedProductionMultimodalPaths: 2,
        lastReportAgeDays: 7,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.secR2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("multimodal-input-scan smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
