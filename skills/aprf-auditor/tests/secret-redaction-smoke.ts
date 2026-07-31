/**
 * Smoke: secret-redaction needs config + 100% canary rate for PASS.
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

const outDir = mkdtempSync(join(tmpdir(), "aprf-redact-"));
const targetDir = mkdtempSync(join(tmpdir(), "aprf-redact-target-"));

async function main() {
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outDir,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  const empty = await secretRedactionCollector.collect(baseCtx);
  if (empty.status !== "ran") throw new Error(`expected ran: ${empty.status}`);
  const r0 = JSON.parse(
    readFileSync(
      join(outDir, "imports", "secret-redaction", "secret-redaction-report.json"),
      "utf8",
    ),
  ) as SecretRedactionReport;
  if (r0.summary.statusHint !== "not_demonstrated") {
    throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "otel"), { recursive: true });
  writeFileSync(
    join(targetDir, "otel", "redact_processor.py"),
    `
class SensitiveDataFilter:
    """OTel AttributeProcessor that redacts API keys from spans/logs."""
    def redact(self, value: str) -> str:
        return "[REDACTED]"
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-redact1-"));
  await secretRedactionCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = JSON.parse(
    readFileSync(
      join(out1, "imports", "secret-redaction", "secret-redaction-report.json"),
      "utf8",
    ),
  ) as SecretRedactionReport;
  if (r1.summary.statusHint !== "partial" || !r1.summary.redactionConfigPresent) {
    throw new Error(`expected partial with config, got ${JSON.stringify(r1.summary)}`);
  }

  // Fail: rate < 100
  const out2 = mkdtempSync(join(tmpdir(), "aprf-redact2-"));
  mkdirSync(join(out2, "imports", "secret-redaction"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "secret-redaction", "harness.json"),
    JSON.stringify({ detectionRatePct: 80, caseCount: 5 }),
    "utf8",
  );
  await secretRedactionCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = JSON.parse(
    readFileSync(
      join(out2, "imports", "secret-redaction", "secret-redaction-report.json"),
      "utf8",
    ),
  ) as SecretRedactionReport;
  if (r2.summary.statusHint !== "fail") {
    throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
  }

  // Pass: config + 100% harness
  const out3 = mkdtempSync(join(tmpdir(), "aprf-redact3-"));
  mkdirSync(join(out3, "imports", "secret-redaction"), { recursive: true });
  writeFileSync(
    join(out3, "imports", "secret-redaction", "harness.json"),
    JSON.stringify({
      detectionRatePct: 100,
      cases: [
        { id: "sk", result: "redacted" },
        { id: "bearer", result: "pass" },
        { id: "akia", ok: true },
      ],
    }),
    "utf8",
  );
  await secretRedactionCollector.collect({ ...baseCtx, outputDir: out3 });
  const r3 = JSON.parse(
    readFileSync(
      join(out3, "imports", "secret-redaction", "secret-redaction-report.json"),
      "utf8",
    ),
  ) as SecretRedactionReport;
  if (r3.summary.sec2M2Satisfied !== true || r3.summary.statusHint !== "pass") {
    throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
  }

  console.log("aprf-auditor secret-redaction smoke OK");
  for (const d of [outDir, out1, out2, out3, targetDir]) {
    rmSync(d, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
