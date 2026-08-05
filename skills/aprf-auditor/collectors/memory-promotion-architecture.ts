/**
 * memory-promotion-architecture — MEM-R3 / repo-memory-promotion-architecture.
 *
 * Discovers working vs durable memory separation, promotion rules, and audits.
 * Import evidence under imports/memory-promotion-architecture/ to unlock PASS.
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

const PLUGIN_ID = "memory-promotion-architecture";
const RELATED = ["MEM-R3"] as const;
const DETECTOR_ID = "repo-memory-promotion-architecture";
const INVENTORY_MAX_AGE_DAYS = 90;
const MIN_PROMOTIONS = 10;

const MEMORY_PATH_RE =
  /(memory|memories|working[\s_-]*mem|durable[\s_-]*mem|short[\s_-]*term|long[\s_-]*term|session[\s_-]*mem|promotion)/i;

const SEPARATION_RE =
  /\b(working[\s_-]*memory|durable[\s_-]*memory|short[\s_-]*term[\s_-]*memory|long[\s_-]*term[\s_-]*memory|session[\s_-]*scratch|ephemeral[\s_-]*memory)\b/i;

const PROMOTION_RE =
  /\b(promot(?:e|ion)[\s_-]*(?:rule|policy|gate)|working[\s_-]*to[\s_-]*durable|promote[\s_-]*to[\s_-]*durable|memory[\s_-]*promotion)\b/i;

const TTL_CLASS_RE =
  /\b(ttl[\s_-]*by[\s_-]*(?:class|type)|retention[\s_-]*by[\s_-]*class|different[\s_-]*ttl|per[\s_-]*memory[\s_-]*class)\b/i;

const AUDIT_RE =
  /\b(promotion[\s_-]*audit|promoted[\s_-]*by|rule[\s_-]*id|actor[\s_-]*id|promotion[\s_-]*log)\b/i;

export interface MemoryPromotionArchitectureReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    workingDurableSeparation: { found: boolean; refs: string[] };
    promotionRules: { found: boolean; refs: string[] };
    ttlByClass: { found: boolean; refs: string[] };
    promotionAudit: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    workingDurableSeparated: boolean | null;
    promotionRulesPresent: boolean | null;
    silentPromotionDenied: boolean | null;
    lastPromotionsWithRuleAndActor: number | null;
    ttlDiffersByMemoryClass: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    architectureSignalsPresent: boolean;
    memR3Satisfied: boolean | null;
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

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function loadImported(
  ctx: CollectorContext,
): MemoryPromotionArchitectureReport["importedResults"] {
  const sources: string[] = [];
  let workingDurableSeparated: boolean | null = null;
  let promotionRulesPresent: boolean | null = null;
  let silentPromotionDenied: boolean | null = null;
  let lastPromotionsWithRuleAndActor: number | null = null;
  let ttlDiffersByMemoryClass: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/memory-promotion-architecture-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      workingDurableSeparated =
        asBool(data.workingDurableSeparated) ??
        asBool(data.storesSeparated) ??
        workingDurableSeparated;
      promotionRulesPresent =
        asBool(data.promotionRulesPresent) ??
        asBool(data.promotionRulesConfigured) ??
        promotionRulesPresent;
      silentPromotionDenied =
        asBool(data.silentPromotionDenied) ??
        asBool(data.cannotSilentlyPromote) ??
        silentPromotionDenied;
      lastPromotionsWithRuleAndActor =
        asNum(data.lastPromotionsWithRuleAndActor) ??
        asNum(data.promotionAuditCount) ??
        asNum(data.last10PromotionsComplete) ??
        lastPromotionsWithRuleAndActor;
      ttlDiffersByMemoryClass =
        asBool(data.ttlDiffersByMemoryClass) ??
        asBool(data.ttlByClass) ??
        ttlDiffersByMemoryClass;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const promotions = (data.promotions as unknown[]) || [];
      if (Array.isArray(promotions) && promotions.length > 0) {
        let ok = 0;
        for (const p of promotions) {
          if (!p || typeof p !== "object") continue;
          const row = p as Record<string, unknown>;
          if (
            (row.ruleId || row.rule_id || row.rule) &&
            (row.actor || row.actorId || row.actor_id || row.user)
          ) {
            ok += 1;
          }
        }
        lastPromotionsWithRuleAndActor =
          lastPromotionsWithRuleAndActor ?? ok;
      }

      if (asBool(data.memR3Complete) === true) {
        workingDurableSeparated = workingDurableSeparated ?? true;
        promotionRulesPresent = promotionRulesPresent ?? true;
        silentPromotionDenied = silentPromotionDenied ?? true;
        lastPromotionsWithRuleAndActor =
          lastPromotionsWithRuleAndActor ?? MIN_PROMOTIONS;
        ttlDiffersByMemoryClass = ttlDiffersByMemoryClass ?? true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    workingDurableSeparated,
    promotionRulesPresent,
    silentPromotionDenied,
    lastPromotionsWithRuleAndActor,
    ttlDiffersByMemoryClass,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildMemoryPromotionArchitectureReport(opts: {
  assessedAt: string;
  signals: MemoryPromotionArchitectureReport["signals"];
  memorySignals: boolean;
  imported: MemoryPromotionArchitectureReport["importedResults"];
}): MemoryPromotionArchitectureReport {
  const notes: string[] = [];
  const architectureSignalsPresent =
    opts.signals.workingDurableSeparation.found ||
    opts.signals.promotionRules.found ||
    opts.signals.ttlByClass.found;

  if (
    !opts.memorySignals &&
    !architectureSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No working/durable promotion signals — MEM-R3 may be NOT_APPLICABLE if there is no dual-class AI memory.",
    );
  }
  if (opts.signals.promotionRules.found) {
    notes.push(
      `Promotion refs: ${opts.signals.promotionRules.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (separated=${opts.imported.workingDurableSeparated}, rules=${opts.imported.promotionRulesPresent}, silentDenied=${opts.imported.silentPromotionDenied}, audits=${opts.imported.lastPromotionsWithRuleAndActor}, ttlByClass=${opts.imported.ttlDiffersByMemoryClass}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (architectureSignalsPresent) {
    notes.push(
      "Architecture signals alone are PARTIAL — import separation + rules + ≥10 promotion audits (measuredAt ≤90d) under imports/memory-promotion-architecture/ to PASS.",
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
  const auditOk =
    opts.imported.lastPromotionsWithRuleAndActor !== null &&
    opts.imported.lastPromotionsWithRuleAndActor >= MIN_PROMOTIONS;
  const passOk =
    opts.imported.workingDurableSeparated === true &&
    opts.imported.promotionRulesPresent === true &&
    opts.imported.silentPromotionDenied === true &&
    auditOk &&
    opts.imported.ttlDiffersByMemoryClass === true &&
    ageOk &&
    importFresh;

  let statusHint: MemoryPromotionArchitectureReport["summary"]["statusHint"];
  let memR3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.workingDurableSeparated === false ||
      opts.imported.promotionRulesPresent === false ||
      opts.imported.silentPromotionDenied === false ||
      opts.imported.ttlDiffersByMemoryClass === false ||
      (opts.imported.lastPromotionsWithRuleAndActor !== null &&
        opts.imported.lastPromotionsWithRuleAndActor < MIN_PROMOTIONS) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > INVENTORY_MAX_AGE_DAYS));

  if (
    !opts.memorySignals &&
    !architectureSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    memR3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    memR3Satisfied = false;
    notes.push(
      "Imported evidence shows missing separation/rules, silent promotion allowed, incomplete audits, identical TTLs, or evidence older than 90 days — MEM-R3 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    memR3Satisfied = true;
  } else if (architectureSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    memR3Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.workingDurableSeparated !== true) {
        notes.push("Import must show workingDurableSeparated=true.");
      }
      if (opts.imported.promotionRulesPresent !== true) {
        notes.push("Import must show promotionRulesPresent=true.");
      }
      if (opts.imported.silentPromotionDenied !== true) {
        notes.push("Import must show silentPromotionDenied=true.");
      }
      if (!auditOk) {
        notes.push(
          `Import must show lastPromotionsWithRuleAndActor≥${MIN_PROMOTIONS}.`,
        );
      }
      if (opts.imported.ttlDiffersByMemoryClass !== true) {
        notes.push("Import must show ttlDiffersByMemoryClass=true.");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock MEM-R3 PASS.",
        );
      }
    }
  } else if (opts.memorySignals) {
    statusHint = "not_demonstrated";
    memR3Satisfied = null;
    notes.push(
      "Memory signals present but no working/durable separation or promotion rules found.",
    );
  } else {
    statusHint = "not_demonstrated";
    memR3Satisfied = null;
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
      architectureSignalsPresent,
      memR3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const memoryPromotionArchitectureCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const memorySignals =
      collectRefs(
        ctx.targetPath,
        Math.min(maxFiles, 2000),
        (path, text) => MEMORY_PATH_RE.test(path) || MEMORY_PATH_RE.test(text),
        5,
      ).length > 0;

    const inMem = (path: string, text: string) =>
      MEMORY_PATH_RE.test(path) ||
      MEMORY_PATH_RE.test(text) ||
      SEPARATION_RE.test(text);

    const sepRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SEPARATION_RE.test(path) || SEPARATION_RE.test(text)) &&
        inMem(path, text),
    );
    const promoRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PROMOTION_RE.test(path) || PROMOTION_RE.test(text)) &&
        inMem(path, text),
    );
    const ttlRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (TTL_CLASS_RE.test(path) || TTL_CLASS_RE.test(text)) &&
        inMem(path, text),
      12,
    );
    const auditRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (AUDIT_RE.test(path) || AUDIT_RE.test(text)) && inMem(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildMemoryPromotionArchitectureReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        workingDurableSeparation: {
          found: sepRefs.length > 0,
          refs: sepRefs,
        },
        promotionRules: { found: promoRefs.length > 0, refs: promoRefs },
        ttlByClass: { found: ttlRefs.length > 0, refs: ttlRefs },
        promotionAudit: { found: auditRefs.length > 0, refs: auditRefs },
      },
      memorySignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "memory-promotion-architecture-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/memory-promotion-architecture-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "memory-promotion-architecture",
          "mem-r3",
          DETECTOR_ID,
          ...(report.summary.architectureSignalsPresent
            ? ["architecture-signals"]
            : []),
          ...(report.summary.memR3Satisfied ? ["mem-r3-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...sepRefs.slice(0, 1),
        ...promoRefs.slice(0, 2),
        ...ttlRefs.slice(0, 1),
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
        signals: ["memory-promotion-architecture-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `MEM-R3 status=${report.summary.statusHint} architecture=${report.summary.architectureSignalsPresent} satisfied=${report.summary.memR3Satisfied}; report=imports/${PLUGIN_ID}/memory-promotion-architecture-report.json`,
      nodes,
    };
  },
};
