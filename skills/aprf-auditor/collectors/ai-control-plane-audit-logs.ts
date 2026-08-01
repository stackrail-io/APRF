/**
 * ai-control-plane-audit-logs — CMP-M3 / repo-ai-control-plane-audit-logs.
 *
 * Discovers audit retention for critical AI control-plane changes. Import smoke
 * evidence under imports/ai-control-plane-audit-logs/ to unlock PASS.
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

const PLUGIN_ID = "ai-control-plane-audit-logs";
const RELATED = ["CMP-M3"] as const;
const DETECTOR_ID = "repo-ai-control-plane-audit-logs";
const INVENTORY_MAX_AGE_DAYS = 90;
const DEFAULT_POLICY_MIN_DAYS = 365;
const MAX_APPEAR_MINUTES = 5;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PATH_RE =
  /(audit[\s_-]*log|control[\s_-]*plane|retention|cloudtrail|siem|audit[\s_-]*trail)/i;

const CONTROL_PLANE_RE =
  /\b(control[\s_-]*plane|model[\s_-]*promot|prompt[\s_-]*promot|tool[\s_-]*allowlist|kill[\s_-]*switch|policy[\s_-]*flip|ai[\s_-]*config[\s_-]*change)\b/i;

const RETENTION_RE =
  /\b(retention|retain[\s_-]*for|log[\s_-]*retention|audit[\s_-]*retention|days[\s_-]*to[\s_-]*live|ttl[\s_-]*days)\b/i;

const SMOKE_RE =
  /\b(synthetic[\s_-]*change|retention[\s_-]*smoke|audit[\s_-]*smoke|appear(?:s|ed)?[\s_-]*within|queryable)\b/i;

export interface AiControlPlaneAuditLogsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    controlPlaneAudit: { found: boolean; refs: string[] };
    retentionConfig: { found: boolean; refs: string[] };
    smokeTest: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    retentionConfiguredDays: number | null;
    policyMinimumDays: number | null;
    syntheticAppearMinutes: number | null;
    remainsQueryableAfterSmoke: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    auditSignalsPresent: boolean;
    cmpM3Satisfied: boolean | null;
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
      ".tf",
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

function loadImported(
  ctx: CollectorContext,
): AiControlPlaneAuditLogsReport["importedResults"] {
  const sources: string[] = [];
  let retentionConfiguredDays: number | null = null;
  let policyMinimumDays: number | null = null;
  let syntheticAppearMinutes: number | null = null;
  let remainsQueryableAfterSmoke: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-control-plane-audit-logs-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      retentionConfiguredDays =
        asNum(data.retentionConfiguredDays) ??
        asNum(data.retentionDays) ??
        retentionConfiguredDays;
      policyMinimumDays =
        asNum(data.policyMinimumDays) ??
        asNum(data.policyMinDays) ??
        policyMinimumDays;
      syntheticAppearMinutes =
        asNum(data.syntheticAppearMinutes) ??
        asNum(data.appearMinutes) ??
        asNum(data.appearanceLatencyMinutes) ??
        syntheticAppearMinutes;
      remainsQueryableAfterSmoke =
        asBool(data.remainsQueryableAfterSmoke) ??
        asBool(data.queryableAfterRetentionSmoke) ??
        asBool(data.remainsQueryable) ??
        remainsQueryableAfterSmoke;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      if (asBool(data.appearedWithin5Minutes) === true) {
        syntheticAppearMinutes = syntheticAppearMinutes ?? MAX_APPEAR_MINUTES;
      }
      if (asBool(data.cmpM3Complete) === true) {
        retentionConfiguredDays =
          retentionConfiguredDays ?? DEFAULT_POLICY_MIN_DAYS;
        policyMinimumDays = policyMinimumDays ?? DEFAULT_POLICY_MIN_DAYS;
        syntheticAppearMinutes = syntheticAppearMinutes ?? MAX_APPEAR_MINUTES;
        remainsQueryableAfterSmoke = remainsQueryableAfterSmoke ?? true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    retentionConfiguredDays,
    policyMinimumDays,
    syntheticAppearMinutes,
    remainsQueryableAfterSmoke,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiControlPlaneAuditLogsReport(opts: {
  assessedAt: string;
  signals: AiControlPlaneAuditLogsReport["signals"];
  controlPlaneSignals: boolean;
  imported: AiControlPlaneAuditLogsReport["importedResults"];
}): AiControlPlaneAuditLogsReport {
  const notes: string[] = [];
  const auditSignalsPresent =
    opts.signals.controlPlaneAudit.found ||
    opts.signals.retentionConfig.found ||
    opts.signals.smokeTest.found;

  if (
    !opts.controlPlaneSignals &&
    !auditSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No AI control-plane audit signals — CMP-M3 may be NOT_APPLICABLE if there are no critical AI control-plane changes.",
    );
  }
  if (opts.signals.retentionConfig.found) {
    notes.push(
      `Retention refs: ${opts.signals.retentionConfig.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (retentionDays=${opts.imported.retentionConfiguredDays}, policyMin=${opts.imported.policyMinimumDays}, appearMin=${opts.imported.syntheticAppearMinutes}, queryable=${opts.imported.remainsQueryableAfterSmoke}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (auditSignalsPresent) {
    notes.push(
      "Audit signals alone are PARTIAL — import retention ≥ policy min + ≤5 min synthetic appearance + queryable smoke (measuredAt ≤90d) under imports/ai-control-plane-audit-logs/ to PASS.",
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
  const policyMin =
    opts.imported.policyMinimumDays ?? DEFAULT_POLICY_MIN_DAYS;
  const retentionOk =
    opts.imported.retentionConfiguredDays !== null &&
    opts.imported.retentionConfiguredDays >= policyMin;
  const appearOk =
    opts.imported.syntheticAppearMinutes !== null &&
    opts.imported.syntheticAppearMinutes <= MAX_APPEAR_MINUTES;
  const passOk =
    retentionOk &&
    appearOk &&
    opts.imported.remainsQueryableAfterSmoke === true &&
    ageOk &&
    importFresh;

  let statusHint: AiControlPlaneAuditLogsReport["summary"]["statusHint"];
  let cmpM3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.retentionConfiguredDays !== null &&
      opts.imported.retentionConfiguredDays < policyMin) ||
      (opts.imported.syntheticAppearMinutes !== null &&
        opts.imported.syntheticAppearMinutes > MAX_APPEAR_MINUTES) ||
      opts.imported.remainsQueryableAfterSmoke === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > INVENTORY_MAX_AGE_DAYS));

  if (
    !opts.controlPlaneSignals &&
    !auditSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    cmpM3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    cmpM3Satisfied = false;
    notes.push(
      "Imported evidence shows retention below policy min, appearance >5 minutes, not queryable after smoke, or evidence older than 90 days — CMP-M3 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    cmpM3Satisfied = true;
  } else if (auditSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    cmpM3Satisfied = false;
    if (opts.imported.found) {
      if (!retentionOk) {
        notes.push(
          `Import must show retentionConfiguredDays≥policyMinimumDays (default policy min ${DEFAULT_POLICY_MIN_DAYS}).`,
        );
      }
      if (!appearOk) {
        notes.push(
          `Import must show syntheticAppearMinutes≤${MAX_APPEAR_MINUTES}.`,
        );
      }
      if (opts.imported.remainsQueryableAfterSmoke !== true) {
        notes.push("Import must show remainsQueryableAfterSmoke=true.");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock CMP-M3 PASS.",
        );
      }
    }
  } else if (opts.controlPlaneSignals) {
    statusHint = "not_demonstrated";
    cmpM3Satisfied = null;
    notes.push(
      "Control-plane/audit signals present but no retention config or smoke evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    cmpM3Satisfied = null;
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
      auditSignalsPresent,
      cmpM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiControlPlaneAuditLogsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const controlPlaneSignals =
      collectRefs(
        ctx.targetPath,
        Math.min(maxFiles, 2000),
        (path, text) =>
          PATH_RE.test(path) ||
          PATH_RE.test(text) ||
          CONTROL_PLANE_RE.test(text),
        5,
      ).length > 0;

    const inCtx = (path: string, text: string) =>
      PATH_RE.test(path) ||
      PATH_RE.test(text) ||
      CONTROL_PLANE_RE.test(text) ||
      RETENTION_RE.test(text);

    const auditRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (CONTROL_PLANE_RE.test(path) || CONTROL_PLANE_RE.test(text)) &&
        (PATH_RE.test(path) || PATH_RE.test(text) || /audit/i.test(text)),
    );
    const retentionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (RETENTION_RE.test(path) || RETENTION_RE.test(text)) &&
        inCtx(path, text),
    );
    const smokeRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SMOKE_RE.test(path) || SMOKE_RE.test(text)) && inCtx(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiControlPlaneAuditLogsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        controlPlaneAudit: { found: auditRefs.length > 0, refs: auditRefs },
        retentionConfig: {
          found: retentionRefs.length > 0,
          refs: retentionRefs,
        },
        smokeTest: { found: smokeRefs.length > 0, refs: smokeRefs },
      },
      controlPlaneSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-control-plane-audit-logs-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/ai-control-plane-audit-logs-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-control-plane-audit-logs",
          "cmp-m3",
          DETECTOR_ID,
          ...(report.summary.auditSignalsPresent ? ["audit-signals"] : []),
          ...(report.summary.cmpM3Satisfied ? ["cmp-m3-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...retentionRefs.slice(0, 2),
        ...auditRefs.slice(0, 1),
        ...smokeRefs.slice(0, 1),
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
        signals: ["ai-control-plane-audit-logs-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `CMP-M3 status=${report.summary.statusHint} audit=${report.summary.auditSignalsPresent} satisfied=${report.summary.cmpM3Satisfied}; report=imports/${PLUGIN_ID}/ai-control-plane-audit-logs-report.json`,
      nodes,
    };
  },
};
