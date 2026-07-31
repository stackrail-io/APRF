/**
 * Smoke: model-payload-redaction needs ≥50 clean samples + fail-closed for PASS.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildModelPayloadRedactionReport,
  modelPayloadRedactionCollector,
} from "../collectors/model-payload-redaction.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function runCollector(
  target: string,
  outDir: string,
): Promise<ReturnType<typeof buildModelPayloadRedactionReport>> {
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  };
  await modelPayloadRedactionCollector.collect(ctx);
  const reportPath = join(
    outDir,
    "imports",
    "model-payload-redaction",
    "model-payload-redaction-report.json",
  );
  const { readFileSync } = await import("node:fs");
  return JSON.parse(readFileSync(reportPath, "utf8"));
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-mpr-"));
  try {
    // partial: pipeline signal only
    const t1 = join(root, "t1");
    mkdirSync(t1, { recursive: true });
    writeFileSync(
      join(t1, "redact_pipeline.py"),
      "# pre-model redaction pipeline before openai call\ndef redact_before_model(payload): ...\n",
    );
    const out1 = join(root, "o1");
    const r1 = await runCollector(t1, out1);
    if (r1.summary.statusHint !== "partial" || r1.summary.priR1Satisfied !== false) {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    // pass: import complete
    const t2 = join(root, "t2");
    mkdirSync(t2, { recursive: true });
    writeFileSync(
      join(t2, "tokenize_pipeline.md"),
      "pre-model tokenization pipeline with fail-closed on redaction error\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "model-payload-redaction"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "model-payload-redaction", "sample.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highSensitivityFieldsDocumented: true,
        pipelineFailClosed: true,
        sampleSize: 50,
        cleartextHits: 0,
      }),
    );
    const r2 = await runCollector(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.priR1Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    // fail: cleartext hits
    const t3 = join(root, "t3");
    mkdirSync(t3, { recursive: true });
    writeFileSync(
      join(t3, "redact.md"),
      "pre-model redaction pipeline for high-sensitivity fields\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "model-payload-redaction"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "model-payload-redaction", "sample.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highSensitivityFieldsDocumented: true,
        pipelineFailClosed: true,
        sampleSize: 50,
        cleartextHits: 2,
      }),
    );
    const r3 = await runCollector(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.priR1Satisfied !== false) {
      throw new Error(`expected fail, got ${JSON.stringify(r3.summary)}`);
    }

    console.log("model-payload-redaction smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
