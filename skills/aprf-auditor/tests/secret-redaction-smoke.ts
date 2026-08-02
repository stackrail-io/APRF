/**
 * Smoke: secret-redaction needs config + 100% canary + pattern coverage +
 * measuredAt ≤90d; config alone ≠ PASS.
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
  secretRedactionCollector,
  type SecretRedactionReport,
} from "../collectors/secret-redaction.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<SecretRedactionReport> {
  await secretRedactionCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "secret-redaction", "secret-redaction-report.json"),
      "utf8",
    ),
  );
}

function harness(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    detectionRatePct: 100,
    canaryCoversApiKeyBearerAndAwsKeyPatterns: true,
    cases: [
      { id: "sk", result: "redacted" },
      { id: "bearer", result: "pass" },
      { id: "akia", ok: true },
    ],
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sec2-m2-"));
  try {
    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const r0 = await run(tEmpty, join(root, "o0"));
    if (r0.summary.statusHint !== "not_demonstrated") {
      throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
    }

    const tConfig = join(root, "t-config");
    mkdirSync(join(tConfig, "otel"), { recursive: true });
    writeFileSync(
      join(tConfig, "otel", "redact_processor.py"),
      `
class SensitiveDataFilter:
    """OTel AttributeProcessor that redacts API keys from spans/logs."""
    def redact(self, value: str) -> str:
        return "[REDACTED]"
`,
    );
    const r1 = await run(tConfig, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      !r1.summary.redactionConfigPresent
    ) {
      throw new Error(
        `expected partial with config, got ${JSON.stringify(r1.summary)}`,
      );
    }

    // Fail: rate < 100
    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "secret-redaction"), { recursive: true });
    writeFileSync(
      join(outFail, "imports", "secret-redaction", "harness.json"),
      harness({ detectionRatePct: 80, caseCount: 5, cases: undefined }),
    );
    const r2 = await run(tConfig, outFail);
    if (r2.summary.statusHint !== "fail") {
      throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
    }

    // Rate 100 without measuredAt / covers → PARTIAL
    const outStale = join(root, "o-stale");
    mkdirSync(join(outStale, "imports", "secret-redaction"), {
      recursive: true,
    });
    writeFileSync(
      join(outStale, "imports", "secret-redaction", "harness.json"),
      JSON.stringify({ detectionRatePct: 100 }),
    );
    const rStale = await run(tConfig, outStale);
    if (rStale.summary.statusHint !== "partial") {
      throw new Error(
        `rate without measuredAt/covers expected partial: ${JSON.stringify(rStale.summary)}`,
      );
    }

    // PASS
    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "secret-redaction"), { recursive: true });
    writeFileSync(
      join(outPass, "imports", "secret-redaction", "harness.json"),
      harness(),
    );
    const r3 = await run(tConfig, outPass);
    if (r3.summary.sec2M2Satisfied !== true || r3.summary.statusHint !== "pass") {
      throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
    }

    // N/A
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "secret-redaction"), { recursive: true });
    writeFileSync(
      join(outNa, "imports", "secret-redaction", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionLoggingOrTracingPipelinesPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    // Bare rate=100 + covers without cases must not PASS.
    const outBare = join(root, "o-bare");
    mkdirSync(join(outBare, "imports", "secret-redaction"), { recursive: true });
    writeFileSync(
      join(outBare, "imports", "secret-redaction", "harness.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        detectionRatePct: 100,
        canaryCoversApiKeyBearerAndAwsKeyPatterns: true,
      }),
    );
    const rBare = await run(tConfig, outBare);
    if (rBare.summary.statusHint !== "partial") {
      throw new Error(
        `bare rate/covers without cases expected partial: ${JSON.stringify(rBare.summary)}`,
      );
    }

    console.log("aprf-auditor secret-redaction smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
