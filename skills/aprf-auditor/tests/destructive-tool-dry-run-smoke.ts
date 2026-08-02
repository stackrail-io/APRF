/**
 * Smoke: destructive-tool-dry-run needs inventory 100% + dry-run 100% + promotion evidence + measuredAt ≤90d.
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
  destructiveToolDryRunCollector,
  type DestructiveToolDryRunReport,
} from "../collectors/destructive-tool-dry-run.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<DestructiveToolDryRunReport> {
  await destructiveToolDryRunCollector.collect({
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
        "destructive-tool-dry-run",
        "destructive-tool-dry-run-report.json",
      ),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    destructiveToolsPresent: true,
    destructiveToolsInventoriedPct: 100,
    destructiveToolsWithDryRunInNonProdPct: 100,
    lastDestructivePromotionHasDryRunEvidenceWithin90Days: true,
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-tol-r1-"));
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
      join(tSig, "destructive-tools.yaml"),
      "tools:\n  wipe_db:\n    destructive_tool: true\n    dry_run: true\n    simulation_mode: enabled\n",
    );
    const r1 = await run(tSig, join(root, "o1"));
    if (r1.summary.statusHint !== "partial" || !r1.summary.surfaceProvedForNaOverride) {
      throw new Error(`expected partial with surface: ${JSON.stringify(r1.summary)}`);
    }

    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "destructive-tool-dry-run"), {
      recursive: true,
    });
    writeFileSync(
      join(outFail, "imports", "destructive-tool-dry-run", "coverage.json"),
      coverage({ destructiveToolsWithDryRunInNonProdPct: 80 }),
    );
    const r2 = await run(tSig, outFail);
    if (r2.summary.statusHint !== "fail") {
      throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
    }

    const outInvFail = join(root, "o-inv-fail");
    mkdirSync(join(outInvFail, "imports", "destructive-tool-dry-run"), {
      recursive: true,
    });
    writeFileSync(
      join(outInvFail, "imports", "destructive-tool-dry-run", "coverage.json"),
      coverage({ destructiveToolsInventoriedPct: 40 }),
    );
    const rInvFail = await run(tSig, outInvFail);
    if (rInvFail.summary.statusHint !== "fail") {
      throw new Error(
        `inventory <100 must FAIL: ${JSON.stringify(rInvFail.summary)}`,
      );
    }

    const outNoInv = join(root, "o-no-inv");
    mkdirSync(join(outNoInv, "imports", "destructive-tool-dry-run"), {
      recursive: true,
    });
    writeFileSync(
      join(outNoInv, "imports", "destructive-tool-dry-run", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        destructiveToolsPresent: true,
        destructiveToolsWithDryRunInNonProdPct: 100,
        lastDestructivePromotionHasDryRunEvidenceWithin90Days: true,
      }),
    );
    const rNoInv = await run(tSig, outNoInv);
    if (rNoInv.summary.statusHint === "pass") {
      throw new Error(
        `dry-run+promotion without inventory must not PASS: ${JSON.stringify(rNoInv.summary)}`,
      );
    }

    const outAged = join(root, "o-aged");
    mkdirSync(join(outAged, "imports", "destructive-tool-dry-run"), {
      recursive: true,
    });
    const aged = new Date();
    aged.setUTCDate(aged.getUTCDate() - 120);
    writeFileSync(
      join(outAged, "imports", "destructive-tool-dry-run", "coverage.json"),
      coverage({ measuredAt: aged.toISOString() }),
    );
    const rAged = await run(tSig, outAged);
    if (rAged.summary.statusHint === "pass") {
      throw new Error(`over-age measuredAt must not PASS: ${JSON.stringify(rAged.summary)}`);
    }

    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "destructive-tool-dry-run"), {
      recursive: true,
    });
    writeFileSync(
      join(outPass, "imports", "destructive-tool-dry-run", "coverage.json"),
      coverage(),
    );
    const r3 = await run(tSig, outPass);
    if (r3.summary.tolR1Satisfied !== true || r3.summary.statusHint !== "pass") {
      throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
    }

    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "destructive-tool-dry-run"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "destructive-tool-dry-run", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        destructiveToolsPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    const outSigNa = join(root, "o-sig-na");
    mkdirSync(join(outSigNa, "imports", "destructive-tool-dry-run"), {
      recursive: true,
    });
    writeFileSync(
      join(outSigNa, "imports", "destructive-tool-dry-run", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        destructiveToolsPresent: false,
      }),
    );
    const rSigNa = await run(tSig, outSigNa);
    if (rSigNa.summary.statusHint === "not_applicable") {
      throw new Error("dry-run/destructive signals must block N/A launder");
    }

    const outFailNa = join(root, "o-fail-na");
    mkdirSync(join(outFailNa, "imports", "destructive-tool-dry-run"), {
      recursive: true,
    });
    writeFileSync(
      join(outFailNa, "imports", "destructive-tool-dry-run", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        destructiveToolsPresent: false,
        lastDestructivePromotionHasDryRunEvidenceWithin90Days: false,
      }),
    );
    const rFailNa = await run(tEmpty, outFailNa);
    if (rFailNa.summary.statusHint !== "fail") {
      throw new Error(
        `failing promotion flag must beat N/A: ${JSON.stringify(rFailNa.summary)}`,
      );
    }

    console.log("aprf-auditor destructive-tool-dry-run smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
