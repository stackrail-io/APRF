/**
 * Smoke: OBS-M2 N/A when no sensitive traces; PASS needs 100% synthetic redaction/ACL.
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
  aiTraceSensitiveRedactionCollector,
  type AiTraceSensitiveRedactionReport,
} from "../collectors/ai-trace-sensitive-redaction.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiTraceSensitiveRedactionReport> {
  await aiTraceSensitiveRedactionCollector.collect({
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
        "ai-trace-sensitive-redaction",
        "ai-trace-sensitive-redaction-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-obs-m2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "otel"), { recursive: true });
    writeFileSync(
      join(t1, "otel", "span-redact.ts"),
      "OpenTelemetry attribute processor for span redact of api key and pii\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.obsM2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "tests"), { recursive: true });
    writeFileSync(
      join(t2, "tests", "synthetic-sensitive-field-test.py"),
      "synthetic secret canary assert redact on otel span attributes\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-trace-sensitive-redaction"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-trace-sensitive-redaction", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        tracesContainSecretsOrSensitiveData: true,
        syntheticSensitiveFieldRedactionOrAclPct: 100,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.obsM2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(t3, { recursive: true });
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-trace-sensitive-redaction"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-trace-sensitive-redaction", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        tracesContainSecretsOrSensitiveData: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "not_applicable") {
      throw new Error(`na expected: ${JSON.stringify(r3.summary)}`);
    }

    const t4 = join(root, "t4");
    mkdirSync(join(t4, "docs"), { recursive: true });
    writeFileSync(
      join(t4, "docs", "trace-acl.md"),
      "Trace ACL deny unauthorized access to span attributes with jwt\n",
    );
    const out4 = join(root, "o4");
    mkdirSync(join(out4, "imports", "ai-trace-sensitive-redaction"), {
      recursive: true,
    });
    writeFileSync(
      join(out4, "imports", "ai-trace-sensitive-redaction", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        tracesContainSecretsOrSensitiveData: true,
        syntheticSensitiveFieldRedactionOrAclPct: 80,
      }),
    );
    const r4 = await run(t4, out4);
    if (r4.summary.statusHint !== "fail" || r4.summary.obsM2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r4.summary)}`);
    }

    console.log("ai-trace-sensitive-redaction smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
