/**
 * secrets-hygiene — SEC2-M1 / repo-secrets-hygiene.
 *
 * Discovers secrets-manager wiring, CI/repo secret-scan config, and
 * high-confidence embedded privileged secrets (values never stored).
 * Import coverage under imports/secrets-hygiene/ unlocks PASS (measuredAt ≤90d).
 * CI ${{ secrets.* }} alone ≠ production secrets manager.
 */
import { writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
  EvidenceNode,
} from "./types.ts";
import {
  ensureDir,
  isSkippedScanRelPath,
  listImportFiles,
  readText,
  redact,
  rel,
  walkFiles,
} from "./lib/fs.ts";
import { withReportEvidenceTypes } from "./lib/evidence-types.ts";
import {
  asBool,
  measuredAtFresh,
  mergeAndBool,
  mergeMaxNum,
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "secrets-hygiene";
const RELATED = ["SEC2-M1"] as const;
const DETECTOR_ID = "repo-secrets-hygiene";
const IMPORT_MAX_AGE_DAYS = 90;

const CLOUD_CFG_IMPORT_RE =
  /(cloud.?config|provider.?export|config.?snapshot|secrets.?manager.?export)/i;
const LOG_IMPORT_RE = /(log|audit|cloudtrail|cloud.?watch)/i;
const POLICY_SCAN_IMPORT_RE =
  /(\.sarif$|secret.?scan|gitleaks|trufflehog|detect.?secret|policy.?scan)/i;

const MANAGER_FILE_RE =
  /(external-?secrets|sealed-?secrets|secretproviderclass|vault|doppler|1password|aws.?secrets.?manager|secretsmanager|azure.?key.?vault|gcp.?secret|google.?secret.?manager)/i;

const MANAGER_CONTENT_RE =
  /\b(ExternalSecret|SealedSecret|SecretProviderClass|aws_secretsmanager|secretsmanager:GetSecretValue|hashicorp\/vault|doppler\.|op:\/\/|azure\.keyvault|SecretManagerServiceClient|from_secrets_manager|secrets\.manager)\b/i;

const SCAN_CONTENT_RE =
  /\b(gitleaks|trufflehog|detect-secrets|secret.?scan|git-secrets|talisman)\b/i;

const SCAN_CONFIG_NAMES =
  /^(gitleaks\.(toml|yml|yaml)|\.gitleaks\.toml|\.trufflehog|detect-secrets|\.secrets\.baseline)/i;

/** High-confidence privileged patterns — capture groups unused; values never logged. */
const EMBEDDED_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    id: "aws-secret-assign",
    re: /aws_secret_access_key\s*[=:]\s*['"][A-Za-z0-9/+=]{30,}['"]/gi,
  },
  { id: "openai-sk", re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { id: "github-pat", re: /\bghp_[A-Za-z0-9]{30,}\b/g },
  { id: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  {
    id: "private-key-block",
    re: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/g,
  },
  {
    id: "generic-api-key-assign",
    re: /\b(api[_-]?key|secret[_-]?key|access[_-]?token)\s*[=:]\s*['"][A-Za-z0-9_\-]{24,}['"]/gi,
  },
];

const PROMPT_FIXTURE_HINT =
  /(prompt|fixture|notebook|\.ipynb|eval|testdata|sample|__tests__|__mocks__|\.test\.|\.spec\.|(^|[/\\])(tests?|specs?|e2e|mocks?)[/\\])/i;

export interface EmbeddedFinding {
  patternId: string;
  ref: string;
  /** Line number only — never the secret value */
  line: number;
  inPromptOrFixture: boolean;
}

export interface SecretsHygieneReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  secretsManager: {
    found: boolean;
    refs: string[];
  };
  secretScan: {
    ciConfigFound: boolean;
    configRefs: string[];
    importedReportFound: boolean;
    importedFindingCount: number | null;
    importedSources: string[];
  };
  embeddedFindings: EmbeddedFinding[];
  importedResults: {
    found: boolean;
    productionRuntimeSecretsPresent: boolean | null;
    secretsManagerWiringPresent: boolean | null;
    productionRuntimeSecretsResolvedFromSecretsManagerPct: number | null;
    /** Production-path privileged findings (gates FAIL/PASS/N/A). */
    privilegedSecretsInReposPromptsOrClientBundles: number | null;
    /** Fixture/test-path findings from structural imports — visibility only. */
    importedFixtureFindingCount: number | null;
    secretScanCoversPromptsAndFixtures: boolean | null;
    measuredAt: string | null;
    sources: string[];
    /**
     * Stronger evidence types proven by the same import artifact that supplied
     * the metric (filename pattern + field on that file).
     */
    provenEvidenceTypes: string[];
  };
  summary: {
    embeddedCount: number;
    embeddedInPromptsOrFixtures: number;
    secretsManagerPresent: boolean;
    secretScanPresent: boolean;
    gateSignalsPresent: boolean;
    sec2M1Satisfied: boolean | null;
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
  return (
    isSkippedScanRelPath(path) ||
    /\.(min\.js|map|lock|png|jpg|gif|webp|woff2?)$/i.test(path)
  );
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function detectSecretsManager(
  targetPath: string,
  maxFiles: number,
): { found: boolean; refs: string[] } {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [
      ".yaml",
      ".yml",
      ".json",
      ".tf",
      ".hcl",
      ".py",
      ".ts",
      ".js",
      ".env",
      ".toml",
      ".md",
    ],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    if (MANAGER_FILE_RE.test(r) || MANAGER_FILE_RE.test(basename(f))) {
      refs.push(r);
      continue;
    }
    const text = readText(f, 120_000);
    if (text && MANAGER_CONTENT_RE.test(text)) refs.push(r);
    if (refs.length >= 20) break;
  }
  return { found: refs.length > 0, refs: refs.slice(0, 16) };
}

function detectSecretScanConfig(
  targetPath: string,
  maxFiles: number,
): { found: boolean; refs: string[] } {
  const refs: string[] = [];
  const wfDir = join(targetPath, ".github", "workflows");
  if (existsSync(wfDir)) {
    for (const f of walkFiles(wfDir, {
      maxFiles: 100,
      extensions: [".yml", ".yaml"],
    })) {
      const text = readText(f) ?? "";
      if (SCAN_CONTENT_RE.test(text)) refs.push(rel(targetPath, f));
    }
  }
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 3000),
    extensions: [".toml", ".yml", ".yaml", ".json", ".cfg", ".baseline"],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    if (SCAN_CONFIG_NAMES.test(basename(f)) || SCAN_CONTENT_RE.test(r)) {
      refs.push(r);
      continue;
    }
    const text = readText(f, 80_000);
    if (
      text &&
      SCAN_CONTENT_RE.test(text) &&
      /(workflow|ci|pre-commit|husky)/i.test(r + text.slice(0, 200))
    ) {
      refs.push(r);
    }
    if (refs.length >= 16) break;
  }
  return { found: refs.length > 0, refs: [...new Set(refs)].slice(0, 16) };
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/).length;
}

function heuristicEmbeddedScan(
  targetPath: string,
  maxFiles: number,
): EmbeddedFinding[] {
  const findings: EmbeddedFinding[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 4000),
    extensions: [
      ".py",
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".env",
      ".yml",
      ".yaml",
      ".json",
      ".md",
      ".ipynb",
      ".toml",
      ".sh",
      ".Dockerfile",
    ],
  });
  const extras = ["Dockerfile", "Dockerfile.dev", ".env", ".env.example"].map(
    (n) => join(targetPath, n),
  );
  const all = [...files, ...extras.filter((p) => existsSync(p))];

  for (const f of all) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    const text = readText(f, 300_000);
    if (!text) continue;
    const inPrompt = PROMPT_FIXTURE_HINT.test(r);

    for (const { id, re } of EMBEDDED_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const matched = m[0];
        if (
          /your[_-]?api[_-]?key|changeme|example|xxx+|placeholder|<.*>|\$\{|process\.env|os\.environ|secrets\./i.test(
            matched,
          ) ||
          // Placeholders that name the credential mid-string, e.g.
          // 'your-openai-api-key-here' or 'my_replace_me_token'.
          /\b(your|my|replace|dummy|fake|test|sample)[-_].*(key|token|secret)|[-_]here['"]?$/i.test(
            matched,
          )
        ) {
          continue;
        }
        // Patterns that match only a prefix (e.g. a PEM header) reveal nothing
        // about what follows, so inspect a short trailing window: an elided or
        // placeholder body means this is documentation, not a real key.
        if (
          /\.\.\.|your[_-]|changeme|example|placeholder|<[^>]*>/i.test(
            text.slice(m.index + matched.length, m.index + matched.length + 40),
          )
        ) {
          continue;
        }
        if (/\.env\.example$/i.test(r) && id === "generic-api-key-assign") {
          continue;
        }
        // Markdown documents usage; an assignment in prose is an illustrative
        // example, not a production runtime secret. Same rationale as
        // .env.example above. Higher-entropy provider patterns (aws-access-key,
        // slack-token, private-key-block) still count wherever they appear.
        if (/\.md$/i.test(r) && id === "generic-api-key-assign") {
          continue;
        }
        findings.push({
          patternId: id,
          ref: r,
          line: lineOf(text, m.index),
          inPromptOrFixture: inPrompt,
        });
        if (findings.length >= 50) return findings;
      }
    }
  }
  return findings;
}

/** Best-effort file path from a SARIF/scan finding for fixture vs production split. */
function findingPathHint(finding: unknown): string {
  if (!finding || typeof finding !== "object") return "";
  const f = finding as Record<string, unknown>;
  if (typeof f.path === "string") return f.path;
  if (typeof f.file === "string") return f.file;
  if (typeof f.uri === "string") return f.uri;
  const locations = f.locations;
  if (!Array.isArray(locations) || locations.length === 0) return "";
  const loc = locations[0] as Record<string, unknown>;
  const physical = loc.physicalLocation as Record<string, unknown> | undefined;
  const artifact = physical?.artifactLocation as
    | Record<string, unknown>
    | undefined;
  if (typeof artifact?.uri === "string") return artifact.uri;
  if (typeof loc.uri === "string") return loc.uri;
  return "";
}

/**
 * Count structural scan findings, splitting fixture/test paths from production.
 * Only production-path findings raise the SEC2-M1 gate metric; fixture hits
 * stay visible via the returned fixture count.
 */
function countStructuralFindings(data: Record<string, unknown>): {
  production: number;
  fixture: number;
} {
  let items: unknown[] = [];
  if (Array.isArray(data.runs)) {
    for (const run of data.runs as Array<{ results?: unknown[] }>) {
      if (Array.isArray(run.results)) items.push(...run.results);
    }
  } else if (Array.isArray(data.findings)) {
    items = data.findings;
  } else if (Array.isArray(data.results)) {
    items = data.results;
  } else if (
    typeof data.embeddedCount === "number" &&
    data.embeddedCount > 0
  ) {
    // Opaque count with no paths — treat as production (cannot prove fixture-only).
    return { production: data.embeddedCount, fixture: 0 };
  } else if (typeof data.findings === "number" && data.findings > 0) {
    return { production: data.findings, fixture: 0 };
  }

  if (items.length === 0) return { production: 0, fixture: 0 };

  let production = 0;
  let fixture = 0;
  for (const item of items) {
    const path = findingPathHint(item);
    if (path && PROMPT_FIXTURE_HINT.test(path)) fixture += 1;
    else production += 1;
  }
  return { production, fixture };
}

function loadImported(
  ctx: CollectorContext,
): SecretsHygieneReport["importedResults"] {
  const sources: string[] = [];
  const proven = new Set<string>();
  let productionRuntimeSecretsPresent: boolean | null = null;
  let secretsManagerWiringPresent: boolean | null = null;
  let productionRuntimeSecretsResolvedFromSecretsManagerPct: number | null =
    null;
  let privilegedSecretsInReposPromptsOrClientBundles: number | null = null;
  let importedFixtureFindingCount: number | null = null;
  let secretScanCoversPromptsAndFixtures: boolean | null = null;
  let measuredAt: string | null = null;

  for (const file of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (!/\.(json|sarif)$/i.test(file)) continue;
    if (/secrets-hygiene-report\.json$/i.test(file)) continue;
    const text = readText(file, 5_000_000);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      const base = basename(file);
      sources.push(base);
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));

      const wiring =
        asBool(data.secretsManagerWiringPresent) ??
        asBool(data.secrets_manager_wiring_present) ??
        asBool(data.secretsManagerPresent);
      productionRuntimeSecretsPresent = mergeOrBool(
        productionRuntimeSecretsPresent,
        asBool(data.productionRuntimeSecretsPresent) ??
          asBool(data.production_runtime_secrets_present) ??
          asBool(data.productionSecretsPresent),
      );
      secretsManagerWiringPresent = mergeAndBool(
        secretsManagerWiringPresent,
        wiring,
      );
      if (wiring != null && CLOUD_CFG_IMPORT_RE.test(base)) {
        proven.add("cloud_configuration");
      }

      const resolvedPct =
        asNum(data.productionRuntimeSecretsResolvedFromSecretsManagerPct) ??
        asNum(
          data.production_runtime_secrets_resolved_from_secrets_manager_pct,
        ) ??
        asNum(data.resolvedFromSecretsManagerPct);
      productionRuntimeSecretsResolvedFromSecretsManagerPct = mergeMinNum(
        productionRuntimeSecretsResolvedFromSecretsManagerPct,
        resolvedPct,
      );

      // Explicit gate field = production privileged findings (catalog contract).
      const privileged =
        asNum(data.privilegedSecretsInReposPromptsOrClientBundles) ??
        asNum(data.privileged_secrets_in_repos_prompts_or_client_bundles) ??
        asNum(data.privilegedSecretsFoundInScan);
      privilegedSecretsInReposPromptsOrClientBundles = mergeMaxNum(
        privilegedSecretsInReposPromptsOrClientBundles,
        privileged,
      );

      const covers =
        asBool(data.secretScanCoversPromptsAndFixtures) ??
        asBool(data.secret_scan_covers_prompts_and_fixtures) ??
        asBool(data.scanCoversPromptsAndFixtures);
      secretScanCoversPromptsAndFixtures = mergeAndBool(
        secretScanCoversPromptsAndFixtures,
        covers,
      );

      // Structural scan payloads (SARIF / findings arrays): only production-path
      // results raise the gate metric. Fixture/test hits are visibility-only.
      // Empty runs/results must not attest privilegedSecrets…=0 — that requires
      // the explicit field above.
      const structural = countStructuralFindings(data);
      if (structural.production > 0) {
        privilegedSecretsInReposPromptsOrClientBundles = mergeMaxNum(
          privilegedSecretsInReposPromptsOrClientBundles,
          structural.production,
        );
      }
      if (structural.fixture > 0) {
        importedFixtureFindingCount = mergeMaxNum(
          importedFixtureFindingCount,
          structural.fixture,
        );
      }

      const scanMetricPresent =
        privileged != null ||
        covers != null ||
        structural.production > 0 ||
        /\.sarif$/i.test(base);
      if (scanMetricPresent && POLICY_SCAN_IMPORT_RE.test(base)) {
        proven.add("policy_scan_report");
      }
      const logMetricPresent =
        resolvedPct != null || privileged != null || structural.production > 0;
      if (logMetricPresent && LOG_IMPORT_RE.test(base)) {
        proven.add("application_logs");
        proven.add("cloud_audit_logs");
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionRuntimeSecretsPresent,
    secretsManagerWiringPresent,
    productionRuntimeSecretsResolvedFromSecretsManagerPct,
    privilegedSecretsInReposPromptsOrClientBundles,
    importedFixtureFindingCount,
    secretScanCoversPromptsAndFixtures,
    measuredAt,
    sources,
    provenEvidenceTypes: [...proven].sort(),
  };
}

export function buildSecretsReport(opts: {
  assessedAt: string;
  manager: { found: boolean; refs: string[] };
  scan: { found: boolean; refs: string[] };
  embedded: EmbeddedFinding[];
  imported: SecretsHygieneReport["importedResults"];
}): SecretsHygieneReport {
  const notes: string[] = [];
  const gateSignalsPresent = opts.manager.found || opts.scan.found;
  const secretsManagerPresent =
    opts.manager.found ||
    opts.imported.secretsManagerWiringPresent === true;
  const secretScanPresent = opts.scan.found || opts.imported.found;
  const embeddedCount = opts.embedded.length;
  const embeddedInPrompts = opts.embedded.filter((f) => f.inPromptOrFixture)
    .length;
  // SEC2-M1 governs *production* runtime secrets. Test and fixture material is
  // reported for visibility but must not fail the control or block N/A on its own.
  const embeddedProductionCount = opts.embedded.filter(
    (f) => !f.inPromptOrFixture,
  ).length;
  // Only production-path embeds (or manager wiring) prove the surface exists.
  const surfaceProvedForNaOverride =
    opts.manager.found || embeddedProductionCount > 0;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No secrets-hygiene signals — SEC2-M1 remains not demonstrated until secrets-manager wiring + secret-scan evidence or an explicit N/A attest (productionRuntimeSecretsPresent=false) is imported.",
    );
  }
  if (!secretsManagerPresent) {
    notes.push(
      "No secrets-manager / sealed-secrets / cloud secret-ref wiring found. CI ${{ secrets.* }} alone does not count as production runtime secrets manager.",
    );
  } else if (opts.manager.found) {
    notes.push(
      `Secrets-manager-like refs: ${opts.manager.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.scan.found) {
    notes.push(
      `Secret-scan config: ${opts.scan.refs.slice(0, 3).join(", ")}; CI config alone does not prove a clean latest scan.`,
    );
  }
  if (opts.imported.found) {
    const fixtureNote =
      (opts.imported.importedFixtureFindingCount ?? 0) > 0
        ? `, fixtureFindings=${opts.imported.importedFixtureFindingCount}`
        : "";
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (scopePresent=${opts.imported.productionRuntimeSecretsPresent}, manager=${opts.imported.secretsManagerWiringPresent}, resolvedPct=${opts.imported.productionRuntimeSecretsResolvedFromSecretsManagerPct}, privilegedFindings=${opts.imported.privilegedSecretsInReposPromptsOrClientBundles}${fixtureNote}, coversPrompts=${opts.imported.secretScanCoversPromptsAndFixtures}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import privilegedSecretsInReposPromptsOrClientBundles=0 + productionRuntimeSecretsResolvedFromSecretsManagerPct=100 + secretScanCoversPromptsAndFixtures=true (measuredAt ≤90d) under imports/secrets-hygiene/ to PASS. Set productionRuntimeSecretsPresent=false for NOT_APPLICABLE.",
    );
  }
  if (embeddedCount > 0) {
    notes.push(
      `Heuristic scan found ${embeddedCount} high-confidence embedded secret pattern(s) (values redacted; ${embeddedInPrompts} in prompt/fixture/test paths, ${embeddedProductionCount} in production paths). Only production-path findings fail SEC2-M1.`,
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  // PASS needs manager wiring — scan config / present=true alone must not unlock.
  const managerOk = secretsManagerPresent;

  const privilegedCount =
    opts.imported.privilegedSecretsInReposPromptsOrClientBundles;
  const privilegedOk = privilegedCount === 0;
  const resolvedOk =
    opts.imported.productionRuntimeSecretsResolvedFromSecretsManagerPct ===
    100;
  const coversOk = opts.imported.secretScanCoversPromptsAndFixtures === true;

  let statusHint: SecretsHygieneReport["summary"]["statusHint"];
  let sec2M1Satisfied: boolean | null = null;

  const naCandidate =
    opts.imported.found &&
    opts.imported.productionRuntimeSecretsPresent === false &&
    !surfaceProvedForNaOverride;
  // Positive findings contradict N/A; vacuous control=false fields under N/A do not.
  const contradictingFail =
    privilegedCount !== null && privilegedCount > 0;
  const explicitFail =
    opts.imported.found &&
    (!naCandidate || contradictingFail) &&
    ((privilegedCount !== null && privilegedCount > 0) ||
      (opts.imported.productionRuntimeSecretsResolvedFromSecretsManagerPct !==
        null &&
        opts.imported.productionRuntimeSecretsResolvedFromSecretsManagerPct <
          100) ||
      opts.imported.secretScanCoversPromptsAndFixtures === false ||
      (opts.imported.secretsManagerWiringPresent === false &&
        !opts.manager.found));

  const naOverrideReasons: string[] = [];
  if (opts.manager.found) naOverrideReasons.push("secrets-manager wiring");
  if (embeddedProductionCount > 0) {
    naOverrideReasons.push("heuristic embedded privileged secrets");
  }
  const naOverrideNote =
    naOverrideReasons.length > 0
      ? `Imported productionRuntimeSecretsPresent=false ignored — in-repo ${naOverrideReasons.join(" / ")} prove the surface exists.`
      : "Imported productionRuntimeSecretsPresent=false ignored — in-repo signals prove the surface exists.";

  // Heuristic embeds + contradicting fail metrics beat N/A.
  if (embeddedProductionCount > 0) {
    statusHint = "fail";
    sec2M1Satisfied = false;
    if (
      opts.imported.found &&
      opts.imported.productionRuntimeSecretsPresent === false
    ) {
      notes.push(naOverrideNote);
    }
    if (!opts.imported.found) {
      notes.push(
        "Heuristic embedded privileged secret patterns — SEC2-M1 fail.",
      );
    }
  } else if (explicitFail) {
    statusHint = "fail";
    sec2M1Satisfied = false;
    if (
      opts.imported.productionRuntimeSecretsPresent === false &&
      surfaceProvedForNaOverride
    ) {
      notes.push(naOverrideNote);
    }
    notes.push(
      "Imported evidence shows privileged findings, unresolved runtime secrets, missing prompt/fixture scan coverage, or missing manager wiring — SEC2-M1 fail.",
    );
  } else if (
    opts.imported.found &&
    opts.imported.productionRuntimeSecretsPresent === false &&
    !surfaceProvedForNaOverride
  ) {
    statusHint = "not_applicable";
    sec2M1Satisfied = null;
    notes.push(
      "Imported productionRuntimeSecretsPresent=false — SEC2-M1 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.productionRuntimeSecretsPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(naOverrideNote);
    if (
      managerOk &&
      privilegedOk &&
      resolvedOk &&
      coversOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      sec2M1Satisfied = true;
    } else {
      statusHint = "partial";
      sec2M1Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    sec2M1Satisfied = null;
  } else if (
    managerOk &&
    privilegedOk &&
    resolvedOk &&
    coversOk &&
    importFresh &&
    opts.imported.found &&
    embeddedProductionCount === 0
  ) {
    statusHint = "pass";
    sec2M1Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    sec2M1Satisfied = false;
    if (opts.imported.found && !managerOk) {
      notes.push(
        "PASS requires secrets-manager wiring (in-repo or secretsManagerWiringPresent=true).",
      );
    }
    if (opts.imported.found && !privilegedOk) {
      notes.push(
        "Import must show privilegedSecretsInReposPromptsOrClientBundles=0 (empty SARIF alone does not attest a clean scan).",
      );
    }
    if (opts.imported.found && !resolvedOk) {
      notes.push(
        "Import must show productionRuntimeSecretsResolvedFromSecretsManagerPct=100.",
      );
    }
    if (opts.imported.found && !coversOk) {
      notes.push(
        "Import must show secretScanCoversPromptsAndFixtures=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SEC2-M1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    sec2M1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    secretsManager: {
      found: secretsManagerPresent,
      refs: opts.manager.refs,
    },
    secretScan: {
      ciConfigFound: opts.scan.found,
      configRefs: opts.scan.refs,
      importedReportFound: opts.imported.found,
      importedFindingCount:
        opts.imported.privilegedSecretsInReposPromptsOrClientBundles,
      importedSources: opts.imported.sources,
    },
    embeddedFindings: opts.embedded.slice(0, 40),
    importedResults: opts.imported,
    summary: {
      embeddedCount,
      embeddedInPromptsOrFixtures: embeddedInPrompts,
      secretsManagerPresent,
      secretScanPresent,
      gateSignalsPresent,
      sec2M1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const secretsHygieneCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const manager = detectSecretsManager(ctx.targetPath, ctx.maxFiles ?? 4000);
    const scan = detectSecretScanConfig(ctx.targetPath, ctx.maxFiles ?? 4000);
    const embedded = heuristicEmbeddedScan(
      ctx.targetPath,
      ctx.maxFiles ?? 4000,
    );
    const imported = loadImported(ctx);

    const report = withReportEvidenceTypes(
      buildSecretsReport({
        assessedAt: ctx.assessedAt.toISOString(),
        manager,
        scan,
        embedded,
        imported,
      }),
      [
        ...(manager.found || scan.found || embedded.length > 0
          ? ["repo_signal"]
          : []),
        ...imported.provenEvidenceTypes,
      ],
    );

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "secrets-hygiene-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/secrets-hygiene-report.json`,
        excerpt: redact(
          JSON.stringify(
            {
              summary: report.summary,
              notes: report.notes.slice(0, 4),
              sampleFindings: report.embeddedFindings.slice(0, 5),
            },
            null,
            2,
          ).slice(0, 1200),
        ),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        signals: [
          "secrets-hygiene",
          "sec2-m1",
          DETECTOR_ID,
          ...(report.secretsManager.found ? ["secrets-manager"] : []),
          ...(report.secretScan.ciConfigFound ||
          report.secretScan.importedReportFound
            ? ["secret-scan"]
            : []),
          ...(report.summary.embeddedCount > 0 ? ["embedded-secret"] : []),
          ...(report.summary.sec2M1Satisfied
            ? ["sec2-m1-satisfied"]
            : ["sec2-m1-fail-or-incomplete"]),
        ],
        relatedCheckIds: [...RELATED],
      },
    ];

    if (manager.found) {
      nodes.push({
        id: `${PLUGIN_ID}:manager`,
        class: "iac",
        ref: manager.refs[0],
        excerpt: redact(
          `Secrets manager refs: ${manager.refs.slice(0, 6).join(", ")}`,
        ),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        signals: ["secrets-manager", "sec2-m1"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SEC2-M1 status=${report.summary.statusHint} manager=${report.summary.secretsManagerPresent} scan=${report.summary.secretScanPresent} embedded=${report.summary.embeddedCount} satisfied=${report.summary.sec2M1Satisfied}; report=imports/${PLUGIN_ID}/secrets-hygiene-report.json`,
      nodes,
    };
  },
};
