/**
 * Smoke: ai-exfil-detection accepts DLP/SIEM without requiring canaries.
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
  aiExfilDetectionCollector,
  type AiExfilDetectionReport,
} from "../collectors/ai-exfil-detection.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiExfilDetectionReport> {
  await aiExfilDetectionCollector.collect({
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
        "ai-exfil-detection",
        "ai-exfil-detection-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sec-r3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "dlp.md"),
      "dlp data_loss_prevention for sensitive_ai_context\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.secR3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    // PASS without canaries — DLP/SIEM class is enough when validated
    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ops"), { recursive: true });
    writeFileSync(
      join(t2, "ops", "siem-alerts.md"),
      "siem ueba exfiltration_detect alert for prompt_exfil\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-exfil-detection"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-exfil-detection", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        mechanismClass: "siem",
        sensitiveAiContextsExfilDetectionConfigured: true,
        detectionMechanismCoversSensitiveAiPaths: true,
        latestDetectionValidationWithin90DaysWithExpectedAlertsOrZeroSilentMisses: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.secR3Satisfied !== true) {
      throw new Error(`pass expected (no canary): ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "security"), { recursive: true });
    writeFileSync(
      join(t3, "security", "canary-token.md"),
      "canary_token tripwire honeytoken detection_test\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-exfil-detection"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-exfil-detection", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        mechanismClass: "canary",
        sensitiveAiContextsExfilDetectionConfigured: true,
        detectionMechanismCoversSensitiveAiPaths: false,
        latestDetectionValidationWithin90DaysWithExpectedAlertsOrZeroSilentMisses: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.secR3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-exfil-detection smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
