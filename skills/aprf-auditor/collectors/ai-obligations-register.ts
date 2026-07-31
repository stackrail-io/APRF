/**
 * ai-obligations-register — CMP-M1 / repo-ai-obligations-register.
 *
 * Discovers AI obligations registers and per-system ownership. Import register
 * coverage under imports/ai-obligations-register/ to unlock PASS.
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

const PLUGIN_ID = "ai-obligations-register";
const RELATED = ["CMP-M1"] as const;
const DETECTOR_ID = "repo-ai-obligations-register";
const REVIEW_MAX_AGE_DAYS = 365;
const INVENTORY_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PATH_RE =
  /(obligation|compliance|regulatory|ai[\s_-]*system|system[\s_-]*inventory|legal[\s_-]*register)/i;

const REGISTER_RE =
  /\b(obligation[\s_-]*register|obligations[\s_-]*register|compliance[\s_-]*register|regulatory[\s_-]*obligation|applicable[\s_-]*obligation)\b/i;

const OWNER_RE =
  /\b(owner|accountable|responsible|named[\s_-]*owner|obligation[\s_-]*owner)\b/i;

const NONE_SCOPE_RE =
  /\b(none[\s_-]*in[\s_-]*scope|no[\s_-]*obligation|out[\s_-]*of[\s_-]*scope|not[\s_-]*applicable[\s_-]*obligation)\b/i;

export interface AiObligationsRegisterReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    register: { found: boolean; refs: string[] };
    ownership: { found: boolean; refs: string[] };
    noneInScope: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionAiSystemCount: number | null;
    coversAllProductionAiSystems: boolean | null;
    systemsMissingObligationOrNoneAttest: number | null;
    systemsMissingOwner: number | null;
    systemsWithStaleReview: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    obligationSignalsPresent: boolean;
    cmpM1Satisfied: boolean | null;
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
      ".csv",
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

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
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
): AiObligationsRegisterReport["importedResults"] {
  const sources: string[] = [];
  let productionAiSystemCount: number | null = null;
  let coversAllProductionAiSystems: boolean | null = null;
  let systemsMissingObligationOrNoneAttest: number | null = null;
  let systemsMissingOwner: number | null = null;
  let systemsWithStaleReview: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-obligations-register-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      productionAiSystemCount =
        asNum(data.productionAiSystemCount) ??
        asNum(data.systemCount) ??
        productionAiSystemCount;
      coversAllProductionAiSystems =
        asBool(data.coversAllProductionAiSystems) ??
        asBool(data.coversAllSystems) ??
        coversAllProductionAiSystems;
      systemsMissingObligationOrNoneAttest =
        asNum(data.systemsMissingObligationOrNoneAttest) ??
        asNum(data.missingObligationCount) ??
        systemsMissingObligationOrNoneAttest;
      systemsMissingOwner =
        asNum(data.systemsMissingOwner) ??
        asNum(data.missingOwnerCount) ??
        systemsMissingOwner;
      systemsWithStaleReview =
        asNum(data.systemsWithStaleReview) ??
        asNum(data.staleReviewCount) ??
        systemsWithStaleReview;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const systems =
        (data.systems as unknown[]) ||
        (data.aiSystems as unknown[]) ||
        (data.entries as unknown[]) ||
        [];
      if (Array.isArray(systems) && systems.length > 0) {
        productionAiSystemCount = productionAiSystemCount ?? systems.length;
        let missingObl = 0;
        let missingOwner = 0;
        let stale = 0;
        for (const s of systems) {
          if (!s || typeof s !== "object") continue;
          const row = s as Record<string, unknown>;
          const none =
            asBool(row.noneInScope) === true ||
            asBool(row.none_in_scope) === true;
          const oblCount =
            asNum(row.obligationCount) ??
            (Array.isArray(row.obligations) ? row.obligations.length : null);
          if (!none && (oblCount === null || oblCount < 1)) missingObl += 1;
          const owner = row.owner || row.ownerId || row.owner_id;
          if (!owner) missingOwner += 1;
          const reviewAge =
            daysSince(
              (row.reviewDate || row.reviewedAt || row.review_date) as
                | string
                | undefined,
              now,
            ) ?? asNum(row.reviewAgeDays);
          if (reviewAge !== null && reviewAge > REVIEW_MAX_AGE_DAYS) stale += 1;
        }
        systemsMissingObligationOrNoneAttest =
          systemsMissingObligationOrNoneAttest ?? missingObl;
        systemsMissingOwner = systemsMissingOwner ?? missingOwner;
        systemsWithStaleReview = systemsWithStaleReview ?? stale;
        if (coversAllProductionAiSystems == null) {
          coversAllProductionAiSystems =
            missingObl === 0 && missingOwner === 0 && stale === 0;
        }
      }

      if (asBool(data.cmpM1Complete) === true) {
        coversAllProductionAiSystems = coversAllProductionAiSystems ?? true;
        systemsMissingObligationOrNoneAttest =
          systemsMissingObligationOrNoneAttest ?? 0;
        systemsMissingOwner = systemsMissingOwner ?? 0;
        systemsWithStaleReview = systemsWithStaleReview ?? 0;
        productionAiSystemCount = productionAiSystemCount ?? 1;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionAiSystemCount,
    coversAllProductionAiSystems,
    systemsMissingObligationOrNoneAttest,
    systemsMissingOwner,
    systemsWithStaleReview,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiObligationsRegisterReport(opts: {
  assessedAt: string;
  signals: AiObligationsRegisterReport["signals"];
  complianceSignals: boolean;
  imported: AiObligationsRegisterReport["importedResults"];
}): AiObligationsRegisterReport {
  const notes: string[] = [];
  const obligationSignalsPresent =
    opts.signals.register.found ||
    (opts.signals.ownership.found && opts.signals.noneInScope.found);

  if (
    !opts.complianceSignals &&
    !obligationSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No AI obligations-register signals — CMP-M1 may be NOT_APPLICABLE if there are no production AI systems.",
    );
  }
  if (opts.signals.register.found) {
    notes.push(
      `Register refs: ${opts.signals.register.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (systems=${opts.imported.productionAiSystemCount}, covers=${opts.imported.coversAllProductionAiSystems}, missingObl=${opts.imported.systemsMissingObligationOrNoneAttest}, missingOwner=${opts.imported.systemsMissingOwner}, stale=${opts.imported.systemsWithStaleReview}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (obligationSignalsPresent) {
    notes.push(
      "Register signals alone are PARTIAL — import per-system obligations/none-in-scope coverage (measuredAt ≤90d) under imports/ai-obligations-register/ to PASS.",
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
    opts.imported.coversAllProductionAiSystems === true &&
    opts.imported.systemsMissingObligationOrNoneAttest === 0 &&
    opts.imported.systemsMissingOwner === 0 &&
    opts.imported.systemsWithStaleReview === 0 &&
    ageOk &&
    importFresh;

  let statusHint: AiObligationsRegisterReport["summary"]["statusHint"] =
    "not_demonstrated";
  let cmpM1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.coversAllProductionAiSystems === false ||
      (opts.imported.systemsMissingObligationOrNoneAttest !== null &&
        opts.imported.systemsMissingObligationOrNoneAttest > 0) ||
      (opts.imported.systemsMissingOwner !== null &&
        opts.imported.systemsMissingOwner > 0) ||
      (opts.imported.systemsWithStaleReview !== null &&
        opts.imported.systemsWithStaleReview > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > INVENTORY_MAX_AGE_DAYS));

  if (
    !opts.complianceSignals &&
    !obligationSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    cmpM1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    cmpM1Satisfied = false;
    notes.push(
      "Imported register shows uncovered systems, missing owners, stale (>12 month) reviews, or evidence older than 90 days — CMP-M1 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    cmpM1Satisfied = true;
  } else if (obligationSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    cmpM1Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.coversAllProductionAiSystems !== true) {
        notes.push("Import must show coversAllProductionAiSystems=true.");
      }
      if (opts.imported.systemsMissingObligationOrNoneAttest !== 0) {
        notes.push(
          "Import must show systemsMissingObligationOrNoneAttest=0.",
        );
      }
      if (opts.imported.systemsMissingOwner !== 0) {
        notes.push("Import must show systemsMissingOwner=0.");
      }
      if (opts.imported.systemsWithStaleReview !== 0) {
        notes.push("Import must show systemsWithStaleReview=0 (reviews ≤12 months).");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock CMP-M1 PASS.",
        );
      }
    }
  } else if (opts.complianceSignals) {
    statusHint = "not_demonstrated";
    cmpM1Satisfied = null;
    notes.push(
      "Compliance signals present but no obligations register with owners found.",
    );
  } else {
    statusHint = "not_demonstrated";
    cmpM1Satisfied = null;
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
      obligationSignalsPresent,
      cmpM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiObligationsRegisterCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const complianceSignals =
      collectRefs(
        ctx.targetPath,
        Math.min(maxFiles, 2000),
        (path, text) => PATH_RE.test(path) || PATH_RE.test(text),
        5,
      ).length > 0;

    const inCtx = (path: string, text: string) =>
      PATH_RE.test(path) || PATH_RE.test(text) || REGISTER_RE.test(text);

    const registerRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (REGISTER_RE.test(path) || REGISTER_RE.test(text)) &&
        inCtx(path, text),
    );
    const ownerRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (OWNER_RE.test(path) || OWNER_RE.test(text)) &&
        (REGISTER_RE.test(text) || PATH_RE.test(path)),
      12,
    );
    const noneRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (NONE_SCOPE_RE.test(path) || NONE_SCOPE_RE.test(text)) &&
        inCtx(path, text),
      12,
    );

    const imported = loadImported(ctx, ctx.assessedAt);
    const report = buildAiObligationsRegisterReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        register: { found: registerRefs.length > 0, refs: registerRefs },
        ownership: { found: ownerRefs.length > 0, refs: ownerRefs },
        noneInScope: { found: noneRefs.length > 0, refs: noneRefs },
      },
      complianceSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-obligations-register-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/ai-obligations-register-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-obligations-register",
          "cmp-m1",
          DETECTOR_ID,
          ...(report.summary.obligationSignalsPresent
            ? ["obligation-signals"]
            : []),
          ...(report.summary.cmpM1Satisfied ? ["cmp-m1-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...registerRefs.slice(0, 2),
      ...ownerRefs.slice(0, 1),
      ...noneRefs.slice(0, 1),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["ai-obligations-register-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `CMP-M1 status=${report.summary.statusHint} obligations=${report.summary.obligationSignalsPresent} satisfied=${report.summary.cmpM1Satisfied}; report=imports/${PLUGIN_ID}/ai-obligations-register-report.json`,
      nodes,
    };
  },
};
