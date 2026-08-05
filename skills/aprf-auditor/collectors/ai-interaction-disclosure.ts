/**
 * ai-interaction-disclosure — SAF-M3 / repo-ai-interaction-disclosure.
 *
 * Discovers AI-interaction disclosure UX inventory + audits.
 * Import disclosureUxInventoryConfigured +
 * inScopeSurfacesWithAiDisclosurePct=100 +
 * criticalSurfacesMissingDisclosure=0 under
 * imports/ai-interaction-disclosure/ to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "ai-interaction-disclosure";
const RELATED = ["SAF-M3"] as const;
const DETECTOR_ID = "repo-ai-interaction-disclosure";
const IMPORT_MAX_AGE_DAYS = 90;

const DISCLOSURE_RE =
  /\b(ai[_-]?(disclosure|disclaimer|notice|label)|interacting[_-]?with[_-]?ai|you[_-]?are[_-]?(chatting|speaking|talking)[_-]?with[_-]?(an[_-]?)?ai|powered[_-]?by[_-]?ai|ai[_-]?generated|chatbot[_-]?disclosure|bot[_-]?disclosure)\b/i;

const INVENTORY_RE =
  /\b(disclosure[_-]?(ux[_-]?)?inventory|surface[_-]?inventory|in[_-]?scope[_-]?(surface|ux)|disclosure[_-]?checklist|ux[_-]?audit)\b/i;

const AUDIT_RE =
  /\b(disclosure[_-]?audit|screenshot[_-]?(audit|checklist)|surface[_-]?audit|critical[_-]?surface)\b/i;

export interface AiInteractionDisclosureReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    disclosure: { found: boolean; refs: string[] };
    inventory: { found: boolean; refs: string[] };
    audit: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    disclosureUxInventoryConfigured: boolean | null;
    inScopeSurfacesWithAiDisclosurePct: number | null;
    criticalSurfacesMissingDisclosure: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    disclosureSignalsPresent: boolean;
    safM3Satisfied: boolean | null;
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
    extensions: [
      ".md",
      ".txt",
      ".yml",
      ".yaml",
      ".json",
      ".tsx",
      ".jsx",
      ".vue",
      ".html",
      ".png",
      ".jpg",
      ".webp",
    ],
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
): AiInteractionDisclosureReport["importedResults"] {
  const sources: string[] = [];
  let disclosureUxInventoryConfigured: boolean | null = null;
  let inScopeSurfacesWithAiDisclosurePct: number | null = null;
  let criticalSurfacesMissingDisclosure: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-interaction-disclosure-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      disclosureUxInventoryConfigured =
        asBool(data.disclosureUxInventoryConfigured) ??
        asBool(data.disclosure_ux_inventory_configured) ??
        asBool(data.inventoryConfigured) ??
        asBool(data.disclosureInventoryPresent) ??
        disclosureUxInventoryConfigured;
      inScopeSurfacesWithAiDisclosurePct =
        asNum(data.inScopeSurfacesWithAiDisclosurePct) ??
        asNum(data.in_scope_surfaces_with_ai_disclosure_pct) ??
        asNum(data.disclosureCoveragePct) ??
        asNum(data.surfaceCoveragePct) ??
        inScopeSurfacesWithAiDisclosurePct;
      criticalSurfacesMissingDisclosure =
        asNum(data.criticalSurfacesMissingDisclosure) ??
        asNum(data.critical_surfaces_missing_disclosure) ??
        asNum(data.criticalMissingCount) ??
        criticalSurfacesMissingDisclosure;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    disclosureUxInventoryConfigured,
    inScopeSurfacesWithAiDisclosurePct,
    criticalSurfacesMissingDisclosure,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiInteractionDisclosureReport(opts: {
  assessedAt: string;
  disclosure: { found: boolean; refs: string[] };
  inventory: { found: boolean; refs: string[] };
  audit: { found: boolean; refs: string[] };
  imported: AiInteractionDisclosureReport["importedResults"];
}): AiInteractionDisclosureReport {
  const notes: string[] = [];
  const disclosureSignalsPresent =
    opts.disclosure.found || opts.inventory.found || opts.audit.found;

  if (!disclosureSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI-interaction disclosure signals — SAF-M3 may be NOT_APPLICABLE if no in-scope user surfaces require disclosure.",
    );
  }
  if (opts.disclosure.found) {
    notes.push(
      `Disclosure refs: ${opts.disclosure.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.inventory.found) {
    notes.push(
      `Inventory refs: ${opts.inventory.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.audit.found) {
    notes.push(`Audit refs: ${opts.audit.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (inventory=${opts.imported.disclosureUxInventoryConfigured}, coveragePct=${opts.imported.inScopeSurfacesWithAiDisclosurePct}, criticalMissing=${opts.imported.criticalSurfacesMissingDisclosure})`,
    );
  } else if (disclosureSignalsPresent) {
    notes.push(
      "Disclosure signals alone are PARTIAL — import disclosureUxInventoryConfigured=true + inScopeSurfacesWithAiDisclosurePct=100 + criticalSurfacesMissingDisclosure=0 (measuredAt ≤90d) under imports/ai-interaction-disclosure/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const inventoryOk = opts.imported.disclosureUxInventoryConfigured === true;
  const coverageOk = opts.imported.inScopeSurfacesWithAiDisclosurePct === 100;
  const criticalOk = opts.imported.criticalSurfacesMissingDisclosure === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiInteractionDisclosureReport["summary"]["statusHint"];
  let safM3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.disclosureUxInventoryConfigured === false ||
      (opts.imported.inScopeSurfacesWithAiDisclosurePct !== null &&
        opts.imported.inScopeSurfacesWithAiDisclosurePct < 100) ||
      (opts.imported.criticalSurfacesMissingDisclosure !== null &&
        opts.imported.criticalSurfacesMissingDisclosure > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!disclosureSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    safM3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    safM3Satisfied = false;
    notes.push(
      "Imported evidence shows missing inventory, coverage <100%, critical surfaces missing disclosure, or attest older than 90 days — SAF-M3 fail.",
    );
  } else if (
    (disclosureSignalsPresent || opts.imported.found) &&
    inventoryOk &&
    coverageOk &&
    criticalOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    safM3Satisfied = true;
  } else if (disclosureSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    safM3Satisfied = false;
    if (opts.imported.found && !inventoryOk) {
      notes.push(
        "Import must show disclosureUxInventoryConfigured=true.",
      );
    }
    if (opts.imported.found && !coverageOk) {
      notes.push(
        "Import must show inScopeSurfacesWithAiDisclosurePct=100.",
      );
    }
    if (opts.imported.found && !criticalOk) {
      notes.push(
        "Import must show criticalSurfacesMissingDisclosure=0.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SAF-M3 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    safM3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      disclosure: opts.disclosure,
      inventory: opts.inventory,
      audit: opts.audit,
    },
    importedResults: opts.imported,
    summary: {
      disclosureSignalsPresent,
      safM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiInteractionDisclosureCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const disclosureRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => DISCLOSURE_RE.test(path) || DISCLOSURE_RE.test(text),
      10,
    );
    const inventoryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => INVENTORY_RE.test(path) || INVENTORY_RE.test(text),
      10,
    );
    const auditRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => AUDIT_RE.test(path) || AUDIT_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiInteractionDisclosureReport({
      assessedAt: ctx.assessedAt.toISOString(),
      disclosure: { found: disclosureRefs.length > 0, refs: disclosureRefs },
      inventory: { found: inventoryRefs.length > 0, refs: inventoryRefs },
      audit: { found: auditRefs.length > 0, refs: auditRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-interaction-disclosure-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-interaction-disclosure-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-interaction-disclosure",
          "saf-m3",
          DETECTOR_ID,
          ...(report.summary.safM3Satisfied ? ["saf-m3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.disclosure.refs,
        ...report.signals.inventory.refs,
        ...report.signals.audit.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-interaction-disclosure-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SAF-M3 status=${report.summary.statusHint} signals=${report.summary.disclosureSignalsPresent} satisfied=${report.summary.safM3Satisfied}; report=imports/${PLUGIN_ID}/ai-interaction-disclosure-report.json`,
      nodes,
    };
  },
};
