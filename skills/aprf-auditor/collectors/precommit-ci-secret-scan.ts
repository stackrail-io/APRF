/**
 * precommit-ci-secret-scan — SEC2-R1 / repo-precommit-ci-secret-scan.
 *
 * Discovers pre-commit + CI secret-scan configs (prompt/fixture coverage,
 * blocking). Import coverage under imports/precommit-ci-secret-scan/ unlocks
 * PASS (measuredAt ≤7d). Config alone ≠ PASS; SEC2-M1 content scan alone ≠ PASS.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
  EvidenceNode,
} from "./types.ts";
import {
  ensureDir,
  listImportFiles,
  readText,
  redact,
  rel,
  walkFiles,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  mergeAndBool,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "precommit-ci-secret-scan";
const RELATED = ["SEC2-R1"] as const;
const DETECTOR_ID = "repo-precommit-ci-secret-scan";
/** Matches passCondition: last green main/PR-merge scan ≤7 days. */
const IMPORT_MAX_AGE_DAYS = 7;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const SCANNER_RE =
  /\b(gitleaks|trufflehog|detect[_-]?secrets|git[_-]?secrets|talisman|secret[_-]?scan|secrets[_-]?scan)\b/i;

const PRECOMMIT_PATH_RE =
  /(^|[/\\])(\.pre-commit-config\.ya?ml|pre-commit|husky|\.husky)([/\\]|$|\.)/i;

const CI_PATH_RE =
  /(^|[/\\])(\.github[/\\]workflows|\.gitlab-ci|azure-pipelines|Jenkinsfile|\.circleci|buildkite)([/\\]|$|\.)/i;

const PROMPT_FIXTURE_RE =
  /\b(prompt|fixture|notebook|\.ipynb|testdata|eval[_-]?corpus|sample[_-]?prompt)\b/i;

const BLOCKING_RE =
  /\b(fail[_-]?(on|the[_-]?build|closed)|blocking|required[_-]?check|exit[_-]?code|cannot[_-]?skip|enforce)\b/i;

/** Root / dedicated scanner config files (not under pre-commit or CI paths). */
const SCANNER_CONFIG_FILE_RE =
  /(^|[/\\])(\.?gitleaks\.toml|\.?trufflehog\.ya?ml|\.?detect-secrets|\.?secrets\.baseline|talisman\.yml)([/\\]|$)/i;

export interface PrecommitCiSecretScanReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    preCommitSecretScan: { found: boolean; refs: string[] };
    ciSecretScan: { found: boolean; refs: string[] };
    scannerConfig: { found: boolean; refs: string[] };
    promptFixtureCoverage: { found: boolean; refs: string[] };
    blocking: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    applicationCodePromptsOrFixturesPresent: boolean | null;
    preCommitSecretScanConfigured: boolean | null;
    ciSecretScanConfigured: boolean | null;
    secretScanCoversPromptsAndFixtures: boolean | null;
    blocksOnHighConfidenceSecrets: boolean | null;
    lastGreenMainBranchOrPrMergeScanWithin7Days: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    preCommitPresent: boolean;
    ciPresent: boolean;
    sec2R1Satisfied: boolean | null;
    statusHint:
      | "pass"
      | "partial"
      | "fail"
      | "not_demonstrated"
      | "not_applicable";
  };
  notes: string[];
}

function importDir(ctx: CollectorContext): string {
  return join(ctx.outputDir, "imports", PLUGIN_ID);
}

function isSkippable(path: string): boolean {
  return SKIP_DIR_HINT.test(path);
}

function collectScanRefs(
  targetPath: string,
  maxFiles: number,
): {
  preCommit: string[];
  ci: string[];
  scannerConfig: string[];
  promptFixture: string[];
  blocking: string[];
} {
  const preCommit: string[] = [];
  const ci: string[] = [];
  const scannerConfig: string[] = [];
  const promptFixture: string[] = [];
  const blocking: string[] = [];

  const extras = [
    ".pre-commit-config.yaml",
    ".pre-commit-config.yml",
    "Jenkinsfile",
    ".gitlab-ci.yml",
    "gitleaks.toml",
    ".gitleaks.toml",
  ].map((n) => join(targetPath, n));

  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [
      ".yml",
      ".yaml",
      ".toml",
      ".json",
      ".md",
      ".sh",
      ".ts",
      ".js",
      ".py",
      ".cfg",
    ],
  });
  const all = [...new Set([...files, ...extras.filter((p) => existsSync(p))])];

  for (const f of all) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    const text = readText(f, 80_000) || "";
    const hasScanner = SCANNER_RE.test(r) || SCANNER_RE.test(text);
    const isScannerConfigFile = SCANNER_CONFIG_FILE_RE.test(r);
    if (!hasScanner && !isScannerConfigFile) continue;

    const inPre =
      PRECOMMIT_PATH_RE.test(r) ||
      /\bpre[_-]?commit\b/i.test(r) ||
      /\bpre[_-]?commit\b/i.test(text.slice(0, 400));
    const inCi =
      CI_PATH_RE.test(r) ||
      /\b(workflow|github[_-]?actions|gitlab[_-]?ci|azure[_-]?pipelines)\b/i.test(
        r + text.slice(0, 200),
      );

    if (inPre && preCommit.length < 12) preCommit.push(r);
    if (inCi && ci.length < 12) ci.push(r);
    // Root gitleaks.toml / equivalent: scanner config without pre-commit/CI path.
    if (
      isScannerConfigFile &&
      !inPre &&
      !inCi &&
      scannerConfig.length < 12
    ) {
      scannerConfig.push(r);
    }
    if (
      (PROMPT_FIXTURE_RE.test(r) || PROMPT_FIXTURE_RE.test(text)) &&
      promptFixture.length < 12
    ) {
      promptFixture.push(r);
    }
    if ((BLOCKING_RE.test(r) || BLOCKING_RE.test(text)) && blocking.length < 12) {
      blocking.push(r);
    }
  }
  return {
    preCommit: [...new Set(preCommit)],
    ci: [...new Set(ci)],
    scannerConfig: [...new Set(scannerConfig)],
    promptFixture: [...new Set(promptFixture)],
    blocking: [...new Set(blocking)],
  };
}

function loadImported(
  ctx: CollectorContext,
): PrecommitCiSecretScanReport["importedResults"] {
  const sources: string[] = [];
  let applicationCodePromptsOrFixturesPresent: boolean | null = null;
  let preCommitSecretScanConfigured: boolean | null = null;
  let ciSecretScanConfigured: boolean | null = null;
  let secretScanCoversPromptsAndFixtures: boolean | null = null;
  let blocksOnHighConfidenceSecrets: boolean | null = null;
  let lastGreenMainBranchOrPrMergeScanWithin7Days: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/precommit-ci-secret-scan-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      applicationCodePromptsOrFixturesPresent = mergeOrBool(
        applicationCodePromptsOrFixturesPresent,
        asBool(data.applicationCodePromptsOrFixturesPresent) ??
          asBool(data.application_code_prompts_or_fixtures_present) ??
          asBool(data.applicationContentPresent),
      );
      preCommitSecretScanConfigured = mergeAndBool(
        preCommitSecretScanConfigured,
        asBool(data.preCommitSecretScanConfigured) ??
          asBool(data.pre_commit_secret_scan_configured) ??
          asBool(data.preCommitConfigured),
      );
      ciSecretScanConfigured = mergeAndBool(
        ciSecretScanConfigured,
        asBool(data.ciSecretScanConfigured) ??
          asBool(data.ci_secret_scan_configured) ??
          asBool(data.ciConfigured),
      );
      secretScanCoversPromptsAndFixtures = mergeAndBool(
        secretScanCoversPromptsAndFixtures,
        asBool(data.secretScanCoversPromptsAndFixtures) ??
          asBool(data.secret_scan_covers_prompts_and_fixtures) ??
          asBool(data.coversPromptsAndFixtures),
      );
      blocksOnHighConfidenceSecrets = mergeAndBool(
        blocksOnHighConfidenceSecrets,
        asBool(data.blocksOnHighConfidenceSecrets) ??
          asBool(data.blocks_on_high_confidence_secrets) ??
          asBool(data.blocking),
      );
      lastGreenMainBranchOrPrMergeScanWithin7Days = mergeAndBool(
        lastGreenMainBranchOrPrMergeScanWithin7Days,
        asBool(data.lastGreenMainBranchOrPrMergeScanWithin7Days) ??
          asBool(data.last_green_main_branch_or_pr_merge_scan_within_7_days) ??
          asBool(data.lastGreenWithin7Days),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    applicationCodePromptsOrFixturesPresent,
    preCommitSecretScanConfigured,
    ciSecretScanConfigured,
    secretScanCoversPromptsAndFixtures,
    blocksOnHighConfidenceSecrets,
    lastGreenMainBranchOrPrMergeScanWithin7Days,
    measuredAt,
    sources,
  };
}

export function buildPrecommitCiSecretScanReport(opts: {
  assessedAt: string;
  preCommitSecretScan: { found: boolean; refs: string[] };
  ciSecretScan: { found: boolean; refs: string[] };
  scannerConfig: { found: boolean; refs: string[] };
  promptFixtureCoverage: { found: boolean; refs: string[] };
  blocking: { found: boolean; refs: string[] };
  imported: PrecommitCiSecretScanReport["importedResults"];
}): PrecommitCiSecretScanReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.preCommitSecretScan.found ||
    opts.ciSecretScan.found ||
    opts.scannerConfig.found ||
    opts.promptFixtureCoverage.found ||
    opts.blocking.found;
  // Config / scanner-config presence proves a scan program for N/A override.
  const surfaceProvedForNaOverride =
    opts.preCommitSecretScan.found ||
    opts.ciSecretScan.found ||
    opts.scannerConfig.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No precommit-ci-secret-scan signals — SEC2-R1 remains not demonstrated until pre-commit + CI secret-scan evidence or an explicit N/A attest (applicationCodePromptsOrFixturesPresent=false) is imported.",
    );
  }
  if (opts.preCommitSecretScan.found) {
    notes.push(
      `Pre-commit secret-scan refs: ${opts.preCommitSecretScan.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.ciSecretScan.found) {
    notes.push(
      `CI secret-scan refs: ${opts.ciSecretScan.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.scannerConfig.found) {
    notes.push(
      `Scanner-config refs: ${opts.scannerConfig.refs.slice(0, 3).join(", ")}; root config alone ≠ PASS — still need pre-commit + CI + green scan import.`,
    );
  }
  if (opts.promptFixtureCoverage.found) {
    notes.push(
      `Prompt/fixture coverage refs: ${opts.promptFixtureCoverage.refs.slice(0, 3).join(", ")}; path/text hints alone do not prove disposition — import secretScanCoversPromptsAndFixtures.`,
    );
  }
  if (opts.blocking.found) {
    notes.push(
      `Blocking refs: ${opts.blocking.refs.slice(0, 3).join(", ")}; blocking wording alone ≠ PASS without import.`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (contentPresent=${opts.imported.applicationCodePromptsOrFixturesPresent}, preCommit=${opts.imported.preCommitSecretScanConfigured}, ci=${opts.imported.ciSecretScanConfigured}, covers=${opts.imported.secretScanCoversPromptsAndFixtures}, blocks=${opts.imported.blocksOnHighConfidenceSecrets}, green7d=${opts.imported.lastGreenMainBranchOrPrMergeScanWithin7Days}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import pre-commit + CI configured (or present via in-repo signals), secretScanCoversPromptsAndFixtures=true, blocksOnHighConfidenceSecrets=true, lastGreenMainBranchOrPrMergeScanWithin7Days=true (measuredAt ≤7d) under imports/precommit-ci-secret-scan/ to PASS. Set applicationCodePromptsOrFixturesPresent=false for NOT_APPLICABLE.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const preCommitPresent =
    opts.preCommitSecretScan.found ||
    opts.imported.preCommitSecretScanConfigured === true;
  const ciPresent =
    opts.ciSecretScan.found || opts.imported.ciSecretScanConfigured === true;

  const coversOk =
    opts.imported.secretScanCoversPromptsAndFixtures === true;
  const blocksOk = opts.imported.blocksOnHighConfidenceSecrets === true;
  const greenOk =
    opts.imported.lastGreenMainBranchOrPrMergeScanWithin7Days === true;

  let statusHint: PrecommitCiSecretScanReport["summary"]["statusHint"];
  let sec2R1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    ((opts.imported.preCommitSecretScanConfigured === false &&
      !opts.preCommitSecretScan.found) ||
      (opts.imported.ciSecretScanConfigured === false &&
        !opts.ciSecretScan.found) ||
      opts.imported.secretScanCoversPromptsAndFixtures === false ||
      opts.imported.blocksOnHighConfidenceSecrets === false ||
      opts.imported.lastGreenMainBranchOrPrMergeScanWithin7Days === false);

  if (explicitFail) {
    statusHint = "fail";
    sec2R1Satisfied = false;
    if (
      opts.imported.applicationCodePromptsOrFixturesPresent === false &&
      surfaceProvedForNaOverride
    ) {
      notes.push(
        "Imported applicationCodePromptsOrFixturesPresent=false ignored — in-repo pre-commit/CI/scanner-config proves the surface exists.",
      );
    }
    notes.push(
      "Imported evidence shows missing pre-commit/CI, incomplete prompt/fixture coverage, non-blocking scan, or stale/missing green scan — SEC2-R1 fail.",
    );
  } else if (
    opts.imported.found &&
    opts.imported.applicationCodePromptsOrFixturesPresent === false &&
    !surfaceProvedForNaOverride
  ) {
    statusHint = "not_applicable";
    sec2R1Satisfied = null;
    notes.push(
      "Imported applicationCodePromptsOrFixturesPresent=false — SEC2-R1 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.applicationCodePromptsOrFixturesPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported applicationCodePromptsOrFixturesPresent=false ignored — in-repo pre-commit/CI/scanner-config proves the surface exists.",
    );
    if (
      preCommitPresent &&
      ciPresent &&
      coversOk &&
      blocksOk &&
      greenOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      sec2R1Satisfied = true;
    } else {
      statusHint = "partial";
      sec2R1Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    sec2R1Satisfied = null;
  } else if (
    preCommitPresent &&
    ciPresent &&
    coversOk &&
    blocksOk &&
    greenOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    sec2R1Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    sec2R1Satisfied = false;
    if (opts.imported.found && !preCommitPresent) {
      notes.push(
        "PASS requires pre-commit secret-scan config (in-repo or preCommitSecretScanConfigured=true).",
      );
    }
    if (opts.imported.found && !ciPresent) {
      notes.push(
        "PASS requires CI secret-scan config (in-repo or ciSecretScanConfigured=true).",
      );
    }
    if (opts.imported.found && !coversOk) {
      notes.push(
        "Import must show secretScanCoversPromptsAndFixtures=true.",
      );
    }
    if (opts.imported.found && !blocksOk) {
      notes.push("Import must show blocksOnHighConfidenceSecrets=true.");
    }
    if (opts.imported.found && !greenOk) {
      notes.push(
        "Import must show lastGreenMainBranchOrPrMergeScanWithin7Days=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤7 days; generatedAt is ignored) — required to unlock SEC2-R1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    sec2R1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      preCommitSecretScan: opts.preCommitSecretScan,
      ciSecretScan: opts.ciSecretScan,
      scannerConfig: opts.scannerConfig,
      promptFixtureCoverage: opts.promptFixtureCoverage,
      blocking: opts.blocking,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      preCommitPresent,
      ciPresent,
      sec2R1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const precommitCiSecretScanCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const refs = collectScanRefs(ctx.targetPath, maxFiles);
    const imported = loadImported(ctx);
    const report = buildPrecommitCiSecretScanReport({
      assessedAt: ctx.assessedAt.toISOString(),
      preCommitSecretScan: {
        found: refs.preCommit.length > 0,
        refs: refs.preCommit,
      },
      ciSecretScan: { found: refs.ci.length > 0, refs: refs.ci },
      scannerConfig: {
        found: refs.scannerConfig.length > 0,
        refs: refs.scannerConfig,
      },
      promptFixtureCoverage: {
        found: refs.promptFixture.length > 0,
        refs: refs.promptFixture,
      },
      blocking: { found: refs.blocking.length > 0, refs: refs.blocking },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "precommit-ci-secret-scan-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/precommit-ci-secret-scan-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "precommit-ci-secret-scan",
          "sec2-r1",
          DETECTOR_ID,
          ...(report.summary.sec2R1Satisfied ? ["sec2-r1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SEC2-R1 status=${report.summary.statusHint} preCommit=${report.summary.preCommitPresent} ci=${report.summary.ciPresent} satisfied=${report.summary.sec2R1Satisfied}; report=imports/${PLUGIN_ID}/precommit-ci-secret-scan-report.json`,
      nodes,
    };
  },
};
