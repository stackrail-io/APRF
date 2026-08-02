/**
 * Smoke: secrets-hygiene needs manager + coverage import (0 privileged,
 * 100% resolved, prompts covered, measuredAt ≤90d); CI config alone ≠ PASS.
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

async function run(
  target: string,
  outDir: string,
): Promise<SecretsHygieneReport> {
  await secretsHygieneCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "secrets-hygiene", "secrets-hygiene-report.json"),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    privilegedSecretsInReposPromptsOrClientBundles: 0,
    productionRuntimeSecretsResolvedFromSecretsManagerPct: 100,
    secretScanCoversPromptsAndFixtures: true,
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sec2-m1-"));
  try {
    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const r0 = await run(tEmpty, join(root, "o0"));
    if (r0.summary.statusHint !== "not_demonstrated") {
      throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
    }

    const tScan = join(root, "t-scan");
    mkdirSync(join(tScan, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(tScan, ".github", "workflows", "secrets.yml"),
      `
name: secrets
on: push
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: gitleaks/gitleaks-action@v2
`,
    );
    const r1 = await run(tScan, join(root, "o1"));
    if (r1.summary.statusHint !== "partial") {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    const tLeak = join(root, "t-leak");
    mkdirSync(tLeak, { recursive: true });
    writeFileSync(join(tLeak, "leak.py"), `KEY = "AKIAJTESTKEYNOTREAL0"\n`);
    const r2 = await run(tLeak, join(root, "o2"));
    if (r2.summary.statusHint !== "fail" || r2.summary.embeddedCount < 1) {
      throw new Error(
        `expected fail with findings, got ${JSON.stringify(r2.summary)}`,
      );
    }
    if (JSON.stringify(r2).includes("AKIAJTESTKEYNOTREAL0")) {
      throw new Error("secret value leaked into report");
    }

    // Manager + scan config alone must stay PARTIAL (no vacuous PASS).
    const tPartial = join(root, "t-partial");
    mkdirSync(join(tPartial, ".github", "workflows"), { recursive: true });
    mkdirSync(join(tPartial, "deploy"), { recursive: true });
    writeFileSync(
      join(tPartial, ".github", "workflows", "secrets.yml"),
      `jobs:\n  scan:\n    steps:\n      - run: gitleaks detect\n`,
    );
    writeFileSync(
      join(tPartial, "deploy", "external-secret.yaml"),
      `apiVersion: external-secrets.io/v1beta1\nkind: ExternalSecret\nmetadata:\n  name: app\n`,
    );
    const rPartial = await run(tPartial, join(root, "o-partial"));
    if (rPartial.summary.statusHint !== "partial") {
      throw new Error(
        `manager+scan-config without import expected partial: ${JSON.stringify(rPartial.summary)}`,
      );
    }

    // PASS with manager + fresh coverage import.
    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "secrets-hygiene"), { recursive: true });
    writeFileSync(
      join(outPass, "imports", "secrets-hygiene", "coverage.json"),
      coverage(),
    );
    const rPass = await run(tPartial, outPass);
    if (
      rPass.summary.sec2M1Satisfied !== true ||
      rPass.summary.statusHint !== "pass"
    ) {
      throw new Error(`expected pass, got ${JSON.stringify(rPass.summary)}`);
    }

    // N/A when no production runtime secrets.
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "secrets-hygiene"), { recursive: true });
    writeFileSync(
      join(outNa, "imports", "secrets-hygiene", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionRuntimeSecretsPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    // In-repo manager blocks N/A launder.
    const outOverride = join(root, "o-override");
    mkdirSync(join(outOverride, "imports", "secrets-hygiene"), {
      recursive: true,
    });
    writeFileSync(
      join(outOverride, "imports", "secrets-hygiene", "coverage.json"),
      coverage({ productionRuntimeSecretsPresent: false }),
    );
    const rOverride = await run(tPartial, outOverride);
    if (rOverride.summary.statusHint === "not_applicable") {
      throw new Error("in-repo manager must block N/A launder");
    }
    if (rOverride.summary.statusHint !== "pass") {
      throw new Error(
        `override+metrics expected pass: ${JSON.stringify(rOverride.summary)}`,
      );
    }

    // Heuristic embeds + present=false must FAIL (not N/A).
    const outEmbedNa = join(root, "o-embed-na");
    mkdirSync(join(outEmbedNa, "imports", "secrets-hygiene"), {
      recursive: true,
    });
    writeFileSync(
      join(outEmbedNa, "imports", "secrets-hygiene", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionRuntimeSecretsPresent: false,
      }),
    );
    const rEmbedNa = await run(tLeak, outEmbedNa);
    if (rEmbedNa.summary.statusHint !== "fail") {
      throw new Error(
        `embeds+present=false expected fail, got ${JSON.stringify(rEmbedNa.summary)}`,
      );
    }

    // Empty SARIF runs must not attest privilegedSecrets…=0 / unlock PASS.
    const outSarif = join(root, "o-sarif");
    mkdirSync(join(outSarif, "imports", "secrets-hygiene"), {
      recursive: true,
    });
    writeFileSync(
      join(outSarif, "imports", "secrets-hygiene", "scan.sarif.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionRuntimeSecretsResolvedFromSecretsManagerPct: 100,
        secretScanCoversPromptsAndFixtures: true,
        runs: [],
      }),
    );
    const rSarif = await run(tPartial, outSarif);
    if (rSarif.summary.statusHint === "pass") {
      throw new Error(
        `empty SARIF runs must not unlock PASS: ${JSON.stringify(rSarif.summary)}`,
      );
    }
    if (
      rSarif.importedResults
        .privilegedSecretsInReposPromptsOrClientBundles === 0
    ) {
      throw new Error(
        "empty SARIF must not set privilegedSecretsInReposPromptsOrClientBundles=0",
      );
    }

    console.log("aprf-auditor secrets-hygiene smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
