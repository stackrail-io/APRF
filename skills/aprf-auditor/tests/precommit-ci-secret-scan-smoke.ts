/**
 * Smoke: precommit-ci-secret-scan needs pre-commit + CI + prompt/fixture
 * coverage + blocking + ≤7d green scan; config alone ≠ PASS.
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
  precommitCiSecretScanCollector,
  type PrecommitCiSecretScanReport,
} from "../collectors/precommit-ci-secret-scan.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<PrecommitCiSecretScanReport> {
  await precommitCiSecretScanCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "precommit-ci-secret-scan",
        "precommit-ci-secret-scan-report.json",
      ),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    applicationCodePromptsOrFixturesPresent: true,
    preCommitSecretScanConfigured: true,
    ciSecretScanConfigured: true,
    secretScanCoversPromptsAndFixtures: true,
    blocksOnHighConfidenceSecrets: true,
    lastGreenMainBranchOrPrMergeScanWithin7Days: true,
    ...extra,
  });
}

function seedRepo(root: string) {
  writeFileSync(
    join(root, ".pre-commit-config.yaml"),
    `
repos:
  - repo: https://github.com/gitleaks/gitleaks
    hooks:
      - id: gitleaks
        args: [--verbose]
`,
  );
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(root, ".github", "workflows", "secret-scan.yml"),
    `
name: secret-scan
on: [push, pull_request]
jobs:
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run gitleaks (blocking)
        run: gitleaks detect --source . --verbose --redact
        # covers prompts/ fixtures/ notebooks
`,
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sec2-r1-"));
  try {
    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const r0 = await run(tEmpty, join(root, "o0"));
    if (r0.summary.statusHint !== "not_demonstrated") {
      throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
    }

    const tCfg = join(root, "t-cfg");
    mkdirSync(tCfg, { recursive: true });
    seedRepo(tCfg);
    const r1 = await run(tCfg, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      !r1.summary.preCommitPresent ||
      !r1.summary.ciPresent
    ) {
      throw new Error(
        `expected partial with pre-commit+CI, got ${JSON.stringify(r1.summary)}`,
      );
    }

    // Fail: no green scan
    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "precommit-ci-secret-scan"), {
      recursive: true,
    });
    writeFileSync(
      join(outFail, "imports", "precommit-ci-secret-scan", "coverage.json"),
      coverage({ lastGreenMainBranchOrPrMergeScanWithin7Days: false }),
    );
    const r2 = await run(tCfg, outFail);
    if (r2.summary.statusHint !== "fail") {
      throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
    }

    // Metrics without measuredAt → PARTIAL
    const outStale = join(root, "o-stale");
    mkdirSync(join(outStale, "imports", "precommit-ci-secret-scan"), {
      recursive: true,
    });
    writeFileSync(
      join(outStale, "imports", "precommit-ci-secret-scan", "coverage.json"),
      JSON.stringify({
        applicationCodePromptsOrFixturesPresent: true,
        secretScanCoversPromptsAndFixtures: true,
        blocksOnHighConfidenceSecrets: true,
        lastGreenMainBranchOrPrMergeScanWithin7Days: true,
      }),
    );
    const rStale = await run(tCfg, outStale);
    if (rStale.summary.statusHint !== "partial") {
      throw new Error(
        `without measuredAt expected partial: ${JSON.stringify(rStale.summary)}`,
      );
    }

    // PASS
    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "precommit-ci-secret-scan"), {
      recursive: true,
    });
    writeFileSync(
      join(outPass, "imports", "precommit-ci-secret-scan", "coverage.json"),
      coverage(),
    );
    const r3 = await run(tCfg, outPass);
    if (r3.summary.sec2R1Satisfied !== true || r3.summary.statusHint !== "pass") {
      throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
    }

    // N/A
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "precommit-ci-secret-scan"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "precommit-ci-secret-scan", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        applicationCodePromptsOrFixturesPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    // N/A overridden by in-repo config → pass with full import
    const outOverride = join(root, "o-override");
    mkdirSync(join(outOverride, "imports", "precommit-ci-secret-scan"), {
      recursive: true,
    });
    writeFileSync(
      join(outOverride, "imports", "precommit-ci-secret-scan", "coverage.json"),
      coverage({ applicationCodePromptsOrFixturesPresent: false }),
    );
    const rOv = await run(tCfg, outOverride);
    if (rOv.summary.statusHint !== "pass") {
      throw new Error(
        `config should override N/A to pass: ${JSON.stringify(rOv.summary)}`,
      );
    }

    // Root gitleaks.toml alone → partial (not not_demonstrated).
    const tToml = join(root, "t-toml");
    mkdirSync(tToml, { recursive: true });
    writeFileSync(
      join(tToml, "gitleaks.toml"),
      "[extend]\nuseDefault = true\n",
    );
    const rToml = await run(tToml, join(root, "o-toml"));
    if (rToml.summary.statusHint !== "partial") {
      throw new Error(
        `root gitleaks.toml expected partial, got ${JSON.stringify(rToml.summary)}`,
      );
    }
    if (!rToml.signals.scannerConfig.found) {
      throw new Error("expected scannerConfig signal for root gitleaks.toml");
    }

    // generatedAt must not unlock ≤7d PASS without measuredAt.
    const outGen = join(root, "o-gen");
    mkdirSync(join(outGen, "imports", "precommit-ci-secret-scan"), {
      recursive: true,
    });
    writeFileSync(
      join(outGen, "imports", "precommit-ci-secret-scan", "coverage.json"),
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        applicationCodePromptsOrFixturesPresent: true,
        preCommitSecretScanConfigured: true,
        ciSecretScanConfigured: true,
        secretScanCoversPromptsAndFixtures: true,
        blocksOnHighConfidenceSecrets: true,
        lastGreenMainBranchOrPrMergeScanWithin7Days: true,
      }),
    );
    const rGen = await run(tCfg, outGen);
    if (rGen.summary.statusHint === "pass") {
      throw new Error(
        `generatedAt must not unlock PASS: ${JSON.stringify(rGen.summary)}`,
      );
    }

    console.log("aprf-auditor precommit-ci-secret-scan smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
