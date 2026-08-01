/**
 * Smoke: ai-harm-policy needs version + owner + mapped categories + fresh review.
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
  aiHarmPolicyCollector,
  type AiHarmPolicyReport,
} from "../collectors/ai-harm-policy.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiHarmPolicyReport> {
  await aiHarmPolicyCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-harm-policy", "ai-harm-policy-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-saf-m1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "harm-taxonomy.md"),
      "harm_taxonomy refusal_policy escalate for self_harm and violence\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.safM1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "policy"), { recursive: true });
    writeFileSync(
      join(t2, "policy", "content-safety-policy.md"),
      "harm_categories refuse vs escalate owner reviewed version\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-harm-policy"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-harm-policy", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        hasVersion: true,
        hasOwner: true,
        domainMinimumHarmCategoriesWithRefuseEscalateMapped: true,
        reviewAgeDays: 30,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.safM1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "refusal-policy.md"),
      "refusal_matrix harm_taxonomy incomplete categories\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-harm-policy"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-harm-policy", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        hasVersion: true,
        hasOwner: true,
        domainMinimumHarmCategoriesWithRefuseEscalateMapped: false,
        reviewAgeDays: 30,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.safM1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-harm-policy smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
