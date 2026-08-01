/**
 * Smoke: ai-customer-notification-criteria needs criteria map + followed sample ≤12m for PASS.
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
  aiCustomerNotificationCriteriaCollector,
  type AiCustomerNotificationCriteriaReport,
} from "../collectors/ai-customer-notification-criteria.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiCustomerNotificationCriteriaReport> {
  await aiCustomerNotificationCriteriaCollector.collect({
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
        "ai-customer-notification-criteria",
        "ai-customer-notification-criteria-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-inc-r3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "customer-notification-criteria.md"),
      "AI customer notification criteria: safety incident → notify; quality fail → no-notify\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.incR3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "comms"), { recursive: true });
    writeFileSync(
      join(t2, "comms", "notification-drill.md"),
      "Customer notification drill for data exposure followed notify criteria with timestamps 2026-01-15\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-customer-notification-criteria"), {
      recursive: true,
    });
    writeFileSync(
      join(
        out2,
        "imports",
        "ai-customer-notification-criteria",
        "coverage.json",
      ),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        criteriaMapEventTypesToNotifyDecision: true,
        lastDrillOrIncidentFollowedCriteriaWithin12Months: true,
        timestampsPresent: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.incR3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "disclosure-criteria.md"),
      "Notify/no-notify criteria for AI safety incident and widespread quality fail\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-customer-notification-criteria"), {
      recursive: true,
    });
    writeFileSync(
      join(
        out3,
        "imports",
        "ai-customer-notification-criteria",
        "coverage.json",
      ),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        criteriaMapEventTypesToNotifyDecision: true,
        lastDrillOrIncidentAgeDays: 400,
        timestampsPresent: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.incR3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    const t4 = join(root, "t4");
    mkdirSync(join(t4, "docs"), { recursive: true });
    writeFileSync(
      join(t4, "docs", "customer-notification-criteria.md"),
      "AI customer notification criteria map with notify/no-notify for safety incident\n",
    );
    const out4 = join(root, "o4");
    mkdirSync(join(out4, "imports", "ai-customer-notification-criteria"), {
      recursive: true,
    });
    writeFileSync(
      join(
        out4,
        "imports",
        "ai-customer-notification-criteria",
        "coverage.json",
      ),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        criteriaMapEventTypesToNotifyDecision: true,
        lastDrillOrIncidentFollowedCriteriaWithin12Months: true,
      }),
    );
    const r4 = await run(t4, out4);
    if (
      r4.summary.statusHint !== "partial" ||
      r4.summary.incR3Satisfied !== false
    ) {
      throw new Error(
        `partial without timestamps expected: ${JSON.stringify(r4.summary)}`,
      );
    }

    console.log("ai-customer-notification-criteria smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
