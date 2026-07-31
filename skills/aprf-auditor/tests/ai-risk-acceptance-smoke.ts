/**
 * Smoke: ai-risk-acceptance needs complete open waivers + escalated expired for PASS.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aiRiskAcceptanceCollector,
  type AiRiskAcceptanceReport,
} from "../collectors/ai-risk-acceptance.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function runCollector(
  target: string,
  outDir: string,
): Promise<AiRiskAcceptanceReport> {
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  };
  await aiRiskAcceptanceCollector.collect(ctx);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-risk-acceptance",
        "ai-risk-acceptance-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-org-r4-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "risk_acceptance_register.md"),
      `# Risk acceptance register
Control-gap waivers require owner, expiry, and escalation on expiry.
Open waiver tracking for known AI control gaps.
`,
    );
    const out1 = join(root, "o1");
    const r1 = await runCollector(t1, out1);
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.orgR4Satisfied !== false
    ) {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "waiver_register.md"),
      "waiver register for control gap risk acceptance\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-risk-acceptance"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-risk-acceptance", "register.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        openWaiverCount: 2,
        openWaiversIncomplete: 0,
        expiredWaiversWithoutEscalation: 0,
      }),
    );
    const r2 = await runCollector(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.orgR4Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "exceptions.md"),
      "exception register open waiver control gap\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-risk-acceptance"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-risk-acceptance", "register.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        openWaiversIncomplete: 0,
        expiredWaiversWithoutEscalation: 3,
      }),
    );
    const r3 = await runCollector(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.orgR4Satisfied !== false) {
      throw new Error(`expected fail, got ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-risk-acceptance smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
