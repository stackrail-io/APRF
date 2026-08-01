/**
 * Smoke: ai-token-cost-attribution needs ≥95% attributed billed calls over ≥24h for PASS.
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
  aiTokenCostAttributionCollector,
  type AiTokenCostAttributionReport,
} from "../collectors/ai-token-cost-attribution.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiTokenCostAttributionReport> {
  await aiTokenCostAttributionCollector.collect({
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
        "ai-token-cost-attribution",
        "ai-token-cost-attribution-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-obs-r4-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "metrics"), { recursive: true });
    writeFileSync(
      join(t1, "metrics", "token-usage.md"),
      "Token usage metrics with request id and tenant id labels\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.obsR4Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "observability"), { recursive: true });
    writeFileSync(
      join(t2, "observability", "cost-per-request.yaml"),
      "billed model cost metrics: request_id, feature_name, tenant_id\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-token-cost-attribution"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-token-cost-attribution", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        attributedBilledCallPct: 96,
        sampleWindowHours: 24,
        coversRequestFeatureTenant: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.obsR4Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "finops-labels.md"),
      "Model spend finops label for feature and org id\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-token-cost-attribution"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-token-cost-attribution", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        attributedBilledCallPct: 70,
        sampleWindowHours: 24,
        coversRequestFeatureTenant: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.obsR4Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-token-cost-attribution smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
