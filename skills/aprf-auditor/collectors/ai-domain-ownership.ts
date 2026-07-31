/**
 * ai-domain-ownership — ORG-R2 / repo-ai-domain-ownership.
 *
 * Discovers production AI inventories with critical-domain owners. Import
 * coverage under imports/ai-domain-ownership/ to unlock PASS.
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

const PLUGIN_ID = "ai-domain-ownership";
const RELATED = ["ORG-R2"] as const;
const DETECTOR_ID = "repo-ai-domain-ownership";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PATH_RE =
  /(system[\s_-]*inventory|ai[\s_-]*inventory|domain[\s_-]*owner|raci|ownership[\s_-]*register|codeowners)/i;

const INVENTORY_RE =
  /\b(system[\s_-]*inventory|ai[\s_-]*system[\s_-]*inventory|production[\s_-]*ai[\s_-]*inventory|service[\s_-]*catalog)\b/i;

const DOMAIN_OWNER_RE =
  /\b(domain[\s_-]*owner|security[\s_-]*owner|safety[\s_-]*owner|data[\s_-]*owner|reliability[\s_-]*owner|model[\s_-]*owner|governance[\s_-]*owner)\b/i;

const OWNER_RE =
  /\b(named[\s_-]*owner|accountable|owner[\s_-]*team|domain[\s_-]*raci)\b/i;

export interface AiDomainOwnershipReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    inventory: { found: boolean; refs: string[] };
    domainOwners: { found: boolean; refs: string[] };
    ownership: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionAiSystemCount: number | null;
    coversAllProductionAiSystems: boolean | null;
    systemsMissingRequiredDomainOwners: number | null;
    requiredDomainOwnerFieldCount: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    ownershipSignalsPresent: boolean;
    orgR2Satisfied: boolean | null;
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
): AiDomainOwnershipReport["importedResults"] {
  const sources: string[] = [];
  let productionAiSystemCount: number | null = null;
  let coversAllProductionAiSystems: boolean | null = null;
  let systemsMissingRequiredDomainOwners: number | null = null;
  let requiredDomainOwnerFieldCount: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-domain-ownership-report\.json$/i.test(f)) continue;
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
      systemsMissingRequiredDomainOwners =
        asNum(data.systemsMissingRequiredDomainOwners) ??
        asNum(data.missingOwnerSystemCount) ??
        systemsMissingRequiredDomainOwners;
      requiredDomainOwnerFieldCount =
        asNum(data.requiredDomainOwnerFieldCount) ??
        (Array.isArray(data.requiredDomainOwnerFields)
          ? data.requiredDomainOwnerFields.length
          : null) ??
        requiredDomainOwnerFieldCount;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const systems =
        (data.systems as unknown[]) ||
        (data.aiSystems as unknown[]) ||
        (data.entries as unknown[]) ||
        [];
      if (Array.isArray(systems) && systems.length > 0) {
        productionAiSystemCount = productionAiSystemCount ?? systems.length;
        const requiredFields =
          (data.requiredDomainOwnerFields as string[]) ||
          (data.requiredDomains as string[]) ||
          [];
        if (requiredFields.length > 0) {
          requiredDomainOwnerFieldCount =
            requiredDomainOwnerFieldCount ?? requiredFields.length;
        }
        let missing = 0;
        for (const s of systems) {
          if (!s || typeof s !== "object") continue;
          const row = s as Record<string, unknown>;
          const owners =
            (row.domainOwners as Record<string, unknown>) ||
            (row.owners as Record<string, unknown>) ||
            null;
          if (requiredFields.length > 0 && owners) {
            for (const field of requiredFields) {
              const v = owners[field];
              if (v == null || (typeof v === "string" && !v.trim())) {
                missing += 1;
                break;
              }
            }
          } else if (asBool(row.missingRequiredDomainOwners) === true) {
            missing += 1;
          } else if (
            asNum(row.missingDomainOwnerCount) !== null &&
            (asNum(row.missingDomainOwnerCount) as number) > 0
          ) {
            missing += 1;
          }
        }
        systemsMissingRequiredDomainOwners =
          systemsMissingRequiredDomainOwners ?? missing;
        if (coversAllProductionAiSystems == null) {
          coversAllProductionAiSystems = missing === 0;
        }
      }

      if (asBool(data.orgR2Complete) === true || asBool(data.orgM2Complete) === true) {
        coversAllProductionAiSystems = coversAllProductionAiSystems ?? true;
        systemsMissingRequiredDomainOwners =
          systemsMissingRequiredDomainOwners ?? 0;
        productionAiSystemCount = productionAiSystemCount ?? 1;
        requiredDomainOwnerFieldCount =
          requiredDomainOwnerFieldCount ?? 1;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionAiSystemCount,
    coversAllProductionAiSystems,
    systemsMissingRequiredDomainOwners,
    requiredDomainOwnerFieldCount,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiDomainOwnershipReport(opts: {
  assessedAt: string;
  signals: AiDomainOwnershipReport["signals"];
  ownershipContextSignals: boolean;
  imported: AiDomainOwnershipReport["importedResults"];
}): AiDomainOwnershipReport {
  const notes: string[] = [];
  const ownershipSignalsPresent =
    opts.signals.inventory.found ||
    opts.signals.domainOwners.found ||
    opts.signals.ownership.found;

  if (
    !opts.ownershipContextSignals &&
    !ownershipSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No AI domain-ownership signals — ORG-R2 may be NOT_APPLICABLE if there are no production AI systems.",
    );
  }
  if (opts.signals.inventory.found) {
    notes.push(
      `Inventory refs: ${opts.signals.inventory.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (systems=${opts.imported.productionAiSystemCount}, covers=${opts.imported.coversAllProductionAiSystems}, missing=${opts.imported.systemsMissingRequiredDomainOwners}, requiredFields=${opts.imported.requiredDomainOwnerFieldCount})`,
    );
  } else if (ownershipSignalsPresent) {
    notes.push(
      "Ownership signals alone are PARTIAL — import inventory coverage with systemsMissingRequiredDomainOwners=0 (measuredAt ≤90d) under imports/ai-domain-ownership/ to PASS.",
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
  const coverageOk = opts.imported.coversAllProductionAiSystems === true;
  const missingOk = opts.imported.systemsMissingRequiredDomainOwners === 0;
  const fieldsOk =
    opts.imported.requiredDomainOwnerFieldCount !== null &&
    opts.imported.requiredDomainOwnerFieldCount > 0;
  const passOk = coverageOk && missingOk && fieldsOk && ageOk && importFresh;

  let statusHint: AiDomainOwnershipReport["summary"]["statusHint"] =
    "not_demonstrated";
  let orgR2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.coversAllProductionAiSystems === false ||
      (opts.imported.systemsMissingRequiredDomainOwners !== null &&
        opts.imported.systemsMissingRequiredDomainOwners > 0) ||
      (opts.imported.requiredDomainOwnerFieldCount !== null &&
        opts.imported.requiredDomainOwnerFieldCount <= 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (
    !opts.ownershipContextSignals &&
    !ownershipSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    orgR2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    orgR2Satisfied = false;
    notes.push(
      "Imported evidence shows uncovered systems, missing domain owners, empty required-domain set, or evidence older than 90 days — ORG-R2 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    orgR2Satisfied = true;
  } else if (ownershipSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    orgR2Satisfied = false;
    if (opts.imported.found) {
      if (!coverageOk) {
        notes.push("Import must show coversAllProductionAiSystems=true.");
      }
      if (!missingOk) {
        notes.push(
          "Import must show systemsMissingRequiredDomainOwners=0.",
        );
      }
      if (!fieldsOk) {
        notes.push(
          "Import must show requiredDomainOwnerFieldCount>0 (or requiredDomainOwnerFields).",
        );
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock ORG-R2 PASS.",
        );
      }
    }
  } else if (opts.ownershipContextSignals) {
    statusHint = "not_demonstrated";
    orgR2Satisfied = null;
    notes.push(
      "Ownership-context signals present but no system inventory with domain owners found.",
    );
  } else {
    statusHint = "not_demonstrated";
    orgR2Satisfied = null;
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
      ownershipSignalsPresent,
      orgR2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiDomainOwnershipCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const ownershipContextSignals =
      collectRefs(
        ctx.targetPath,
        Math.min(maxFiles, 2000),
        (path, text) => PATH_RE.test(path) || PATH_RE.test(text),
        5,
      ).length > 0;

    const inCtx = (path: string, text: string) =>
      PATH_RE.test(path) ||
      PATH_RE.test(text) ||
      INVENTORY_RE.test(text) ||
      DOMAIN_OWNER_RE.test(text);

    const inventoryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (INVENTORY_RE.test(path) || INVENTORY_RE.test(text)) &&
        inCtx(path, text),
    );
    const domainRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (DOMAIN_OWNER_RE.test(path) || DOMAIN_OWNER_RE.test(text)) &&
        inCtx(path, text),
      12,
    );
    const ownershipRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (OWNER_RE.test(path) || OWNER_RE.test(text)) && inCtx(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildAiDomainOwnershipReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        inventory: { found: inventoryRefs.length > 0, refs: inventoryRefs },
        domainOwners: { found: domainRefs.length > 0, refs: domainRefs },
        ownership: { found: ownershipRefs.length > 0, refs: ownershipRefs },
      },
      ownershipContextSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-domain-ownership-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/ai-domain-ownership-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "ai-domain-ownership",
          "org-r2",
          DETECTOR_ID,
          ...(report.summary.ownershipSignalsPresent
            ? ["ownership-signals"]
            : []),
          ...(report.summary.orgR2Satisfied ? ["org-r2-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...inventoryRefs.slice(0, 2),
      ...domainRefs.slice(0, 1),
      ...ownershipRefs.slice(0, 1),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["ai-domain-ownership-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `ORG-R2 status=${report.summary.statusHint} ownership=${report.summary.ownershipSignalsPresent} satisfied=${report.summary.orgR2Satisfied}; report=imports/${PLUGIN_ID}/ai-domain-ownership-report.json`,
      nodes,
    };
  },
};
