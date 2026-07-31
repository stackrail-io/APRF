/**
 * Smoke: model-inventory needs incompleteInventoryRows=0 for PASS.
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
  modelInventoryCollector,
  type ModelInventoryReport,
} from "../collectors/model-inventory.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<ModelInventoryReport> {
  await modelInventoryCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "model-inventory", "model-inventory-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-mod-r4-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "model-inventory.md"),
      "# Model inventory\nowner: platform\nresidency: us-east-1\nintended_use: chat\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.modR4Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "registry"), { recursive: true });
    writeFileSync(
      join(t2, "registry", "models.yaml"),
      "model_inventory:\n  - id: gpt-4o\n    owner: ml-platform\n    data_residency: eu-west-1\n    intended_use: support-bot\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "model-inventory"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "model-inventory", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        incompleteInventoryRows: 0,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.modR4Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "model-registry.md"),
      "model registry with owner fields\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "model-inventory"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "model-inventory", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        incompleteInventoryRows: 2,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.modR4Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    // Regression: per-field missing counts must not be summed (overlapping rows).
    const t4 = join(root, "t4");
    mkdirSync(join(t4, "docs"), { recursive: true });
    writeFileSync(
      join(t4, "docs", "model-inventory.md"),
      "model inventory registry with owner residency intended_use\n",
    );
    const out4 = join(root, "o4");
    mkdirSync(join(out4, "imports", "model-inventory"), { recursive: true });
    writeFileSync(
      join(out4, "imports", "model-inventory", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        missingOwner: 1,
        missingResidency: 1,
        missingIntendedUse: 1,
      }),
    );
    const r4 = await run(t4, out4);
    if (
      r4.importedResults.incompleteInventoryRows !== 1 ||
      r4.summary.statusHint !== "fail"
    ) {
      throw new Error(
        `max of field gaps expected (not sum=3): ${JSON.stringify(r4.importedResults)} ${JSON.stringify(r4.summary)}`,
      );
    }

    console.log("model-inventory smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
