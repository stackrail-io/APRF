/**
 * Smoke: context-source-acl needs 0 unauthorized + 0 unlabeled inclusions for PASS.
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
  contextSourceAclCollector,
  type ContextSourceAclReport,
} from "../collectors/context-source-acl.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<ContextSourceAclReport> {
  await contextSourceAclCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "context-source-acl",
        "context-source-acl-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-ctx-m2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "src"), { recursive: true });
    writeFileSync(
      join(t1, "src", "rag_assembler.py"),
      "def include_chunk(chunk):\n  # source_label + document_acl access_check before retrieval inclusion\n  return chunk\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.ctxM2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "src"), { recursive: true });
    writeFileSync(
      join(t2, "src", "tool_context.py"),
      "chunk_source_type = 'tool'\nacl = check_permission(doc)\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "context-source-acl"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "context-source-acl", "suite.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        unauthorizedChunksIncluded: 0,
        unlabeledIncludedCount: 0,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.ctxM2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "src"), { recursive: true });
    writeFileSync(
      join(t3, "src", "retriever.py"),
      "source_label = chunk.meta['type']\nunauthorized filter via acl\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "context-source-acl"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "context-source-acl", "suite.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        unauthorizedChunksIncluded: 3,
        unlabeledIncludedCount: 0,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.ctxM2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }
    console.log("context-source-acl smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
