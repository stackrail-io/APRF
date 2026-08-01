/**
 * prompt-template-hygiene — PRM-R1 / repo-prompt-template-hygiene.
 *
 * Discovers parameterized prompt templates and secret/PII hygiene signals.
 * Import templatesMissingParameters=0 + hardcodedSecretsInTemplates=0 +
 * hardcodedPiiInTemplates=0 under imports/prompt-template-hygiene/ to unlock
 * PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "prompt-template-hygiene";
const RELATED = ["PRM-R1"] as const;
const DETECTOR_ID = "repo-prompt-template-hygiene";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PROMPT_PATH_RE =
  /(prompt|prompts|system[\s_-]*prompt|prompt[\s_-]*template|\.prompt\.)/i;

const PARAM_RE =
  /\b(parameteriz\w*|template[\s_-]*var\w*|mustache|\{\{[^{}]+\}\}|\$\{[^}]+\}|prompt[\s_-]*slot\w*|jinja|handlebars)\b/i;

const SECRET_SCAN_RE =
  /\b(secret[\s_-]*scan\w*|no[\s_-]*hardcoded[\s_-]*secret\w*|api[\s_-]*key[\s_-]*in[\s_-]*prompt|prompt[\s_-]*secret\w*)\b/i;

const PII_SCAN_RE =
  /\b(pii[\s_-]*(scan|in[\s_-]*prompt|hardcod\w*)|hardcoded[\s_-]*(email|ssn|phone)|customer[\s_-]*pii[\s_-]*in[\s_-]*prompt)\b/i;

const INVENTORY_RE =
  /\b(prompt[\s_-]*template[\s_-]*inventory|template[\s_-]*inventory|parameter[\s_-]*inventory)\b/i;

export interface PromptTemplateHygieneReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    templates: { found: boolean; refs: string[] };
    parameterization: { found: boolean; refs: string[] };
    secretScan: { found: boolean; refs: string[] };
    piiScan: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    templatesMissingParameters: number | null;
    hardcodedSecretsInTemplates: number | null;
    hardcodedPiiInTemplates: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    promptSignalsPresent: boolean;
    hygieneSignalsPresent: boolean;
    prmR1Satisfied: boolean | null;
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
): PromptTemplateHygieneReport["importedResults"] {
  const sources: string[] = [];
  let templatesMissingParameters: number | null = null;
  let hardcodedSecretsInTemplates: number | null = null;
  let hardcodedPiiInTemplates: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/prompt-template-hygiene-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      templatesMissingParameters =
        asNum(data.templatesMissingParameters) ??
        asNum(data.templates_missing_parameters) ??
        asNum(data.nonParameterizedProductionTemplates) ??
        templatesMissingParameters;
      hardcodedSecretsInTemplates =
        asNum(data.hardcodedSecretsInTemplates) ??
        asNum(data.hardcoded_secrets_in_templates) ??
        asNum(data.secretFindings) ??
        hardcodedSecretsInTemplates;
      hardcodedPiiInTemplates =
        asNum(data.hardcodedPiiInTemplates) ??
        asNum(data.hardcoded_pii_in_templates) ??
        asNum(data.piiFindings) ??
        hardcodedPiiInTemplates;

      if (asBool(data.allTemplatesParameterized) === true) {
        templatesMissingParameters = templatesMissingParameters ?? 0;
      }
      if (asBool(data.zeroSecretsInTemplates) === true) {
        hardcodedSecretsInTemplates = hardcodedSecretsInTemplates ?? 0;
      }
      if (asBool(data.zeroPiiInTemplates) === true) {
        hardcodedPiiInTemplates = hardcodedPiiInTemplates ?? 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    templatesMissingParameters,
    hardcodedSecretsInTemplates,
    hardcodedPiiInTemplates,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildPromptTemplateHygieneReport(opts: {
  assessedAt: string;
  templates: { found: boolean; refs: string[] };
  parameterization: { found: boolean; refs: string[] };
  secretScan: { found: boolean; refs: string[] };
  piiScan: { found: boolean; refs: string[] };
  promptSignals: boolean;
  imported: PromptTemplateHygieneReport["importedResults"];
}): PromptTemplateHygieneReport {
  const notes: string[] = [];
  const hygieneSignalsPresent =
    opts.templates.found ||
    opts.parameterization.found ||
    opts.secretScan.found ||
    opts.piiScan.found;

  if (!opts.promptSignals && !hygieneSignalsPresent && !opts.imported.found) {
    notes.push(
      "No prompt/hygiene signals — PRM-R1 may be NOT_APPLICABLE if there are no production prompt templates.",
    );
  }
  if (opts.templates.found) {
    notes.push(`Template refs: ${opts.templates.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.parameterization.found) {
    notes.push(
      `Parameterization refs: ${opts.parameterization.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.secretScan.found) {
    notes.push(`Secret-scan refs: ${opts.secretScan.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.piiScan.found) {
    notes.push(`PII-scan refs: ${opts.piiScan.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (missingParams=${opts.imported.templatesMissingParameters}, secrets=${opts.imported.hardcodedSecretsInTemplates}, pii=${opts.imported.hardcodedPiiInTemplates})`,
    );
  } else if (hygieneSignalsPresent) {
    notes.push(
      "Hygiene signals alone are PARTIAL — import templatesMissingParameters=0 + hardcodedSecretsInTemplates=0 + hardcodedPiiInTemplates=0 (measuredAt ≤90d) under imports/prompt-template-hygiene/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const paramsOk =
    opts.imported.templatesMissingParameters !== null &&
    opts.imported.templatesMissingParameters === 0;
  const secretsOk =
    opts.imported.hardcodedSecretsInTemplates !== null &&
    opts.imported.hardcodedSecretsInTemplates === 0;
  const piiOk =
    opts.imported.hardcodedPiiInTemplates !== null &&
    opts.imported.hardcodedPiiInTemplates === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: PromptTemplateHygieneReport["summary"]["statusHint"];
  let prmR1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.templatesMissingParameters !== null &&
      opts.imported.templatesMissingParameters > 0) ||
      (opts.imported.hardcodedSecretsInTemplates !== null &&
        opts.imported.hardcodedSecretsInTemplates > 0) ||
      (opts.imported.hardcodedPiiInTemplates !== null &&
        opts.imported.hardcodedPiiInTemplates > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!opts.promptSignals && !hygieneSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    prmR1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    prmR1Satisfied = false;
    notes.push(
      "Imported evidence shows missing parameters, hardcoded secrets/PII, or evidence older than 90 days — PRM-R1 fail.",
    );
  } else if (
    (hygieneSignalsPresent || opts.imported.found) &&
    paramsOk &&
    secretsOk &&
    piiOk &&
    ageOk &&
    importFresh
  ) {
    statusHint = "pass";
    prmR1Satisfied = true;
  } else if (hygieneSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    prmR1Satisfied = false;
    if (opts.imported.found && !paramsOk) {
      notes.push("Import must show templatesMissingParameters=0.");
    }
    if (opts.imported.found && !secretsOk) {
      notes.push("Import must show hardcodedSecretsInTemplates=0.");
    }
    if (opts.imported.found && !piiOk) {
      notes.push("Import must show hardcodedPiiInTemplates=0.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock PRM-R1 PASS.",
      );
    }
  } else if (opts.promptSignals) {
    statusHint = "not_demonstrated";
    prmR1Satisfied = null;
    notes.push(
      "Prompt signals present but no parameterization/secret/PII hygiene evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    prmR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      templates: opts.templates,
      parameterization: opts.parameterization,
      secretScan: opts.secretScan,
      piiScan: opts.piiScan,
    },
    importedResults: opts.imported,
    summary: {
      promptSignalsPresent: opts.promptSignals,
      hygieneSignalsPresent,
      prmR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const promptTemplateHygieneCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const promptSignals = detectPromptSignals(ctx.targetPath, maxFiles);

    const templateRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        PROMPT_PATH_RE.test(path) ||
        INVENTORY_RE.test(path) ||
        INVENTORY_RE.test(text) ||
        /\bprompt[\s_-]*template\b/i.test(text),
      12,
    );
    const paramRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PROMPT_PATH_RE.test(path) || PARAM_RE.test(path)) &&
        PARAM_RE.test(text),
      12,
    );
    const secretScanRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SECRET_SCAN_RE.test(path) || SECRET_SCAN_RE.test(text),
      12,
    );
    const piiScanRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => PII_SCAN_RE.test(path) || PII_SCAN_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildPromptTemplateHygieneReport({
      assessedAt: ctx.assessedAt.toISOString(),
      templates: { found: templateRefs.length > 0, refs: templateRefs },
      parameterization: { found: paramRefs.length > 0, refs: paramRefs },
      secretScan: { found: secretScanRefs.length > 0, refs: secretScanRefs },
      piiScan: { found: piiScanRefs.length > 0, refs: piiScanRefs },
      promptSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "prompt-template-hygiene-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/prompt-template-hygiene-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "prompt-template-hygiene",
          "prm-r1",
          DETECTOR_ID,
          ...(report.summary.prmR1Satisfied ? ["prm-r1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.templates.refs,
        ...report.signals.parameterization.refs,
        ...report.signals.secretScan.refs,
        ...report.signals.piiScan.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["prompt-template-hygiene-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PRM-R1 status=${report.summary.statusHint} hygiene=${report.summary.hygieneSignalsPresent} satisfied=${report.summary.prmR1Satisfied}; report=imports/${PLUGIN_ID}/prompt-template-hygiene-report.json`,
      nodes,
    };
  },
};
