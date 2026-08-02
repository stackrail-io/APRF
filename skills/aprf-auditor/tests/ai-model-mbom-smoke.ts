/**
 * Smoke: ai-model-mbom needs 100% registry-linked MBOM + retention ≥90d +
 * measuredAt ≤90d; container-only SBOM ≠ PASS.
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
  aiModelMbomCollector,
  type AiModelMbomReport,
} from "../collectors/ai-model-mbom.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiModelMbomReport> {
  await aiModelMbomCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-model-mbom", "ai-model-mbom-report.json"),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    productionModelPinsPresent: true,
    pinsWithLinkedMbomPct: 100,
    retentionDaysSatisfied: true,
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sci-r2-"));
  try {
    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const r0 = await run(tEmpty, join(root, "o0"));
    if (r0.summary.statusHint !== "not_demonstrated") {
      throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
    }

    // Container SBOM alone → PARTIAL, does not prove model-pin surface for N/A override
    const tSbom = join(root, "t-sbom");
    mkdirSync(tSbom, { recursive: true });
    writeFileSync(join(tSbom, "sbom.json"), '{"bomFormat":"CycloneDX","components":[]}\n');
    const rSbom = await run(tSbom, join(root, "o-sbom"));
    if (
      rSbom.summary.statusHint !== "partial" ||
      rSbom.summary.surfaceProvedForNaOverride ||
      !rSbom.summary.gateSignalsPresent
    ) {
      throw new Error(
        `container SBOM alone expected partial without model surface: ${JSON.stringify(rSbom.summary)}`,
      );
    }

    const tMbom = join(root, "t-mbom");
    mkdirSync(join(tMbom, "docs"), { recursive: true });
    writeFileSync(
      join(tMbom, "docs", "model-mbom.md"),
      "Production models publish an ML-BOM linked from the model registry.\n",
    );
    const r1 = await run(tMbom, join(root, "o1"));
    if (r1.summary.statusHint !== "partial" || !r1.summary.surfaceProvedForNaOverride) {
      throw new Error(`expected partial with MBOM surface: ${JSON.stringify(r1.summary)}`);
    }

    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "ai-model-mbom"), { recursive: true });
    writeFileSync(
      join(outFail, "imports", "ai-model-mbom", "coverage.json"),
      coverage({ pinsWithLinkedMbomPct: 80 }),
    );
    const r2 = await run(tMbom, outFail);
    if (r2.summary.statusHint !== "fail") {
      throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
    }

    const outAged = join(root, "o-aged");
    mkdirSync(join(outAged, "imports", "ai-model-mbom"), { recursive: true });
    const aged = new Date();
    aged.setUTCDate(aged.getUTCDate() - 120);
    writeFileSync(
      join(outAged, "imports", "ai-model-mbom", "coverage.json"),
      coverage({ measuredAt: aged.toISOString() }),
    );
    const rAged = await run(tMbom, outAged);
    if (rAged.summary.statusHint === "pass") {
      throw new Error(`over-age measuredAt must not PASS: ${JSON.stringify(rAged.summary)}`);
    }

    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "ai-model-mbom"), { recursive: true });
    writeFileSync(
      join(outPass, "imports", "ai-model-mbom", "coverage.json"),
      coverage(),
    );
    const r3 = await run(tMbom, outPass);
    if (r3.summary.sciR2Satisfied !== true || r3.summary.statusHint !== "pass") {
      throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
    }

    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "ai-model-mbom"), { recursive: true });
    writeFileSync(
      join(outNa, "imports", "ai-model-mbom", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionModelPinsPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    // SBOM alone + present=false may N/A (container SBOM does not prove model surface)
    const outSbomNa = join(root, "o-sbom-na");
    mkdirSync(join(outSbomNa, "imports", "ai-model-mbom"), { recursive: true });
    writeFileSync(
      join(outSbomNa, "imports", "ai-model-mbom", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionModelPinsPresent: false,
      }),
    );
    const rSbomNa = await run(tSbom, outSbomNa);
    if (rSbomNa.summary.statusHint !== "not_applicable") {
      throw new Error(
        `SBOM-only + present=false should N/A: ${JSON.stringify(rSbomNa.summary)}`,
      );
    }

    const outMbomNa = join(root, "o-mbom-na");
    mkdirSync(join(outMbomNa, "imports", "ai-model-mbom"), { recursive: true });
    writeFileSync(
      join(outMbomNa, "imports", "ai-model-mbom", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionModelPinsPresent: false,
      }),
    );
    const rMbomNa = await run(tMbom, outMbomNa);
    if (rMbomNa.summary.statusHint === "not_applicable") {
      throw new Error("MBOM signals must block N/A launder");
    }

    const outFailNa = join(root, "o-fail-na");
    mkdirSync(join(outFailNa, "imports", "ai-model-mbom"), { recursive: true });
    writeFileSync(
      join(outFailNa, "imports", "ai-model-mbom", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionModelPinsPresent: false,
        retentionDaysSatisfied: false,
      }),
    );
    const rFailNa = await run(tEmpty, outFailNa);
    if (rFailNa.summary.statusHint !== "fail") {
      throw new Error(
        `failing retention must beat N/A: ${JSON.stringify(rFailNa.summary)}`,
      );
    }

    console.log("aprf-auditor ai-model-mbom smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
