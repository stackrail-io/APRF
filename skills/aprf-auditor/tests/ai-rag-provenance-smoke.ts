/**
 * Smoke: ai-rag-provenance needs eval + ≥90% citation coverage + resolveability.
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
  aiRagProvenanceCollector,
  type AiRagProvenanceReport,
} from "../collectors/ai-rag-provenance.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiRagProvenanceReport> {
  await aiRagProvenanceCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-rag-provenance", "ai-rag-provenance-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-exp-m1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "rag-answer.md"),
      "RAG retrieval answers must include citation source_id\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.expM1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "evals"), { recursive: true });
    writeFileSync(
      join(t2, "evals", "citation_eval.yaml"),
      "factual_rag citation_coverage provenance_eval groundedness_score\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-rag-provenance"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-rag-provenance", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        factualOrHighStakesRagEvalConfigured: true,
        answersWithValidCitationPct: 93,
        citationsResolveToAuthorizedCorpus: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.expM1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "evals"), { recursive: true });
    writeFileSync(
      join(t3, "evals", "high_stakes_rag.md"),
      "high_stakes_rag citation_eval report\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-rag-provenance"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-rag-provenance", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        factualOrHighStakesRagEvalConfigured: true,
        answersWithValidCitationPct: 70,
        citationsResolveToAuthorizedCorpus: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.expM1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-rag-provenance smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
