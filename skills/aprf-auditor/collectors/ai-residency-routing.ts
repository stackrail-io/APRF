/**
 * ai-residency-routing — PRI-M3 / repo-ai-residency-routing detector executor.
 *
 * Discovers residency-constrained routing for regulated AI workloads.
 * Import in-region sample under imports/ai-residency-routing/ to unlock PASS.
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

const PLUGIN_ID = "ai-residency-routing";
const RELATED = ["PRI-M3"] as const;
const DETECTOR_ID = "repo-ai-residency-routing";
const INVENTORY_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PATH_RE =
  /(residenc|data[\s_-]*localit|region[\s_-]*rout|geo[\s_-]*rout|sovereign|in[\s_-]*region)/i;

const REGULATED_RE =
  /\b(regulated|residency[\s_-]*required|eu[\s_-]*only|data[\s_-]*residency|gdpr[\s_-]*region|approved[\s_-]*region)\b/i;

const ROUTING_RE =
  /\b(model[\s_-]*rout|region[\s_-]*pin|endpoint[\s_-]*allowlist|region[\s_-]*allowlist|geo[\s_-]*fence|routing[\s_-]*policy)\b/i;

const SAMPLE_RE =
  /\b(routing[\s_-]*sample|region[\s_-]*decision|cross[\s_-]*region[\s_-]*deny|in[\s_-]*region[\s_-]*pct)\b/i;

export interface AiResidencyRoutingReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    policy: { found: boolean; refs: string[] };
    regulatedLabels: { found: boolean; refs: string[] };
    routing: { found: boolean; refs: string[] };
    sampleOrDeny: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    regulatedWorkloadsLabeled: boolean | null;
    approvedRegionsDocumented: boolean | null;
    sampleInApprovedRegionPct: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    residencySignalsPresent: boolean;
    policySignalsPresent: boolean;
    priM3Satisfied: boolean | null;
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

function detectResidencySignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        PATH_RE.test(path) ||
        REGULATED_RE.test(text) ||
        /\b(data[\s_-]*residency|region[\s_-]*constraint)\b/i.test(text),
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
): AiResidencyRoutingReport["importedResults"] {
  const sources: string[] = [];
  let regulatedWorkloadsLabeled: boolean | null = null;
  let approvedRegionsDocumented: boolean | null = null;
  let sampleInApprovedRegionPct: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-residency-routing-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      regulatedWorkloadsLabeled =
        asBool(data.regulatedWorkloadsLabeled) ??
        asBool(data.workloadsLabeled) ??
        regulatedWorkloadsLabeled;
      approvedRegionsDocumented =
        asBool(data.approvedRegionsDocumented) ??
        asBool(data.approvedRegionsPresent) ??
        approvedRegionsDocumented;
      sampleInApprovedRegionPct =
        asNum(data.sampleInApprovedRegionPct) ??
        asNum(data.inApprovedRegionPct) ??
        asNum(data.inRegionPct) ??
        sampleInApprovedRegionPct;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      if (asBool(data.allRegulatedInApprovedRegions) === true) {
        sampleInApprovedRegionPct = sampleInApprovedRegionPct ?? 100;
      }
      if (asBool(data.priM3Complete) === true) {
        regulatedWorkloadsLabeled = regulatedWorkloadsLabeled ?? true;
        approvedRegionsDocumented = approvedRegionsDocumented ?? true;
        sampleInApprovedRegionPct = sampleInApprovedRegionPct ?? 100;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    regulatedWorkloadsLabeled,
    approvedRegionsDocumented,
    sampleInApprovedRegionPct,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiResidencyRoutingReport(opts: {
  assessedAt: string;
  signals: AiResidencyRoutingReport["signals"];
  residencySignals: boolean;
  imported: AiResidencyRoutingReport["importedResults"];
}): AiResidencyRoutingReport {
  const notes: string[] = [];
  const policySignalsPresent =
    opts.signals.policy.found ||
    (opts.signals.regulatedLabels.found && opts.signals.routing.found);

  if (!opts.residencySignals && !policySignalsPresent && !opts.imported.found) {
    notes.push(
      "No residency/regulated-routing signals — PRI-M3 may be NOT_APPLICABLE if no regulated workloads require residency constraints.",
    );
  }
  if (opts.signals.policy.found) {
    notes.push(
      `Policy refs: ${opts.signals.policy.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (labeled=${opts.imported.regulatedWorkloadsLabeled}, regions=${opts.imported.approvedRegionsDocumented}, inRegionPct=${opts.imported.sampleInApprovedRegionPct}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (policySignalsPresent) {
    notes.push(
      "Residency policy signals alone are PARTIAL — import labeled workloads + 100% in-region sample under imports/ai-residency-routing/ to PASS.",
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
    opts.imported.regulatedWorkloadsLabeled === true &&
    opts.imported.approvedRegionsDocumented === true &&
    opts.imported.sampleInApprovedRegionPct === 100 &&
    ageOk &&
    importFresh;

  let statusHint: AiResidencyRoutingReport["summary"]["statusHint"] =
    "not_demonstrated";
  let priM3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.regulatedWorkloadsLabeled === false ||
      opts.imported.approvedRegionsDocumented === false ||
      (opts.imported.sampleInApprovedRegionPct !== null &&
        opts.imported.sampleInApprovedRegionPct < 100) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > INVENTORY_MAX_AGE_DAYS));

  if (
    !opts.residencySignals &&
    !opts.signals.policy.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    priM3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    priM3Satisfied = false;
    notes.push(
      "Imported evidence shows unlabeled workloads, missing approved regions, out-of-region samples, or evidence older than 90 days — PRI-M3 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    priM3Satisfied = true;
  } else if (
    opts.signals.policy.found ||
    opts.signals.regulatedLabels.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    priM3Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.regulatedWorkloadsLabeled !== true) {
        notes.push("Import must show regulatedWorkloadsLabeled=true.");
      }
      if (opts.imported.approvedRegionsDocumented !== true) {
        notes.push("Import must show approvedRegionsDocumented=true.");
      }
      if (opts.imported.sampleInApprovedRegionPct !== 100) {
        notes.push("Import must show sampleInApprovedRegionPct=100.");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock PRI-M3 PASS.",
        );
      }
    }
  } else if (opts.residencySignals) {
    statusHint = "not_demonstrated";
    priM3Satisfied = null;
    notes.push(
      "Residency signals present but no labeled regulated routing policy or sample found.",
    );
  } else {
    statusHint = "not_demonstrated";
    priM3Satisfied = null;
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
      residencySignalsPresent: opts.residencySignals,
      policySignalsPresent,
      priM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiResidencyRoutingCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const residencySignals = detectResidencySignals(ctx.targetPath, maxFiles);

    const inCtx = (path: string, text: string) =>
      PATH_RE.test(path) ||
      REGULATED_RE.test(text) ||
      ROUTING_RE.test(text) ||
      PATH_RE.test(text);

    const policyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PATH_RE.test(path) || PATH_RE.test(text) || REGULATED_RE.test(text)) &&
        inCtx(path, text),
    );
    const labelRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (REGULATED_RE.test(path) || REGULATED_RE.test(text)) &&
        inCtx(path, text),
      12,
    );
    const routingRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (ROUTING_RE.test(path) || ROUTING_RE.test(text)) && inCtx(path, text),
      12,
    );
    const sampleRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SAMPLE_RE.test(path) || SAMPLE_RE.test(text)) && inCtx(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiResidencyRoutingReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        policy: { found: policyRefs.length > 0, refs: policyRefs },
        regulatedLabels: { found: labelRefs.length > 0, refs: labelRefs },
        routing: { found: routingRefs.length > 0, refs: routingRefs },
        sampleOrDeny: { found: sampleRefs.length > 0, refs: sampleRefs },
      },
      residencySignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-residency-routing-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/ai-residency-routing-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-residency-routing",
          "pri-m3",
          DETECTOR_ID,
          ...(report.summary.policySignalsPresent
            ? ["residency-policy-signals"]
            : []),
          ...(report.summary.priM3Satisfied ? ["pri-m3-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...policyRefs.slice(0, 2),
        ...labelRefs.slice(0, 1),
        ...routingRefs.slice(0, 1),
        ...sampleRefs.slice(0, 1),
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
        signals: ["ai-residency-routing-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `PRI-M3 status=${report.summary.statusHint} policy=${report.summary.policySignalsPresent} satisfied=${report.summary.priM3Satisfied}; report=imports/${PLUGIN_ID}/ai-residency-routing-report.json`,
      nodes,
    };
  },
};
