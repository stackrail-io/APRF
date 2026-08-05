/**
 * memory-isolation — MEM-M1 / repo-memory-isolation.
 *
 * Discovers AI memory-store isolation and scores cross-tenant (and cross-user
 * where required) attack suites. Code filters alone are PARTIAL — PASS needs
 * ≥10 attack cases with 0 unauthorized successes and measuredAt ≤90 days.
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

const PLUGIN_ID = "memory-isolation";
const RELATED = ["MEM-M1"] as const;
const DETECTOR_ID = "repo-memory-isolation";
const MIN_ATTACK_CASES = 10;
const INVENTORY_MAX_AGE_DAYS = 90;

const MEMORY_PATH_RE =
  /(memory|memories|conversation|chat[\s_-]*history|vector|embedding|retriev|durable[\s_-]*mem|session[\s_-]*mem|rag)/i;

const ISOLATION_RE =
  /\b(tenant[_-]?id|org[_-]?id|workspace[_-]?id|user[_-]?id|cross[_-]?tenant|multi[_-]?tenant|isolat|access[_-]?grant)\b/i;

const CROSS_BOUNDARY_TEST_RE =
  /\b(cross[_-]?tenant|cross[_-]?user|tenant[_-]?isolat|other[_-]?user|another[_-]?user|user_a|user_b|attacker|unauthorized\s+(read|write|access)|memory\s+isolat)\b/i;

const TEST_FILE_RE =
  /(^|[/\\])(tests?|__tests__|spec)([/\\]|$)|[._-](test|spec)\.(py|ts|tsx|js|jsx|mjs|cjs)$/i;

export interface MemoryIsolationReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    memoryIsolationCode: { found: boolean; refs: string[] };
    memoryAttackTests: { found: boolean; refs: string[]; caseCount: number };
  };
  importedResults: {
    found: boolean;
    coversMemoryApis: boolean | null;
    crossUserRequired: boolean | null;
    crossUserCovered: boolean | null;
    attackCases: number | null;
    unauthorizedSuccesses: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    memorySignalsPresent: boolean;
    memM1Satisfied: boolean | null;
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
      ".md",
      ".txt",
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
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

function countTestCases(targetPath: string, maxFiles: number): {
  refs: string[];
  caseCount: number;
} {
  const refs: string[] = [];
  let caseCount = 0;
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 6000),
    extensions: [".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  });
  for (const f of files) {
    if (!TEST_FILE_RE.test(f)) continue;
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 200_000) || "";
    if (!MEMORY_PATH_RE.test(r) && !MEMORY_PATH_RE.test(text)) continue;
    if (!CROSS_BOUNDARY_TEST_RE.test(text) && !ISOLATION_RE.test(text)) continue;
    refs.push(r);
    const fnMatches =
      text.match(
        /(?:(?:async\s+)?def\s+(test_\w+)|(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`])/g,
      ) || [];
    caseCount += Math.max(fnMatches.length, 1);
    if (refs.length >= 12) break;
  }
  return { refs: refs.slice(0, 12), caseCount };
}

function loadImported(
  ctx: CollectorContext,
): MemoryIsolationReport["importedResults"] {
  const sources: string[] = [];
  let coversMemoryApis: boolean | null = null;
  let crossUserRequired: boolean | null = null;
  let crossUserCovered: boolean | null = null;
  let attackCases: number | null = null;
  let unauthorizedSuccesses: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/memory-isolation-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      coversMemoryApis =
        asBool(data.coversMemoryApis) ??
        asBool(data.coversInScopeMemoryApis) ??
        coversMemoryApis;
      crossUserRequired =
        asBool(data.crossUserRequired) ?? crossUserRequired;
      crossUserCovered =
        asBool(data.crossUserCovered) ??
        asBool(data.crossUserCasesPresent) ??
        crossUserCovered;
      attackCases =
        asNum(data.attackCases) ??
        asNum(data.caseCount) ??
        attackCases;
      unauthorizedSuccesses =
        asNum(data.unauthorizedSuccesses) ??
        asNum(data.unauthorizedSuccessCount) ??
        unauthorizedSuccesses;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const rawCases = (data.cases as unknown[]) || [];
      if (Array.isArray(rawCases) && rawCases.length > 0) {
        attackCases = attackCases ?? rawCases.length;
        let leaks = 0;
        for (const c of rawCases) {
          if (!c || typeof c !== "object") continue;
          const row = c as Record<string, unknown>;
          const result = String(row.result || row.status || "").toLowerCase();
          if (
            row.unauthorizedSuccess === true ||
            result === "leak" ||
            result === "fail" ||
            result === "breach"
          ) {
            leaks += 1;
          }
        }
        unauthorizedSuccesses = unauthorizedSuccesses ?? leaks;
      }

      if (asBool(data.memM1Complete) === true) {
        coversMemoryApis = coversMemoryApis ?? true;
        attackCases = attackCases ?? MIN_ATTACK_CASES;
        unauthorizedSuccesses = unauthorizedSuccesses ?? 0;
        if (crossUserRequired === true) {
          crossUserCovered = crossUserCovered ?? true;
        }
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    coversMemoryApis,
    crossUserRequired,
    crossUserCovered,
    attackCases,
    unauthorizedSuccesses,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildMemoryIsolationReport(opts: {
  assessedAt: string;
  signals: MemoryIsolationReport["signals"];
  memorySignals: boolean;
  imported: MemoryIsolationReport["importedResults"];
}): MemoryIsolationReport {
  const notes: string[] = [];
  const memorySignalsPresent =
    opts.signals.memoryIsolationCode.found ||
    opts.signals.memoryAttackTests.found ||
    opts.memorySignals;

  if (!memorySignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI memory isolation signals — MEM-M1 may be NOT_APPLICABLE if there is no tenant/user AI memory store.",
    );
  }
  if (opts.signals.memoryIsolationCode.found) {
    notes.push(
      `Isolation refs: ${opts.signals.memoryIsolationCode.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.signals.memoryAttackTests.found) {
    notes.push(
      `Memory attack-test refs: ${opts.signals.memoryAttackTests.refs.slice(0, 3).join(", ")} (~${opts.signals.memoryAttackTests.caseCount} fns)`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (covers=${opts.imported.coversMemoryApis}, cases=${opts.imported.attackCases}, leaks=${opts.imported.unauthorizedSuccesses}, crossUserRequired=${opts.imported.crossUserRequired}, crossUserCovered=${opts.imported.crossUserCovered}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (opts.signals.memoryIsolationCode.found) {
    notes.push(
      "Memory isolation code alone is PARTIAL — import ≥10 attack cases with 0 unauthorized successes under imports/memory-isolation/ to PASS.",
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
  const casesOk =
    opts.imported.attackCases !== null &&
    opts.imported.attackCases >= MIN_ATTACK_CASES;
  const clean =
    opts.imported.unauthorizedSuccesses !== null &&
    opts.imported.unauthorizedSuccesses === 0;
  const crossUserOk =
    opts.imported.crossUserRequired !== true ||
    opts.imported.crossUserCovered === true;
  const passOk =
    opts.imported.coversMemoryApis === true &&
    casesOk &&
    clean &&
    crossUserOk &&
    ageOk &&
    importFresh;

  let statusHint: MemoryIsolationReport["summary"]["statusHint"];
  let memM1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.coversMemoryApis === false ||
      (opts.imported.unauthorizedSuccesses !== null &&
        opts.imported.unauthorizedSuccesses > 0) ||
      (opts.imported.attackCases !== null &&
        opts.imported.attackCases < MIN_ATTACK_CASES) ||
      (opts.imported.crossUserRequired === true &&
        opts.imported.crossUserCovered === false) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > INVENTORY_MAX_AGE_DAYS));

  if (!memorySignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    memM1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    memM1Satisfied = false;
    notes.push(
      "Imported suite shows missing memory coverage, unauthorized successes, undersized suite, missing cross-user coverage, or evidence older than 90 days — MEM-M1 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    memM1Satisfied = true;
  } else if (
    opts.signals.memoryIsolationCode.found ||
    opts.signals.memoryAttackTests.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    memM1Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.coversMemoryApis !== true) {
        notes.push("Import must show coversMemoryApis=true.");
      }
      if (!casesOk) {
        notes.push(`Import must show attackCases≥${MIN_ATTACK_CASES}.`);
      }
      if (!clean) {
        notes.push("Import must show unauthorizedSuccesses=0.");
      }
      if (!crossUserOk) {
        notes.push(
          "Import marks crossUserRequired=true but crossUserCovered is not true.",
        );
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock MEM-M1 PASS.",
        );
      }
    }
  } else {
    statusHint = "not_demonstrated";
    memM1Satisfied = null;
    notes.push(
      "Memory path signals present but no tenant/user isolation on memory stores found.",
    );
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
      memorySignalsPresent,
      memM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const memoryIsolationCollector: Collector = {
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

    const isolationRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (MEMORY_PATH_RE.test(path) || MEMORY_PATH_RE.test(text)) &&
        ISOLATION_RE.test(text),
    );
    const tests = countTestCases(ctx.targetPath, maxFiles);

    const imported = loadImported(ctx);
    const report = buildMemoryIsolationReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        memoryIsolationCode: {
          found: isolationRefs.length > 0,
          refs: isolationRefs,
        },
        memoryAttackTests: {
          found: tests.refs.length > 0,
          refs: tests.refs,
          caseCount: tests.caseCount,
        },
      },
      memorySignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "memory-isolation-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/memory-isolation-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "memory-isolation",
          "mem-m1",
          DETECTOR_ID,
          ...(report.summary.memorySignalsPresent ? ["memory-signals"] : []),
          ...(report.summary.memM1Satisfied ? ["mem-m1-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...isolationRefs.slice(0, 2),
        ...tests.refs.slice(0, 2),
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
        signals: ["memory-isolation-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `MEM-M1 status=${report.summary.statusHint} memory=${report.summary.memorySignalsPresent} satisfied=${report.summary.memM1Satisfied}; report=imports/${PLUGIN_ID}/memory-isolation-report.json`,
      nodes,
    };
  },
};
