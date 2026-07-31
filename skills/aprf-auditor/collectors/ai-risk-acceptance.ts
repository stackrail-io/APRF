/**
 * ai-risk-acceptance — ORG-R4 / repo-ai-risk-acceptance.
 *
 * Discovers control-gap risk-acceptance / waiver registers. Import coverage
 * under imports/ai-risk-acceptance/ to unlock PASS.
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

const PLUGIN_ID = "ai-risk-acceptance";
const RELATED = ["ORG-R4"] as const;
const DETECTOR_ID = "repo-ai-risk-acceptance";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PATH_RE =
  /(risk[\s_-]*accept|control[\s_-]*gap|waiver|exception[\s_-]*register|risk[\s_-]*register)/i;

const REGISTER_RE =
  /\b(risk[\s_-]*acceptance|waiver[\s_-]*register|control[\s_-]*gap[\s_-]*waiver|exception[\s_-]*register|risk[\s_-]*accept)\b/i;

const OWNER_EXPIRY_RE =
  /\b(waiver[\s_-]*owner|expiry|expires[\s_-]*at|compensating|escalat(?:e|ion))\b/i;

const GAP_RE =
  /\b(control[\s_-]*gap|known[\s_-]*gap|open[\s_-]*waiver|expired[\s_-]*waiver)\b/i;

export interface AiRiskAcceptanceReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    register: { found: boolean; refs: string[] };
    ownerExpiry: { found: boolean; refs: string[] };
    gaps: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    openWaiverCount: number | null;
    openWaiversIncomplete: number | null;
    expiredWaiversWithoutEscalation: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    riskSignalsPresent: boolean;
    orgR4Satisfied: boolean | null;
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

function waiverIncomplete(row: Record<string, unknown>): boolean {
  const owner = row.owner || row.ownerId || row.owner_id;
  const expiry =
    row.expiry || row.expiresAt || row.expiryDate || row.expires_at;
  return !owner || !expiry;
}

function loadImported(
  ctx: CollectorContext,
): AiRiskAcceptanceReport["importedResults"] {
  const sources: string[] = [];
  let openWaiverCount: number | null = null;
  let openWaiversIncomplete: number | null = null;
  let expiredWaiversWithoutEscalation: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-risk-acceptance-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      openWaiverCount =
        asNum(data.openWaiverCount) ??
        asNum(data.openWaivers) ??
        openWaiverCount;
      openWaiversIncomplete =
        asNum(data.openWaiversIncomplete) ??
        asNum(data.incompleteOpenWaivers) ??
        openWaiversIncomplete;
      expiredWaiversWithoutEscalation =
        asNum(data.expiredWaiversWithoutEscalation) ??
        asNum(data.expiredWithoutEscalation) ??
        expiredWaiversWithoutEscalation;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const waivers =
        (data.openWaivers as unknown[]) ||
        (data.waivers as unknown[]) ||
        (data.entries as unknown[]) ||
        [];
      if (Array.isArray(waivers) && waivers.length > 0) {
        let incomplete = 0;
        let open = 0;
        let expiredNoEsc = 0;
        for (const w of waivers) {
          if (!w || typeof w !== "object") continue;
          const row = w as Record<string, unknown>;
          const status = String(row.status || row.state || "open").toLowerCase();
          const expired =
            status === "expired" || asBool(row.expired) === true;
          const closed =
            status === "closed" || asBool(row.closed) === true;
          if (closed) continue;
          if (expired) {
            const escalated =
              asBool(row.escalated) === true ||
              asBool(row.hasEscalationRecord) === true ||
              Boolean(row.escalationRecord || row.escalation);
            if (!escalated) expiredNoEsc += 1;
          } else {
            open += 1;
            if (waiverIncomplete(row)) incomplete += 1;
          }
        }
        openWaiverCount = openWaiverCount ?? open;
        openWaiversIncomplete = openWaiversIncomplete ?? incomplete;
        expiredWaiversWithoutEscalation =
          expiredWaiversWithoutEscalation ?? expiredNoEsc;
      }

      if (asBool(data.orgR4Complete) === true || asBool(data.orgM3Complete) === true) {
        openWaiversIncomplete = openWaiversIncomplete ?? 0;
        expiredWaiversWithoutEscalation =
          expiredWaiversWithoutEscalation ?? 0;
        openWaiverCount = openWaiverCount ?? 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    openWaiverCount,
    openWaiversIncomplete,
    expiredWaiversWithoutEscalation,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiRiskAcceptanceReport(opts: {
  assessedAt: string;
  signals: AiRiskAcceptanceReport["signals"];
  riskContextSignals: boolean;
  imported: AiRiskAcceptanceReport["importedResults"];
}): AiRiskAcceptanceReport {
  const notes: string[] = [];
  const riskSignalsPresent =
    opts.signals.register.found ||
    opts.signals.ownerExpiry.found ||
    opts.signals.gaps.found;

  if (
    !opts.riskContextSignals &&
    !riskSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No risk-acceptance / waiver signals — ORG-R4 may be NOT_APPLICABLE if there are no AI control-gap waivers.",
    );
  }
  if (opts.signals.register.found) {
    notes.push(
      `Register refs: ${opts.signals.register.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (open=${opts.imported.openWaiverCount}, incomplete=${opts.imported.openWaiversIncomplete}, expiredNoEsc=${opts.imported.expiredWaiversWithoutEscalation})`,
    );
  } else if (riskSignalsPresent) {
    notes.push(
      "Risk signals alone are PARTIAL — import openWaiversIncomplete=0 and expiredWaiversWithoutEscalation=0 (measuredAt ≤90d) under imports/ai-risk-acceptance/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(),
    IMPORT_MAX_AGE_DAYS,
  );
  const openOk = opts.imported.openWaiversIncomplete === 0;
  const expiredOk = opts.imported.expiredWaiversWithoutEscalation === 0;
  const passOk = openOk && expiredOk && ageOk && importFresh;

  let statusHint: AiRiskAcceptanceReport["summary"]["statusHint"] =
    "not_demonstrated";
  let orgR4Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.openWaiversIncomplete !== null &&
      opts.imported.openWaiversIncomplete > 0) ||
      (opts.imported.expiredWaiversWithoutEscalation !== null &&
        opts.imported.expiredWaiversWithoutEscalation > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (
    !opts.riskContextSignals &&
    !riskSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    orgR4Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    orgR4Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete open waivers, expired waivers without escalation, or evidence older than 90 days — ORG-R4 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    orgR4Satisfied = true;
  } else if (riskSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    orgR4Satisfied = false;
    if (opts.imported.found) {
      if (!openOk) {
        notes.push(
          "Import must show openWaiversIncomplete=0 (every open waiver has owner + expiry).",
        );
      }
      if (!expiredOk) {
        notes.push(
          "Import must show expiredWaiversWithoutEscalation=0.",
        );
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock ORG-R4 PASS.",
        );
      }
    }
  } else if (opts.riskContextSignals) {
    statusHint = "not_demonstrated";
    orgR4Satisfied = null;
    notes.push(
      "Risk-context signals present but no risk-acceptance register found.",
    );
  } else {
    statusHint = "not_demonstrated";
    orgR4Satisfied = null;
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
      riskSignalsPresent,
      orgR4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiRiskAcceptanceCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const riskContextSignals =
      collectRefs(
        ctx.targetPath,
        Math.min(maxFiles, 2000),
        (path, text) => PATH_RE.test(path) || PATH_RE.test(text),
        5,
      ).length > 0;

    const inCtx = (path: string, text: string) =>
      PATH_RE.test(path) ||
      PATH_RE.test(text) ||
      REGISTER_RE.test(text) ||
      GAP_RE.test(text);

    const registerRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (REGISTER_RE.test(path) || REGISTER_RE.test(text)) &&
        inCtx(path, text),
    );
    const ownerExpiryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (OWNER_EXPIRY_RE.test(path) || OWNER_EXPIRY_RE.test(text)) &&
        inCtx(path, text),
      12,
    );
    const gapRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (GAP_RE.test(path) || GAP_RE.test(text)) && inCtx(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiRiskAcceptanceReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        register: { found: registerRefs.length > 0, refs: registerRefs },
        ownerExpiry: {
          found: ownerExpiryRefs.length > 0,
          refs: ownerExpiryRefs,
        },
        gaps: { found: gapRefs.length > 0, refs: gapRefs },
      },
      riskContextSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-risk-acceptance-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/ai-risk-acceptance-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-risk-acceptance",
          "org-r4",
          DETECTOR_ID,
          ...(report.summary.riskSignalsPresent ? ["risk-signals"] : []),
          ...(report.summary.orgR4Satisfied ? ["org-r4-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...registerRefs.slice(0, 2),
        ...ownerExpiryRefs.slice(0, 1),
        ...gapRefs.slice(0, 1),
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
        signals: ["ai-risk-acceptance-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `ORG-R4 status=${report.summary.statusHint} risk=${report.summary.riskSignalsPresent} satisfied=${report.summary.orgR4Satisfied}; report=imports/${PLUGIN_ID}/ai-risk-acceptance-report.json`,
      nodes,
    };
  },
};
