/**
 * feedback-promotion-governance — DG-M3 / repo-feedback-promotion executor.
 *
 * Discovers feedback→durable-memory/training promotion gates.
 * Import inventory + ungated deny proof under
 * imports/feedback-promotion-governance/ to unlock PASS.
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
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "feedback-promotion-governance";
const RELATED = ["DG-M3"] as const;
const DETECTOR_ID = "repo-feedback-promotion";

const PROMOTE_PATH_RE =
  /(feedback|thumbs|memory|promotion|promote|durable|fine[\s_-]*tun|training[\s_-]*signal|rlhf|preference)/i;

const PROMOTE_RE =
  /\b(feedback[\s_-]*(loop|promotion|to[\s_-]*train)|promote[\s_-]*(to[\s_-]*)?(durable|memory|training)|memory[\s_-]*promotion|thumbs[\s_-]*(up|down)[\s_-]*train|preference[\s_-]*data|rlhf)\b/i;

const GATE_RE =
  /\b(policy[\s_-]*(check|engine|gate)|human[\s_-]*approval|approval[\s_-]*required|dual[\s_-]*control|promotion[\s_-]*gate|write[\s_-]*path[\s_-]*control)\b/i;

const DENY_TEST_RE =
  /\b(ungated|deny[\s_-]*(test|promotion)|bypass[\s_-]*test|fail[\s_-]*closed|promotion[\s_-]*denied|without[\s_-]*approval)\b/i;

export interface FeedbackPromotionGovernanceReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    promotionPaths: { found: boolean; refs: string[] };
    gates: { found: boolean; refs: string[] };
    denyTests: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    promotionPathCount: number | null;
    missingGateCount: number | null;
    coversAllPromotionPaths: boolean | null;
    ungatedPromotionDenied: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    promotionSignalsPresent: boolean;
    gateSignalsPresent: boolean;
    dgM3Satisfied: boolean | null;
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
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 100_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function detectPromotionSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        PROMOTE_PATH_RE.test(path) ||
        PROMOTE_RE.test(text) ||
        /\b(durableMemory|promoteFeedback|memoryPromotion)\b/i.test(text),
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
): FeedbackPromotionGovernanceReport["importedResults"] {
  const sources: string[] = [];
  let promotionPathCount: number | null = null;
  let missingGateCount: number | null = null;
  let coversAllPromotionPaths: boolean | null = null;
  let ungatedPromotionDenied: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/feedback-promotion-governance-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      promotionPathCount =
        asNum(data.promotionPathCount) ??
        asNum(data.pathCount) ??
        promotionPathCount;
      missingGateCount =
        asNum(data.missingGateCount) ?? missingGateCount;
      coversAllPromotionPaths =
        asBool(data.coversAllPromotionPaths) ??
        asBool(data.coversAllPaths) ??
        coversAllPromotionPaths;
      ungatedPromotionDenied =
        asBool(data.ungatedPromotionDenied) ??
        asBool(data.denyTestPassed) ??
        asBool(data.ungatedWriteDenied) ??
        ungatedPromotionDenied;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const paths = Array.isArray(data.promotionPaths)
        ? (data.promotionPaths as Array<Record<string, unknown>>)
        : Array.isArray(data.paths)
          ? (data.paths as Array<Record<string, unknown>>)
          : [];
      if (paths.length > 0) {
        promotionPathCount = paths.length;
        let miss = 0;
        for (const p of paths) {
          const gated =
            p.requiresPolicyCheck === true ||
            p.requiresHumanApproval === true ||
            p.gated === true ||
            (typeof p.gate === "string" && p.gate.trim().length > 0);
          if (!gated) miss += 1;
        }
        missingGateCount = miss;
        if (coversAllPromotionPaths == null) {
          coversAllPromotionPaths = true;
        }
      }

      if (
        asBool(data.allPathsGated) === true &&
        missingGateCount == null
      ) {
        missingGateCount = 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    promotionPathCount,
    missingGateCount,
    coversAllPromotionPaths,
    ungatedPromotionDenied,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildFeedbackPromotionGovernanceReport(opts: {
  assessedAt: string;
  signals: FeedbackPromotionGovernanceReport["signals"];
  promotionSignals: boolean;
  imported: FeedbackPromotionGovernanceReport["importedResults"];
}): FeedbackPromotionGovernanceReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.signals.promotionPaths.found &&
    (opts.signals.gates.found || opts.signals.denyTests.found);

  if (
    !opts.promotionSignals &&
    !opts.signals.promotionPaths.found &&
    !opts.imported.found
  ) {
    notes.push(
      "No feedback/memory promotion signals — DG-M3 may be NOT_APPLICABLE if there is no feedback→durable/training write path.",
    );
  }
  if (opts.signals.promotionPaths.found) {
    notes.push(
      `Promotion-path refs: ${opts.signals.promotionPaths.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.signals.gates.found) {
    notes.push(
      `Gate refs: ${opts.signals.gates.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.signals.denyTests.found) {
    notes.push(
      `Deny-test refs: ${opts.signals.denyTests.refs.slice(0, 2).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (paths=${opts.imported.promotionPathCount}, missGate=${opts.imported.missingGateCount}, coversAll=${opts.imported.coversAllPromotionPaths}, ungatedDenied=${opts.imported.ungatedPromotionDenied}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (opts.signals.promotionPaths.found) {
    notes.push(
      "Promotion signals alone are PARTIAL — import coversAllPromotionPaths + missingGateCount=0 + ungatedPromotionDenied ≤90d under imports/feedback-promotion-governance/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null || opts.imported.ageDays <= 90;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const passOk =
    opts.imported.coversAllPromotionPaths === true &&
    opts.imported.missingGateCount === 0 &&
    opts.imported.ungatedPromotionDenied === true &&
    ageOk &&
    importFresh;

  let statusHint: FeedbackPromotionGovernanceReport["summary"]["statusHint"];
  let dgM3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.coversAllPromotionPaths === false ||
      (opts.imported.missingGateCount !== null &&
        opts.imported.missingGateCount > 0) ||
      opts.imported.ungatedPromotionDenied === false ||
      (opts.imported.ageDays !== null && opts.imported.ageDays > 90));

  if (
    !opts.promotionSignals &&
    !opts.signals.promotionPaths.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    dgM3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    dgM3Satisfied = false;
    notes.push(
      "Imported results show ungated paths, failed deny tests, or evidence older than 90 days — DG-M3 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    dgM3Satisfied = true;
    if ((opts.imported.promotionPathCount ?? 0) === 0) {
      notes.push(
        "Vacuous PASS: coversAllPromotionPaths with zero paths — confirm no feedback→durable/training surface.",
      );
    }
  } else if (
    opts.signals.promotionPaths.found ||
    opts.signals.gates.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    dgM3Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.coversAllPromotionPaths !== true) {
        notes.push("Import must show coversAllPromotionPaths=true.");
      }
      if (opts.imported.missingGateCount !== 0) {
        notes.push("Import must show missingGateCount=0.");
      }
      if (opts.imported.ungatedPromotionDenied !== true) {
        notes.push("Import must show ungatedPromotionDenied=true.");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock DG-M3 PASS.",
        );
      }
    }
  } else if (opts.promotionSignals) {
    statusHint = "not_demonstrated";
    dgM3Satisfied = null;
    notes.push(
      "Promotion-related signals present but no gated feedback→durable path found.",
    );
  } else {
    statusHint = "not_demonstrated";
    dgM3Satisfied = null;
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
      promotionSignalsPresent: opts.promotionSignals,
      gateSignalsPresent,
      dgM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const feedbackPromotionGovernanceCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const promotionSignals = detectPromotionSignals(ctx.targetPath, maxFiles);

    const inPromoteContext = (path: string, text: string) =>
      PROMOTE_PATH_RE.test(path) ||
      PROMOTE_RE.test(path) ||
      PROMOTE_RE.test(text) ||
      PROMOTE_PATH_RE.test(text);

    const pathRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PROMOTE_RE.test(path) || PROMOTE_RE.test(text)) &&
        inPromoteContext(path, text),
    );
    const gateRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (GATE_RE.test(path) || GATE_RE.test(text)) &&
        inPromoteContext(path, text),
      12,
    );
    const denyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (DENY_TEST_RE.test(path) || DENY_TEST_RE.test(text)) &&
        inPromoteContext(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildFeedbackPromotionGovernanceReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        promotionPaths: { found: pathRefs.length > 0, refs: pathRefs },
        gates: { found: gateRefs.length > 0, refs: gateRefs },
        denyTests: { found: denyRefs.length > 0, refs: denyRefs },
      },
      promotionSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "feedback-promotion-governance-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "policy",
        ref: `imports/${PLUGIN_ID}/feedback-promotion-governance-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "feedback-promotion-governance",
          "dg-m3",
          DETECTOR_ID,
          ...(report.summary.gateSignalsPresent
            ? ["promotion-gate-signals"]
            : []),
          ...(report.summary.dgM3Satisfied ? ["dg-m3-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...pathRefs.slice(0, 2),
        ...gateRefs.slice(0, 2),
        ...denyRefs.slice(0, 2),
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
        signals: ["feedback-promotion-governance-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DG-M3 status=${report.summary.statusHint} gates=${report.summary.gateSignalsPresent} satisfied=${report.summary.dgM3Satisfied}; report=imports/${PLUGIN_ID}/feedback-promotion-governance-report.json`,
      nodes,
    };
  },
};
