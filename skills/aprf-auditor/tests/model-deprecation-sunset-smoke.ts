/**
 * Smoke: model-deprecation-sunset needs policy + ≥1 sunset date + 0 past-sunset pins for PASS.
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
  modelDeprecationSunsetCollector,
  type ModelDeprecationSunsetReport,
} from "../collectors/model-deprecation-sunset.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<ModelDeprecationSunsetReport> {
  await modelDeprecationSunsetCollector.collect({
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
        "model-deprecation-sunset",
        "model-deprecation-sunset-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-mod-r1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "model-deprecation.md"),
      "# Model deprecation\nnotice_period: 90 days\nforced_sunset: true\nsunset_date for superseded pins\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.modR1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "registry"), { recursive: true });
    writeFileSync(
      join(t2, "registry", "models.yaml"),
      "policy:\n  notice_period_days: 90\n  forced_sunset: true\nmodels:\n  - id: old-embed\n    superseded: true\n    sunset_date: 2026-01-01\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "model-deprecation-sunset"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "model-deprecation-sunset", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        policyDefinesNoticeAndForcedSunset: true,
        supersededWithSunsetDateCount: 1,
        undocumentedPinsPastSunset: 0,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.modR1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "eol-policy.md"),
      "embedding EOL and model sunset policy with notice period\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "model-deprecation-sunset"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "model-deprecation-sunset", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        policyDefinesNoticeAndForcedSunset: true,
        supersededWithSunsetDateCount: 0,
        undocumentedPinsPastSunset: 2,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.modR1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("model-deprecation-sunset smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
