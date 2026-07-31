/**
 * Smoke: ai-acceptable-use-policy needs version/owner/sections/review for PASS.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aiAcceptableUsePolicyCollector,
  type AiAcceptableUsePolicyReport,
} from "../collectors/ai-acceptable-use-policy.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function runCollector(
  target: string,
  outDir: string,
): Promise<AiAcceptableUsePolicyReport> {
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  };
  await aiAcceptableUsePolicyCollector.collect(ctx);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-acceptable-use-policy",
        "ai-acceptable-use-policy-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-org-m1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "ai_acceptable_use_policy.md"),
      `# AI Acceptable Use Policy
## Acceptable use
Permitted use cases for generative AI.
## Prohibited applications
Forbidden use cases.
Owner: security@example.com
Version: 1.2
`,
    );
    const out1 = join(root, "o1");
    const r1 = await runCollector(t1, out1);
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.orgM1Satisfied !== false
    ) {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "ai_policy.md"),
      "AI acceptable use policy with prohibited applications\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-acceptable-use-policy"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-acceptable-use-policy", "attest.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        hasVersion: true,
        hasOwner: true,
        hasAcceptableUseSection: true,
        hasProhibitedApplicationsSection: true,
        reviewAgeDays: 45,
      }),
    );
    const r2 = await runCollector(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.orgM1Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "use_of_ai.md"),
      "AI policy covering acceptable use and prohibited applications\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-acceptable-use-policy"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-acceptable-use-policy", "attest.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        hasVersion: true,
        hasOwner: true,
        hasAcceptableUseSection: true,
        hasProhibitedApplicationsSection: false,
        reviewAgeDays: 10,
      }),
    );
    const r3 = await runCollector(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.orgM1Satisfied !== false) {
      throw new Error(`expected fail, got ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-acceptable-use-policy smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
