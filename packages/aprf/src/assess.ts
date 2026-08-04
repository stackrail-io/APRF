/**
 * Assess engine — evidence-graph + collector statusHints → assessment.json.
 *
 * Aligned with skills/aprf-auditor scoring.yaml / confidence.yaml / evidence-precedence.yaml:
 * - Mandatory gate: every applicable mandatory is PASS or NOT_APPLICABLE
 * - PARTIAL / FAIL / NOT_DEMONSTRATED on mandatory → blockers
 * - NOT_APPLICABLE is excluded (passed=false, not a gate satisfy)
 * - recommendedScore from recommended Checks only (severity-weighted)
 * - Domains from catalog taxonomy (not pillar slug as domain name)
 *
 * Status sources (deterministic, no LLM):
 * 1) imports/<plugin>/*-report.json summary.statusHint (+ plugin mapsToChecks)
 * 2) evidence-graph collectors[].detail "CHECK-ID status=<hint>"
 * Worse hint wins when multiple sources conflict.
 */
import {
  readdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  getGeneratedCatalog,
  SEVERITY_WEIGHT,
  type AprfRule,
  type DomainDef,
} from "@stackrail-io/aprf-engine";
import {
  PROFILE_CORE,
  PROFILE_REGULATED,
  PROFILE_ID_CORE,
  PROFILE_ID_REGULATED,
  getProfileById,
  getLensById,
  unionProfileAndLenses,
  type AprfProfile,
  type AprfLens,
} from "@stackrail-io/aprf-framework-definition";
import type {
  EvidenceGraph,
  EvidenceNode,
  EvidenceClass,
} from "../../../skills/aprf-auditor/collectors/types.ts";
import pluginCheckMap from "./generated/plugin-check-map.json" with {
  type: "json",
};
import { catalogVersion, cliVersion } from "./versions.ts";

export type HintStatus =
  | "pass"
  | "fail"
  | "partial"
  | "not_applicable"
  | "not_demonstrated";

export type ControlStatus =
  | "PASS"
  | "FAIL"
  | "PARTIAL"
  | "NOT_APPLICABLE"
  | "NOT_DEMONSTRATED";

const HINT_TO_STATUS: Record<HintStatus, ControlStatus> = {
  pass: "PASS",
  fail: "FAIL",
  partial: "PARTIAL",
  not_applicable: "NOT_APPLICABLE",
  not_demonstrated: "NOT_DEMONSTRATED",
};

const CRITICALITY_NAME: Record<number, string> = {
  0: "Sandbox",
  1: "Internal",
  2: "Production",
  3: "Mission Critical",
};

const CAPABILITY_NAME: Record<number, string> = {
  1: "Initial",
  2: "Managed",
  3: "Defined",
  4: "Quantitatively Managed",
  5: "Optimizing",
};

const PRECEDENCE: Record<EvidenceClass, number> = {
  runtime: 100,
  ci: 90,
  iac: 85,
  "runtime-config": 80,
  policy: 70,
  code: 60,
  docs: 40,
  user: 20,
};

const BASE_CONFIDENCE: Record<EvidenceClass, number> = {
  runtime: 1.0,
  ci: 0.9,
  iac: 0.85,
  "runtime-config": 0.82,
  policy: 0.8,
  code: 0.8,
  docs: 0.5,
  user: 0.3,
};

type HintHit = {
  hint: HintStatus;
  pluginId: string;
  reportRef: string;
  /** Collector-specific gap notes (preferred over generic evidenceRequired). */
  gapNotes?: string[];
  /** Optional finding severity override (e.g. AGN-M1 high→critical escalation). */
  severityHint?: AprfRule["severity"];
};

type ControlOut = {
  checkId: string;
  title: string;
  category: string;
  domain: string;
  description: string;
  whyItMatters: string;
  passCondition: string;
  evidenceRequired: string[];
  recommendedFixes: string[];
  manualVerification: string;
  falsePositiveGuidance: string;
  references: AprfRule["references"];
  gate: "mandatory" | "recommended";
  severity: AprfRule["severity"];
  status: ControlStatus;
  passed: boolean;
  notApplicable?: boolean;
  confidence: "high" | "medium" | "low";
  confidenceScore: number;
  evidenceFound: Array<{ ref: string; excerpt?: string }>;
  requiredEvidenceMissing: string[];
  reasoning: string;
  recommendedAction: string;
  priority: string;
  remediation: {
    fix: string;
    reference: string;
    owner: string;
    priority: string;
    estimatedEffort: string;
  };
  naReason?: string;
};

function normalizeHint(raw: unknown): HintStatus | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase().replace(/-/g, "_");
  if (
    v === "pass" ||
    v === "fail" ||
    v === "partial" ||
    v === "not_applicable" ||
    v === "not_demonstrated"
  ) {
    return v;
  }
  return null;
}

function worseHint(a: HintStatus, b: HintStatus): HintStatus {
  const rank: Record<HintStatus, number> = {
    fail: 5,
    partial: 4,
    not_demonstrated: 3,
    pass: 2,
    not_applicable: 1,
  };
  return rank[a] >= rank[b] ? a : b;
}

function setHint(
  byCheck: Map<string, HintHit>,
  checkId: string,
  hit: HintHit,
): void {
  const prev = byCheck.get(checkId);
  if (!prev || worseHint(hit.hint, prev.hint) === hit.hint) {
    byCheck.set(checkId, hit);
  }
}

function loadHintsFromImports(outDir: string): Map<string, HintHit> {
  const byCheck = new Map<string, HintHit>();
  const importsDir = join(outDir, "imports");
  if (!existsSync(importsDir)) return byCheck;

  for (const pluginId of readdirSync(importsDir)) {
    const dir = join(importsDir, pluginId);
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    const checkIds = (pluginCheckMap as Record<string, string[]>)[pluginId];
    if (!checkIds?.length) continue;

    for (const file of files) {
      if (!file.includes("report")) continue;
      let doc: {
        summary?: { statusHint?: unknown; severityHint?: unknown };
        gapNotes?: unknown;
        notes?: unknown;
      };
      try {
        doc = JSON.parse(readFileSync(join(dir, file), "utf8")) as typeof doc;
      } catch {
        continue;
      }
      const hint = normalizeHint(doc.summary?.statusHint);
      if (!hint) continue;
      const reportRef = `imports/${pluginId}/${file}`;
      // Prefer typed gapNotes from collectors; fall back to a conservative note filter.
      const typedGaps = Array.isArray(doc.gapNotes)
        ? doc.gapNotes
            .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
            .slice(0, 8)
        : [];
      const gapNotes =
        typedGaps.length > 0
          ? typedGaps
          : Array.isArray(doc.notes)
            ? doc.notes
                .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
                .filter(
                  (n) =>
                    !/\bmissingFields\s*=\s*0\b/i.test(n) &&
                    /missing(?!Fields\s*=\s*0)|no [a-z]|not found|requir(?:ed|es)|cannot|fail|partial|unlock|absent|unscored|severityHint=critical/i.test(
                      n,
                    ),
                )
                .slice(0, 8)
            : undefined;
      const sevRaw =
        typeof doc.summary?.severityHint === "string"
          ? doc.summary.severityHint.trim().toLowerCase()
          : "";
      const severityHint =
        sevRaw === "critical" ||
        sevRaw === "high" ||
        sevRaw === "medium" ||
        sevRaw === "low"
          ? (sevRaw as AprfRule["severity"])
          : undefined;
      for (const checkId of checkIds) {
        setHint(byCheck, checkId, {
          hint,
          pluginId,
          reportRef,
          ...(gapNotes?.length ? { gapNotes } : {}),
          ...(severityHint ? { severityHint } : {}),
        });
      }
    }
  }
  return byCheck;
}

/** Parse `SEC2-M1 status=pass` from collector detail lines. */
function loadHintsFromCollectorDetails(
  graph: EvidenceGraph | undefined,
): Map<string, HintHit> {
  const byCheck = new Map<string, HintHit>();
  if (!graph?.collectors) return byCheck;
  const re =
    /\b([A-Z]{2,6}-[MR]\d+)\s+status\s*=\s*(pass|fail|partial|not_applicable|not_demonstrated)\b/i;
  for (const c of graph.collectors) {
    if (!c.detail) continue;
    const m = c.detail.match(re);
    if (!m) continue;
    const hint = normalizeHint(m[2]);
    if (!hint) continue;
    setHint(byCheck, m[1]!.toUpperCase(), {
      hint,
      pluginId: c.pluginId,
      reportRef: `evidence-graph:collectors/${c.pluginId}`,
    });
  }
  return byCheck;
}

function mergeHints(
  imports: Map<string, HintHit>,
  details: Map<string, HintHit>,
): Map<string, HintHit> {
  const out = new Map(imports);
  for (const [id, hit] of details) setHint(out, id, hit);
  return out;
}

function resolveProfile(profileId: string): AprfProfile {
  if (profileId === PROFILE_ID_REGULATED || profileId === "regulated") {
    return PROFILE_REGULATED;
  }
  if (profileId === PROFILE_ID_CORE || profileId === "core") {
    return PROFILE_CORE;
  }
  return getProfileById(profileId) ?? PROFILE_CORE;
}

function resolveLenses(lensIds: string[]): AprfLens[] {
  const out: AprfLens[] = [];
  for (const raw of lensIds) {
    const id =
      raw.startsWith("aprf-lens-") ? raw : `aprf-lens-${raw.replace(/^lens-/, "")}`;
    const lens = getLensById(id);
    if (lens) out.push(lens);
  }
  return out;
}

function domainForCategory(
  category: string,
  domains: DomainDef[],
  categoryDomain: Map<string, string>,
): string {
  const mapped = categoryDomain.get(category);
  if (mapped) {
    const d = domains.find((x) => x.id === mapped);
    return d?.name ?? mapped;
  }
  return category;
}

function buildCategoryDomainMap(
  catalog: ReturnType<typeof getGeneratedCatalog>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of catalog.pillars ?? []) {
    if (p.domain) map.set(p.slug, p.domain);
  }
  for (const c of catalog.categories ?? []) {
    if (c.domain) map.set(c.id, c.domain);
  }
  return map;
}

function nodesForCheck(
  graph: EvidenceGraph | undefined,
  checkId: string,
): EvidenceNode[] {
  if (!graph?.nodes?.length) return [];
  return graph.nodes
    .filter((n) => n.relatedCheckIds?.includes(checkId))
    .sort((a, b) => {
      const pr = (PRECEDENCE[b.class] ?? 0) - (PRECEDENCE[a.class] ?? 0);
      if (pr !== 0) return pr;
      return a.ref.localeCompare(b.ref);
    });
}

function confidenceFromEvidence(
  nodes: EvidenceNode[],
  hasHint: boolean,
): { label: "high" | "medium" | "low"; score: number } {
  if (!nodes.length) {
    // Import report / collector detail without graph nodes → treat as ci-class hint.
    const score = hasHint ? BASE_CONFIDENCE.ci * 0.85 : 0;
    return {
      score,
      label: score >= 0.85 ? "high" : score >= 0.55 ? "medium" : "low",
    };
  }
  const primary = nodes[0]!;
  const base = BASE_CONFIDENCE[primary.class] ?? 0.5;
  const classes = new Set(nodes.slice(1).map((n) => n.class));
  const bump = Math.min(0.1, classes.size * 0.05);
  const score = Math.min(1, base * 0.85 + bump); // unknown age → 0.85 freshness
  return {
    score,
    label: score >= 0.85 ? "high" : score >= 0.55 ? "medium" : "low",
  };
}

function priorityFor(
  gate: "mandatory" | "recommended",
  severity: AprfRule["severity"],
  status: ControlStatus,
): string {
  if (gate === "mandatory" && status === "FAIL" && severity === "critical") {
    return "P0";
  }
  if (
    gate === "mandatory" &&
    (status === "FAIL" ||
      (status === "NOT_DEMONSTRATED" && severity === "critical"))
  ) {
    return "P1";
  }
  if (
    (gate === "mandatory" && status === "PARTIAL") ||
    (gate === "recommended" &&
      status === "FAIL" &&
      (severity === "critical" || severity === "high"))
  ) {
    return "P2";
  }
  if (status === "PASS" || status === "NOT_APPLICABLE") return "P3";
  return "P3";
}

function overallGrade(args: {
  gatePass: boolean;
  recommendedScore: number;
  criticalBlockers: ControlOut[];
  mandatoryFails: number;
  criticalNd: number;
}): "A" | "B" | "C" | "D" | "F" {
  const { gatePass, recommendedScore, criticalBlockers, mandatoryFails, criticalNd } =
    args;
  if (!gatePass) {
    if (criticalBlockers.some((c) => c.status === "FAIL") || mandatoryFails >= 3) {
      return "F";
    }
    if (criticalBlockers.length || criticalNd) return "F";
    return "D";
  }
  if (recommendedScore >= 85 && criticalNd === 0) return "A";
  if (recommendedScore >= 70) return "B";
  return "C";
}

function riskLevel(args: {
  gatePass: boolean;
  criticalMandatoryFails: number;
  criticalMandatoryNd: number;
}): "critical" | "high" | "medium" | "low" {
  if (args.criticalMandatoryFails > 0) return "critical";
  if (!args.gatePass || args.criticalMandatoryNd > 0) return "high";
  if (args.gatePass) return "low";
  return "medium";
}

function assessmentConfidenceLabel(controls: ControlOut[]): "high" | "medium" | "low" {
  const criticalMand = controls.filter(
    (c) => c.gate === "mandatory" && c.severity === "critical" && !c.notApplicable,
  );
  if (
    criticalMand.some(
      (c) =>
        c.status === "NOT_DEMONSTRATED" ||
        (c.status === "PASS" && c.confidence === "low"),
    )
  ) {
    return "low";
  }
  if (criticalMand.some((c) => c.status === "FAIL")) return "medium";
  if (
    criticalMand.length &&
    criticalMand.every((c) => c.status === "PASS" && c.confidence === "high")
  ) {
    return "high";
  }
  return "medium";
}

export type AssessOptions = {
  outDir: string;
  profileId?: string;
  lensIds?: string[];
  /** Score full non-deprecated catalog. */
  fullCatalog?: boolean;
  graph?: EvidenceGraph;
};

export function assessFromStatusHints(opts: AssessOptions): unknown {
  const outDir = resolve(opts.outDir);
  const profile = resolveProfile(opts.profileId ?? PROFILE_ID_CORE);
  const lenses = resolveLenses(opts.lensIds ?? []);
  const mandatoryIds = new Set(
    lenses.length
      ? unionProfileAndLenses(
          profile.mandatoryCheckIds,
          lenses.map((l) => l.id),
        )
      : [...profile.mandatoryCheckIds],
  );

  const catalog = getGeneratedCatalog();
  const rulesById = new Map(catalog.rules.map((r) => [r.id, r]));
  const categoryDomain = buildCategoryDomainMap(catalog);

  let graph = opts.graph;
  if (!graph) {
    const graphPath = join(outDir, "evidence-graph.json");
    if (existsSync(graphPath)) {
      graph = JSON.parse(readFileSync(graphPath, "utf8")) as EvidenceGraph;
    }
  }

  const hints = mergeHints(
    loadHintsFromImports(outDir),
    loadHintsFromCollectorDetails(graph),
  );

  const checkIds = new Set<string>();
  if (opts.fullCatalog) {
    for (const r of catalog.rules) {
      if (r.status !== "deprecated") checkIds.add(r.id);
    }
  } else {
    for (const id of mandatoryIds) checkIds.add(id);
    // Include any Check with a collector hint (recommended or extra).
    for (const id of hints.keys()) checkIds.add(id);
  }

  const controls: ControlOut[] = [];

  for (const checkId of [...checkIds].sort()) {
    const rule = rulesById.get(checkId);
    if (!rule || rule.status === "deprecated") continue;

    const mapped = hints.get(checkId);
    const hint: HintStatus = mapped?.hint ?? "not_demonstrated";
    const status = HINT_TO_STATUS[hint];
    const gate: "mandatory" | "recommended" = mandatoryIds.has(checkId)
      ? "mandatory"
      : "recommended";
    const notApplicable = status === "NOT_APPLICABLE";
    // scoring.yaml: N/A is excluded, not a pass
    const passed = status === "PASS";

    const related = nodesForCheck(graph, checkId);
    const conf = confidenceFromEvidence(related, Boolean(mapped));

    const evidenceFound: Array<{ ref: string; excerpt?: string }> = [];
    if (mapped) {
      evidenceFound.push({
        ref: mapped.reportRef,
        excerpt: `statusHint=${mapped.hint} (plugin=${mapped.pluginId})`,
      });
    }
    for (const n of related.slice(0, 8)) {
      if (evidenceFound.some((e) => e.ref === n.ref)) continue;
      evidenceFound.push({
        ref: n.ref,
        excerpt:
          n.excerpt?.slice(0, 240) ??
          `class=${n.class} plugin=${n.pluginId}${n.signals?.length ? ` signals=${n.signals.join(",")}` : ""}`,
      });
    }

    // Prefer collector gap notes over dumping the full normative evidenceRequired list.
    const outDirLabel = basename(outDir) || "assessment-output";
    const requiredEvidenceMissing =
      status === "PASS" || status === "NOT_APPLICABLE"
        ? []
        : mapped?.gapNotes?.length
          ? [...mapped.gapNotes]
          : status === "NOT_DEMONSTRATED"
            ? [
                `No scored collector report for this Check — re-run collect or add measured imports under ${outDirLabel}/imports/<plugin>/.`,
                ...(rule.evidenceRequired ?? []).slice(0, 2),
              ]
            : [...(rule.evidenceRequired ?? [])];

    // Collector may escalate (e.g. AGN-M1 high → critical when inventory unproven).
    const severity = mapped?.severityHint ?? rule.severity;
    const priority = priorityFor(gate, severity, status);
    const domain = domainForCategory(
      rule.category,
      catalog.domains ?? [],
      categoryDomain,
    );

    const fix = rule.recommendedFixes?.[0] ?? "";
    controls.push({
      checkId,
      title: rule.title,
      category: rule.category,
      domain,
      description: rule.description,
      whyItMatters: rule.whyItMatters,
      passCondition: rule.passCondition,
      evidenceRequired: rule.evidenceRequired,
      recommendedFixes: rule.recommendedFixes,
      manualVerification: rule.manualVerification,
      falsePositiveGuidance: rule.falsePositiveGuidance,
      references: rule.references,
      gate,
      severity,
      status,
      passed,
      ...(notApplicable ? { notApplicable: true } : {}),
      confidence: conf.label,
      confidenceScore: Number(conf.score.toFixed(3)),
      evidenceFound,
      requiredEvidenceMissing,
      reasoning: mapped
        ? `Collector statusHint=${mapped.hint}${mapped.severityHint ? ` severityHint=${mapped.severityHint}` : ""} from ${mapped.reportRef}. Primary evidence class=${related[0]?.class ?? "ci"} (${evidenceFound.length} refs). Deterministic assess (no LLM).`
        : `No collector statusHint for ${checkId}. Marked NOT_DEMONSTRATED — add imports/ evidence or re-run collect. Manual: ${rule.manualVerification}`,
      recommendedAction: (rule.recommendedFixes ?? []).join("; "),
      priority,
      // No placeholder owner/effort — those belong to a tracked remediation system, not CLI assess.
      remediation: {
        fix,
        reference: checkId,
        owner: "",
        priority,
        estimatedEffort: "",
      },
      ...(notApplicable
        ? { naReason: "Collector reported not_applicable (surface absent)." }
        : {}),
    });
  }

  const applicableMandatory = controls.filter(
    (c) => c.gate === "mandatory" && c.status !== "NOT_APPLICABLE",
  );
  const blockers = applicableMandatory.filter((c) => c.status !== "PASS");
  const criticalBlockers = blockers.filter((c) => c.severity === "critical");
  const overallGatePassed = blockers.length === 0;
  const mandatoryFails = applicableMandatory.filter(
    (c) => c.status === "FAIL",
  ).length;
  const criticalNd = applicableMandatory.filter(
    (c) => c.status === "NOT_DEMONSTRATED" && c.severity === "critical",
  ).length;
  const criticalMandatoryFails = applicableMandatory.filter(
    (c) => c.status === "FAIL" && c.severity === "critical",
  ).length;

  // recommendedScore — recommended Checks only, severity-weighted
  const recommended = controls.filter(
    (c) => c.gate === "recommended" && c.status !== "NOT_APPLICABLE",
  );
  let recWeight = 0;
  let recPassWeight = 0;
  for (const c of recommended) {
    const w = SEVERITY_WEIGHT[c.severity] ?? 1;
    recWeight += w;
    if (c.status === "PASS") recPassWeight += w;
  }
  const recommendedScore =
    recWeight === 0 ? 100 : Math.round((recPassWeight / recWeight) * 100);

  const byDomain = new Map<
    string,
    {
      applicable: number;
      satisfied: number;
      notDemonstrated: number;
      failGate: boolean;
    }
  >();
  for (const c of controls) {
    const d = c.domain || c.category || "other";
    const row = byDomain.get(d) ?? {
      applicable: 0,
      satisfied: 0,
      notDemonstrated: 0,
      failGate: false,
    };
    // Exclude NOT_APPLICABLE from domain applicable/satisfied (same as recommendedScore).
    if (c.status === "NOT_APPLICABLE") {
      byDomain.set(d, row);
      continue;
    }
    row.applicable += 1;
    if (c.status === "PASS") row.satisfied += 1;
    if (c.status === "NOT_DEMONSTRATED") row.notDemonstrated += 1;
    if (
      c.gate === "mandatory" &&
      c.status !== "PASS" &&
      c.status !== "NOT_APPLICABLE"
    ) {
      row.failGate = true;
    }
    byDomain.set(d, row);
  }

  const domainScores = [...byDomain.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, row]) => ({
      domain,
      score:
        row.applicable === 0
          ? 100
          : Math.round((row.satisfied / row.applicable) * 100),
      mandatoryGatePassed: !row.failGate,
      applicable: row.applicable,
      satisfied: row.satisfied,
      notDemonstrated: row.notDemonstrated,
    }));

  const grade = overallGrade({
    gatePass: overallGatePassed,
    recommendedScore,
    criticalBlockers,
    mandatoryFails,
    criticalNd,
  });
  const risk = riskLevel({
    gatePass: overallGatePassed,
    criticalMandatoryFails,
    criticalMandatoryNd: criticalNd,
  });

  const subject = graph?.subject ?? {
    path: outDir,
    name: "assessment",
  };

  const roadmapNow = blockers
    .filter((c) => c.priority === "P0" || c.priority === "P1")
    .slice(0, 30)
    .map((c) => ({
      checkId: c.checkId,
      title: c.title,
      action: c.recommendedAction,
      priority: c.priority,
    }));
  const roadmapNext = controls
    .filter((c) => c.priority === "P2" && c.status !== "PASS")
    .slice(0, 30)
    .map((c) => ({
      checkId: c.checkId,
      title: c.title,
      action: c.recommendedAction,
      priority: c.priority,
    }));
  const roadmapLater = controls
    .filter(
      (c) =>
        c.gate === "recommended" &&
        c.priority === "P3" &&
        c.status !== "PASS" &&
        c.status !== "NOT_APPLICABLE",
    )
    .slice(0, 30)
    .map((c) => ({
      checkId: c.checkId,
      title: c.title,
      action: c.recommendedAction,
      priority: c.priority,
    }));

  const hintedCount = [...hints.keys()].filter((id) => checkIds.has(id)).length;

  return {
    schemaVersion: "0.2.0",
    aprfVersion: catalogVersion(),
    skillVersion: cliVersion(),
    assessedAt: graph?.assessedAt ?? new Date().toISOString(),
    subject,
    scope: {
      profileId: profile.id,
      criticality: profile.targetCriticality,
      lensIds: lenses.map((l) => l.id),
      checkIds: [...checkIds].sort(),
      mode: "assess",
      assessmentKind:
        profile.id === PROFILE_ID_REGULATED ? "aprf-regulated" : "aprf-core",
      systemType: "ai-application",
    },
    evidenceGraphPath: "evidence-graph.json",
    executiveSummary: {
      overallGatePassed,
      criticalityTier: profile.targetCriticality,
      criticalityName:
        CRITICALITY_NAME[profile.targetCriticality] ?? "Production",
      requiredCapabilityLevel: profile.targetCapability,
      requiredCapabilityName:
        CAPABILITY_NAME[profile.targetCapability] ?? "Defined",
      maturityUrl: "https://stackrail.io/aprf/how/#maturity",
      overallGrade: grade,
      riskLevel: risk,
      assessmentConfidence: assessmentConfidenceLabel(controls),
      recommendedScore,
      blockerCount: blockers.length,
      criticalBlockerCount: criticalBlockers.length,
      narrative: `APRF CLI assess against ${profile.name}${lenses.length ? ` + lenses [${lenses.map((l) => l.name).join(", ")}]` : ""}: ${hintedCount}/${controls.length} Checks scored from collector statusHints; unscored → NOT_DEMONSTRATED. Gate ${overallGatePassed ? "PASS" : "FAIL"} (${blockers.length} mandatory blockers, ${criticalBlockers.length} critical). recommendedScore=${recommendedScore} (prioritization only).`,
    },
    domainScores,
    controls,
    findings: blockers.map((c) => ({
      checkId: c.checkId,
      title: c.title,
      status: c.status,
      summary: c.reasoning,
      priority: c.priority,
    })),
    roadmaps: {
      now: roadmapNow,
      next: roadmapNext,
      later: roadmapLater,
      days30: roadmapNow,
      days90: roadmapNext,
      longTerm: roadmapLater,
    },
    disclaimer:
      "Deterministic CLI assess from collector statusHints + evidence-graph nodes. Not a StackRail attestation. NOT_DEMONSTRATED means no scored collector report — not necessarily FAIL. Use the APRF Auditor skill for YES/NO/DON'T KNOW attestation fills.",
  };
}

export function writeAssessment(
  opts: AssessOptions,
): { path: string; assessment: unknown } {
  const assessment = assessFromStatusHints(opts);
  const outDir = resolve(opts.outDir);
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "assessment.json");
  writeFileSync(path, `${JSON.stringify(assessment, null, 2)}\n`, "utf8");
  return { path, assessment };
}
