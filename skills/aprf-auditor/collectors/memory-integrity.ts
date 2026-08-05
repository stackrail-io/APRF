/**
 * memory-integrity — MEM-M4 / repo-memory-integrity.
 *
 * Discovers cryptographic/signed integrity for critical AI memory classes.
 * Import verification evidence under imports/memory-integrity/ to unlock PASS.
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

const PLUGIN_ID = "memory-integrity";
const RELATED = ["MEM-M4"] as const;
const DETECTOR_ID = "repo-memory-integrity";
const INVENTORY_MAX_AGE_DAYS = 90;

const MEMORY_PATH_RE =
  /(memory|memories|durable|vector|embedding|retriev|conversation[\s_-]*store|critical[\s_-]*mem)/i;

const INVENTORY_RE =
  /\b(critical[\s_-]*memory|memory[\s_-]*class(?:es)?|integrity[\s_-]*inventory|trusted[\s_-]*fact|signed[\s_-]*memory)\b/i;

const INTEGRITY_RE =
  /\b(hmac|mac[\s_-]*verif|sign(?:ed|ature)|crypto(?:graphic)?[\s_-]*integrity|seal(?:ed)?[\s_-]*object|integrity[\s_-]*(?:check|protect|tag)|verify[\s_-]*signature)\b/i;

const VERIFY_RE =
  /\b(integrity[\s_-]*verif|verify[\s_-]*(?:mac|signature|integrity)|signature[\s_-]*check|tamper[\s_-]*detect|integrity[\s_-]*sample)\b/i;

export interface MemoryIntegrityReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    criticalInventory: { found: boolean; refs: string[] };
    integrityControl: { found: boolean; refs: string[] };
    verification: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    criticalClassesInventoried: boolean | null;
    integrityControlPresent: boolean | null;
    verificationSucceededPct: number | null;
    coversAllCriticalClasses: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    integritySignalsPresent: boolean;
    memM4Satisfied: boolean | null;
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
): MemoryIntegrityReport["importedResults"] {
  const sources: string[] = [];
  let criticalClassesInventoried: boolean | null = null;
  let integrityControlPresent: boolean | null = null;
  let verificationSucceededPct: number | null = null;
  let coversAllCriticalClasses: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/memory-integrity-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      criticalClassesInventoried =
        asBool(data.criticalClassesInventoried) ??
        asBool(data.criticalMemoryClassesInventoried) ??
        criticalClassesInventoried;
      integrityControlPresent =
        asBool(data.integrityControlPresent) ??
        asBool(data.signingConfigured) ??
        asBool(data.cryptographicIntegrityPresent) ??
        integrityControlPresent;
      verificationSucceededPct =
        asNum(data.verificationSucceededPct) ??
        asNum(data.signatureCheckSucceededPct) ??
        asNum(data.integrityCheckSucceededPct) ??
        verificationSucceededPct;
      coversAllCriticalClasses =
        asBool(data.coversAllCriticalClasses) ??
        asBool(data.verificationCoversAllCriticalClasses) ??
        coversAllCriticalClasses;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      if (asBool(data.verificationSucceeded) === true) {
        verificationSucceededPct = verificationSucceededPct ?? 100;
      }
      if (asBool(data.memM4Complete) === true) {
        criticalClassesInventoried = criticalClassesInventoried ?? true;
        integrityControlPresent = integrityControlPresent ?? true;
        verificationSucceededPct = verificationSucceededPct ?? 100;
        coversAllCriticalClasses = coversAllCriticalClasses ?? true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    criticalClassesInventoried,
    integrityControlPresent,
    verificationSucceededPct,
    coversAllCriticalClasses,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildMemoryIntegrityReport(opts: {
  assessedAt: string;
  signals: MemoryIntegrityReport["signals"];
  memorySignals: boolean;
  imported: MemoryIntegrityReport["importedResults"];
}): MemoryIntegrityReport {
  const notes: string[] = [];
  const integritySignalsPresent =
    opts.signals.criticalInventory.found ||
    opts.signals.integrityControl.found ||
    opts.signals.verification.found;

  if (!opts.memorySignals && !integritySignalsPresent && !opts.imported.found) {
    notes.push(
      "No critical-memory integrity signals — MEM-M4 may be NOT_APPLICABLE if no critical AI memory classes are designated.",
    );
  }
  if (opts.signals.integrityControl.found) {
    notes.push(
      `Integrity refs: ${opts.signals.integrityControl.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (inventory=${opts.imported.criticalClassesInventoried}, control=${opts.imported.integrityControlPresent}, verifyPct=${opts.imported.verificationSucceededPct}, coversAll=${opts.imported.coversAllCriticalClasses}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (integritySignalsPresent) {
    notes.push(
      "Integrity signals alone are PARTIAL — import critical-class inventory + 100% verification (measuredAt ≤90d) under imports/memory-integrity/ to PASS.",
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
    opts.imported.criticalClassesInventoried === true &&
    opts.imported.integrityControlPresent === true &&
    opts.imported.verificationSucceededPct === 100 &&
    opts.imported.coversAllCriticalClasses === true &&
    ageOk &&
    importFresh;

  let statusHint: MemoryIntegrityReport["summary"]["statusHint"];
  let memM4Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.criticalClassesInventoried === false ||
      opts.imported.integrityControlPresent === false ||
      opts.imported.coversAllCriticalClasses === false ||
      (opts.imported.verificationSucceededPct !== null &&
        opts.imported.verificationSucceededPct < 100) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > INVENTORY_MAX_AGE_DAYS));

  if (!opts.memorySignals && !integritySignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    memM4Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    memM4Satisfied = false;
    notes.push(
      "Imported evidence shows missing inventory/control, incomplete coverage, verification <100%, or evidence older than 90 days — MEM-M4 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    memM4Satisfied = true;
  } else if (integritySignalsPresent || opts.imported.found) {
    statusHint = "partial";
    memM4Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.criticalClassesInventoried !== true) {
        notes.push("Import must show criticalClassesInventoried=true.");
      }
      if (opts.imported.integrityControlPresent !== true) {
        notes.push("Import must show integrityControlPresent=true.");
      }
      if (opts.imported.verificationSucceededPct !== 100) {
        notes.push("Import must show verificationSucceededPct=100.");
      }
      if (opts.imported.coversAllCriticalClasses !== true) {
        notes.push("Import must show coversAllCriticalClasses=true.");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock MEM-M4 PASS.",
        );
      }
    }
  } else if (opts.memorySignals) {
    statusHint = "not_demonstrated";
    memM4Satisfied = null;
    notes.push(
      "Memory signals present but no critical-class integrity/signing controls found.",
    );
  } else {
    statusHint = "not_demonstrated";
    memM4Satisfied = null;
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
      integritySignalsPresent,
      memM4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const memoryIntegrityCollector: Collector = {
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
      INVENTORY_RE.test(text) ||
      INTEGRITY_RE.test(text);

    const inventoryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (INVENTORY_RE.test(path) || INVENTORY_RE.test(text)) &&
        inMem(path, text),
    );
    const integrityRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (INTEGRITY_RE.test(path) || INTEGRITY_RE.test(text)) &&
        inMem(path, text),
    );
    const verifyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (VERIFY_RE.test(path) || VERIFY_RE.test(text)) && inMem(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildMemoryIntegrityReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        criticalInventory: {
          found: inventoryRefs.length > 0,
          refs: inventoryRefs,
        },
        integrityControl: {
          found: integrityRefs.length > 0,
          refs: integrityRefs,
        },
        verification: { found: verifyRefs.length > 0, refs: verifyRefs },
      },
      memorySignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "memory-integrity-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/memory-integrity-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "memory-integrity",
          "mem-m4",
          DETECTOR_ID,
          ...(report.summary.integritySignalsPresent
            ? ["integrity-signals"]
            : []),
          ...(report.summary.memM4Satisfied ? ["mem-m4-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...integrityRefs.slice(0, 2),
        ...inventoryRefs.slice(0, 1),
        ...verifyRefs.slice(0, 1),
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
        signals: ["memory-integrity-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `MEM-M4 status=${report.summary.statusHint} integrity=${report.summary.integritySignalsPresent} satisfied=${report.summary.memM4Satisfied}; report=imports/${PLUGIN_ID}/memory-integrity-report.json`,
      nodes,
    };
  },
};
