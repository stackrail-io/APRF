/**
 * memory-write-policy — MEM-M3 / repo-memory-write-policy.
 *
 * Discovers durable/long-term memory write policies and deny tests.
 * Import deny-suite evidence under imports/memory-write-policy/ to unlock PASS.
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

const PLUGIN_ID = "memory-write-policy";
const RELATED = ["MEM-M3"] as const;
const DETECTOR_ID = "repo-memory-write-policy";
const INVENTORY_MAX_AGE_DAYS = 90;

const MEMORY_PATH_RE =
  /(memory|memories|durable|long[\s_-]*term|vector|embedding|retriev|conversation[\s_-]*store)/i;

const POLICY_RE =
  /\b(write[\s_-]*policy|allowed[\s_-]*writer|memory[\s_-]*writer|content[\s_-]*class|who[\s_-]*may[\s_-]*write|durable[\s_-]*memory[\s_-]*policy|write[\s_-]*allowlist)\b/i;

const ENFORCE_RE =
  /\b(write[\s_-]*gate|memory[\s_-]*middleware|deny[\s_-]*write|authorize[\s_-]*write|validate[\s_-]*writer|before[\s_-]*write|write[\s_-]*guard)\b/i;

const DENY_TEST_RE =
  /\b(unauthorized[\s_-]*writer|deny[\s_-]*write|write[\s_-]*denied|forbidden[\s_-]*write|assert.*(?:403|denied|unauthorized).*write|test_.*write.*polic)\b/i;

export interface MemoryWritePolicyReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    writePolicy: { found: boolean; refs: string[] };
    enforcement: { found: boolean; refs: string[] };
    denyTests: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    policyEnumeratesWritersAndContentClasses: boolean | null;
    enforcementPresent: boolean | null;
    unauthorizedWritersDeniedPct: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    writePolicySignalsPresent: boolean;
    memM3Satisfied: boolean | null;
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
): MemoryWritePolicyReport["importedResults"] {
  const sources: string[] = [];
  let policyEnumeratesWritersAndContentClasses: boolean | null = null;
  let enforcementPresent: boolean | null = null;
  let unauthorizedWritersDeniedPct: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/memory-write-policy-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      policyEnumeratesWritersAndContentClasses =
        asBool(data.policyEnumeratesWritersAndContentClasses) ??
        asBool(data.policyEnumeratesAllowedWritersAndContentClasses) ??
        asBool(data.policyComplete) ??
        policyEnumeratesWritersAndContentClasses;
      enforcementPresent =
        asBool(data.enforcementPresent) ??
        asBool(data.writePolicyEnforced) ??
        enforcementPresent;
      unauthorizedWritersDeniedPct =
        asNum(data.unauthorizedWritersDeniedPct) ??
        asNum(data.denyRatePct) ??
        asNum(data.unauthorizedDeniedPct) ??
        unauthorizedWritersDeniedPct;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      if (asBool(data.unauthorizedWritersDeniedAt100) === true) {
        unauthorizedWritersDeniedPct = unauthorizedWritersDeniedPct ?? 100;
      }
      if (asBool(data.memM3Complete) === true) {
        policyEnumeratesWritersAndContentClasses =
          policyEnumeratesWritersAndContentClasses ?? true;
        enforcementPresent = enforcementPresent ?? true;
        unauthorizedWritersDeniedPct = unauthorizedWritersDeniedPct ?? 100;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    policyEnumeratesWritersAndContentClasses,
    enforcementPresent,
    unauthorizedWritersDeniedPct,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildMemoryWritePolicyReport(opts: {
  assessedAt: string;
  signals: MemoryWritePolicyReport["signals"];
  durableMemorySignals: boolean;
  imported: MemoryWritePolicyReport["importedResults"];
}): MemoryWritePolicyReport {
  const notes: string[] = [];
  const writePolicySignalsPresent =
    opts.signals.writePolicy.found ||
    opts.signals.enforcement.found ||
    opts.signals.denyTests.found;

  if (
    !opts.durableMemorySignals &&
    !writePolicySignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No durable-memory write-policy signals — MEM-M3 may be NOT_APPLICABLE if there is no long-term/durable AI memory.",
    );
  }
  if (opts.signals.writePolicy.found) {
    notes.push(
      `Policy refs: ${opts.signals.writePolicy.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (policy=${opts.imported.policyEnumeratesWritersAndContentClasses}, enforce=${opts.imported.enforcementPresent}, denyPct=${opts.imported.unauthorizedWritersDeniedPct}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (writePolicySignalsPresent) {
    notes.push(
      "Write-policy signals alone are PARTIAL — import policy + 100% unauthorized deny tests (measuredAt ≤90d) under imports/memory-write-policy/ to PASS.",
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
    opts.imported.policyEnumeratesWritersAndContentClasses === true &&
    opts.imported.enforcementPresent === true &&
    opts.imported.unauthorizedWritersDeniedPct === 100 &&
    ageOk &&
    importFresh;

  let statusHint: MemoryWritePolicyReport["summary"]["statusHint"];
  let memM3Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.policyEnumeratesWritersAndContentClasses === false ||
      opts.imported.enforcementPresent === false ||
      (opts.imported.unauthorizedWritersDeniedPct !== null &&
        opts.imported.unauthorizedWritersDeniedPct < 100) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > INVENTORY_MAX_AGE_DAYS));

  if (
    !opts.durableMemorySignals &&
    !writePolicySignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    memM3Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    memM3Satisfied = false;
    notes.push(
      "Imported evidence shows incomplete write policy, missing enforcement, deny rate <100%, or evidence older than 90 days — MEM-M3 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    memM3Satisfied = true;
  } else if (writePolicySignalsPresent || opts.imported.found) {
    statusHint = "partial";
    memM3Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.policyEnumeratesWritersAndContentClasses !== true) {
        notes.push(
          "Import must show policyEnumeratesWritersAndContentClasses=true.",
        );
      }
      if (opts.imported.enforcementPresent !== true) {
        notes.push("Import must show enforcementPresent=true.");
      }
      if (opts.imported.unauthorizedWritersDeniedPct !== 100) {
        notes.push("Import must show unauthorizedWritersDeniedPct=100.");
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock MEM-M3 PASS.",
        );
      }
    }
  } else if (opts.durableMemorySignals) {
    statusHint = "not_demonstrated";
    memM3Satisfied = null;
    notes.push(
      "Durable-memory signals present but no write policy or deny tests found.",
    );
  } else {
    statusHint = "not_demonstrated";
    memM3Satisfied = null;
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
      writePolicySignalsPresent,
      memM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const memoryWritePolicyCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const durableMemorySignals =
      collectRefs(
        ctx.targetPath,
        Math.min(maxFiles, 2000),
        (path, text) =>
          MEMORY_PATH_RE.test(path) ||
          MEMORY_PATH_RE.test(text) ||
          /\b(durable[\s_-]*memory|long[\s_-]*term[\s_-]*memory)\b/i.test(text),
        5,
      ).length > 0;

    const inMem = (path: string, text: string) =>
      MEMORY_PATH_RE.test(path) ||
      MEMORY_PATH_RE.test(text) ||
      POLICY_RE.test(text);

    const policyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (POLICY_RE.test(path) || POLICY_RE.test(text)) && inMem(path, text),
    );
    const enforceRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (ENFORCE_RE.test(path) || ENFORCE_RE.test(text)) && inMem(path, text),
    );
    const denyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (DENY_TEST_RE.test(path) || DENY_TEST_RE.test(text)) &&
        inMem(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildMemoryWritePolicyReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        writePolicy: { found: policyRefs.length > 0, refs: policyRefs },
        enforcement: { found: enforceRefs.length > 0, refs: enforceRefs },
        denyTests: { found: denyRefs.length > 0, refs: denyRefs },
      },
      durableMemorySignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "memory-write-policy-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/memory-write-policy-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "memory-write-policy",
          "mem-m3",
          DETECTOR_ID,
          ...(report.summary.writePolicySignalsPresent
            ? ["write-policy-signals"]
            : []),
          ...(report.summary.memM3Satisfied ? ["mem-m3-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...policyRefs.slice(0, 2),
        ...enforceRefs.slice(0, 1),
        ...denyRefs.slice(0, 1),
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
        signals: ["memory-write-policy-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `MEM-M3 status=${report.summary.statusHint} writePolicy=${report.summary.writePolicySignalsPresent} satisfied=${report.summary.memM3Satisfied}; report=imports/${PLUGIN_ID}/memory-write-policy-report.json`,
      nodes,
    };
  },
};
