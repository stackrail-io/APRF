/**
 * memory-poisoning-evals — MEM-R1 / repo-memory-poisoning-evals.
 *
 * Discovers memory-poisoning scenarios in eval/adversarial suites.
 * Import suite run evidence under imports/memory-poisoning-evals/ to unlock PASS.
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

const PLUGIN_ID = "memory-poisoning-evals";
const RELATED = ["MEM-R1"] as const;
const DETECTOR_ID = "repo-memory-poisoning-evals";
const INVENTORY_MAX_AGE_DAYS = 90;
const MIN_SCENARIOS = 5;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const MEMORY_PATH_RE =
  /(memory|memories|poison|vector|embedding|retriev|adversarial|redteam|promptfoo|eval)/i;

const POISON_RE =
  /\b(memory[\s_-]*poison|poison(?:ing)?[\s_-]*memory|prompt[\s_-]*in[\s_-]*memory|stale[\s_-]*trusted[\s_-]*fact|cross[\s_-]*tenant[\s_-]*write|poison(?:ed)?[\s_-]*(?:vector|embedding|fact))\b/i;

const SUITE_RE =
  /\b(eval[\s_-]*suite|adversarial[\s_-]*eval|red[\s_-]*team|promptfoo|poison(?:ing)?[\s_-]*(?:case|scenario|test))\b/i;

const GATE_RE =
  /\b(fail[\s_-]*closed|block[\s_-]*promot|gate[\s_-]*fail|risk[\s_-]*accept|waiver|critical[\s_-]*fail)\b/i;

export interface MemoryPoisoningEvalsReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    poisoningCases: { found: boolean; refs: string[] };
    suiteConfig: { found: boolean; refs: string[] };
    gateOrAcceptance: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    poisoningScenarioCount: number | null;
    coversCrossTenantWrite: boolean | null;
    coversPromptInMemory: boolean | null;
    coversStaleTrustedFact: boolean | null;
    criticalFailsBlockedOrRiskAccepted: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    poisoningSignalsPresent: boolean;
    memR1Satisfied: boolean | null;
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

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function loadImported(
  ctx: CollectorContext,
): MemoryPoisoningEvalsReport["importedResults"] {
  const sources: string[] = [];
  let poisoningScenarioCount: number | null = null;
  let coversCrossTenantWrite: boolean | null = null;
  let coversPromptInMemory: boolean | null = null;
  let coversStaleTrustedFact: boolean | null = null;
  let criticalFailsBlockedOrRiskAccepted: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/memory-poisoning-evals-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      poisoningScenarioCount =
        asNum(data.poisoningScenarioCount) ??
        asNum(data.scenarioCount) ??
        asNum(data.caseCount) ??
        poisoningScenarioCount;
      coversCrossTenantWrite =
        asBool(data.coversCrossTenantWrite) ??
        asBool(data.crossTenantWrite) ??
        coversCrossTenantWrite;
      coversPromptInMemory =
        asBool(data.coversPromptInMemory) ??
        asBool(data.promptInMemory) ??
        coversPromptInMemory;
      coversStaleTrustedFact =
        asBool(data.coversStaleTrustedFact) ??
        asBool(data.staleTrustedFact) ??
        coversStaleTrustedFact;
      criticalFailsBlockedOrRiskAccepted =
        asBool(data.criticalFailsBlockedOrRiskAccepted) ??
        asBool(data.criticalFailsGated) ??
        criticalFailsBlockedOrRiskAccepted;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const cases = (data.cases as unknown[]) || (data.scenarios as unknown[]);
      if (Array.isArray(cases) && cases.length > 0) {
        poisoningScenarioCount = poisoningScenarioCount ?? cases.length;
        for (const c of cases) {
          if (!c || typeof c !== "object") continue;
          const row = c as Record<string, unknown>;
          const blob = `${row.id || ""} ${row.name || ""} ${row.type || ""}`.toLowerCase();
          if (/cross[_-]?tenant/.test(blob)) coversCrossTenantWrite = true;
          if (/prompt[_-]?in[_-]?memory|prompt.?memory/.test(blob)) {
            coversPromptInMemory = true;
          }
          if (/stale/.test(blob) && /trust|fact/.test(blob)) {
            coversStaleTrustedFact = true;
          }
        }
      }

      if (asBool(data.memR1Complete) === true) {
        poisoningScenarioCount = poisoningScenarioCount ?? MIN_SCENARIOS;
        coversCrossTenantWrite = coversCrossTenantWrite ?? true;
        coversPromptInMemory = coversPromptInMemory ?? true;
        coversStaleTrustedFact = coversStaleTrustedFact ?? true;
        criticalFailsBlockedOrRiskAccepted =
          criticalFailsBlockedOrRiskAccepted ?? true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    poisoningScenarioCount,
    coversCrossTenantWrite,
    coversPromptInMemory,
    coversStaleTrustedFact,
    criticalFailsBlockedOrRiskAccepted,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildMemoryPoisoningEvalsReport(opts: {
  assessedAt: string;
  signals: MemoryPoisoningEvalsReport["signals"];
  memoryOrEvalSignals: boolean;
  imported: MemoryPoisoningEvalsReport["importedResults"];
}): MemoryPoisoningEvalsReport {
  const notes: string[] = [];
  const poisoningSignalsPresent =
    opts.signals.poisoningCases.found || opts.signals.suiteConfig.found;

  if (
    !opts.memoryOrEvalSignals &&
    !poisoningSignalsPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No memory-poisoning eval signals — MEM-R1 may be NOT_APPLICABLE if there is no AI memory surface to poison.",
    );
  }
  if (opts.signals.poisoningCases.found) {
    notes.push(
      `Poisoning refs: ${opts.signals.poisoningCases.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (count=${opts.imported.poisoningScenarioCount}, xtenant=${opts.imported.coversCrossTenantWrite}, promptMem=${opts.imported.coversPromptInMemory}, stale=${opts.imported.coversStaleTrustedFact}, gated=${opts.imported.criticalFailsBlockedOrRiskAccepted}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (poisoningSignalsPresent) {
    notes.push(
      "Poisoning signals alone are PARTIAL — import ≥5-scenario suite run (measuredAt ≤90d) under imports/memory-poisoning-evals/ to PASS.",
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
  const countOk =
    opts.imported.poisoningScenarioCount !== null &&
    opts.imported.poisoningScenarioCount >= MIN_SCENARIOS;
  const typesOk =
    opts.imported.coversCrossTenantWrite === true &&
    opts.imported.coversPromptInMemory === true &&
    opts.imported.coversStaleTrustedFact === true;
  const passOk =
    countOk &&
    typesOk &&
    opts.imported.criticalFailsBlockedOrRiskAccepted === true &&
    ageOk &&
    importFresh;

  let statusHint: MemoryPoisoningEvalsReport["summary"]["statusHint"] =
    "not_demonstrated";
  let memR1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    ((opts.imported.poisoningScenarioCount !== null &&
      opts.imported.poisoningScenarioCount < MIN_SCENARIOS) ||
      opts.imported.coversCrossTenantWrite === false ||
      opts.imported.coversPromptInMemory === false ||
      opts.imported.coversStaleTrustedFact === false ||
      opts.imported.criticalFailsBlockedOrRiskAccepted === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > INVENTORY_MAX_AGE_DAYS));

  if (
    !opts.memoryOrEvalSignals &&
    !poisoningSignalsPresent &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    memR1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    memR1Satisfied = false;
    notes.push(
      "Imported suite shows too few scenarios, missing required types, ungated critical fails, or evidence older than 90 days — MEM-R1 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    memR1Satisfied = true;
  } else if (poisoningSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    memR1Satisfied = false;
    if (opts.imported.found) {
      if (!countOk) {
        notes.push(`Import must show poisoningScenarioCount≥${MIN_SCENARIOS}.`);
      }
      if (!typesOk) {
        notes.push(
          "Import must show coversCrossTenantWrite, coversPromptInMemory, and coversStaleTrustedFact all true.",
        );
      }
      if (opts.imported.criticalFailsBlockedOrRiskAccepted !== true) {
        notes.push(
          "Import must show criticalFailsBlockedOrRiskAccepted=true.",
        );
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock MEM-R1 PASS.",
        );
      }
    }
  } else if (opts.memoryOrEvalSignals) {
    statusHint = "not_demonstrated";
    memR1Satisfied = null;
    notes.push(
      "Memory/eval signals present but no memory-poisoning scenarios found.",
    );
  } else {
    statusHint = "not_demonstrated";
    memR1Satisfied = null;
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
      poisoningSignalsPresent,
      memR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const memoryPoisoningEvalsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const memoryOrEvalSignals =
      collectRefs(
        ctx.targetPath,
        Math.min(maxFiles, 2000),
        (path, text) => MEMORY_PATH_RE.test(path) || MEMORY_PATH_RE.test(text),
        5,
      ).length > 0;

    const inCtx = (path: string, text: string) =>
      MEMORY_PATH_RE.test(path) ||
      MEMORY_PATH_RE.test(text) ||
      POISON_RE.test(text);

    const poisonRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (POISON_RE.test(path) || POISON_RE.test(text)) && inCtx(path, text),
    );
    const suiteRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SUITE_RE.test(path) || SUITE_RE.test(text)) &&
        (POISON_RE.test(text) || /memory/i.test(text)) &&
        inCtx(path, text),
    );
    const gateRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (GATE_RE.test(path) || GATE_RE.test(text)) &&
        (POISON_RE.test(text) || SUITE_RE.test(text)),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildMemoryPoisoningEvalsReport({
      assessedAt: ctx.assessedAt.toISOString(),
      signals: {
        poisoningCases: { found: poisonRefs.length > 0, refs: poisonRefs },
        suiteConfig: { found: suiteRefs.length > 0, refs: suiteRefs },
        gateOrAcceptance: { found: gateRefs.length > 0, refs: gateRefs },
      },
      memoryOrEvalSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "memory-poisoning-evals-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/memory-poisoning-evals-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "memory-poisoning-evals",
          "mem-r1",
          DETECTOR_ID,
          ...(report.summary.poisoningSignalsPresent
            ? ["poisoning-signals"]
            : []),
          ...(report.summary.memR1Satisfied ? ["mem-r1-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...poisonRefs.slice(0, 2),
      ...suiteRefs.slice(0, 1),
      ...gateRefs.slice(0, 1),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["memory-poisoning-evals-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `MEM-R1 status=${report.summary.statusHint} poisoning=${report.summary.poisoningSignalsPresent} satisfied=${report.summary.memR1Satisfied}; report=imports/${PLUGIN_ID}/memory-poisoning-evals-report.json`,
      nodes,
    };
  },
};
