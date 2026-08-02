/**
 * Smoke: high-impact-tool-gates needs 100% gated + ungated impossible + measuredAt ≤90d.
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
  highImpactToolGatesCollector,
  type HighImpactToolGatesReport,
} from "../collectors/high-impact-tool-gates.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<HighImpactToolGatesReport> {
  await highImpactToolGatesCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "high-impact-tool-gates",
        "high-impact-tool-gates-report.json",
      ),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    highImpactToolsPresent: true,
    highImpactToolsWithConfiguredGatePct: 100,
    ungatedExecutionImpossibleInTests: true,
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-tol-m3-"));
  try {
    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const r0 = await run(tEmpty, join(root, "o0"));
    if (r0.summary.statusHint !== "not_demonstrated") {
      throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
    }

    const tSig = join(root, "t-sig");
    mkdirSync(tSig, { recursive: true });
    writeFileSync(
      join(tSig, "impact-tier.yaml"),
      "tools:\n  delete_account:\n    impact_tier: irreversible\n    approval_gate: required\n",
    );
    const r1 = await run(tSig, join(root, "o1"));
    if (r1.summary.statusHint !== "partial" || !r1.summary.surfaceProvedForNaOverride) {
      throw new Error(`expected partial with surface: ${JSON.stringify(r1.summary)}`);
    }

    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "high-impact-tool-gates"), {
      recursive: true,
    });
    writeFileSync(
      join(outFail, "imports", "high-impact-tool-gates", "coverage.json"),
      coverage({ ungatedExecutionImpossibleInTests: false }),
    );
    const r2 = await run(tSig, outFail);
    if (r2.summary.statusHint !== "fail") {
      throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
    }

    const outAged = join(root, "o-aged");
    mkdirSync(join(outAged, "imports", "high-impact-tool-gates"), {
      recursive: true,
    });
    const aged = new Date();
    aged.setUTCDate(aged.getUTCDate() - 120);
    writeFileSync(
      join(outAged, "imports", "high-impact-tool-gates", "coverage.json"),
      coverage({ measuredAt: aged.toISOString() }),
    );
    const rAged = await run(tSig, outAged);
    if (rAged.summary.statusHint === "pass") {
      throw new Error(`over-age measuredAt must not PASS: ${JSON.stringify(rAged.summary)}`);
    }

    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "high-impact-tool-gates"), {
      recursive: true,
    });
    writeFileSync(
      join(outPass, "imports", "high-impact-tool-gates", "coverage.json"),
      coverage(),
    );
    const r3 = await run(tSig, outPass);
    if (r3.summary.tolM3Satisfied !== true || r3.summary.statusHint !== "pass") {
      throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
    }

    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "high-impact-tool-gates"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "high-impact-tool-gates", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highImpactToolsPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    const outSigNa = join(root, "o-sig-na");
    mkdirSync(join(outSigNa, "imports", "high-impact-tool-gates"), {
      recursive: true,
    });
    writeFileSync(
      join(outSigNa, "imports", "high-impact-tool-gates", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highImpactToolsPresent: false,
      }),
    );
    const rSigNa = await run(tSig, outSigNa);
    if (rSigNa.summary.statusHint === "not_applicable") {
      throw new Error("impact/gate signals must block N/A launder");
    }

    const outFailNa = join(root, "o-fail-na");
    mkdirSync(join(outFailNa, "imports", "high-impact-tool-gates"), {
      recursive: true,
    });
    writeFileSync(
      join(outFailNa, "imports", "high-impact-tool-gates", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highImpactToolsPresent: false,
        highImpactToolsWithConfiguredGatePct: 50,
      }),
    );
    const rFailNa = await run(tEmpty, outFailNa);
    if (rFailNa.summary.statusHint !== "fail") {
      throw new Error(
        `failing gate pct must beat N/A: ${JSON.stringify(rFailNa.summary)}`,
      );
    }

    console.log("aprf-auditor high-impact-tool-gates smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
