/**
 * prompt-lint-ci — PRM-R2 / repo-prompt-lint-ci.
 *
 * Discovers blocking prompt-lint CI on prompt-change PRs.
 * Import promptChangePrsMissingLint=0 + blockingPromptLintRulesPresent +
 * lastFailingLintExampleRetained under imports/prompt-lint-ci/ to unlock PASS
 * (measuredAt ≤90d).
 */
import { writeFileSync } from "node:fs";
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
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "prompt-lint-ci";
const RELATED = ["PRM-R2"] as const;
const DETECTOR_ID = "repo-prompt-lint-ci";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PROMPT_PATH_RE =
  /(prompt|prompts|system[\s_-]*prompt|prompt[\s_-]*template|\.prompt\.)/i;

const LINT_RE =
  /\b(prompt[\s_-]*lint\w*|lint[\s_-]*prompt\w*|promptfoo[\s_-]*lint|prompt[\s_-]*check\w*)\b/i;

const RULE_RE =
  /\b(length[\s_-]*limit\w*|max[\s_-]*tokens?|forbidden[\s_-]*pattern\w*|secret[\s_-]*pattern\w*|injection[\s_-]*prone|unbounded[\s_-]*(user|concat)|user[\s_-]*concatenat\w*)\b/i;

const BLOCK_RE =
  /\b(required[\s_-]*check\w*|blocking|fail[\s_-]*the[\s_-]*build|fail[\s_-]*closed|cannot[\s_-]*skip|enforce\w*)\b/i;

const FAIL_EXAMPLE_RE =
  /\b(failing[\s_-]*lint|lint[\s_-]*failure|example[\s_-]*failure|retained[\s_-]*fail|last[\s_-]*fail)\b/i;

export interface PromptLintCiReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    lintConfig: { found: boolean; refs: string[] };
    rules: { found: boolean; refs: string[] };
    blocking: { found: boolean; refs: string[] };
    failExample: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    promptChangePrsMissingLint: number | null;
    blockingPromptLintRulesPresent: boolean | null;
    lastFailingLintExampleRetained: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    promptSignalsPresent: boolean;
    lintSignalsPresent: boolean;
    prmR2Satisfied: boolean | null;
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

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function collectRefs(
  targetPath: string,
  maxFiles: number,
  match: (path: string, text: string) => boolean,
  limit = 16,
): string[] {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [
      ".py",
      ".ts",
      ".js",
      ".tsx",
      ".yml",
      ".yaml",
      ".json",
      ".toml",
      ".md",
    ],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    const text = readText(f, 80_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function detectPromptSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        PROMPT_PATH_RE.test(path) ||
        /\b(system[\s_-]*prompt|prompt[\s_-]*template)\b/i.test(text),
      5,
    ).length > 0
  );
}

function loadImported(
  ctx: CollectorContext,
): PromptLintCiReport["importedResults"] {
  const sources: string[] = [];
  let promptChangePrsMissingLint: number | null = null;
  let blockingPromptLintRulesPresent: boolean | null = null;
  let lastFailingLintExampleRetained: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/prompt-lint-ci-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      promptChangePrsMissingLint =
        asNum(data.promptChangePrsMissingLint) ??
        asNum(data.prompt_change_prs_missing_lint) ??
        asNum(data.prsMissingPromptLint) ??
        promptChangePrsMissingLint;
      blockingPromptLintRulesPresent =
        asBool(data.blockingPromptLintRulesPresent) ??
        asBool(data.blocking_prompt_lint_rules_present) ??
        asBool(data.blockingRulesPresent) ??
        blockingPromptLintRulesPresent;
      lastFailingLintExampleRetained =
        asBool(data.lastFailingLintExampleRetained) ??
        asBool(data.last_failing_lint_example_retained) ??
        asBool(data.failingExampleRetained) ??
        lastFailingLintExampleRetained;

      if (asBool(data.lintRunsOnEveryPromptPr) === true) {
        promptChangePrsMissingLint = promptChangePrsMissingLint ?? 0;
      }
      // Affirmative rule coverage overrides earlier false.
      if (asBool(data.coversLengthSecretsInjectionConcat) === true) {
        blockingPromptLintRulesPresent = true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    promptChangePrsMissingLint,
    blockingPromptLintRulesPresent,
    lastFailingLintExampleRetained,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildPromptLintCiReport(opts: {
  assessedAt: string;
  lintConfig: { found: boolean; refs: string[] };
  rules: { found: boolean; refs: string[] };
  blocking: { found: boolean; refs: string[] };
  failExample: { found: boolean; refs: string[] };
  promptSignals: boolean;
  imported: PromptLintCiReport["importedResults"];
}): PromptLintCiReport {
  const notes: string[] = [];
  const lintSignalsPresent =
    opts.lintConfig.found ||
    opts.rules.found ||
    opts.blocking.found ||
    opts.failExample.found;

  if (!opts.promptSignals && !lintSignalsPresent && !opts.imported.found) {
    notes.push(
      "No prompt/lint signals — PRM-R2 may be NOT_APPLICABLE if there are no production prompts.",
    );
  }
  if (opts.lintConfig.found) {
    notes.push(`Lint-config refs: ${opts.lintConfig.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.rules.found) {
    notes.push(`Rule refs: ${opts.rules.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.blocking.found) {
    notes.push(`Blocking refs: ${opts.blocking.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.failExample.found) {
    notes.push(
      `Fail-example refs: ${opts.failExample.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (missingLint=${opts.imported.promptChangePrsMissingLint}, blocking=${opts.imported.blockingPromptLintRulesPresent}, failRetained=${opts.imported.lastFailingLintExampleRetained})`,
    );
  } else if (lintSignalsPresent) {
    notes.push(
      "Lint signals alone are PARTIAL — import promptChangePrsMissingLint=0 + blockingPromptLintRulesPresent=true + lastFailingLintExampleRetained=true (measuredAt ≤90d) under imports/prompt-lint-ci/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const coverageOk =
    opts.imported.promptChangePrsMissingLint !== null &&
    opts.imported.promptChangePrsMissingLint === 0;
  const rulesOk = opts.imported.blockingPromptLintRulesPresent === true;
  const failOk = opts.imported.lastFailingLintExampleRetained === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: PromptLintCiReport["summary"]["statusHint"];
  let prmR2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.promptChangePrsMissingLint !== null &&
      opts.imported.promptChangePrsMissingLint > 0) ||
      opts.imported.blockingPromptLintRulesPresent === false ||
      opts.imported.lastFailingLintExampleRetained === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.promptSignals && !lintSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    prmR2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    prmR2Satisfied = false;
    notes.push(
      "Imported evidence shows missing PR lint coverage, non-blocking rules, missing failure example, or evidence older than 90 days — PRM-R2 fail.",
    );
  } else if (
    (lintSignalsPresent || opts.imported.found) &&
    coverageOk &&
    rulesOk &&
    failOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    prmR2Satisfied = true;
  } else if (lintSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    prmR2Satisfied = false;
    if (opts.imported.found && !coverageOk) {
      notes.push("Import must show promptChangePrsMissingLint=0.");
    }
    if (opts.imported.found && !rulesOk) {
      notes.push("Import must show blockingPromptLintRulesPresent=true.");
    }
    if (opts.imported.found && !failOk) {
      notes.push("Import must show lastFailingLintExampleRetained=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock PRM-R2 PASS.",
      );
    }
  } else if (opts.promptSignals) {
    statusHint = "not_demonstrated";
    prmR2Satisfied = null;
    notes.push(
      "Prompt signals present but no prompt-lint CI evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    prmR2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      lintConfig: opts.lintConfig,
      rules: opts.rules,
      blocking: opts.blocking,
      failExample: opts.failExample,
    },
    importedResults: opts.imported,
    summary: {
      promptSignalsPresent: opts.promptSignals,
      lintSignalsPresent,
      prmR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const promptLintCiCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const promptSignals = detectPromptSignals(ctx.targetPath, maxFiles);

    const lintConfigRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => LINT_RE.test(path) || LINT_RE.test(text),
      12,
    );
    const ruleRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (LINT_RE.test(path) || LINT_RE.test(text) || RULE_RE.test(path)) &&
        RULE_RE.test(text),
      12,
    );
    const blockingRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (LINT_RE.test(path) || LINT_RE.test(text)) && BLOCK_RE.test(text),
      12,
    );
    const failExampleRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => FAIL_EXAMPLE_RE.test(path) || FAIL_EXAMPLE_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildPromptLintCiReport({
      assessedAt: ctx.assessedAt.toISOString(),
      lintConfig: { found: lintConfigRefs.length > 0, refs: lintConfigRefs },
      rules: { found: ruleRefs.length > 0, refs: ruleRefs },
      blocking: { found: blockingRefs.length > 0, refs: blockingRefs },
      failExample: {
        found: failExampleRefs.length > 0,
        refs: failExampleRefs,
      },
      promptSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "prompt-lint-ci-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/prompt-lint-ci-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "prompt-lint-ci",
          "prm-r2",
          DETECTOR_ID,
          ...(report.summary.prmR2Satisfied ? ["prm-r2-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.lintConfig.refs,
        ...report.signals.rules.refs,
        ...report.signals.blocking.refs,
        ...report.signals.failExample.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["prompt-lint-ci-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PRM-R2 status=${report.summary.statusHint} lint=${report.summary.lintSignalsPresent} satisfied=${report.summary.prmR2Satisfied}; report=imports/${PLUGIN_ID}/prompt-lint-ci-report.json`,
      nodes,
    };
  },
};
