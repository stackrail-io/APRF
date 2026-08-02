/**
 * Smoke: tool-allowlist needs inventory 100% + allowlist 100% + deny 100% + invent-reject + measuredAt ≤90d.
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
  toolAllowlistCollector,
  type ToolAllowlistReport,
} from "../collectors/tool-allowlist.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<ToolAllowlistReport> {
  await toolAllowlistCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "tool-allowlist", "tool-allowlist-report.json"),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    productionAgentsOrToolWorkloadsPresent: true,
    agentsInventoriedPct: 100,
    agentsWithExplicitToolAllowlistPct: 100,
    unknownToolRequestsDeniedPct: 100,
    unknownOrInventedToolsRejectedAtRuntime: true,
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-tol-m2-"));
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
      join(tSig, "tool-allowlist.yaml"),
      "agent:\n  tool_allowlist:\n    - search\n    - summarize\n",
    );
    const r1 = await run(tSig, join(root, "o1"));
    if (r1.summary.statusHint !== "partial" || !r1.summary.surfaceProvedForNaOverride) {
      throw new Error(`expected partial with surface: ${JSON.stringify(r1.summary)}`);
    }

    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "tool-allowlist"), { recursive: true });
    writeFileSync(
      join(outFail, "imports", "tool-allowlist", "coverage.json"),
      coverage({ unknownToolRequestsDeniedPct: 90 }),
    );
    const r2 = await run(tSig, outFail);
    if (r2.summary.statusHint !== "fail") {
      throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
    }

    const outAllowFail = join(root, "o-allow-fail");
    mkdirSync(join(outAllowFail, "imports", "tool-allowlist"), {
      recursive: true,
    });
    writeFileSync(
      join(outAllowFail, "imports", "tool-allowlist", "coverage.json"),
      coverage({ agentsWithExplicitToolAllowlistPct: 80 }),
    );
    const rAllowFail = await run(tSig, outAllowFail);
    if (rAllowFail.summary.statusHint !== "fail") {
      throw new Error(
        `allowlist coverage <100 must FAIL: ${JSON.stringify(rAllowFail.summary)}`,
      );
    }

    const outInvFail = join(root, "o-inv-fail");
    mkdirSync(join(outInvFail, "imports", "tool-allowlist"), {
      recursive: true,
    });
    writeFileSync(
      join(outInvFail, "imports", "tool-allowlist", "coverage.json"),
      coverage({ agentsInventoriedPct: 60 }),
    );
    const rInvFail = await run(tSig, outInvFail);
    if (rInvFail.summary.statusHint !== "fail") {
      throw new Error(
        `agentsInventoriedPct <100 must FAIL: ${JSON.stringify(rInvFail.summary)}`,
      );
    }

    const outNoInv = join(root, "o-no-inv");
    mkdirSync(join(outNoInv, "imports", "tool-allowlist"), { recursive: true });
    writeFileSync(
      join(outNoInv, "imports", "tool-allowlist", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAgentsOrToolWorkloadsPresent: true,
        agentsWithExplicitToolAllowlistPct: 100,
        unknownToolRequestsDeniedPct: 100,
        unknownOrInventedToolsRejectedAtRuntime: true,
      }),
    );
    const rNoInv = await run(tSig, outNoInv);
    if (rNoInv.summary.statusHint === "pass") {
      throw new Error(
        `allowlist+deny+invent without inventory must not PASS: ${JSON.stringify(rNoInv.summary)}`,
      );
    }

    const outInventFail = join(root, "o-invent-fail");
    mkdirSync(join(outInventFail, "imports", "tool-allowlist"), {
      recursive: true,
    });
    writeFileSync(
      join(outInventFail, "imports", "tool-allowlist", "coverage.json"),
      coverage({ unknownOrInventedToolsRejectedAtRuntime: false }),
    );
    const rInventFail = await run(tSig, outInventFail);
    if (rInventFail.summary.statusHint !== "fail") {
      throw new Error(
        `invent-reject=false must FAIL: ${JSON.stringify(rInventFail.summary)}`,
      );
    }

    const outNoInvent = join(root, "o-no-invent");
    mkdirSync(join(outNoInvent, "imports", "tool-allowlist"), {
      recursive: true,
    });
    writeFileSync(
      join(outNoInvent, "imports", "tool-allowlist", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAgentsOrToolWorkloadsPresent: true,
        agentsInventoriedPct: 100,
        agentsWithExplicitToolAllowlistPct: 100,
        unknownToolRequestsDeniedPct: 100,
      }),
    );
    const rNoInvent = await run(tSig, outNoInvent);
    if (rNoInvent.summary.statusHint === "pass") {
      throw new Error(
        `deny+allowlist without invent-reject must not PASS: ${JSON.stringify(rNoInvent.summary)}`,
      );
    }

    const outAged = join(root, "o-aged");
    mkdirSync(join(outAged, "imports", "tool-allowlist"), { recursive: true });
    const aged = new Date();
    aged.setUTCDate(aged.getUTCDate() - 120);
    writeFileSync(
      join(outAged, "imports", "tool-allowlist", "coverage.json"),
      coverage({ measuredAt: aged.toISOString() }),
    );
    const rAged = await run(tSig, outAged);
    if (rAged.summary.statusHint === "pass") {
      throw new Error(`over-age measuredAt must not PASS: ${JSON.stringify(rAged.summary)}`);
    }

    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "tool-allowlist"), { recursive: true });
    writeFileSync(
      join(outPass, "imports", "tool-allowlist", "coverage.json"),
      coverage(),
    );
    const r3 = await run(tSig, outPass);
    if (r3.summary.tolM2Satisfied !== true || r3.summary.statusHint !== "pass") {
      throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
    }

    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "tool-allowlist"), { recursive: true });
    writeFileSync(
      join(outNa, "imports", "tool-allowlist", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAgentsOrToolWorkloadsPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    const outSigNa = join(root, "o-sig-na");
    mkdirSync(join(outSigNa, "imports", "tool-allowlist"), { recursive: true });
    writeFileSync(
      join(outSigNa, "imports", "tool-allowlist", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAgentsOrToolWorkloadsPresent: false,
      }),
    );
    const rSigNa = await run(tSig, outSigNa);
    if (rSigNa.summary.statusHint === "not_applicable") {
      throw new Error("allowlist signals must block N/A launder");
    }

    const outFailNa = join(root, "o-fail-na");
    mkdirSync(join(outFailNa, "imports", "tool-allowlist"), { recursive: true });
    writeFileSync(
      join(outFailNa, "imports", "tool-allowlist", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAgentsOrToolWorkloadsPresent: false,
        agentsWithExplicitToolAllowlistPct: 50,
      }),
    );
    const rFailNa = await run(tEmpty, outFailNa);
    if (rFailNa.summary.statusHint !== "fail") {
      throw new Error(
        `failing allowlist pct must beat N/A: ${JSON.stringify(rFailNa.summary)}`,
      );
    }

    console.log("aprf-auditor tool-allowlist smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
