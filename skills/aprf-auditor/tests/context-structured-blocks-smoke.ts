/**
 * Smoke: context-structured-blocks needs structured sections + overwrite block for PASS.
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
  contextStructuredBlocksCollector,
  type ContextStructuredBlocksReport,
} from "../collectors/context-structured-blocks.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<ContextStructuredBlocksReport> {
  await contextStructuredBlocksCollector.collect({
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
        "context-structured-blocks",
        "context-structured-blocks-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-ctx-r3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "src"), { recursive: true });
    writeFileSync(
      join(t1, "src", "context_schema.md"),
      "Structured context blocks: instruction section separate from data section (JSON schema)\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.ctxR3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "src"), { recursive: true });
    writeFileSync(
      join(t2, "src", "assembler.py"),
      "structured_context instruction_block vs data_block json schema\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "context-structured-blocks"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "context-structured-blocks", "suite.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        structuredSectionsEmitted: true,
        instructionOverwriteBlocked: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.ctxR3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "src"), { recursive: true });
    writeFileSync(
      join(t3, "src", "prompt_blocks.xml"),
      "<instruction_section/><data_section/> structured context block separation\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "context-structured-blocks"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "context-structured-blocks", "suite.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        structuredSectionsEmitted: true,
        instructionOverwriteBlocked: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.ctxR3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }
    console.log("context-structured-blocks smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
