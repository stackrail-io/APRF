/**
 * identity-propagation — AUTHN-M4 / repo-identity-propagation.
 *
 * Discovers identity-propagation design and subject-on-tool-call signals.
 * Import privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct=100 +
 * anonymousPrivilegedHops=0 under imports/identity-propagation/ to unlock
 * PASS (measuredAt ≤90d). Set toolsAgentsWorkflowsOrDelegatedActionsPresent=false
 * for N/A (non-agentic systems).
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
  mergeAndBool,
  mergeMaxNum,
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "identity-propagation";
const RELATED = ["AUTHN-M4"] as const;
const DETECTOR_ID = "repo-identity-propagation";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const DESIGN_RE =
  /\b(identity[_-]?propagat|subject[_-]?(propagat|binding|claim)|end[_-]?user[_-]?subject|delegated[_-]?(identity|credential)|token[_-]?exchange|on[_-]?behalf[_-]?of|auth[_-]?context[_-]?(propagat|forward))\b/i;

const TOOL_CHAIN_RE =
  /\b(tool[_-]?(call|chain|invok)|agent[_-]?(chain|hop|hand[_-]?off)|workflow[_-]?(step|hop)|mcp[_-]?(call|tool)|privileged[_-]?(tool|action|hop))\b/i;

const TRACE_RE =
  /\b(trace|span|otel|opentelemetry|langsmith|phoenix).{0,60}(subject|user[_-]?id|actor|principal|on[_-]?behalf)\b|\b(subject|user[_-]?id|actor|principal).{0,60}(tool[_-]?call|span|trace)\b/i;

const SAMPLE_RE =
  /\b(sample[_-]?(trace|review|harness)|privileged[_-]?hop[_-]?(review|sample)|identity[_-]?binding[_-]?(test|harness|suite))\b/i;

export interface IdentityPropagationReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    design: { found: boolean; refs: string[] };
    toolChain: { found: boolean; refs: string[] };
    traces: { found: boolean; refs: string[] };
    sample: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    toolsAgentsWorkflowsOrDelegatedActionsPresent: boolean | null;
    identityPropagationDesignDocumented: boolean | null;
    privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct: number | null;
    anonymousPrivilegedHops: number | null;
    sampleSize: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    authnM4Satisfied: boolean | null;
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
      ".yml",
      ".yaml",
      ".json",
      ".md",
      ".txt",
      ".ts",
      ".js",
      ".py",
      ".toml",
    ],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    const text = readText(f, 80_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function loadImported(
  ctx: CollectorContext,
): IdentityPropagationReport["importedResults"] {
  const sources: string[] = [];
  let toolsAgentsWorkflowsOrDelegatedActionsPresent: boolean | null = null;
  let identityPropagationDesignDocumented: boolean | null = null;
  let privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct:
    | number
    | null = null;
  let anonymousPrivilegedHops: number | null = null;
  let sampleSize: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/identity-propagation-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      ageDays = mergeMaxNum(
        ageDays,
        asNum(data.ageDays) ?? asNum(data.age_days),
      );
      toolsAgentsWorkflowsOrDelegatedActionsPresent = mergeOrBool(
        toolsAgentsWorkflowsOrDelegatedActionsPresent,
        asBool(data.toolsAgentsWorkflowsOrDelegatedActionsPresent) ??
          asBool(data.tools_agents_workflows_or_delegated_actions_present) ??
          asBool(data.hasToolsAgentsWorkflowsOrDelegatedActions) ??
          asBool(data.agenticSurfacesPresent),
      );
      identityPropagationDesignDocumented = mergeAndBool(
        identityPropagationDesignDocumented,
        asBool(data.identityPropagationDesignDocumented) ??
          asBool(data.identity_propagation_design_documented) ??
          asBool(data.designDocumented),
      );
      const scalarPct =
        asNum(
          data.privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct,
        ) ??
        asNum(
          data.privileged_tool_calls_with_end_user_or_documented_service_subject_pct,
        ) ??
        asNum(data.subjectBoundPrivilegedCallPct) ??
        asNum(data.subjectCoveragePct);
      const scalarAnon =
        asNum(data.anonymousPrivilegedHops) ??
        asNum(data.anonymous_privileged_hops) ??
        asNum(data.anonymousHops);
      const scalarSampleSize =
        asNum(data.sampleSize) ??
        asNum(data.sample_size) ??
        asNum(data.sampledPrivilegedCalls);

      const samples =
        (data.samples as Array<Record<string, unknown>>) ||
        (data.calls as Array<Record<string, unknown>>) ||
        [];
      if (samples.length) {
        // Samples are authoritative for this file — ignore co-located scalar
        // anon/pct/sampleSize so a stale scalar cannot beat sample evidence.
        const withSubject = samples.filter(
          (s) =>
            s.hasEndUserSubject === true ||
            s.hasDocumentedServiceSubject === true ||
            Boolean(s.subject) ||
            Boolean(s.userId) ||
            Boolean(s.actor),
        ).length;
        const anon = samples.filter(
          (s) =>
            s.anonymous === true ||
            s.anonymousPrivilegedHop === true ||
            (!s.subject &&
              !s.userId &&
              !s.actor &&
              s.hasEndUserSubject !== true &&
              s.hasDocumentedServiceSubject !== true),
        ).length;
        const pct = (withSubject / samples.length) * 100;
        privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct =
          mergeMinNum(
            privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct,
            pct,
          );
        anonymousPrivilegedHops = mergeMaxNum(anonymousPrivilegedHops, anon);
        sampleSize = mergeMaxNum(sampleSize, samples.length);
      } else {
        privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct =
          mergeMinNum(
            privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct,
            scalarPct,
          );
        anonymousPrivilegedHops = mergeMaxNum(
          anonymousPrivilegedHops,
          scalarAnon,
        );
        sampleSize = mergeMaxNum(sampleSize, scalarSampleSize);
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    toolsAgentsWorkflowsOrDelegatedActionsPresent,
    identityPropagationDesignDocumented,
    privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct,
    anonymousPrivilegedHops,
    sampleSize,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildIdentityPropagationReport(opts: {
  assessedAt: string;
  design: { found: boolean; refs: string[] };
  toolChain: { found: boolean; refs: string[] };
  traces: { found: boolean; refs: string[] };
  sample: { found: boolean; refs: string[] };
  imported: IdentityPropagationReport["importedResults"];
}): IdentityPropagationReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.design.found ||
    opts.toolChain.found ||
    opts.traces.found ||
    opts.sample.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No identity-propagation signals — AUTHN-M4 remains not demonstrated until design/sample evidence or an explicit N/A attest (toolsAgentsWorkflowsOrDelegatedActionsPresent=false) is imported.",
    );
  }
  if (opts.design.found) {
    notes.push(`Design refs: ${opts.design.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.toolChain.found) {
    notes.push(
      `Tool/agent/workflow refs: ${opts.toolChain.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.traces.found) {
    notes.push(`Trace/subject refs: ${opts.traces.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (agenticPresent=${opts.imported.toolsAgentsWorkflowsOrDelegatedActionsPresent}, design=${opts.imported.identityPropagationDesignDocumented}, subjectPct=${opts.imported.privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct}, anonHops=${opts.imported.anonymousPrivilegedHops}, sampleSize=${opts.imported.sampleSize}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import identityPropagationDesignDocumented=true + privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct=100 + anonymousPrivilegedHops=0 (measuredAt ≤90d) under imports/identity-propagation/ to PASS. Set toolsAgentsWorkflowsOrDelegatedActionsPresent=false for NOT_APPLICABLE.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const designOk =
    opts.imported.identityPropagationDesignDocumented === true ||
    opts.design.found;
  const subjectOk =
    opts.imported.privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct ===
    100;
  const anonOk = opts.imported.anonymousPrivilegedHops === 0;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
  );
  const scopeAbsent =
    opts.imported.toolsAgentsWorkflowsOrDelegatedActionsPresent === false;
  const scopePresent =
    opts.imported.toolsAgentsWorkflowsOrDelegatedActionsPresent === true;
  // Metrics alone with present=null cannot unlock PASS — need in-repo signals
  // or an explicit present=true attest.
  const surfaceOk = gateSignalsPresent || scopePresent;

  let statusHint: IdentityPropagationReport["summary"]["statusHint"];
  let authnM4Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !scopeAbsent &&
    ((opts.imported
      .privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct !== null &&
      opts.imported
        .privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct < 100) ||
      (opts.imported.anonymousPrivilegedHops !== null &&
        opts.imported.anonymousPrivilegedHops > 0) ||
      opts.imported.identityPropagationDesignDocumented === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (opts.imported.found && scopeAbsent) {
    statusHint = "not_applicable";
    authnM4Satisfied = null;
    notes.push(
      "Imported toolsAgentsWorkflowsOrDelegatedActionsPresent=false — AUTHN-M4 NOT_APPLICABLE (no agentic/tool/workflow surface).",
    );
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    authnM4Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    authnM4Satisfied = false;
    notes.push(
      "Imported evidence shows subject coverage <100%, anonymous privileged hops >0, missing design, or attest older than 90 days — AUTHN-M4 fail.",
    );
  } else if (
    surfaceOk &&
    designOk &&
    subjectOk &&
    anonOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    authnM4Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    authnM4Satisfied = false;
    if (opts.imported.found && !surfaceOk) {
      notes.push(
        "Import must set toolsAgentsWorkflowsOrDelegatedActionsPresent=true (or discover in-repo design/tool/trace signals) — coverage metrics alone without an attested surface cannot unlock PASS.",
      );
    }
    if (opts.imported.found && !designOk) {
      notes.push(
        "Import must show identityPropagationDesignDocumented=true (or discover design in-repo).",
      );
    }
    if (opts.imported.found && !subjectOk) {
      notes.push(
        "Import must show privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct=100.",
      );
    }
    if (opts.imported.found && !anonOk) {
      notes.push("Import must show anonymousPrivilegedHops=0.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock AUTHN-M4 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    authnM4Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      design: opts.design,
      toolChain: opts.toolChain,
      traces: opts.traces,
      sample: opts.sample,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      authnM4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const identityPropagationCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const designRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => DESIGN_RE.test(path) || DESIGN_RE.test(text),
      10,
    );
    const toolChainRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => TOOL_CHAIN_RE.test(path) || TOOL_CHAIN_RE.test(text),
      10,
    );
    const traceRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => TRACE_RE.test(path) || TRACE_RE.test(text),
      10,
    );
    const sampleRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SAMPLE_RE.test(path) || SAMPLE_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildIdentityPropagationReport({
      assessedAt: ctx.assessedAt.toISOString(),
      design: { found: designRefs.length > 0, refs: designRefs },
      toolChain: { found: toolChainRefs.length > 0, refs: toolChainRefs },
      traces: { found: traceRefs.length > 0, refs: traceRefs },
      sample: { found: sampleRefs.length > 0, refs: sampleRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "identity-propagation-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime",
        ref: `imports/${PLUGIN_ID}/identity-propagation-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "identity-propagation",
          "authn-m4",
          DETECTOR_ID,
          ...(report.summary.authnM4Satisfied ? ["authn-m4-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.design.refs,
        ...report.signals.toolChain.refs,
        ...report.signals.traces.refs,
        ...report.signals.sample.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["identity-propagation-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AUTHN-M4 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.authnM4Satisfied}; report=imports/${PLUGIN_ID}/identity-propagation-report.json`,
      nodes,
    };
  },
};
