/**
 * Smoke: key-rotation-scope needs inventory + 0 client privileged keys +
 * 100% scope + 100% rotation + measuredAt ≤90d; rotation docs alone ≠ PASS.
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
  keyRotationScopeCollector,
  type KeyRotationScopeReport,
} from "../collectors/key-rotation-scope.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<KeyRotationScopeReport> {
  await keyRotationScopeCollector.collect({
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
        "key-rotation-scope",
        "key-rotation-scope-report.json",
      ),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    productionProviderOrCloudKeysPresent: true,
    privilegedProviderOrCloudKeysInClientApps: 0,
    productionKeysWithDocumentedLeastPrivilegeScopePct: 100,
    productionKeysWithinRotationPolicyPct: 100,
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sec2-m3-"));
  try {
    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const r0 = await run(tEmpty, join(root, "o0"));
    if (r0.summary.statusHint !== "not_demonstrated") {
      throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
    }

    const tRot = join(root, "t-rot");
    mkdirSync(join(tRot, "docs"), { recursive: true });
    writeFileSync(
      join(tRot, "docs", "key_rotation_policy.md"),
      "# Key rotation\nRotate API keys every 90 days. Prefer short-lived credentials.\n",
    );
    const r1 = await run(tRot, join(root, "o1"));
    if (r1.summary.statusHint !== "partial" || !r1.signals.rotationPolicy.found) {
      throw new Error(
        `expected partial with rotation signal, got ${JSON.stringify(r1.summary)}`,
      );
    }

    // Rotation docs alone must not block N/A.
    const outRotNa = join(root, "o-rot-na");
    mkdirSync(join(outRotNa, "imports", "key-rotation-scope"), {
      recursive: true,
    });
    writeFileSync(
      join(outRotNa, "imports", "key-rotation-scope", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionProviderOrCloudKeysPresent: false,
      }),
    );
    const rRotNa = await run(tRot, outRotNa);
    if (rRotNa.summary.statusHint !== "not_applicable") {
      throw new Error(
        `rotation-only must allow N/A: ${JSON.stringify(rRotNa.summary)}`,
      );
    }

    const tInv = join(root, "t-inv");
    mkdirSync(join(tInv, "ops"), { recursive: true });
    writeFileSync(
      join(tInv, "ops", "api_key_inventory.yaml"),
      "keys:\n  - id: openai-prod\n    scope: least-privilege\n",
    );
    // Fail: privileged client keys
    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "key-rotation-scope"), {
      recursive: true,
    });
    writeFileSync(
      join(outFail, "imports", "key-rotation-scope", "coverage.json"),
      coverage({ privilegedProviderOrCloudKeysInClientApps: 2 }),
    );
    const r2 = await run(tInv, outFail);
    if (r2.summary.statusHint !== "fail") {
      throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
    }

    // Metrics without measuredAt → PARTIAL
    const outStale = join(root, "o-stale");
    mkdirSync(join(outStale, "imports", "key-rotation-scope"), {
      recursive: true,
    });
    writeFileSync(
      join(outStale, "imports", "key-rotation-scope", "coverage.json"),
      JSON.stringify({
        productionProviderOrCloudKeysPresent: true,
        privilegedProviderOrCloudKeysInClientApps: 0,
        productionKeysWithDocumentedLeastPrivilegeScopePct: 100,
        productionKeysWithinRotationPolicyPct: 100,
      }),
    );
    const rStale = await run(tInv, outStale);
    if (rStale.summary.statusHint !== "partial") {
      throw new Error(
        `metrics without measuredAt expected partial: ${JSON.stringify(rStale.summary)}`,
      );
    }

    // PASS
    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "key-rotation-scope"), {
      recursive: true,
    });
    writeFileSync(
      join(outPass, "imports", "key-rotation-scope", "coverage.json"),
      coverage(),
    );
    const r3 = await run(tInv, outPass);
    if (r3.summary.sec2M3Satisfied !== true || r3.summary.statusHint !== "pass") {
      throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
    }

    // Rotation-only docs + import present=true without inventory file → still needs
    // inventoryPresent via present=true; full metrics → PASS
    const outPassAttest = join(root, "o-pass-attest");
    mkdirSync(join(outPassAttest, "imports", "key-rotation-scope"), {
      recursive: true,
    });
    writeFileSync(
      join(outPassAttest, "imports", "key-rotation-scope", "coverage.json"),
      coverage(),
    );
    const rAttest = await run(tRot, outPassAttest);
    if (rAttest.summary.statusHint !== "pass") {
      throw new Error(
        `present=true + metrics expected pass: ${JSON.stringify(rAttest.summary)}`,
      );
    }

    // N/A
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "key-rotation-scope"), { recursive: true });
    writeFileSync(
      join(outNa, "imports", "key-rotation-scope", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionProviderOrCloudKeysPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    // N/A overridden by inventory
    const outOverride = join(root, "o-override");
    mkdirSync(join(outOverride, "imports", "key-rotation-scope"), {
      recursive: true,
    });
    writeFileSync(
      join(outOverride, "imports", "key-rotation-scope", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionProviderOrCloudKeysPresent: false,
        privilegedProviderOrCloudKeysInClientApps: 0,
        productionKeysWithDocumentedLeastPrivilegeScopePct: 100,
        productionKeysWithinRotationPolicyPct: 100,
      }),
    );
    const rOv = await run(tInv, outOverride);
    if (rOv.summary.statusHint !== "pass") {
      throw new Error(
        `inventory should override N/A to pass: ${JSON.stringify(rOv.summary)}`,
      );
    }

    // Client-key risk alone blocks N/A launder.
    const tClient = join(root, "t-client");
    mkdirSync(join(tClient, "apps"), { recursive: true });
    writeFileSync(
      join(tClient, "apps", "client_bundle.md"),
      "Do not ship NEXT_PUBLIC_OPENAI_API_KEY in the client app bundle.\n",
    );
    const outClientNa = join(root, "o-client-na");
    mkdirSync(join(outClientNa, "imports", "key-rotation-scope"), {
      recursive: true,
    });
    writeFileSync(
      join(outClientNa, "imports", "key-rotation-scope", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionProviderOrCloudKeysPresent: false,
      }),
    );
    const rClientNa = await run(tClient, outClientNa);
    if (rClientNa.summary.statusHint === "not_applicable") {
      throw new Error("client-key risk must block N/A launder");
    }

    // Failing metrics beat N/A even with no in-repo surface.
    const outFailNa = join(root, "o-fail-na");
    mkdirSync(join(outFailNa, "imports", "key-rotation-scope"), {
      recursive: true,
    });
    writeFileSync(
      join(outFailNa, "imports", "key-rotation-scope", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionProviderOrCloudKeysPresent: false,
        privilegedProviderOrCloudKeysInClientApps: 3,
      }),
    );
    const rFailNa = await run(tEmpty, outFailNa);
    if (rFailNa.summary.statusHint !== "fail") {
      throw new Error(
        `failing metrics must beat N/A: ${JSON.stringify(rFailNa.summary)}`,
      );
    }

    console.log("aprf-auditor key-rotation-scope smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
