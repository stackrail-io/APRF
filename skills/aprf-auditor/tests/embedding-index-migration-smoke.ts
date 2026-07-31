/**
 * Smoke: embedding-index-migration needs automated gates + successful upgrade for PASS.
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
  embeddingIndexMigrationCollector,
  type EmbeddingIndexMigrationReport,
} from "../collectors/embedding-index-migration.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<EmbeddingIndexMigrationReport> {
  await embeddingIndexMigrationCollector.collect({
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
        "embedding-index-migration",
        "embedding-index-migration-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-dep-r3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "ops"), { recursive: true });
    writeFileSync(
      join(t1, "ops", "embedding-migration.md"),
      "automated embedding migration with validation gate and dual-write cutover check\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.depR3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "jobs"), { recursive: true });
    writeFileSync(
      join(t2, "jobs", "reindex.yml"),
      "name: reindex\non: workflow_dispatch\njobs:\n  migrate:\n    steps:\n      - run: echo vector index version upgrade pinecone\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "embedding-index-migration"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "embedding-index-migration", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        automatedMigrationWithValidationGates: true,
        lastUpgradeWithin12Months: true,
        lastUpgradeSucceededWithoutDualWriteGaps: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.depR3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    // Pass when import omits automatedMigrationWithValidationGates but repo
    // migration signals are present (automatedOk null-tolerant path).
    const t2b = join(root, "t2b");
    mkdirSync(join(t2b, "ops"), { recursive: true });
    writeFileSync(
      join(t2b, "ops", "embedding-migration.md"),
      "automated embedding migration with validation gate and dual-write cutover check\n",
    );
    const out2b = join(root, "o2b");
    mkdirSync(join(out2b, "imports", "embedding-index-migration"), {
      recursive: true,
    });
    writeFileSync(
      join(out2b, "imports", "embedding-index-migration", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        lastUpgradeWithin12Months: true,
        lastUpgradeSucceededWithoutDualWriteGaps: true,
      }),
    );
    const r2b = await run(t2b, out2b);
    if (
      r2b.summary.statusHint !== "pass" ||
      r2b.summary.depR3Satisfied !== true
    ) {
      throw new Error(
        `pass with null automated field expected: ${JSON.stringify(r2b.summary)}`,
      );
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ops"), { recursive: true });
    writeFileSync(
      join(t3, "ops", "faiss-migrate.md"),
      "faiss index migration runbook\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "embedding-index-migration"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "embedding-index-migration", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        automatedMigrationWithValidationGates: true,
        lastUpgradeAgeDays: 400,
        lastUpgradeSucceededWithoutDualWriteGaps: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.depR3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    const t4 = join(root, "t4");
    mkdirSync(t4, { recursive: true });
    const out4 = join(root, "o4");
    mkdirSync(join(out4, "imports", "embedding-index-migration"), {
      recursive: true,
    });
    writeFileSync(
      join(out4, "imports", "embedding-index-migration", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        noUpgradeInWindowAttested: true,
      }),
    );
    const r4 = await run(t4, out4);
    if (r4.summary.statusHint !== "not_applicable") {
      throw new Error(`na expected: ${JSON.stringify(r4.summary)}`);
    }

    console.log("embedding-index-migration smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
