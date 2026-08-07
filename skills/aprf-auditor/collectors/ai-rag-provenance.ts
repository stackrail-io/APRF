/**
 * ai-rag-provenance — EXP-M1 / repo-ai-rag-provenance.
 *
 * Discovers factual/high-stakes RAG citation/provenance eval coverage.
 * Import factualOrHighStakesRagEvalConfigured +
 * answersWithValidCitationPct≥90 +
 * citationsResolveToAuthorizedCorpus under imports/ai-rag-provenance/
 * to unlock PASS (measuredAt ≤90d).
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
  isSkippedScanRelPath,
  listImportFiles,
  readText,
  redact,
  rel,
  walkFiles,
  SCAN_EXTENSIONS,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "ai-rag-provenance";
const RELATED = ["EXP-M1"] as const;
const DETECTOR_ID = "repo-ai-rag-provenance";
const IMPORT_MAX_AGE_DAYS = 90;
const CITATION_COVERAGE_MIN_PCT = 90;

const RAG_RE =
  /\b(rag|retriev(al|e)|vector[_-]?(store|index|db)|knowledge[_-]?base|corpus|ground(ed|ing))\b/i;

const CITATION_RE =
  /\b(citation|cite[_-]?(source|doc)|source[_-]?(id|ref|citation)|provenance|footnote|references?[_-]?(list|block)|doc[_-]?id)\b/i;

const EVAL_RE =
  /\b(citation[_-]?(eval|metric|coverage|accuracy)|provenance[_-]?eval|factual[_-]?(rag|eval)|high[_-]?stakes[_-]?(rag|eval)|groundedness[_-]?(eval|score))\b/i;

export interface AiRagProvenanceReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    rag: { found: boolean; refs: string[] };
    citation: { found: boolean; refs: string[] };
    eval: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    factualOrHighStakesRagEvalConfigured: boolean | null;
    answersWithValidCitationPct: number | null;
    citationsResolveToAuthorizedCorpus: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    provenanceSignalsPresent: boolean;
    expM1Satisfied: boolean | null;
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
    extensions: [...SCAN_EXTENSIONS, ".pdf"],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 80_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function loadImported(
  ctx: CollectorContext,
): AiRagProvenanceReport["importedResults"] {
  const sources: string[] = [];
  let factualOrHighStakesRagEvalConfigured: boolean | null = null;
  let answersWithValidCitationPct: number | null = null;
  let citationsResolveToAuthorizedCorpus: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-rag-provenance-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      factualOrHighStakesRagEvalConfigured =
        asBool(data.factualOrHighStakesRagEvalConfigured) ??
        asBool(data.factual_or_high_stakes_rag_eval_configured) ??
        asBool(data.ragProvenanceEvalConfigured) ??
        asBool(data.citationEvalConfigured) ??
        factualOrHighStakesRagEvalConfigured;
      answersWithValidCitationPct =
        asNum(data.answersWithValidCitationPct) ??
        asNum(data.answers_with_valid_citation_pct) ??
        asNum(data.citationCoveragePct) ??
        asNum(data.citation_coverage_pct) ??
        answersWithValidCitationPct;
      citationsResolveToAuthorizedCorpus =
        asBool(data.citationsResolveToAuthorizedCorpus) ??
        asBool(data.citations_resolve_to_authorized_corpus) ??
        asBool(data.citationsResolvable) ??
        asBool(data.sourceIdsResolve) ??
        citationsResolveToAuthorizedCorpus;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    factualOrHighStakesRagEvalConfigured,
    answersWithValidCitationPct,
    citationsResolveToAuthorizedCorpus,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiRagProvenanceReport(opts: {
  assessedAt: string;
  rag: { found: boolean; refs: string[] };
  citation: { found: boolean; refs: string[] };
  eval: { found: boolean; refs: string[] };
  imported: AiRagProvenanceReport["importedResults"];
}): AiRagProvenanceReport {
  const notes: string[] = [];
  const provenanceSignalsPresent =
    opts.rag.found || opts.citation.found || opts.eval.found;

  if (!provenanceSignalsPresent && !opts.imported.found) {
    notes.push(
      "No RAG provenance/citation signals — EXP-M1 may be NOT_APPLICABLE if there are no factual/high-stakes RAG outputs.",
    );
  }
  if (opts.rag.found) {
    notes.push(`RAG refs: ${opts.rag.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.citation.found) {
    notes.push(`Citation refs: ${opts.citation.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.eval.found) {
    notes.push(`Eval refs: ${opts.eval.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (eval=${opts.imported.factualOrHighStakesRagEvalConfigured}, citationPct=${opts.imported.answersWithValidCitationPct}, resolve=${opts.imported.citationsResolveToAuthorizedCorpus})`,
    );
  } else if (provenanceSignalsPresent) {
    notes.push(
      "Provenance signals alone are PARTIAL — import factualOrHighStakesRagEvalConfigured=true + answersWithValidCitationPct≥90 + citationsResolveToAuthorizedCorpus=true (measuredAt ≤90d) under imports/ai-rag-provenance/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const evalOk = opts.imported.factualOrHighStakesRagEvalConfigured === true;
  const coverageOk =
    opts.imported.answersWithValidCitationPct !== null &&
    opts.imported.answersWithValidCitationPct >= CITATION_COVERAGE_MIN_PCT;
  const resolveOk = opts.imported.citationsResolveToAuthorizedCorpus === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiRagProvenanceReport["summary"]["statusHint"];
  let expM1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.factualOrHighStakesRagEvalConfigured === false ||
      (opts.imported.answersWithValidCitationPct !== null &&
        opts.imported.answersWithValidCitationPct < CITATION_COVERAGE_MIN_PCT) ||
      opts.imported.citationsResolveToAuthorizedCorpus === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!provenanceSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    expM1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    expM1Satisfied = false;
    notes.push(
      "Imported evidence shows missing RAG provenance eval, citation coverage <90%, citations that do not resolve, or attest older than 90 days — EXP-M1 fail.",
    );
  } else if (
    (provenanceSignalsPresent || opts.imported.found) &&
    evalOk &&
    coverageOk &&
    resolveOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    expM1Satisfied = true;
  } else if (provenanceSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    expM1Satisfied = false;
    if (opts.imported.found && !evalOk) {
      notes.push(
        "Import must show factualOrHighStakesRagEvalConfigured=true.",
      );
    }
    if (opts.imported.found && !coverageOk) {
      notes.push(
        `Import must show answersWithValidCitationPct≥${CITATION_COVERAGE_MIN_PCT}.`,
      );
    }
    if (opts.imported.found && !resolveOk) {
      notes.push(
        "Import must show citationsResolveToAuthorizedCorpus=true.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock EXP-M1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    expM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      rag: opts.rag,
      citation: opts.citation,
      eval: opts.eval,
    },
    importedResults: opts.imported,
    summary: {
      provenanceSignalsPresent,
      expM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiRagProvenanceCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const ragRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => RAG_RE.test(path) || RAG_RE.test(text),
      10,
    );
    const citationRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!CITATION_RE.test(path) && !CITATION_RE.test(text)) return false;
        return RAG_RE.test(path) || RAG_RE.test(text) || CITATION_RE.test(path);
      },
      10,
    );
    const evalRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        EVAL_RE.test(path) ||
        (/(eval|promptfoo|test|metric)/i.test(path) &&
          (EVAL_RE.test(text) ||
            (CITATION_RE.test(text) && RAG_RE.test(text)))),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiRagProvenanceReport({
      assessedAt: ctx.assessedAt.toISOString(),
      rag: { found: ragRefs.length > 0, refs: ragRefs },
      citation: { found: citationRefs.length > 0, refs: citationRefs },
      eval: { found: evalRefs.length > 0, refs: evalRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-rag-provenance-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-rag-provenance-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-rag-provenance",
          "exp-m1",
          DETECTOR_ID,
          ...(report.summary.expM1Satisfied ? ["exp-m1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.rag.refs,
        ...report.signals.citation.refs,
        ...report.signals.eval.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-rag-provenance-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `EXP-M1 status=${report.summary.statusHint} signals=${report.summary.provenanceSignalsPresent} satisfied=${report.summary.expM1Satisfied}; report=imports/${PLUGIN_ID}/ai-rag-provenance-report.json`,
      nodes,
    };
  },
};
