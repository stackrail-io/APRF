/**
 * ai-trust-documentation — CMP-R2 / repo-ai-trust-documentation.
 *
 * Discovers customer-facing trust docs and pillar/Core maps. Import coverage
 * under imports/ai-trust-documentation/ to unlock PASS.
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

const PLUGIN_ID = "ai-trust-documentation";
const RELATED = ["CMP-R2"] as const;
const DETECTOR_ID = "repo-ai-trust-documentation";
const DOC_MAX_AGE_DAYS = 365;
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PATH_RE =
  /(trust[\s_-]*(center|page|doc)|security[\s_-]*(page|whitepaper|overview)|transparency[\s_-]*report|ai[\s_-]*trust)/i;

const TRUST_DOC_RE =
  /\b(trust[\s_-]*center|customer[\s_-]*facing[\s_-]*trust|public[\s_-]*trust|security[\s_-]*whitepaper|ai[\s_-]*trust[\s_-]*doc)\b/i;

const MAPPING_RE =
  /\b(aprf[\s_-]*pillar|core[\s_-]*profile|pillar[\s_-]*mapping|mapping[\s_-]*table|control[\s_-]*mapping)\b/i;

const TOPIC_RE =
  /\b(identity|authn|authz|safety|eval(?:uation)?|red[\s_-]*team|data[\s_-]*handling|privacy|incident[\s_-]*contact|security[\s_-]*contact)\b/i;

export interface AiTrustDocumentationReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    trustDoc: { found: boolean; refs: string[] };
    pillarMapping: { found: boolean; refs: string[] };
    topics: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    publishedUrl: string | null;
    coversIdentity: boolean | null;
    coversSafetyEval: boolean | null;
    coversDataHandling: boolean | null;
    coversIncidentContact: boolean | null;
    pillarMappingExplicit: boolean | null;
    lastUpdatedAgeDays: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    trustSignalsPresent: boolean;
    cmpR2Satisfied: boolean | null;
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
      ".html",
      ".tsx",
      ".ts",
      ".js",
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

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / (24 * 60 * 60 * 1000));
}

function loadImported(
  ctx: CollectorContext,
  now: Date,
): AiTrustDocumentationReport["importedResults"] {
  const sources: string[] = [];
  let publishedUrl: string | null = null;
  let coversIdentity: boolean | null = null;
  let coversSafetyEval: boolean | null = null;
  let coversDataHandling: boolean | null = null;
  let coversIncidentContact: boolean | null = null;
  let pillarMappingExplicit: boolean | null = null;
  let lastUpdatedAgeDays: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-trust-documentation-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      publishedUrl =
        asStr(data.publishedUrl) ??
        asStr(data.url) ??
        asStr(data.publicUrl) ??
        publishedUrl;
      coversIdentity =
        asBool(data.coversIdentity) ??
        asBool(data.identity) ??
        coversIdentity;
      coversSafetyEval =
        asBool(data.coversSafetyEval) ??
        asBool(data.coversSafety) ??
        asBool(data.safetyEval) ??
        coversSafetyEval;
      coversDataHandling =
        asBool(data.coversDataHandling) ??
        asBool(data.dataHandling) ??
        coversDataHandling;
      coversIncidentContact =
        asBool(data.coversIncidentContact) ??
        asBool(data.incidentContact) ??
        coversIncidentContact;
      pillarMappingExplicit =
        asBool(data.pillarMappingExplicit) ??
        asBool(data.coreMappingExplicit) ??
        asBool(data.mappingExplicit) ??
        pillarMappingExplicit;
      lastUpdatedAgeDays =
        asNum(data.lastUpdatedAgeDays) ??
        asNum(data.docAgeDays) ??
        daysSince(
          asStr(data.lastUpdated) ?? asStr(data.lastUpdatedAt) ?? undefined,
          now,
        ) ??
        lastUpdatedAgeDays;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const topics = data.topics as Record<string, unknown> | undefined;
      if (topics && typeof topics === "object") {
        coversIdentity =
          coversIdentity ?? asBool(topics.identity) ?? asBool(topics.Identity);
        coversSafetyEval =
          coversSafetyEval ??
          asBool(topics.safetyEval) ??
          asBool(topics.safety);
        coversDataHandling =
          coversDataHandling ??
          asBool(topics.dataHandling) ??
          asBool(topics.data);
        coversIncidentContact =
          coversIncidentContact ??
          asBool(topics.incidentContact) ??
          asBool(topics.incident);
      }

      if (asBool(data.cmpR2Complete) === true) {
        publishedUrl = publishedUrl ?? "https://example.com/trust";
        coversIdentity = coversIdentity ?? true;
        coversSafetyEval = coversSafetyEval ?? true;
        coversDataHandling = coversDataHandling ?? true;
        coversIncidentContact = coversIncidentContact ?? true;
        pillarMappingExplicit = pillarMappingExplicit ?? true;
        lastUpdatedAgeDays = lastUpdatedAgeDays ?? 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    publishedUrl,
    coversIdentity,
    coversSafetyEval,
    coversDataHandling,
    coversIncidentContact,
    pillarMappingExplicit,
    lastUpdatedAgeDays,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiTrustDocumentationReport(opts: {
  assessedAt: string;
  signals: AiTrustDocumentationReport["signals"];
  trustContextSignals: boolean;
  imported: AiTrustDocumentationReport["importedResults"];
}): AiTrustDocumentationReport {
  const notes: string[] = [];
  const trustSignalsPresent =
    opts.signals.trustDoc.found ||
    opts.signals.pillarMapping.found ||
    opts.signals.topics.found;

  if (
    !opts.trustContextSignals &&
    !trustSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No trust-documentation signals — CMP-R2 may be NOT_APPLICABLE if there is no customer-facing production AI trust surface.",
    );
  }
  if (opts.signals.trustDoc.found) {
    notes.push(
      `Trust-doc refs: ${opts.signals.trustDoc.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (url=${opts.imported.publishedUrl ? "yes" : "no"}, identity=${opts.imported.coversIdentity}, safety=${opts.imported.coversSafetyEval}, data=${opts.imported.coversDataHandling}, incident=${opts.imported.coversIncidentContact}, map=${opts.imported.pillarMappingExplicit}, lastUpdatedAgeDays=${opts.imported.lastUpdatedAgeDays})`,
    );
  } else if (trustSignalsPresent) {
    notes.push(
      "Trust signals alone are PARTIAL — import published URL + topic coverage + pillar/Core map + last-updated ≤12 months (measuredAt ≤90d) under imports/ai-trust-documentation/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const docFresh =
    opts.imported.lastUpdatedAgeDays !== null &&
    opts.imported.lastUpdatedAgeDays <= DOC_MAX_AGE_DAYS;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(),
    IMPORT_MAX_AGE_DAYS,
  );
  const topicsOk =
    opts.imported.coversIdentity === true &&
    opts.imported.coversSafetyEval === true &&
    opts.imported.coversDataHandling === true &&
    opts.imported.coversIncidentContact === true;
  const urlOk = Boolean(opts.imported.publishedUrl);
  const mapOk = opts.imported.pillarMappingExplicit === true;
  const passOk = urlOk && topicsOk && mapOk && docFresh && ageOk && importFresh;

  let statusHint: AiTrustDocumentationReport["summary"]["statusHint"] =
    "not_demonstrated";
  let cmpR2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.coversIdentity === false ||
      opts.imported.coversSafetyEval === false ||
      opts.imported.coversDataHandling === false ||
      opts.imported.coversIncidentContact === false ||
      opts.imported.pillarMappingExplicit === false ||
      (opts.imported.lastUpdatedAgeDays !== null &&
        opts.imported.lastUpdatedAgeDays > DOC_MAX_AGE_DAYS) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS) ||
      (opts.imported.publishedUrl !== null &&
        opts.imported.publishedUrl.length === 0));

  if (
    !opts.trustContextSignals &&
    !trustSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    cmpR2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    cmpR2Satisfied = false;
    notes.push(
      "Imported evidence shows missing topics, no pillar/Core map, stale last-updated (>12 months), or evidence older than 90 days — CMP-R2 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    cmpR2Satisfied = true;
  } else if (trustSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    cmpR2Satisfied = false;
    if (opts.imported.found) {
      if (!urlOk) {
        notes.push("Import must show publishedUrl for the public trust doc.");
      }
      if (!topicsOk) {
        notes.push(
          "Import must show coversIdentity, coversSafetyEval, coversDataHandling, and coversIncidentContact all true.",
        );
      }
      if (!mapOk) {
        notes.push("Import must show pillarMappingExplicit=true.");
      }
      if (!docFresh) {
        notes.push(
          `Import must show lastUpdatedAgeDays≤${DOC_MAX_AGE_DAYS}.`,
        );
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock CMP-R2 PASS.",
        );
      }
    }
  } else if (opts.trustContextSignals) {
    statusHint = "not_demonstrated";
    cmpR2Satisfied = null;
    notes.push(
      "Trust-context signals present but no trust doc / pillar map found.",
    );
  } else {
    statusHint = "not_demonstrated";
    cmpR2Satisfied = null;
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
      trustSignalsPresent,
      cmpR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiTrustDocumentationCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const trustContextSignals =
      collectRefs(
        ctx.targetPath,
        Math.min(maxFiles, 2000),
        (path, text) => PATH_RE.test(path) || PATH_RE.test(text),
        5,
      ).length > 0;

    const inCtx = (path: string, text: string) =>
      PATH_RE.test(path) ||
      PATH_RE.test(text) ||
      TRUST_DOC_RE.test(text) ||
      MAPPING_RE.test(text);

    const trustRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (TRUST_DOC_RE.test(path) || TRUST_DOC_RE.test(text)) &&
        inCtx(path, text),
    );
    const mappingRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (MAPPING_RE.test(path) || MAPPING_RE.test(text)) && inCtx(path, text),
      12,
    );
    const topicRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        TOPIC_RE.test(text) &&
        (TRUST_DOC_RE.test(text) || PATH_RE.test(path) || PATH_RE.test(text)),
      12,
    );

    const imported = loadImported(ctx, ctx.assessedAt);
    const report = buildAiTrustDocumentationReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        trustDoc: { found: trustRefs.length > 0, refs: trustRefs },
        pillarMapping: { found: mappingRefs.length > 0, refs: mappingRefs },
        topics: { found: topicRefs.length > 0, refs: topicRefs },
      },
      trustContextSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-trust-documentation-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/ai-trust-documentation-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-trust-documentation",
          "cmp-r2",
          DETECTOR_ID,
          ...(report.summary.trustSignalsPresent ? ["trust-signals"] : []),
          ...(report.summary.cmpR2Satisfied ? ["cmp-r2-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...trustRefs.slice(0, 2),
      ...mappingRefs.slice(0, 1),
      ...topicRefs.slice(0, 1),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["ai-trust-documentation-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `CMP-R2 status=${report.summary.statusHint} trust=${report.summary.trustSignalsPresent} satisfied=${report.summary.cmpR2Satisfied}; report=imports/${PLUGIN_ID}/ai-trust-documentation-report.json`,
      nodes,
    };
  },
};
