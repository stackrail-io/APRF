/**
 * Smoke: ai-timeouts-retries needs timeout+retry config + 100% coverage import.
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
  aiTimeoutsRetriesCollector,
  type AiTimeoutsRetriesReport,
} from "../collectors/ai-timeouts-retries.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiTimeoutsRetriesReport> {
  await aiTimeoutsRetriesCollector.collect({
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
        "ai-timeouts-retries",
        "ai-timeouts-retries-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-rel-m1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "src"), { recursive: true });
    writeFileSync(
      join(t1, "src", "openai_client.ts"),
      "const client = { timeout_ms: 30000, max_retries: 3 };\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.relM1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "src"), { recursive: true });
    writeFileSync(
      join(t2, "src", "llm_client.py"),
      "openai.timeout = 30\nmax_retries = 2\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-timeouts-retries"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-timeouts-retries", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        timeoutsConfigured: true,
        retriesBounded: true,
        callSitesCoveredPct: 100,
        verifiedByStaticOrIntegrationTest: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.relM1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "src"), { recursive: true });
    writeFileSync(
      join(t3, "src", "anthropic_client.ts"),
      "export const timeout_ms = 10000;\nexport const max_retries = 5;\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-timeouts-retries"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-timeouts-retries", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        timeoutsConfigured: true,
        retriesBounded: true,
        callSitesCoveredPct: 60,
        verifiedByStaticOrIntegrationTest: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.relM1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-timeouts-retries smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
