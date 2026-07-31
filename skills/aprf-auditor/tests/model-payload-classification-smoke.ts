/**
 * Smoke: model-payload-classification needs scheme + 100% tagged audit for PASS.
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
  modelPayloadClassificationCollector,
  type ModelPayloadClassificationReport,
} from "../collectors/model-payload-classification.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): ModelPayloadClassificationReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "model-payload-classification",
        "model-payload-classification-report.json",
      ),
      "utf8",
    ),
  ) as ModelPayloadClassificationReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-prim1-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-prim1-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await modelPayloadClassificationCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "privacy"), { recursive: true });
  writeFileSync(
    join(targetDir, "privacy", "ai-payload-classification.md"),
    `
# AI data classification

## Payload classes
public, internal, confidential, restricted (PII)

## Sensitive class handling rules
- restricted: redact before model call; block if redaction fails
- confidential: allow with logging; residency constrained
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-prim1-1-"));
  await modelPayloadClassificationCollector.collect({
    ...baseCtx,
    outputDir: out1,
  });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.classificationSignalsPresent
  ) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-prim1-2-"));
  mkdirSync(join(out2, "imports", "model-payload-classification"), {
    recursive: true,
  });
  writeFileSync(
    join(out2, "imports", "model-payload-classification", "audit.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 3,
      classificationSchemeCoversAiPayloads: true,
      sensitiveHandlingRulesDocumented: true,
      sampleTaggedPct: 100,
      sensitiveHandlingMatchesPolicy: true,
    }),
    "utf8",
  );
  await modelPayloadClassificationCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.priM1Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  const out3 = mkdtempSync(join(tmpdir(), "aprf-prim1-3-"));
  mkdirSync(join(out3, "imports", "model-payload-classification"), {
    recursive: true,
  });
  writeFileSync(
    join(out3, "imports", "model-payload-classification", "audit.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      classificationSchemeCoversAiPayloads: true,
      sensitiveHandlingRulesDocumented: true,
      sampleTaggedPct: 92,
      sensitiveHandlingMatchesPolicy: true,
    }),
    "utf8",
  );
  await modelPayloadClassificationCollector.collect({
    ...baseCtx,
    outputDir: out3,
  });
  const r3 = readReport(out3);
  if (r3.summary.statusHint !== "fail") {
    throw new Error(`expected fail on <100% tagged, got ${r3.summary.statusHint}`);
  }

  console.log("model-payload-classification smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
