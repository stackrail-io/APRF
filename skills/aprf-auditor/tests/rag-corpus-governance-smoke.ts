/**
 * Smoke: rag-corpus-governance needs complete inventory import for PASS.
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ragCorpusGovernanceCollector,
  type RagCorpusGovernanceReport,
} from "../collectors/rag-corpus-governance.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): RagCorpusGovernanceReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "rag-corpus-governance",
        "rag-corpus-governance-report.json",
      ),
      "utf8",
    ),
  ) as RagCorpusGovernanceReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-dgm1-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-dgm1-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await ragCorpusGovernanceCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "config", "rag"), { recursive: true });
  writeFileSync(
    join(targetDir, "config", "rag", "corpus.yaml"),
    `
indexes:
  - name: product-docs
    owner: retrieval-team
    versionId: v12
    refreshCadence: "0 2 * * *"
    stale: rebuild_on_breach
vector_store: pinecone
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-dgm1-1-"));
  await ragCorpusGovernanceCollector.collect({
    ...baseCtx,
    outputDir: out1,
  });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.configSignalsPresent
  ) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-dgm1-2-"));
  mkdirSync(join(out2, "imports", "rag-corpus-governance"), {
    recursive: true,
  });
  writeFileSync(
    join(out2, "imports", "rag-corpus-governance", "inventory.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 3,
      coversAllProductionIndexes: true,
      productionIndexCount: 1,
      missingOwnerCount: 0,
      missingVersionCount: 0,
      missingCadenceCount: 0,
      staleUnhandledCount: 0,
      indexes: [
        {
          name: "product-docs",
          owner: "retrieval-team",
          versionId: "v12",
          refreshCadence: "daily",
          stale: false,
        },
      ],
    }),
    "utf8",
  );
  await ragCorpusGovernanceCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.dgM1Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("rag-corpus-governance smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
