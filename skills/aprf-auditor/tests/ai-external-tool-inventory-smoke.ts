/**
 * Smoke: ai-external-tool-inventory needs pin+owner+review 100% + 0 unpinned
 * + measuredAt ≤90d; lockfiles / Action SHA alone ≠ PASS.
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
  aiExternalToolInventoryCollector,
  type AiExternalToolInventoryReport,
} from "../collectors/ai-external-tool-inventory.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiExternalToolInventoryReport> {
  await aiExternalToolInventoryCollector.collect({
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
        "ai-external-tool-inventory",
        "ai-external-tool-inventory-report.json",
      ),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    productionAiExternalToolsOrIntegrationsPresent: true,
    entriesWithPinOwnerReviewPct: 100,
    unpinnedLatestOrFloatingEntries: 0,
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sci-m2-"));
  try {
    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const r0 = await run(tEmpty, join(root, "o0"));
    if (r0.summary.statusHint !== "not_demonstrated") {
      throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
    }

    const tMcp = join(root, "t-mcp");
    mkdirSync(tMcp, { recursive: true });
    writeFileSync(
      join(tMcp, "mcp.json"),
      JSON.stringify({ mcpServers: { demo: { command: "npx", args: ["demo"] } } }),
    );
    const r1 = await run(tMcp, join(root, "o1"));
    if (r1.summary.statusHint !== "partial" || !r1.summary.surfaceProvedForNaOverride) {
      throw new Error(`expected partial with MCP surface: ${JSON.stringify(r1.summary)}`);
    }

    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "ai-external-tool-inventory"), {
      recursive: true,
    });
    writeFileSync(
      join(outFail, "imports", "ai-external-tool-inventory", "coverage.json"),
      coverage({ unpinnedLatestOrFloatingEntries: 2 }),
    );
    const r2 = await run(tMcp, outFail);
    if (r2.summary.statusHint !== "fail") {
      throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
    }

    const outAged = join(root, "o-aged");
    mkdirSync(join(outAged, "imports", "ai-external-tool-inventory"), {
      recursive: true,
    });
    const aged = new Date();
    aged.setUTCDate(aged.getUTCDate() - 120);
    writeFileSync(
      join(outAged, "imports", "ai-external-tool-inventory", "coverage.json"),
      coverage({ measuredAt: aged.toISOString() }),
    );
    const rAged = await run(tMcp, outAged);
    if (rAged.summary.statusHint === "pass") {
      throw new Error(`over-age measuredAt must not PASS: ${JSON.stringify(rAged.summary)}`);
    }

    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "ai-external-tool-inventory"), {
      recursive: true,
    });
    writeFileSync(
      join(outPass, "imports", "ai-external-tool-inventory", "coverage.json"),
      coverage(),
    );
    const r3 = await run(tMcp, outPass);
    if (r3.summary.sciM2Satisfied !== true || r3.summary.statusHint !== "pass") {
      throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
    }

    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "ai-external-tool-inventory"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "ai-external-tool-inventory", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAiExternalToolsOrIntegrationsPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    const outMcpNa = join(root, "o-mcp-na");
    mkdirSync(join(outMcpNa, "imports", "ai-external-tool-inventory"), {
      recursive: true,
    });
    writeFileSync(
      join(outMcpNa, "imports", "ai-external-tool-inventory", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAiExternalToolsOrIntegrationsPresent: false,
      }),
    );
    const rMcpNa = await run(tMcp, outMcpNa);
    if (rMcpNa.summary.statusHint === "not_applicable") {
      throw new Error("MCP signals must block N/A launder");
    }

    const outFailNa = join(root, "o-fail-na");
    mkdirSync(join(outFailNa, "imports", "ai-external-tool-inventory"), {
      recursive: true,
    });
    writeFileSync(
      join(outFailNa, "imports", "ai-external-tool-inventory", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAiExternalToolsOrIntegrationsPresent: false,
        entriesWithPinOwnerReviewPct: 50,
      }),
    );
    const rFailNa = await run(tEmpty, outFailNa);
    if (rFailNa.summary.statusHint !== "fail") {
      throw new Error(
        `failing pin coverage must beat N/A: ${JSON.stringify(rFailNa.summary)}`,
      );
    }

    console.log("aprf-auditor ai-external-tool-inventory smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
