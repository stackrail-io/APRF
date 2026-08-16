/**
 * prompt-model-version-retention — CHG-M1 / repo-prompt-model-version-retention.
 *
 * Discovers retention of prior prompt and/or model-pin versions and restore
 * dry-runs. PASS requires ≥N retained prior versions + immediate-prior restore
 * dry-run for each in-scope artifact type (prompts and/or modelPins), with
 * measuredAt ≤90d under imports/prompt-model-version-retention/.
 *
 * Prefer per-type import fields (`prompts` / `modelPins`, or
 * `artifactTypesInUse`). Legacy aggregate
 * `retainedPriorProductionVersions` + `immediatePriorRestoreDryRunPassed`
 * still unlock PASS when only one artifact type is in scope. When both types
 * are in scope, aggregate-only evidence is PARTIAL (not PASS).
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
  SCAN_EXTENSIONS,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "prompt-model-version-retention";
const RELATED = ["CHG-M1"] as const;
const DETECTOR_ID = "repo-prompt-model-version-retention";
const IMPORT_MAX_AGE_DAYS = 90;
const MIN_RETAINED = 2;

export type ArtifactKind = "prompts" | "modelPins";

const ARTIFACT_KINDS: ArtifactKind[] = ["prompts", "modelPins"];

const PROMPT_SIGNAL_RE =
  /\b(prompt|prompts|system[\s_-]*prompt|\.prompt\.)\b/i;
/** Pin/version indicators only — provider SDK names alone do not imply model pins. */
const MODEL_PIN_SIGNAL_RE =
  /\b(model[\s_-]*pin|model[\s_-]*version|pinned[\s_-]*model|pin[\s_-]*model|immutable[\s_-]*model[\s_-]*version)\b/i;

const RETENTION_RE =
  /\b(retain\w*[\s_-]*(prior|previous|n[\s_-]*version)|version[\s_-]*retention|prior[\s_-]*(production[\s_-]*)?version\w*|keep[\s_-]*last[\s_-]*\d+|min(?:imum)?[\s_-]*n\s*=?\s*\d+)\b/i;

const REGISTRY_RE =
  /\b(prompt[\s_-]*registry|model[\s_-]*registry|version[\s_-]*registry|pinned[\s_-]*(prompt|model)|immutable[\s_-]*version)\b/i;

const DRY_RUN_RE =
  /\b(restore[\s_-]*dry[\s_-]*run|dry[\s_-]*run[\s_-]*restore|immediate[\s_-]*prior|load[\s_-]*prior[\s_-]*version|staging[\s_-]*restore|prod[\s_-]*adjacent)\b/i;

export interface ArtifactTypeEvidence {
  inUse: boolean | null;
  retainedPriorProductionVersions: number | null;
  immediatePriorRestoreDryRunPassed: boolean | null;
}

function emptyArtifact(): ArtifactTypeEvidence {
  return {
    inUse: null,
    retainedPriorProductionVersions: null,
    immediatePriorRestoreDryRunPassed: null,
  };
}

export interface PromptModelVersionRetentionReport {
  schemaVersion: "0.3.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    retention: { found: boolean; refs: string[] };
    registry: { found: boolean; refs: string[] };
    dryRun: { found: boolean; refs: string[] };
    promptsPresent: boolean;
    modelPinsPresent: boolean;
  };
  importedResults: {
    found: boolean;
    /** @deprecated Prefer byArtifact when both types are in scope. */
    retainedPriorProductionVersions: number | null;
    policyMinimumN: number | null;
    /** @deprecated Prefer byArtifact when both types are in scope. */
    immediatePriorRestoreDryRunPassed: boolean | null;
    artifactTypesInUse: ArtifactKind[] | null;
    byArtifact: Record<ArtifactKind, ArtifactTypeEvidence>;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiVersionSignalsPresent: boolean;
    retentionSignalsPresent: boolean;
    inScopeArtifactTypes: ArtifactKind[];
    perArtifactSatisfied: Record<ArtifactKind, boolean | null>;
    chgM1Satisfied: boolean | null;
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

function asArtifactKind(v: unknown): ArtifactKind | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s === "prompts" || s === "prompt") return "prompts";
  if (
    s === "modelpins" ||
    s === "model_pins" ||
    s === "model-pins" ||
    s === "modelpin" ||
    s === "pins"
  ) {
    return "modelPins";
  }
  return null;
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
    extensions: [...SCAN_EXTENSIONS],
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

function detectArtifactSignals(
  targetPath: string,
  maxFiles: number,
): { promptsPresent: boolean; modelPinsPresent: boolean } {
  const files = walkFiles(targetPath, {
    maxFiles: Math.min(maxFiles, 2000),
    extensions: [...SCAN_EXTENSIONS],
  });
  let promptsPresent = false;
  let modelPinsPresent = false;
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 80_000) || "";
    if (!promptsPresent && (PROMPT_SIGNAL_RE.test(r) || PROMPT_SIGNAL_RE.test(text))) {
      promptsPresent = true;
    }
    if (
      !modelPinsPresent &&
      (MODEL_PIN_SIGNAL_RE.test(r) || MODEL_PIN_SIGNAL_RE.test(text))
    ) {
      modelPinsPresent = true;
    }
    if (promptsPresent && modelPinsPresent) break;
  }
  return { promptsPresent, modelPinsPresent };
}

function parseArtifactBlock(
  raw: unknown,
  fallback: ArtifactTypeEvidence,
): ArtifactTypeEvidence {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const data = raw as Record<string, unknown>;
  return {
    inUse:
      asBool(data.inUse) ??
      asBool(data.in_use) ??
      asBool(data.present) ??
      fallback.inUse,
    retainedPriorProductionVersions:
      asNum(data.retainedPriorProductionVersions) ??
      asNum(data.retained_prior_production_versions) ??
      asNum(data.priorVersionsRetained) ??
      fallback.retainedPriorProductionVersions,
    immediatePriorRestoreDryRunPassed:
      asBool(data.immediatePriorRestoreDryRunPassed) ??
      asBool(data.immediate_prior_restore_dry_run_passed) ??
      asBool(data.restoreDryRunPassed) ??
      fallback.immediatePriorRestoreDryRunPassed,
  };
}

function loadImported(
  ctx: CollectorContext,
): PromptModelVersionRetentionReport["importedResults"] {
  const sources: string[] = [];
  let retainedPriorProductionVersions: number | null = null;
  let policyMinimumN: number | null = null;
  let immediatePriorRestoreDryRunPassed: boolean | null = null;
  let artifactTypesInUse: ArtifactKind[] | null = null;
  const byArtifact: Record<ArtifactKind, ArtifactTypeEvidence> = {
    prompts: emptyArtifact(),
    modelPins: emptyArtifact(),
  };
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/prompt-model-version-retention-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      retainedPriorProductionVersions =
        asNum(data.retainedPriorProductionVersions) ??
        asNum(data.retained_prior_production_versions) ??
        asNum(data.priorVersionsRetained) ??
        retainedPriorProductionVersions;
      policyMinimumN =
        asNum(data.policyMinimumN) ??
        asNum(data.policy_minimum_n) ??
        asNum(data.minimumN) ??
        policyMinimumN;
      immediatePriorRestoreDryRunPassed =
        asBool(data.immediatePriorRestoreDryRunPassed) ??
        asBool(data.immediate_prior_restore_dry_run_passed) ??
        asBool(data.restoreDryRunPassed) ??
        immediatePriorRestoreDryRunPassed;

      if (asBool(data.meetsMinimumRetention) === true) {
        retainedPriorProductionVersions =
          retainedPriorProductionVersions ?? MIN_RETAINED;
      }

      const listed = data.artifactTypesInUse ?? data.artifact_types_in_use;
      if (Array.isArray(listed)) {
        const kinds = listed
          .map(asArtifactKind)
          .filter((k): k is ArtifactKind => k !== null);
        if (kinds.length) artifactTypesInUse = [...new Set(kinds)];
      }

      byArtifact.prompts = parseArtifactBlock(
        data.prompts ?? data.prompt,
        byArtifact.prompts,
      );
      byArtifact.modelPins = parseArtifactBlock(
        data.modelPins ?? data.model_pins ?? data.modelPin,
        byArtifact.modelPins,
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    retainedPriorProductionVersions,
    policyMinimumN,
    immediatePriorRestoreDryRunPassed,
    artifactTypesInUse,
    byArtifact,
    ageDays,
    measuredAt,
    sources,
  };
}

function artifactHasExplicitEvidence(a: ArtifactTypeEvidence): boolean {
  // Explicit out-of-scope attestation must not put the type into scope.
  if (a.inUse === false) return false;
  return (
    a.retainedPriorProductionVersions !== null ||
    a.immediatePriorRestoreDryRunPassed !== null ||
    a.inUse === true
  );
}

function attestedNeitherInUse(
  imported: PromptModelVersionRetentionReport["importedResults"],
): boolean {
  return ARTIFACT_KINDS.every((k) => imported.byArtifact[k].inUse === false);
}

function resolveInScope(opts: {
  imported: PromptModelVersionRetentionReport["importedResults"];
  promptsPresent: boolean;
  modelPinsPresent: boolean;
}): ArtifactKind[] {
  const { imported, promptsPresent, modelPinsPresent } = opts;
  if (imported.artifactTypesInUse?.length) {
    return imported.artifactTypesInUse.filter(
      (k) => imported.byArtifact[k].inUse !== false,
    );
  }

  const fromInUse = ARTIFACT_KINDS.filter(
    (k) => imported.byArtifact[k].inUse === true,
  );
  if (fromInUse.length) return fromInUse;

  // Explicit negative attestation for both types → empty scope (N/A), do not infer.
  if (attestedNeitherInUse(imported)) {
    return [];
  }

  const fromExplicit = ARTIFACT_KINDS.filter((k) =>
    artifactHasExplicitEvidence(imported.byArtifact[k]),
  );
  if (fromExplicit.length) return fromExplicit;

  const inferred: ArtifactKind[] = [];
  if (promptsPresent && imported.byArtifact.prompts.inUse !== false) {
    inferred.push("prompts");
  }
  if (modelPinsPresent && imported.byArtifact.modelPins.inUse !== false) {
    inferred.push("modelPins");
  }
  return inferred;
}

function evidenceForKind(
  kind: ArtifactKind,
  imported: PromptModelVersionRetentionReport["importedResults"],
  inScope: ArtifactKind[],
): ArtifactTypeEvidence {
  const specific = imported.byArtifact[kind];
  const multiScope = inScope.length > 1;
  // When both types are in scope, aggregate fields must not cover either type.
  return {
    inUse: specific.inUse ?? true,
    retainedPriorProductionVersions:
      specific.retainedPriorProductionVersions ??
      (multiScope ? null : imported.retainedPriorProductionVersions),
    immediatePriorRestoreDryRunPassed:
      specific.immediatePriorRestoreDryRunPassed ??
      (multiScope ? null : imported.immediatePriorRestoreDryRunPassed),
  };
}

function evaluateArtifact(
  evidence: ArtifactTypeEvidence,
  requiredN: number,
): { ok: boolean; fail: boolean; missing: boolean } {
  const retained = evidence.retainedPriorProductionVersions;
  const dry = evidence.immediatePriorRestoreDryRunPassed;
  const fail =
    (retained !== null && retained < requiredN) || dry === false;
  const ok =
    retained !== null && retained >= requiredN && dry === true;
  const missing = !ok && !fail;
  return { ok, fail, missing };
}

export function buildPromptModelVersionRetentionReport(opts: {
  assessedAt: string;
  retention: { found: boolean; refs: string[] };
  registry: { found: boolean; refs: string[] };
  dryRun: { found: boolean; refs: string[] };
  promptsPresent: boolean;
  modelPinsPresent: boolean;
  imported: PromptModelVersionRetentionReport["importedResults"];
}): PromptModelVersionRetentionReport {
  const notes: string[] = [];
  const aiVersionSignals = opts.promptsPresent || opts.modelPinsPresent;
  const retentionSignalsPresent =
    opts.retention.found || opts.registry.found || opts.dryRun.found;

  if (!aiVersionSignals && !retentionSignalsPresent && !opts.imported.found) {
    notes.push(
      "No prompt/model-pin retention signals — CHG-M1 may be NOT_APPLICABLE if neither ships in production.",
    );
  }
  if (opts.retention.found) {
    notes.push(`Retention refs: ${opts.retention.refs.slice(0, 4).join(", ")}`);
  }
  if (opts.registry.found) {
    notes.push(`Registry refs: ${opts.registry.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.dryRun.found) {
    notes.push(`Dry-run refs: ${opts.dryRun.refs.slice(0, 3).join(", ")}`);
  }

  const requiredN = Math.max(
    MIN_RETAINED,
    opts.imported.policyMinimumN ?? MIN_RETAINED,
  );
  const inScope = resolveInScope({
    imported: opts.imported,
    promptsPresent: opts.promptsPresent,
    modelPinsPresent: opts.modelPinsPresent,
  });

  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (inScope=${inScope.join(",") || "none"}; aggregate retained=${opts.imported.retainedPriorProductionVersions}, dryRun=${opts.imported.immediatePriorRestoreDryRunPassed}; prompts=${JSON.stringify(opts.imported.byArtifact.prompts)}; modelPins=${JSON.stringify(opts.imported.byArtifact.modelPins)})`,
    );
  } else if (retentionSignalsPresent) {
    notes.push(
      "Retention signals alone are PARTIAL — import per in-scope artifact type (prompts and/or modelPins) with retainedPriorProductionVersions≥2 + immediatePriorRestoreDryRunPassed=true (measuredAt ≤90d) under imports/prompt-model-version-retention/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const ageFail =
    opts.imported.found &&
    opts.imported.ageDays !== null &&
    opts.imported.ageDays > IMPORT_MAX_AGE_DAYS;

  const perArtifactSatisfied: Record<ArtifactKind, boolean | null> = {
    prompts: null,
    modelPins: null,
  };

  let anyFail = ageFail;
  let anyMissing = false;
  let allOk = inScope.length > 0;

  for (const kind of ARTIFACT_KINDS) {
    if (!inScope.includes(kind)) {
      perArtifactSatisfied[kind] = null;
      continue;
    }
    const ev = evidenceForKind(kind, opts.imported, inScope);
    const result = evaluateArtifact(ev, requiredN);
    if (result.fail) {
      perArtifactSatisfied[kind] = false;
      anyFail = true;
      allOk = false;
      notes.push(
        `${kind}: fail — need retainedPriorProductionVersions≥${requiredN} and immediatePriorRestoreDryRunPassed=true (got retained=${ev.retainedPriorProductionVersions}, dryRun=${ev.immediatePriorRestoreDryRunPassed}).`,
      );
    } else if (result.ok) {
      perArtifactSatisfied[kind] = true;
    } else {
      perArtifactSatisfied[kind] = false;
      anyMissing = true;
      allOk = false;
      notes.push(
        `${kind}: missing per-type retention/restore evidence (required when this artifact type is in scope).`,
      );
    }
  }

  if (inScope.length > 1 && opts.imported.found) {
    const usedAggregateOnly =
      opts.imported.retainedPriorProductionVersions !== null &&
      !artifactHasExplicitEvidence(opts.imported.byArtifact.prompts) &&
      !artifactHasExplicitEvidence(opts.imported.byArtifact.modelPins);
    if (usedAggregateOnly) {
      notes.push(
        "Both prompts and model pins are in scope — provide per-type prompts{} and modelPins{} evidence; aggregate retainedPriorProductionVersions alone cannot PASS.",
      );
    }
  }

  let statusHint: PromptModelVersionRetentionReport["summary"]["statusHint"];
  let chgM1Satisfied: boolean | null = null;

  if (!aiVersionSignals && !retentionSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    chgM1Satisfied = null;
  } else if (inScope.length === 0 && attestedNeitherInUse(opts.imported)) {
    statusHint = "not_applicable";
    chgM1Satisfied = null;
    notes.push(
      "Import attests prompts.inUse=false and modelPins.inUse=false — CHG-M1 NOT_APPLICABLE.",
    );
  } else if (opts.imported.found && anyFail) {
    statusHint = "fail";
    chgM1Satisfied = false;
  } else if (
    inScope.length > 0 &&
    allOk &&
    ageOk &&
    importFresh &&
    (retentionSignalsPresent || opts.imported.found)
  ) {
    statusHint = "pass";
    chgM1Satisfied = true;
  } else if (retentionSignalsPresent || opts.imported.found || inScope.length) {
    statusHint = "partial";
    chgM1Satisfied = false;
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock CHG-M1 PASS.",
      );
    }
    if (anyMissing && inScope.length > 0) {
      notes.push(
        `Import must satisfy retainedPriorProductionVersions≥${requiredN} + immediatePriorRestoreDryRunPassed=true for each in-scope type: ${inScope.join(", ")}.`,
      );
    }
  } else if (aiVersionSignals) {
    statusHint = "not_demonstrated";
    chgM1Satisfied = null;
    notes.push(
      "Prompt/model signals present but no version retention or restore dry-run evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    chgM1Satisfied = null;
  }

  return {
    schemaVersion: "0.3.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      retention: opts.retention,
      registry: opts.registry,
      dryRun: opts.dryRun,
      promptsPresent: opts.promptsPresent,
      modelPinsPresent: opts.modelPinsPresent,
    },
    importedResults: opts.imported,
    summary: {
      aiVersionSignalsPresent: aiVersionSignals,
      retentionSignalsPresent,
      inScopeArtifactTypes: inScope,
      perArtifactSatisfied,
      chgM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const promptModelVersionRetentionCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const { promptsPresent, modelPinsPresent } = detectArtifactSignals(
      ctx.targetPath,
      maxFiles,
    );

    const retentionRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => RETENTION_RE.test(path) || RETENTION_RE.test(text),
      12,
    );
    const registryRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => REGISTRY_RE.test(path) || REGISTRY_RE.test(text),
      12,
    );
    const dryRunRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => DRY_RUN_RE.test(path) || DRY_RUN_RE.test(text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildPromptModelVersionRetentionReport({
      assessedAt: ctx.assessedAt.toISOString(),
      retention: { found: retentionRefs.length > 0, refs: retentionRefs },
      registry: { found: registryRefs.length > 0, refs: registryRefs },
      dryRun: { found: dryRunRefs.length > 0, refs: dryRunRefs },
      promptsPresent,
      modelPinsPresent,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "prompt-model-version-retention-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/prompt-model-version-retention-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "prompt-model-version-retention",
          "chg-m1",
          DETECTOR_ID,
          ...(report.summary.chgM1Satisfied ? ["chg-m1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.retention.refs,
        ...report.signals.registry.refs,
        ...report.signals.dryRun.refs,
      ]),
    ].slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["prompt-model-version-retention-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `CHG-M1 status=${report.summary.statusHint} inScope=${report.summary.inScopeArtifactTypes.join(",") || "none"} satisfied=${report.summary.chgM1Satisfied}; report=imports/${PLUGIN_ID}/prompt-model-version-retention-report.json`,
      nodes,
    };
  },
};
