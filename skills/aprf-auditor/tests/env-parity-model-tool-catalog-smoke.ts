/**
 * Smoke: env-parity-model-tool-catalog needs scan≤30d + unexplained=0 for PASS.
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
  envParityModelToolCatalogCollector,
  type EnvParityModelToolCatalogReport,
} from "../collectors/env-parity-model-tool-catalog.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<EnvParityModelToolCatalogReport> {
  await envParityModelToolCatalogCollector.collect({
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
        "env-parity-model-tool-catalog",
        "env-parity-model-tool-catalog-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-dep-r2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "ops"), { recursive: true });
    writeFileSync(
      join(t1, "ops", "env-parity.md"),
      "environment parity scan for model pins and tool catalogs prod vs staging\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.depR2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "config"), { recursive: true });
    writeFileSync(
      join(t2, "config", "parity-check.sh"),
      "#!/bin/sh\n# parity check model pin vs staging tool catalog\necho env parity\n",
    );
    writeFileSync(
      join(t2, "config", "model-pins.yaml"),
      "model_pins:\n  prod: gpt-4o\n  staging: gpt-4o\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "env-parity-model-tool-catalog"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "env-parity-model-tool-catalog", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        lastParityScanWithin30Days: true,
        unexplainedParityDrifts: 0,
        coversModelPinsAndToolCatalogs: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.depR2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ops"), { recursive: true });
    writeFileSync(
      join(t3, "ops", "parity-scan.md"),
      "prod vs staging parity check for tool catalog\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "env-parity-model-tool-catalog"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "env-parity-model-tool-catalog", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        parityScanAgeDays: 45,
        unexplainedParityDrifts: 0,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.depR2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("env-parity-model-tool-catalog smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
