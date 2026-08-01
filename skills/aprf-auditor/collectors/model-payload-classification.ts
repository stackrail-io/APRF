/**
 * model-payload-classification — PRI-M1 / repo-model-payload-classification.
 *
 * Discovers AI/model payload classification schemes and sensitive handling
 * rules. Import audit under imports/model-payload-classification/ to unlock PASS.
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

const PLUGIN_ID = "model-payload-classification";
const RELATED = ["PRI-M1"] as const;
const DETECTOR_ID = "repo-model-payload-classification";
const INVENTORY_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PRIVACY_PATH_RE =
  /(classif|privacy|pii|dlp|data[\s_-]*label|payload[\s_-]*class|sensitivity)/i;

const SCHEME_RE =
  /\b(data[\s_-]*classif(?:ication|y)|payload[\s_-]*class(?:es|ification)?|sensitivity[\s_-]*label|ai[\s_-]*data[\s_-]*class|model[\s_-]*bound[\s_-]*class)\b/i;

const HANDLING_RE =
  /\b(handling[\s_-]*rule|sensitive[\s_-]*class|allow[\s_-]*list|redact|block[\s_-]*class|fail[\s_-]*closed|tokenization[\s_-]*required)\b/i;

const TAG_AUDIT_RE =
  /\b(class[\s_-]*tag|tagged[\s_-]*request|payload[\s_-]*label|classification[\s_-]*audit|label[\s_-]*coverage)\b/i;

export interface ModelPayloadClassificationReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    scheme: { found: boolean; refs: string[] };
    sensitiveHandling: { found: boolean; refs: string[] };
    taggingOrAudit: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    classificationSchemeCoversAiPayloads: boolean | null;
    sensitiveHandlingRulesDocumented: boolean | null;
    sampleTaggedPct: number | null;
    sensitiveHandlingMatchesPolicy: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    modelPayloadSignalsPresent: boolean;
    classificationSignalsPresent: boolean;
    priM1Satisfied: boolean | null;
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
      ".yml",
      ".yaml",
      ".json",
      ".toml",
      ".md",
      ".txt",
      ".ts",
      ".js",
      ".py",
    ],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    const text = readText(f, 100_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function detectModelPayloadSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        PRIVACY_PATH_RE.test(path) ||
        SCHEME_RE.test(text) ||
        /\b(model[\s_-]*request|prompt[\s_-]*payload|llm[\s_-]*input)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function loadImported(
  ctx: CollectorContext,
): ModelPayloadClassificationReport["importedResults"] {
  const sources: string[] = [];
  let classificationSchemeCoversAiPayloads: boolean | null = null;
  let sensitiveHandlingRulesDocumented: boolean | null = null;
  let sampleTaggedPct: number | null = null;
  let sensitiveHandlingMatchesPolicy: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/model-payload-classification-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      classificationSchemeCoversAiPayloads =
        asBool(data.classificationSchemeCoversAiPayloads) ??
        asBool(data.schemeCoversAiPayloads) ??
        classificationSchemeCoversAiPayloads;
      sensitiveHandlingRulesDocumented =
        asBool(data.sensitiveHandlingRulesDocumented) ??
        asBool(data.sensitiveRulesDocumented) ??
        sensitiveHandlingRulesDocumented;
      sampleTaggedPct =
        asNum(data.sampleTaggedPct) ??
        asNum(data.taggedPct) ??
        asNum(data.sample_tagged_pct) ??
        sampleTaggedPct;
      sensitiveHandlingMatchesPolicy =
        asBool(data.sensitiveHandlingMatchesPolicy) ??
        asBool(data.handlingMatchesPolicy) ??
        sensitiveHandlingMatchesPolicy;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      if (asBool(data.allSamplesTagged) === true && sampleTaggedPct == null) {
        sampleTaggedPct = 100;
      }
      if (
        asBool(data.priM1Complete) === true &&
        classificationSchemeCoversAiPayloads == null
      ) {
        classificationSchemeCoversAiPayloads = true;
        sensitiveHandlingRulesDocumented = true;
        sensitiveHandlingMatchesPolicy = true;
        sampleTaggedPct = sampleTaggedPct ?? 100;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    classificationSchemeCoversAiPayloads,
    sensitiveHandlingRulesDocumented,
    sampleTaggedPct,
    sensitiveHandlingMatchesPolicy,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildModelPayloadClassificationReport(opts: {
  assessedAt: string;
  signals: ModelPayloadClassificationReport["signals"];
  modelPayloadSignals: boolean;
  imported: ModelPayloadClassificationReport["importedResults"];
}): ModelPayloadClassificationReport {
  const notes: string[] = [];
  const classificationSignalsPresent =
    opts.signals.scheme.found ||
    (opts.signals.sensitiveHandling.found && opts.signals.taggingOrAudit.found);

  if (
    !opts.modelPayloadSignals &&
    !classificationSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No model-payload classification signals — PRI-M1 may be NOT_APPLICABLE if no production model traffic.",
    );
  }
  if (opts.signals.scheme.found) {
    notes.push(
      `Scheme refs: ${opts.signals.scheme.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.signals.sensitiveHandling.found) {
    notes.push(
      `Handling refs: ${opts.signals.sensitiveHandling.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (scheme=${opts.imported.classificationSchemeCoversAiPayloads}, sensitiveRules=${opts.imported.sensitiveHandlingRulesDocumented}, taggedPct=${opts.imported.sampleTaggedPct}, matchesPolicy=${opts.imported.sensitiveHandlingMatchesPolicy}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (classificationSignalsPresent) {
    notes.push(
      "Classification signals alone are PARTIAL — import scheme + 100% tagged audit (measuredAt ≤90d) under imports/model-payload-classification/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= INVENTORY_MAX_AGE_DAYS;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(),
    INVENTORY_MAX_AGE_DAYS,
  );
  const passOk =
    opts.imported.classificationSchemeCoversAiPayloads === true &&
    opts.imported.sensitiveHandlingRulesDocumented === true &&
    opts.imported.sampleTaggedPct === 100 &&
    opts.imported.sensitiveHandlingMatchesPolicy === true &&
    ageOk &&
    importFresh;

  let statusHint: ModelPayloadClassificationReport["summary"]["statusHint"];
  let priM1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.classificationSchemeCoversAiPayloads === false ||
      opts.imported.sensitiveHandlingRulesDocumented === false ||
      opts.imported.sensitiveHandlingMatchesPolicy === false ||
      (opts.imported.sampleTaggedPct !== null &&
        opts.imported.sampleTaggedPct < 100) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > INVENTORY_MAX_AGE_DAYS));

  if (
    !opts.modelPayloadSignals &&
    !opts.signals.scheme.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    priM1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    priM1Satisfied = false;
    notes.push(
      "Imported audit shows missing scheme/rules, untagged samples, policy mismatch, or evidence older than 90 days — PRI-M1 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    priM1Satisfied = true;
  } else if (
    opts.signals.scheme.found ||
    opts.signals.sensitiveHandling.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    priM1Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.classificationSchemeCoversAiPayloads !== true) {
        notes.push(
          "Import must show classificationSchemeCoversAiPayloads=true.",
        );
      }
      if (opts.imported.sensitiveHandlingRulesDocumented !== true) {
        notes.push(
          "Import must show sensitiveHandlingRulesDocumented=true.",
        );
      }
      if (opts.imported.sampleTaggedPct !== 100) {
        notes.push("Import must show sampleTaggedPct=100.");
      }
      if (opts.imported.sensitiveHandlingMatchesPolicy !== true) {
        notes.push(
          "Import must show sensitiveHandlingMatchesPolicy=true.",
        );
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock PRI-M1 PASS.",
        );
      }
    }
  } else if (opts.modelPayloadSignals) {
    statusHint = "not_demonstrated";
    priM1Satisfied = null;
    notes.push(
      "Model/privacy signals present but no classification scheme or sensitive handling rules found.",
    );
  } else {
    statusHint = "not_demonstrated";
    priM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: opts.signals,
    importedResults: opts.imported,
    summary: {
      modelPayloadSignalsPresent: opts.modelPayloadSignals,
      classificationSignalsPresent,
      priM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const modelPayloadClassificationCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const modelPayloadSignals = detectModelPayloadSignals(
      ctx.targetPath,
      maxFiles,
    );

    const inPrivacyContext = (path: string, text: string) =>
      PRIVACY_PATH_RE.test(path) ||
      SCHEME_RE.test(path) ||
      SCHEME_RE.test(text) ||
      PRIVACY_PATH_RE.test(text);

    const schemeRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SCHEME_RE.test(path) || SCHEME_RE.test(text)) &&
        inPrivacyContext(path, text),
    );
    const handlingRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (HANDLING_RE.test(path) || HANDLING_RE.test(text)) &&
        inPrivacyContext(path, text),
      12,
    );
    const auditRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (TAG_AUDIT_RE.test(path) || TAG_AUDIT_RE.test(text)) &&
        inPrivacyContext(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildModelPayloadClassificationReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        scheme: { found: schemeRefs.length > 0, refs: schemeRefs },
        sensitiveHandling: {
          found: handlingRefs.length > 0,
          refs: handlingRefs,
        },
        taggingOrAudit: { found: auditRefs.length > 0, refs: auditRefs },
      },
      modelPayloadSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "model-payload-classification-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/model-payload-classification-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "model-payload-classification",
          "pri-m1",
          DETECTOR_ID,
          ...(report.summary.classificationSignalsPresent
            ? ["classification-signals"]
            : []),
          ...(report.summary.priM1Satisfied ? ["pri-m1-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...schemeRefs.slice(0, 2),
        ...handlingRefs.slice(0, 1),
        ...auditRefs.slice(0, 1),
      ]),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["model-payload-classification-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PRI-M1 status=${report.summary.statusHint} classification=${report.summary.classificationSignalsPresent} satisfied=${report.summary.priM1Satisfied}; report=imports/${PLUGIN_ID}/model-payload-classification-report.json`,
      nodes,
    };
  },
};
