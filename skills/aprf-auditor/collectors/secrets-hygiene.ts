/**
 * secrets-hygiene — SEC2-M1 detector executor.
 *
 * Looks for secrets-manager wiring, CI/repo secret-scan config, and high-confidence
 * embedded privileged secrets. Never writes secret values into the report.
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
  listImportFiles,
  readText,
  redact,
  rel,
  walkFiles,
} from "./lib/fs.ts";

const PLUGIN_ID = "secrets-hygiene";
const RELATED = ["SEC2-M1"] as const;

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
  { id: "aws-secret-assign", re: /aws_secret_access_key\s*[=:]\s*['"][A-Za-z0-9/+=]{30,}['"]/gi },
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

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PROMPT_FIXTURE_HINT =
  /(prompt|fixture|notebook|\.ipynb|eval|testdata|sample)/i;

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
  summary: {
    embeddedCount: number;
    embeddedInPromptsOrFixtures: number;
    secretsManagerPresent: boolean;
    secretScanPresent: boolean;
    /** PASS criteria: manager + scan + 0 embedded (and imported findings 0 if present) */
    sec2M1Satisfied: boolean | null;
    statusHint: "pass" | "partial" | "fail" | "not_demonstrated";
  };
  notes: string[];
}

function importDir(ctx: CollectorContext): string {
  return join(ctx.outputDir, "imports", PLUGIN_ID);
}

function isSkippable(path: string): boolean {
  return SKIP_DIR_HINT.test(path) || /\.(min\.js|map|lock|png|jpg|gif|webp|woff2?)$/i.test(path);
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
  // de-dupe
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
  // Also plain Dockerfile without extension
  const extras = ["Dockerfile", "Dockerfile.dev", ".env", ".env.example"].map(
    (n) => join(targetPath, n),
  );
  const all = [...files, ...extras.filter((p) => existsSync(p))];

  for (const f of all) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    // Skip docs examples that are clearly placeholders often — still scan .env.example lightly
    const text = readText(f, 300_000);
    if (!text) continue;
    const inPrompt = PROMPT_FIXTURE_HINT.test(r);

    for (const { id, re } of EMBEDDED_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const matched = m[0];
        // Skip obvious placeholders
        if (
          /your[_-]?api[_-]?key|changeme|example|xxx+|placeholder|<.*>|\$\{|process\.env|os\.environ|secrets\./i.test(
            matched,
          )
        ) {
          continue;
        }
        // .env.example with empty/short values — generic pattern may false-positive; require length
        if (/\.env\.example$/i.test(r) && id === "generic-api-key-assign") {
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

function loadImportedScan(ctx: CollectorContext): {
  found: boolean;
  findingCount: number | null;
  sources: string[];
} {
  const sources: string[] = [];
  let findingCount: number | null = null;
  for (const file of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (!/\.(json|sarif)$/i.test(file)) continue;
    if (/secrets-hygiene-report\.json$/i.test(file)) continue;
    const text = readText(file, 5_000_000);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(rel(ctx.outputDir, file));
      let n = 0;
      if (Array.isArray(data.runs)) {
        // SARIF
        for (const run of data.runs as Array<{ results?: unknown[] }>) {
          n += run.results?.length ?? 0;
        }
      } else if (typeof data.findings === "number") {
        n = data.findings;
      } else if (Array.isArray(data.findings)) {
        n = data.findings.length;
      } else if (typeof data.embeddedCount === "number") {
        n = data.embeddedCount;
      } else if (Array.isArray(data.results)) {
        n = data.results.length;
      }
      findingCount = (findingCount ?? 0) + n;
    } catch {
      /* skip */
    }
  }
  return {
    found: sources.length > 0,
    findingCount,
    sources,
  };
}

export function buildSecretsReport(
  opts: {
    assessedAt: string;
    manager: { found: boolean; refs: string[] };
    scan: { found: boolean; refs: string[] };
    embedded: EmbeddedFinding[];
    imported: {
      found: boolean;
      findingCount: number | null;
      sources: string[];
    };
  },
): SecretsHygieneReport {
  const notes: string[] = [];
  const secretScanPresent = opts.scan.found || opts.imported.found;
  const secretsManagerPresent = opts.manager.found;
  const embeddedCount = opts.embedded.length;
  const embeddedInPrompts = opts.embedded.filter((f) => f.inPromptOrFixture)
    .length;
  const importedFindings = opts.imported.findingCount;

  if (!secretsManagerPresent) {
    notes.push(
      "No secrets-manager / sealed-secrets / cloud secret-ref wiring found. CI ${{ secrets.* }} alone does not count as production runtime secrets manager.",
    );
  } else {
    notes.push(
      `Secrets-manager-like refs: ${opts.manager.refs.slice(0, 3).join(", ")}`,
    );
  }

  if (!secretScanPresent) {
    notes.push(
      "No CI/repo secret-scan config (gitleaks/trufflehog/detect-secrets) and no imported scan report.",
    );
  } else if (opts.scan.found) {
    notes.push(`Secret-scan config: ${opts.scan.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported scan report(s): ${opts.imported.sources.join(", ")} (findings=${importedFindings})`,
    );
  }
  if (embeddedCount > 0) {
    notes.push(
      `Heuristic scan found ${embeddedCount} high-confidence embedded secret pattern(s) (values redacted; ${embeddedInPrompts} in prompt/fixture paths).`,
    );
  }

  let statusHint: SecretsHygieneReport["summary"]["statusHint"] =
    "not_demonstrated";
  let sec2M1Satisfied: boolean | null = null;

  const scanClean =
    embeddedCount === 0 &&
    (importedFindings === null || importedFindings === 0);

  if (embeddedCount > 0 || (importedFindings !== null && importedFindings > 0)) {
    statusHint = "fail";
    sec2M1Satisfied = false;
  } else if (secretsManagerPresent && secretScanPresent && scanClean) {
    statusHint = "pass";
    sec2M1Satisfied = true;
  } else if (secretsManagerPresent || secretScanPresent) {
    statusHint = "partial";
    sec2M1Satisfied = false;
  } else {
    statusHint = "not_demonstrated";
    sec2M1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
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
      importedFindingCount: importedFindings,
      importedSources: opts.imported.sources,
    },
    embeddedFindings: opts.embedded.slice(0, 40),
    summary: {
      embeddedCount,
      embeddedInPromptsOrFixtures: embeddedInPrompts,
      secretsManagerPresent,
      secretScanPresent,
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
    const embedded = heuristicEmbeddedScan(ctx.targetPath, ctx.maxFiles ?? 4000);
    const imported = loadImportedScan(ctx);

    const report = buildSecretsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      manager,
      scan,
      embedded,
      imported,
    });

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
        excerpt: redact(`Secrets manager refs: ${manager.refs.slice(0, 6).join(", ")}`),
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
