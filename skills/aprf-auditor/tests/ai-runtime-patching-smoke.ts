/**
 * Smoke: ai-runtime-patching needs inventory + org SLA + 100% within SLA +
 * 0 unwaived + vuln/age report.
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
  aiRuntimePatchingCollector,
  type AiRuntimePatchingReport,
} from "../collectors/ai-runtime-patching.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiRuntimePatchingReport> {
  await aiRuntimePatchingCollector.collect({
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
        "ai-runtime-patching",
        "ai-runtime-patching-report.json",
      ),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    patchingSlaDocumented: true,
    productionAiRuntimesWithinDocumentedPatchingSlaPct: 100,
    openSlaBreachesWithoutApprovedWaiver: 0,
    vulnerabilityOrImageAgeReportPresent: true,
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-inf-m2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "patching-sla.md"),
      "patching_sla critical_fix_within org policy for ai_runtime\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.infM2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ops"), { recursive: true });
    writeFileSync(
      join(t2, "ops", "runtime-inventory.md"),
      "production_ai_runtime inventory sagemaker vertex_ai cloud_run\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-runtime-patching"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-runtime-patching", "coverage.json"),
      coverage({ productionAiRuntimeEnvironmentsPresent: true }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.infM2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ci"), { recursive: true });
    writeFileSync(
      join(t3, "ci", "trivy.yaml"),
      "trivy image_age cve_scan vulnerability_report\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-runtime-patching"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-runtime-patching", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        patchingSlaDocumented: true,
        productionAiRuntimesWithinDocumentedPatchingSlaPct: 80,
        openSlaBreachesWithoutApprovedWaiver: 2,
        vulnerabilityOrImageAgeReportPresent: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.infM2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "ai-runtime-patching"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "ai-runtime-patching", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAiRuntimeEnvironmentsPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    // SLA/CVE docs alone must not block present=false N/A.
    const tSlaCve = join(root, "t-sla-cve");
    mkdirSync(join(tSlaCve, "docs"), { recursive: true });
    writeFileSync(
      join(tSlaCve, "docs", "patching-sla.md"),
      "patching_sla policy\n",
    );
    writeFileSync(
      join(tSlaCve, "docs", "trivy.md"),
      "trivy cve_scan vulnerability_report\n",
    );
    const outSlaCve = join(root, "o-sla-cve");
    mkdirSync(join(outSlaCve, "imports", "ai-runtime-patching"), {
      recursive: true,
    });
    writeFileSync(
      join(outSlaCve, "imports", "ai-runtime-patching", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAiRuntimeEnvironmentsPresent: false,
      }),
    );
    const rSlaCve = await run(tSlaCve, outSlaCve);
    if (rSlaCve.summary.statusHint !== "not_applicable") {
      throw new Error(
        `SLA+CVE without inventory must allow N/A: ${JSON.stringify(rSlaCve.summary)}`,
      );
    }

    // SLA-only + perfect metrics without inventory/present → PARTIAL.
    const tSlaOnly = join(root, "t-sla-only");
    mkdirSync(join(tSlaOnly, "docs"), { recursive: true });
    writeFileSync(
      join(tSlaOnly, "docs", "patching-sla.md"),
      "patching_sla critical_fix_within\n",
    );
    const outSlaOnly = join(root, "o-sla-only");
    mkdirSync(join(outSlaOnly, "imports", "ai-runtime-patching"), {
      recursive: true,
    });
    writeFileSync(
      join(outSlaOnly, "imports", "ai-runtime-patching", "coverage.json"),
      coverage(),
    );
    const rSlaOnly = await run(tSlaOnly, outSlaOnly);
    if (rSlaOnly.summary.statusHint !== "partial") {
      throw new Error(
        `SLA-only without inventory expected partial: ${JSON.stringify(rSlaOnly.summary)}`,
      );
    }

    // Inventory in-repo ignores present=false N/A launder.
    const tOverride = join(root, "t-override");
    mkdirSync(join(tOverride, "ops"), { recursive: true });
    writeFileSync(
      join(tOverride, "ops", "runtime-inventory.md"),
      "production_ai_runtime inventory cloud_run\n",
    );
    const outOverride = join(root, "o-override");
    mkdirSync(join(outOverride, "imports", "ai-runtime-patching"), {
      recursive: true,
    });
    writeFileSync(
      join(outOverride, "imports", "ai-runtime-patching", "coverage.json"),
      coverage({ productionAiRuntimeEnvironmentsPresent: false }),
    );
    const rOverride = await run(tOverride, outOverride);
    if (rOverride.summary.statusHint === "not_applicable") {
      throw new Error("in-repo runtime inventory must block N/A launder");
    }
    if (
      rOverride.summary.statusHint !== "pass" ||
      rOverride.summary.infM2Satisfied !== true
    ) {
      throw new Error(
        `override+metrics expected pass: ${JSON.stringify(rOverride.summary)}`,
      );
    }

    console.log("aprf-auditor ai-runtime-patching smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
