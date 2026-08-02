/**
 * Smoke: tool-gateway-authz needs 100% deny + no-bypass + measuredAt ≤90d.
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
  toolGatewayAuthzCollector,
  type ToolGatewayAuthzReport,
} from "../collectors/tool-gateway-authz.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<ToolGatewayAuthzReport> {
  await toolGatewayAuthzCollector.collect({
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
        "tool-gateway-authz",
        "tool-gateway-authz-report.json",
      ),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    productionToolsOrAgentsPresent: true,
    unauthorizedToolCallsDeniedPct: 100,
    modelOutputAloneCannotBypassGateway: true,
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-tol-m1-"));
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
      join(tSig, "tool-gateway-authz.yaml"),
      "tool-gateway:\n  server_side_authz: true\n  deny_suite: unauthorized_tool_calls\n",
    );
    const r1 = await run(tSig, join(root, "o1"));
    if (r1.summary.statusHint !== "partial" || !r1.summary.surfaceProvedForNaOverride) {
      throw new Error(`expected partial with surface: ${JSON.stringify(r1.summary)}`);
    }

    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "tool-gateway-authz"), { recursive: true });
    writeFileSync(
      join(outFail, "imports", "tool-gateway-authz", "coverage.json"),
      coverage({ unauthorizedToolCallsDeniedPct: 80 }),
    );
    const r2 = await run(tSig, outFail);
    if (r2.summary.statusHint !== "fail") {
      throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
    }

    const outBypass = join(root, "o-bypass");
    mkdirSync(join(outBypass, "imports", "tool-gateway-authz"), {
      recursive: true,
    });
    writeFileSync(
      join(outBypass, "imports", "tool-gateway-authz", "coverage.json"),
      coverage({ modelOutputAloneCannotBypassGateway: false }),
    );
    const rBypass = await run(tSig, outBypass);
    if (rBypass.summary.statusHint !== "fail") {
      throw new Error(
        `model-output bypass must fail: ${JSON.stringify(rBypass.summary)}`,
      );
    }

    const outAged = join(root, "o-aged");
    mkdirSync(join(outAged, "imports", "tool-gateway-authz"), { recursive: true });
    const aged = new Date();
    aged.setUTCDate(aged.getUTCDate() - 120);
    writeFileSync(
      join(outAged, "imports", "tool-gateway-authz", "coverage.json"),
      coverage({ measuredAt: aged.toISOString() }),
    );
    const rAged = await run(tSig, outAged);
    if (rAged.summary.statusHint === "pass") {
      throw new Error(`over-age measuredAt must not PASS: ${JSON.stringify(rAged.summary)}`);
    }

    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "tool-gateway-authz"), { recursive: true });
    writeFileSync(
      join(outPass, "imports", "tool-gateway-authz", "coverage.json"),
      coverage(),
    );
    const r3 = await run(tSig, outPass);
    if (r3.summary.tolM1Satisfied !== true || r3.summary.statusHint !== "pass") {
      throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
    }

    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "tool-gateway-authz"), { recursive: true });
    writeFileSync(
      join(outNa, "imports", "tool-gateway-authz", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionToolsOrAgentsPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    const outSigNa = join(root, "o-sig-na");
    mkdirSync(join(outSigNa, "imports", "tool-gateway-authz"), { recursive: true });
    writeFileSync(
      join(outSigNa, "imports", "tool-gateway-authz", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionToolsOrAgentsPresent: false,
      }),
    );
    const rSigNa = await run(tSig, outSigNa);
    if (rSigNa.summary.statusHint === "not_applicable") {
      throw new Error("gateway signals must block N/A launder");
    }

    const outFailNa = join(root, "o-fail-na");
    mkdirSync(join(outFailNa, "imports", "tool-gateway-authz"), { recursive: true });
    writeFileSync(
      join(outFailNa, "imports", "tool-gateway-authz", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionToolsOrAgentsPresent: false,
        unauthorizedToolCallsDeniedPct: 50,
      }),
    );
    const rFailNa = await run(tEmpty, outFailNa);
    if (rFailNa.summary.statusHint !== "fail") {
      throw new Error(
        `failing deny pct must beat N/A: ${JSON.stringify(rFailNa.summary)}`,
      );
    }

    console.log("aprf-auditor tool-gateway-authz smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
