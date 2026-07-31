/**
 * Human-approval collectors — HUM-M1..M4, HUM-R1, HUM-R3.
 */
import type { Collector, CollectorContext } from "./types.ts";
import {
  asBool,
  asNum,
  basename,
  collectRefs,
  detectApprovalSignals,
  listImportFiles,
  measuredAtFresh,
  parseMeasuredAt,
  readText,
  writeReportAndNodes,
  type StatusHint,
} from "./lib/human-approval-common.ts";

function loadJsonImports(
  ctx: CollectorContext,
  pluginId: string,
  reportName: string,
): { sources: string[]; docs: Record<string, unknown>[] } {
  const sources: string[] = [];
  const docs: Record<string, unknown>[] = [];
  for (const f of listImportFiles(ctx.outputDir, pluginId)) {
    if (f.endsWith(reportName)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      docs.push(JSON.parse(text) as Record<string, unknown>);
      sources.push(basename(f));
    } catch {
      /* skip */
    }
  }
  return { sources, docs };
}

/** HUM-M1 */
export const humanApprovalGatesCollector: Collector = {
  id: "human-approval-gates",
  async collect(ctx: CollectorContext) {
    const PLUGIN_ID = "human-approval-gates";
    const RELATED = ["HUM-M1"] as const;
    const maxFiles = ctx.maxFiles ?? 8000;
    const signals = detectApprovalSignals(ctx.targetPath, maxFiles);
    const invRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) =>
        /\b(high[_-]?impact|action[_-]?inventory|gated[_-]?action|approval[_-]?class)\b/i.test(
          p + " " + t,
        ),
    );
    const gateRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) =>
        /\b(human[_-]?approval|approval[_-]?gate|requireApproval|hitl|approval[_-]?token)\b/i.test(
          p + " " + t,
        ),
    );
    const testRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) =>
        /(test|spec)/i.test(p) &&
        /\b(ungated|without[_-]?approval|approval[_-]?required|deny).{0,40}(high[_-]?impact|gated)?/i.test(
          t,
        ),
    );

    const { sources, docs } = loadJsonImports(
      ctx,
      PLUGIN_ID,
      "human-approval-gates-report.json",
    );
    let ungatedDenyRate: number | null = null;
    let classesGated: number | null = null;
    let inventoryComplete: boolean | null = null;
    let measuredAt: string | null = null;
    for (const d of docs) {
      measuredAt = parseMeasuredAt(d) ?? measuredAt;
      ungatedDenyRate =
        asNum(d.ungatedDenyRatePct) ?? asNum(d.denyRatePct) ?? ungatedDenyRate;
      classesGated = asNum(d.classesGated) ?? classesGated;
      inventoryComplete =
        asBool(d.inventoryComplete) ??
        asBool(d.coversAllHighImpactClasses) ??
        inventoryComplete;
      if (Array.isArray(d.results)) {
        const rows = d.results as Array<Record<string, unknown>>;
        const denied = rows.filter(
          (r) =>
            r.ungatedDenied === true ||
            r.denied === true ||
            String(r.status || "").toLowerCase() === "deny",
        ).length;
        if (rows.length) {
          ungatedDenyRate = (denied / rows.length) * 100;
          classesGated = rows.length;
        }
      }
    }

    const inventoryPresent = invRefs.length > 0;
    const gatesPresent = gateRefs.length > 0;
    const imported = sources.length > 0;
    const denyOk = ungatedDenyRate !== null && ungatedDenyRate >= 100;
    const completeOk = inventoryComplete === true;
    const fresh = measuredAtFresh(measuredAt);

    let statusHint: StatusHint = "not_demonstrated";
    let satisfied: boolean | null = null;
    const notes: string[] = [];
    if (!signals && !inventoryPresent && !gatesPresent && !imported) {
      statusHint = "not_applicable";
      notes.push("No high-impact / approval signals — HUM-M1 may be N/A.");
    } else if (imported && (ungatedDenyRate !== null && ungatedDenyRate < 100)) {
      statusHint = "fail";
      satisfied = false;
      notes.push("Imported ungated deny rate < 100% — HUM-M1 fail.");
    } else if (
      (inventoryPresent || gatesPresent) &&
      denyOk &&
      completeOk &&
      fresh
    ) {
      statusHint = "pass";
      satisfied = true;
    } else if (inventoryPresent || gatesPresent || testRefs.length || imported) {
      statusHint = "partial";
      satisfied = false;
      if (imported && !completeOk)
        notes.push("Import needs inventoryComplete/coversAllHighImpactClasses=true.");
      if (imported && !denyOk)
        notes.push("Import needs ungatedDenyRatePct=100 (or all results denied).");
      if (imported && !fresh)
        notes.push("Import needs fresh measuredAt (≤90d).");
    } else if (signals) {
      statusHint = "not_demonstrated";
      notes.push("Approval signals present but no inventory/gate artifacts.");
    }

    const report = {
      schemaVersion: "0.2.0",
      pluginId: PLUGIN_ID,
      relatedCheckIds: [...RELATED],
      assessedAt: ctx.assessedAt.toISOString(),
      inventory: { found: inventoryPresent, refs: invRefs },
      gates: { found: gatesPresent, refs: gateRefs },
      ungatedTests: { found: testRefs.length > 0, refs: testRefs },
      importedResults: {
        found: imported,
        ungatedDenyRatePct: ungatedDenyRate,
        classesGated,
        inventoryComplete,
        measuredAt,
        sources,
      },
      summary: {
        signalsPresent: signals,
        inventoryPresent,
        gatesPresent,
        humM1Satisfied: satisfied,
        statusHint,
      },
      notes,
    };

    return writeReportAndNodes({
      ctx,
      pluginId: PLUGIN_ID,
      related: RELATED,
      reportFile: "human-approval-gates-report.json",
      report,
      summary: report.summary,
      statusHint,
      satisfiedKey: "humM1Satisfied",
      satisfied,
      nodeClass: "policy",
      signals: [
        PLUGIN_ID,
        "hum-m1",
        "repo-human-approval-config",
        ...(satisfied ? ["hum-m1-satisfied"] : []),
      ],
      codeRefs: [...invRefs, ...gateRefs, ...testRefs],
      detail: `HUM-M1 status=${statusHint} inv=${inventoryPresent} gates=${gatesPresent} satisfied=${satisfied}`,
    });
  },
};

/** HUM-M2 */
export const humanApprovalAuditCollector: Collector = {
  id: "human-approval-audit",
  async collect(ctx: CollectorContext) {
    const PLUGIN_ID = "human-approval-audit";
    const RELATED = ["HUM-M2"] as const;
    const maxFiles = ctx.maxFiles ?? 8000;
    const signals = detectApprovalSignals(ctx.targetPath, maxFiles);
    const schemaRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) =>
        /\b(approval[_-]?(audit|log|event)|actor[_-]?id|approve[_-]?deny)\b/i.test(
          p + " " + t,
        ),
    );

    const { sources, docs } = loadJsonImports(
      ctx,
      PLUGIN_ID,
      "human-approval-audit-report.json",
    );
    let sampleCount: number | null = null;
    let completePct: number | null = null;
    let schemaOk: boolean | null = null;
    let measuredAt: string | null = null;
    for (const d of docs) {
      measuredAt = parseMeasuredAt(d) ?? measuredAt;
      schemaOk = asBool(d.schemaValidationPassed) ?? asBool(d.schemaOk) ?? schemaOk;
      sampleCount = asNum(d.sampleCount) ?? sampleCount;
      completePct =
        asNum(d.requiredFieldsCompletePct) ?? asNum(d.completePct) ?? completePct;
      const samples = Array.isArray(d.samples)
        ? (d.samples as Array<Record<string, unknown>>)
        : Array.isArray(d.records)
          ? (d.records as Array<Record<string, unknown>>)
          : [];
      if (samples.length) {
        sampleCount = samples.length;
        const ok = samples.filter(
          (s) =>
            !!(s.actorId || s.actor || s.approver) &&
            !!(s.context || s.actionContext || s.action) &&
            !!(s.outcome || s.decision),
        ).length;
        completePct = (ok / samples.length) * 100;
      }
    }

    const schemaPresent = schemaRefs.length > 0;
    const imported = sources.length > 0;
    const fieldsOk = completePct !== null && completePct >= 100;
    const fresh = measuredAtFresh(measuredAt);

    let statusHint: StatusHint = "not_demonstrated";
    let satisfied: boolean | null = null;
    const notes: string[] = [];
    if (!signals && !schemaPresent && !imported) {
      statusHint = "not_applicable";
    } else if (imported && completePct !== null && completePct < 100) {
      statusHint = "fail";
      satisfied = false;
      notes.push("Sampled approvals missing required fields — HUM-M2 fail.");
    } else if (
      schemaPresent &&
      fieldsOk &&
      schemaOk !== false &&
      fresh &&
      (sampleCount === null || sampleCount > 0)
    ) {
      statusHint = "pass";
      satisfied = true;
    } else if (schemaPresent || imported) {
      statusHint = "partial";
      satisfied = false;
      if (imported && schemaOk === null && !fieldsOk)
        notes.push("Import needs samples with actor/context/outcome at 100%.");
      if (imported && !fresh) notes.push("Import needs fresh measuredAt (≤90d).");
    } else if (signals) statusHint = "not_demonstrated";

    const report = {
      schemaVersion: "0.2.0",
      pluginId: PLUGIN_ID,
      relatedCheckIds: [...RELATED],
      assessedAt: ctx.assessedAt.toISOString(),
      schema: { found: schemaPresent, refs: schemaRefs },
      importedResults: {
        found: imported,
        sampleCount,
        requiredFieldsCompletePct: completePct,
        schemaValidationPassed: schemaOk,
        measuredAt,
        sources,
      },
      summary: {
        signalsPresent: signals,
        schemaPresent,
        humM2Satisfied: satisfied,
        statusHint,
      },
      notes,
    };

    return writeReportAndNodes({
      ctx,
      pluginId: PLUGIN_ID,
      related: RELATED,
      reportFile: "human-approval-audit-report.json",
      report,
      summary: report.summary,
      statusHint,
      satisfiedKey: "humM2Satisfied",
      satisfied,
      nodeClass: "runtime",
      signals: [PLUGIN_ID, "hum-m2", "repo-approval-audit-log"],
      codeRefs: schemaRefs,
      detail: `HUM-M2 status=${statusHint} schema=${schemaPresent} satisfied=${satisfied}`,
    });
  },
};

/** HUM-M3 */
export const humanApprovalBypassCollector: Collector = {
  id: "human-approval-bypass",
  async collect(ctx: CollectorContext) {
    const PLUGIN_ID = "human-approval-bypass";
    const RELATED = ["HUM-M3"] as const;
    const maxFiles = ctx.maxFiles ?? 8000;
    const signals = detectApprovalSignals(ctx.targetPath, maxFiles);
    const bypassRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) =>
        /\b(bypass|alternate[_-]?path|ungated|without[_-]?approval).{0,60}(api|agent|job|ui)?/i.test(
          p + " " + t,
        ) && /(test|spec|threat|bypass)/i.test(p + t),
    );

    const { sources, docs } = loadJsonImports(
      ctx,
      PLUGIN_ID,
      "human-approval-bypass-report.json",
    );
    let ungatedSuccesses: number | null = null;
    let pathsCovered: number | null = null;
    let measuredAt: string | null = null;
    for (const d of docs) {
      measuredAt = parseMeasuredAt(d) ?? measuredAt;
      ungatedSuccesses =
        asNum(d.ungatedSuccessCount) ?? asNum(d.successfulBypasses) ?? ungatedSuccesses;
      pathsCovered = asNum(d.pathsCovered) ?? pathsCovered;
      const cases = Array.isArray(d.cases)
        ? (d.cases as Array<Record<string, unknown>>)
        : Array.isArray(d.results)
          ? (d.results as Array<Record<string, unknown>>)
          : [];
      if (cases.length) {
        pathsCovered = cases.length;
        ungatedSuccesses = cases.filter(
          (c) =>
            c.ungatedSucceeded === true ||
            c.bypassed === true ||
            String(c.result || "").toLowerCase() === "success",
        ).length;
      }
    }

    const testsPresent = bypassRefs.length > 0;
    const imported = sources.length > 0;
    const zeroBypass = ungatedSuccesses === 0;
    const fresh = measuredAtFresh(measuredAt);

    let statusHint: StatusHint = "not_demonstrated";
    let satisfied: boolean | null = null;
    const notes: string[] = [];
    if (!signals && !testsPresent && !imported) statusHint = "not_applicable";
    else if (imported && ungatedSuccesses !== null && ungatedSuccesses > 0) {
      statusHint = "fail";
      satisfied = false;
      notes.push("Bypass suite had successful ungated executions — HUM-M3 fail.");
    } else if ((testsPresent || imported) && zeroBypass && fresh && imported) {
      statusHint = "pass";
      satisfied = true;
    } else if (testsPresent || imported) {
      statusHint = "partial";
      satisfied = false;
      if (imported && !zeroBypass)
        notes.push("Import needs ungatedSuccessCount=0.");
      if (imported && !fresh) notes.push("Import needs fresh measuredAt (≤90d).");
    } else if (signals) statusHint = "not_demonstrated";

    const report = {
      schemaVersion: "0.2.0",
      pluginId: PLUGIN_ID,
      relatedCheckIds: [...RELATED],
      assessedAt: ctx.assessedAt.toISOString(),
      bypassTests: { found: testsPresent, refs: bypassRefs },
      importedResults: {
        found: imported,
        ungatedSuccessCount: ungatedSuccesses,
        pathsCovered,
        measuredAt,
        sources,
      },
      summary: {
        signalsPresent: signals,
        bypassTestsPresent: testsPresent,
        humM3Satisfied: satisfied,
        statusHint,
      },
      notes,
    };

    return writeReportAndNodes({
      ctx,
      pluginId: PLUGIN_ID,
      related: RELATED,
      reportFile: "human-approval-bypass-report.json",
      report,
      summary: report.summary,
      statusHint,
      satisfiedKey: "humM3Satisfied",
      satisfied,
      nodeClass: "policy",
      signals: [PLUGIN_ID, "hum-m3", "repo-approval-bypass-tests"],
      codeRefs: bypassRefs,
      detail: `HUM-M3 status=${statusHint} tests=${testsPresent} satisfied=${satisfied}`,
    });
  },
};

/** HUM-M4 */
export const humanDualControlCollector: Collector = {
  id: "human-dual-control",
  async collect(ctx: CollectorContext) {
    const PLUGIN_ID = "human-dual-control";
    const RELATED = ["HUM-M4"] as const;
    const maxFiles = ctx.maxFiles ?? 8000;
    const signals = detectApprovalSignals(ctx.targetPath, maxFiles);
    const dualRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) =>
        /\b(dual[_-]?control|four[_-]?eyes|two[_-]?person|second[_-]?approver|maker[_-]?checker)\b/i.test(
          p + " " + t,
        ),
    );

    const { sources, docs } = loadJsonImports(
      ctx,
      PLUGIN_ID,
      "human-dual-control-report.json",
    );
    let dualPct: number | null = null;
    let singleApproverCount: number | null = null;
    let inventoryPresentImport: boolean | null = null;
    let measuredAt: string | null = null;
    for (const d of docs) {
      measuredAt = parseMeasuredAt(d) ?? measuredAt;
      dualPct = asNum(d.dualApprovalPct) ?? dualPct;
      singleApproverCount =
        asNum(d.singleApproverCount) ?? singleApproverCount;
      inventoryPresentImport =
        asBool(d.irreversibleInventoryPresent) ?? inventoryPresentImport;
      const samples = Array.isArray(d.samples)
        ? (d.samples as Array<Record<string, unknown>>)
        : [];
      if (samples.length) {
        const dual = samples.filter(
          (s) =>
            s.dualApproval === true ||
            (Array.isArray(s.approvers) && (s.approvers as unknown[]).length >= 2),
        ).length;
        dualPct = (dual / samples.length) * 100;
        singleApproverCount = samples.length - dual;
      }
    }

    const dualPresent = dualRefs.length > 0;
    const imported = sources.length > 0;
    const dualOk = dualPct !== null && dualPct >= 100;
    const noSingle = singleApproverCount === 0;
    const fresh = measuredAtFresh(measuredAt);

    let statusHint: StatusHint = "not_demonstrated";
    let satisfied: boolean | null = null;
    const notes: string[] = [];
    // Level 5 check — still emit N/A only when no dual-control / approval signals
    if (!signals && !dualPresent && !imported) statusHint = "not_applicable";
    else if (
      imported &&
      ((dualPct !== null && dualPct < 100) ||
        (singleApproverCount !== null && singleApproverCount > 0))
    ) {
      statusHint = "fail";
      satisfied = false;
      notes.push("Dual-control samples incomplete or single-approver present — HUM-M4 fail.");
    } else if (
      dualPresent &&
      dualOk &&
      noSingle &&
      inventoryPresentImport !== false &&
      fresh &&
      imported
    ) {
      statusHint = "pass";
      satisfied = true;
    } else if (dualPresent || imported) {
      statusHint = "partial";
      satisfied = false;
      if (imported && !fresh) notes.push("Import needs fresh measuredAt (≤90d).");
      if (imported && !dualOk)
        notes.push("Import needs dualApprovalPct=100 and singleApproverCount=0.");
    } else if (signals) statusHint = "not_demonstrated";

    const report = {
      schemaVersion: "0.2.0",
      pluginId: PLUGIN_ID,
      relatedCheckIds: [...RELATED],
      assessedAt: ctx.assessedAt.toISOString(),
      dualControl: { found: dualPresent, refs: dualRefs },
      importedResults: {
        found: imported,
        dualApprovalPct: dualPct,
        singleApproverCount,
        irreversibleInventoryPresent: inventoryPresentImport,
        measuredAt,
        sources,
      },
      summary: {
        signalsPresent: signals,
        dualControlPresent: dualPresent,
        humM4Satisfied: satisfied,
        statusHint,
      },
      notes,
    };

    return writeReportAndNodes({
      ctx,
      pluginId: PLUGIN_ID,
      related: RELATED,
      reportFile: "human-dual-control-report.json",
      report,
      summary: report.summary,
      statusHint,
      satisfiedKey: "humM4Satisfied",
      satisfied,
      nodeClass: "policy",
      signals: [PLUGIN_ID, "hum-m4", "repo-dual-control-config"],
      codeRefs: dualRefs,
      detail: `HUM-M4 status=${statusHint} dual=${dualPresent} satisfied=${satisfied}`,
    });
  },
};

/** HUM-R1 */
export const humanApprovalUiCollector: Collector = {
  id: "human-approval-ui",
  async collect(ctx: CollectorContext) {
    const PLUGIN_ID = "human-approval-ui";
    const RELATED = ["HUM-R1"] as const;
    const maxFiles = ctx.maxFiles ?? 8000;
    const signals = detectApprovalSignals(ctx.targetPath, maxFiles);
    const uiRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) =>
        /\b(approval[_-]?(ui|modal|panel)|tool[_-]?args|change[_-]?diff|confidence|risk[_-]?score)\b/i.test(
          p + " " + t,
        ),
    );

    const { sources, docs } = loadJsonImports(
      ctx,
      PLUGIN_ID,
      "human-approval-ui-report.json",
    );
    let sampleCount: number | null = null;
    let fieldsCompletePct: number | null = null;
    let measuredAt: string | null = null;
    for (const d of docs) {
      measuredAt = parseMeasuredAt(d) ?? measuredAt;
      sampleCount = asNum(d.sampleCount) ?? sampleCount;
      fieldsCompletePct =
        asNum(d.contextFieldsCompletePct) ?? fieldsCompletePct;
      const samples = Array.isArray(d.samples)
        ? (d.samples as Array<Record<string, unknown>>)
        : [];
      if (samples.length) {
        sampleCount = samples.length;
        const ok = samples.filter(
          (s) =>
            !!(s.toolArgs || s.args) &&
            !!(s.diff || s.preview || s.changeDiff) &&
            !!(s.confidence || s.risk || s.riskScore),
        ).length;
        fieldsCompletePct = (ok / samples.length) * 100;
      }
    }

    const uiPresent = uiRefs.length > 0;
    const imported = sources.length > 0;
    const volumeOk = sampleCount !== null && sampleCount >= 10;
    const fieldsOk = fieldsCompletePct !== null && fieldsCompletePct >= 100;
    const fresh = measuredAtFresh(measuredAt);

    let statusHint: StatusHint = "not_demonstrated";
    let satisfied: boolean | null = null;
    const notes: string[] = [];
    if (!signals && !uiPresent && !imported) statusHint = "not_applicable";
    else if (imported && fieldsCompletePct !== null && fieldsCompletePct < 100) {
      statusHint = "fail";
      satisfied = false;
    } else if (uiPresent && volumeOk && fieldsOk && fresh) {
      statusHint = "pass";
      satisfied = true;
    } else if (uiPresent || imported) {
      statusHint = "partial";
      satisfied = false;
      if (imported && !volumeOk)
        notes.push("Import needs ≥10 sampled approvals with args/diff/confidence.");
      if (imported && !fresh) notes.push("Import needs fresh measuredAt (≤90d).");
    } else if (signals) statusHint = "not_demonstrated";

    const report = {
      schemaVersion: "0.2.0",
      pluginId: PLUGIN_ID,
      relatedCheckIds: [...RELATED],
      assessedAt: ctx.assessedAt.toISOString(),
      approvalUi: { found: uiPresent, refs: uiRefs },
      importedResults: {
        found: imported,
        sampleCount,
        contextFieldsCompletePct: fieldsCompletePct,
        measuredAt,
        sources,
      },
      summary: {
        signalsPresent: signals,
        uiPresent,
        humR1Satisfied: satisfied,
        statusHint,
      },
      notes,
    };

    return writeReportAndNodes({
      ctx,
      pluginId: PLUGIN_ID,
      related: RELATED,
      reportFile: "human-approval-ui-report.json",
      report,
      summary: report.summary,
      statusHint,
      satisfiedKey: "humR1Satisfied",
      satisfied,
      nodeClass: "docs",
      signals: [PLUGIN_ID, "hum-r1", "repo-approval-ui-context"],
      codeRefs: uiRefs,
      detail: `HUM-R1 status=${statusHint} ui=${uiPresent} satisfied=${satisfied}`,
    });
  },
};

/** HUM-R3 */
export const humanApprovalSlaCollector: Collector = {
  id: "human-approval-sla",
  async collect(ctx: CollectorContext) {
    const PLUGIN_ID = "human-approval-sla";
    const RELATED = ["HUM-R3"] as const;
    const maxFiles = ctx.maxFiles ?? 8000;
    const signals = detectApprovalSignals(ctx.targetPath, maxFiles);
    const slaRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) =>
        /\b(approval[\s_-]?queue|queue[\s_-]?(sla|age|slo)|p95.{0,30}(queue|approv)|sla.{0,20}approv)\b/i.test(
          p + " " + t,
        ),
    );

    const { sources, docs } = loadJsonImports(
      ctx,
      PLUGIN_ID,
      "human-approval-sla-report.json",
    );
    let withinSla: boolean | null = null;
    let p95Ms: number | null = null;
    let slaMs: number | null = null;
    let exceptionsOk: boolean | null = null;
    let measuredAt: string | null = null;
    for (const d of docs) {
      measuredAt = parseMeasuredAt(d) ?? measuredAt;
      withinSla = asBool(d.withinSla) ?? withinSla;
      p95Ms = asNum(d.p95QueueAgeMs) ?? asNum(d.p95Ms) ?? p95Ms;
      slaMs = asNum(d.slaMs) ?? asNum(d.slaThresholdMs) ?? slaMs;
      exceptionsOk =
        asBool(d.exceptionsOwnedWithExpiry) ?? exceptionsOk;
      if (p95Ms !== null && slaMs !== null) withinSla = p95Ms <= slaMs;
    }

    const slaPresent = slaRefs.length > 0;
    const imported = sources.length > 0;
    const passMetric =
      withinSla === true ||
      (withinSla === false && exceptionsOk === true);
    const fresh = measuredAtFresh(measuredAt);

    let statusHint: StatusHint = "not_demonstrated";
    let satisfied: boolean | null = null;
    const notes: string[] = [];
    if (!signals && !slaPresent && !imported) statusHint = "not_applicable";
    else if (
      imported &&
      withinSla === false &&
      exceptionsOk === false
    ) {
      statusHint = "fail";
      satisfied = false;
      notes.push("SLA breached without owned exceptions — HUM-R3 fail.");
    } else if (
      (slaPresent || (imported && slaMs !== null)) &&
      passMetric &&
      fresh &&
      imported
    ) {
      statusHint = "pass";
      satisfied = true;
    } else if (slaPresent || imported) {
      statusHint = "partial";
      satisfied = false;
      if (imported && !passMetric)
        notes.push("Import needs withinSla=true or exceptionsOwnedWithExpiry=true.");
      if (imported && !fresh) notes.push("Import needs fresh measuredAt (≤90d).");
    } else if (signals) statusHint = "not_demonstrated";

    const report = {
      schemaVersion: "0.2.0",
      pluginId: PLUGIN_ID,
      relatedCheckIds: [...RELATED],
      assessedAt: ctx.assessedAt.toISOString(),
      sla: { found: slaPresent, refs: slaRefs },
      importedResults: {
        found: imported,
        withinSla,
        p95QueueAgeMs: p95Ms,
        slaMs,
        exceptionsOwnedWithExpiry: exceptionsOk,
        measuredAt,
        sources,
      },
      summary: {
        signalsPresent: signals,
        slaPresent,
        humR3Satisfied: satisfied,
        statusHint,
      },
      notes,
    };

    return writeReportAndNodes({
      ctx,
      pluginId: PLUGIN_ID,
      related: RELATED,
      reportFile: "human-approval-sla-report.json",
      report,
      summary: report.summary,
      statusHint,
      satisfiedKey: "humR3Satisfied",
      satisfied,
      nodeClass: "runtime-config",
      signals: [PLUGIN_ID, "hum-r3", "repo-approval-queue-sla"],
      codeRefs: slaRefs,
      detail: `HUM-R3 status=${statusHint} sla=${slaPresent} satisfied=${satisfied}`,
    });
  },
};
