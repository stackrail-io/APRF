/**
 * Smoke: ai-vuln-scan-gate needs 100% coverage + critical block + 0 skipped
 * + retained + measuredAt ≤90d; deps-only without gate ≠ PASS.
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
  aiVulnScanGateCollector,
  type AiVulnScanGateReport,
} from "../collectors/ai-vuln-scan-gate.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiVulnScanGateReport> {
  await aiVulnScanGateCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-vuln-scan-gate", "ai-vuln-scan-gate-report.json"),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    productionAiArtifactsPresent: true,
    scanCoveragePct: 100,
    criticalFindingsBlockPromotion: true,
    skippedScans: 0,
    retainedResults: true,
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sci-m3-"));
  try {
    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const r0 = await run(tEmpty, join(root, "o0"));
    if (r0.summary.statusHint !== "not_demonstrated") {
      throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
    }

    const tScan = join(root, "t-scan");
    mkdirSync(join(tScan, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(tScan, ".github", "workflows", "trivy.yml"),
      "name: trivy\non: [push]\njobs:\n  scan:\n    runs-on: ubuntu-latest\n    steps:\n      - run: trivy image $IMAGE\n",
    );
    const r1 = await run(tScan, join(root, "o1"));
    if (r1.summary.statusHint !== "partial" || !r1.summary.surfaceProvedForNaOverride) {
      throw new Error(`expected partial with scan surface: ${JSON.stringify(r1.summary)}`);
    }

    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "ai-vuln-scan-gate"), { recursive: true });
    writeFileSync(
      join(outFail, "imports", "ai-vuln-scan-gate", "coverage.json"),
      coverage({ skippedScans: 1 }),
    );
    const r2 = await run(tScan, outFail);
    if (r2.summary.statusHint !== "fail") {
      throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
    }

    const outAged = join(root, "o-aged");
    mkdirSync(join(outAged, "imports", "ai-vuln-scan-gate"), { recursive: true });
    const aged = new Date();
    aged.setUTCDate(aged.getUTCDate() - 120);
    writeFileSync(
      join(outAged, "imports", "ai-vuln-scan-gate", "coverage.json"),
      coverage({ measuredAt: aged.toISOString() }),
    );
    const rAged = await run(tScan, outAged);
    if (rAged.summary.statusHint === "pass") {
      throw new Error(`over-age measuredAt must not PASS: ${JSON.stringify(rAged.summary)}`);
    }

    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "ai-vuln-scan-gate"), { recursive: true });
    writeFileSync(
      join(outPass, "imports", "ai-vuln-scan-gate", "coverage.json"),
      coverage(),
    );
    const r3 = await run(tScan, outPass);
    if (r3.summary.sciM3Satisfied !== true || r3.summary.statusHint !== "pass") {
      throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
    }

    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "ai-vuln-scan-gate"), { recursive: true });
    writeFileSync(
      join(outNa, "imports", "ai-vuln-scan-gate", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAiArtifactsPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    const outScanNa = join(root, "o-scan-na");
    mkdirSync(join(outScanNa, "imports", "ai-vuln-scan-gate"), { recursive: true });
    writeFileSync(
      join(outScanNa, "imports", "ai-vuln-scan-gate", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAiArtifactsPresent: false,
      }),
    );
    const rScanNa = await run(tScan, outScanNa);
    if (rScanNa.summary.statusHint === "not_applicable") {
      throw new Error("scan signals must block N/A launder");
    }

    const outFailNa = join(root, "o-fail-na");
    mkdirSync(join(outFailNa, "imports", "ai-vuln-scan-gate"), { recursive: true });
    writeFileSync(
      join(outFailNa, "imports", "ai-vuln-scan-gate", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAiArtifactsPresent: false,
        criticalFindingsBlockPromotion: false,
      }),
    );
    const rFailNa = await run(tEmpty, outFailNa);
    if (rFailNa.summary.statusHint !== "fail") {
      throw new Error(
        `failing block flag must beat N/A: ${JSON.stringify(rFailNa.summary)}`,
      );
    }

    console.log("aprf-auditor ai-vuln-scan-gate smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
