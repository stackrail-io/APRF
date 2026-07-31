/**
 * Smoke: secrets-hygiene needs manager + scan + 0 embedded findings for PASS.
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
  secretsHygieneCollector,
  type SecretsHygieneReport,
} from "../collectors/secrets-hygiene.ts";
import type { CollectorContext } from "../collectors/types.ts";

const outDir = mkdtempSync(join(tmpdir(), "aprf-secrets-"));
const targetDir = mkdtempSync(join(tmpdir(), "aprf-secrets-target-"));

async function main() {
  // Empty target → not_demonstrated
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outDir,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };
  const empty = await secretsHygieneCollector.collect(baseCtx);
  if (empty.status !== "ran") throw new Error(`expected ran: ${empty.status}`);
  const r0 = JSON.parse(
    readFileSync(
      join(outDir, "imports", "secrets-hygiene", "secrets-hygiene-report.json"),
      "utf8",
    ),
  ) as SecretsHygieneReport;
  if (r0.summary.statusHint !== "not_demonstrated") {
    throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
  }

  // Partial: scan only
  mkdirSync(join(targetDir, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(targetDir, ".github", "workflows", "secrets.yml"),
    `
name: secrets
on: push
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: gitleaks/gitleaks-action@v2
`,
    "utf8",
  );
  const out1 = mkdtempSync(join(tmpdir(), "aprf-secrets1-"));
  await secretsHygieneCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = JSON.parse(
    readFileSync(
      join(out1, "imports", "secrets-hygiene", "secrets-hygiene-report.json"),
      "utf8",
    ),
  ) as SecretsHygieneReport;
  if (r1.summary.statusHint !== "partial") {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  // Fail: embedded key
  writeFileSync(
    join(targetDir, "leak.py"),
    `KEY = "AKIAJTESTKEYNOTREAL0"\n`,
    "utf8",
  );
  const out2 = mkdtempSync(join(tmpdir(), "aprf-secrets2-"));
  await secretsHygieneCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = JSON.parse(
    readFileSync(
      join(out2, "imports", "secrets-hygiene", "secrets-hygiene-report.json"),
      "utf8",
    ),
  ) as SecretsHygieneReport;
  if (r2.summary.statusHint !== "fail" || r2.summary.embeddedCount < 1) {
    throw new Error(`expected fail with findings, got ${JSON.stringify(r2.summary)}`);
  }
  if (JSON.stringify(r2).includes("AKIAJTESTKEYNOTREAL0")) {
    throw new Error("secret value leaked into report");
  }

  // Pass: manager + scan, no embedded (fresh target)
  const passTarget = mkdtempSync(join(tmpdir(), "aprf-secrets-pass-"));
  mkdirSync(join(passTarget, ".github", "workflows"), { recursive: true });
  mkdirSync(join(passTarget, "deploy"), { recursive: true });
  writeFileSync(
    join(passTarget, ".github", "workflows", "secrets.yml"),
    `jobs:\n  scan:\n    steps:\n      - run: gitleaks detect\n`,
    "utf8",
  );
  writeFileSync(
    join(passTarget, "deploy", "external-secret.yaml"),
    `apiVersion: external-secrets.io/v1beta1\nkind: ExternalSecret\nmetadata:\n  name: app\n`,
    "utf8",
  );
  const out3 = mkdtempSync(join(tmpdir(), "aprf-secrets3-"));
  await secretsHygieneCollector.collect({
    targetPath: passTarget,
    outputDir: out3,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  });
  const r3 = JSON.parse(
    readFileSync(
      join(out3, "imports", "secrets-hygiene", "secrets-hygiene-report.json"),
      "utf8",
    ),
  ) as SecretsHygieneReport;
  if (r3.summary.sec2M1Satisfied !== true || r3.summary.statusHint !== "pass") {
    throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
  }

  console.log("aprf-auditor secrets-hygiene smoke OK");
  for (const d of [outDir, out1, out2, out3, targetDir, passTarget]) {
    rmSync(d, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
