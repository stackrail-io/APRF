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
import { join, resolve } from "node:path";
import {
  getCrosswalksForCheck,
  getThreatIntelForCheck,
  getGeneratedCatalog,
  SEVERITY_WEIGHT,
  classifyAchievedTier,
  matchedEvidenceTypes,
  parseEvidenceTier,
  resolveMinimumTier,
  tierMeetsFloor,
  verificationFor,
  type AprfRule,
  type ControlEvidenceTier,
  type DomainDef,
  type EvidenceTier,
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
import {
  customerFacingImportGap,
  isImportFieldRecipe,
  softenGapJargon,
  toCustomerFacingGaps,
} from "../../../skills/aprf-auditor/collectors/lib/customer-gaps.ts";
import type {
  EvidenceGraph,
  EvidenceNode,
  EvidenceClass,
} from "../../../skills/aprf-auditor/collectors/types.ts";
import pluginCheckMap from "./generated/plugin-check-map.json" with {
  type: "json",
};
import pluginEvidenceTierMap from "./generated/plugin-evidence-tier-map.json" with {
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
  /** Collector-provided NOT_APPLICABLE reason (e.g. scope / appliesTo). */
  naReason?: string;
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
  /** Informative peer-framework alignment — not proof of certification. */
  crosswalks: Array<{
    framework: string;
    frameworkId: string;
    controlRef: string;
    controlTitle: string;
    relation: string;
    url?: string;
    relatedPeerControlIds?: string[];
    relatedPeerRefs?: string[];
  }>;
  /** Why this control exists and what it defends against — informative context. */
  threatIntel?: {
    securityIntent: string;
    threats: string[];
    protects: string[];
    mitre: { atlas: string[]; attack: string[] };
    mappingRationale: string;
  };
  gate: "mandatory" | "recommended";
  severity: AprfRule["severity"];
  status: ControlStatus;
  passed: boolean;
  notApplicable?: boolean;
  confidence: "high" | "medium" | "low";
  confidenceScore: number;
  evidenceFound: Array<{ ref: string; excerpt?: string }>;
  requiredEvidenceMissing: string[];
  /** Evidence Assurance Tier rollup (APRF-RFC-0011). */
  evidenceTier: ControlEvidenceTier;
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

const HINT_RANK: Record<HintStatus, number> = {
  fail: 5,
  partial: 4,
  not_demonstrated: 3,
  pass: 2,
  not_applicable: 1,
};

function worseHint(a: HintStatus, b: HintStatus): HintStatus {
  return HINT_RANK[a] >= HINT_RANK[b] ? a : b;
}

function setHint(
  byCheck: Map<string, HintHit>,
  checkId: string,
  hit: HintHit,
): void {
  const prev = byCheck.get(checkId);
  if (!prev) {
    byCheck.set(checkId, hit);
    return;
  }
  const hitRank = HINT_RANK[hit.hint];
  const prevRank = HINT_RANK[prev.hint];
  if (hitRank > prevRank) {
    byCheck.set(checkId, hit);
    return;
  }
  if (hitRank < prevRank) return;
  // Same status: merge gapNotes; keep imports/ reportRef; take worse severityHint.
  // evidence-graph collector details must not clobber import gapNotes.
  const preferHitRef = hit.reportRef.startsWith("imports/");
  const preferPrevRef = prev.reportRef.startsWith("imports/");
  const pluginId = preferHitRef
    ? hit.pluginId
    : preferPrevRef
      ? prev.pluginId
      : hit.pluginId;
  const gapNotes = toCustomerFacingGaps(
    [...(prev.gapNotes ?? []), ...(hit.gapNotes ?? [])],
    pluginId,
  ).map(softenGapJargon);
  const hitSev = hit.severityHint
    ? (SEVERITY_WEIGHT[hit.severityHint] ?? 0)
    : 0;
  const prevSev = prev.severityHint
    ? (SEVERITY_WEIGHT[prev.severityHint] ?? 0)
    : 0;
  const severityHint =
    hitSev > prevSev
      ? hit.severityHint
      : prevSev > hitSev
        ? prev.severityHint
        : (hit.severityHint ?? prev.severityHint);
  const naReason = hit.naReason ?? prev.naReason;
  byCheck.set(checkId, {
    hint: hit.hint,
    pluginId,
    reportRef: preferHitRef
      ? hit.reportRef
      : preferPrevRef
        ? prev.reportRef
        : hit.reportRef,
    ...(gapNotes.length ? { gapNotes } : {}),
    ...(severityHint ? { severityHint } : {}),
    ...(naReason ? { naReason } : {}),
  });
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
        summary?: {
          statusHint?: unknown;
          severityHint?: unknown;
          naReason?: unknown;
        };
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
      // Prefer typed gapNotes; fall back to actionable notes. Either way, rewrite
      // camelCase import-field recipes into customer-facing next steps.
      const typedGaps = Array.isArray(doc.gapNotes)
        ? doc.gapNotes
            .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
            .slice(0, 8)
        : [];
      const noteGaps =
        typedGaps.length === 0 && Array.isArray(doc.notes)
          ? doc.notes
              .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
              .filter(
                (n) =>
                  !/\bmissingFields\s*=\s*0\b/i.test(n) &&
                  (isImportFieldRecipe(n) ||
                    /missing(?!Fields\s*=\s*0)|no [a-z]|not found|requir(?:ed|es)|cannot|fail|partial|unlock|absent|unscored|severityHint=critical|NOT_APPLICABLE/i.test(
                      n,
                    )),
              )
              .slice(0, 8)
          : [];
      const rawGaps = typedGaps.length > 0 ? typedGaps : noteGaps;
      const gapNotes =
        rawGaps.length > 0
          ? toCustomerFacingGaps(rawGaps, pluginId).map(softenGapJargon)
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
      const naReason =
        typeof doc.summary?.naReason === "string" &&
        doc.summary.naReason.trim().length > 0
          ? doc.summary.naReason.trim()
          : undefined;
      for (const checkId of checkIds) {
        setHint(byCheck, checkId, {
          hint,
          pluginId,
          reportRef,
          ...(gapNotes?.length ? { gapNotes } : {}),
          ...(severityHint ? { severityHint } : {}),
          ...(naReason ? { naReason } : {}),
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
  const profile = getProfileById(profileId);
  if (!profile) {
    throw new Error(
      `Unknown APRF profile: ${profileId}. Use "core", "regulated", or a catalog profile id.`,
    );
  }
  return profile;
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

/** Top-level report keys that are never signal groups (even if shaped like {found,refs}). */
const REPORT_NON_SIGNAL_KEYS = new Set([
  "schemaVersion",
  "pluginId",
  "detectorId",
  "relatedCheckIds",
  "assessedAt",
  "measuredAt",
  "probedAt",
  "importedResults",
  "importedScope",
  "summary",
  "notes",
  "gapNotes",
  "results",
  "signals",
  "catalogSource",
  "expectStatus",
  "baseUrl",
]);

function isFoundRefsGroup(
  v: unknown,
): v is { found: boolean; refs: unknown[] } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as { found?: unknown; refs?: unknown };
  return typeof o.found === "boolean" && Array.isArray(o.refs);
}

/** Customer-facing labels for collector signal keys in Evidence found. */
const SIGNAL_DISPLAY_NAMES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    maxSteps: "iterationBound",
    wallClock: "durationBound",
    spawnDepth: "recursionBound",
  },
);

function signalDisplayName(name: string): string {
  return Object.prototype.hasOwnProperty.call(SIGNAL_DISPLAY_NAMES, name)
    ? SIGNAL_DISPLAY_NAMES[name]!
    : name;
}

/**
 * Prefer Evidence found from collector report `signals.<name>.found === true`
 * refs. If `signals` is absent, fall back to top-level `{ found, refs }` groups
 * (legacy collector shape). Skip found=false groups entirely.
 */
function evidenceFromFoundSignals(
  outDir: string,
  reportRef: string,
): Array<{ ref: string; excerpt?: string }> {
  if (!reportRef.startsWith("imports/")) return [];
  const path = join(outDir, reportRef);
  if (!existsSync(path)) return [];
  try {
    const doc = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    let signalMap: Record<string, unknown> | null = null;
    if (
      doc.signals &&
      typeof doc.signals === "object" &&
      !Array.isArray(doc.signals)
    ) {
      signalMap = doc.signals as Record<string, unknown>;
    } else {
      // Legacy reports nest found/refs at the top level (e.g. maxSteps, wallClock).
      const legacy: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(doc)) {
        if (REPORT_NON_SIGNAL_KEYS.has(k)) continue;
        if (isFoundRefsGroup(v)) legacy[k] = v;
      }
      if (Object.keys(legacy).length) signalMap = legacy;
    }
    if (!signalMap) return [];

    const out: Array<{ ref: string; excerpt?: string }> = [];
    const seen = new Set<string>();
    for (const [name, raw] of Object.entries(signalMap)) {
      if (!isFoundRefsGroup(raw) || raw.found !== true) continue;
      const label = signalDisplayName(name);
      const refs = raw.refs.filter(
        (r): r is string => typeof r === "string" && r.trim().length > 0,
      );
      if (refs.length === 0) {
        const key = `${reportRef}#${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ref: reportRef, excerpt: `${label}: found=true` });
        if (out.length >= 12) return out;
        continue;
      }
      for (const r of refs) {
        if (seen.has(r)) continue;
        seen.add(r);
        // Route/finding refs (e.g. "GET /api → HTTP 200 [file.py]") are
        // customer-facing; keep a short label instead of burying the finding.
        const looksLikeFinding = /→|HTTP\s+\d{3}/i.test(r);
        out.push({
          ref: r,
          excerpt: looksLikeFinding
            ? `${label}: found=true — unauthenticated caller not rejected`
            : `${label}: found=true`,
        });
        if (out.length >= 12) return out;
      }
    }
    return out;
  } catch {
    return [];
  }
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

/** Fresh measuredAt within maxAgeDays (default 90). */
function measuredAtFresh(
  measuredAt: string | null | undefined,
  now = new Date(),
  maxAgeDays = 90,
): boolean {
  if (!measuredAt || typeof measuredAt !== "string") return false;
  const t = Date.parse(measuredAt.trim());
  if (Number.isNaN(t)) return false;
  const ageMs = now.getTime() - t;
  // Tolerate clock skew, but never accept an arbitrarily future-dated report.
  const MAX_SKEW_MS = 24 * 60 * 60 * 1000;
  if (ageMs < 0) return -ageMs <= MAX_SKEW_MS;
  return ageMs <= maxAgeDays * 24 * 60 * 60 * 1000;
}

function reportMeasuredAt(
  doc: Record<string, unknown>,
  summary: Record<string, unknown> | null,
  imported: Record<string, unknown> | null,
): string | null {
  if (typeof imported?.measuredAt === "string") return imported.measuredAt;
  if (typeof summary?.measuredAt === "string") return summary.measuredAt;
  if (typeof doc.measuredAt === "string") return doc.measuredAt;
  return null;
}

/**
 * Detect measured import / runtime pack from a collector report — never from
 * statusHint=pass alone (that would launder the Evidence Assurance Tier floor).
 */
function reportHasMeasuredImport(
  outDir: string,
  reportRef: string | undefined,
): boolean {
  if (!reportRef?.startsWith("imports/")) return false;
  const path = join(outDir, reportRef);
  if (!existsSync(path)) return false;
  try {
    const doc = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    const summary =
      doc.summary && typeof doc.summary === "object" && !Array.isArray(doc.summary)
        ? (doc.summary as Record<string, unknown>)
        : null;
    const imported =
      doc.importedResults &&
      typeof doc.importedResults === "object" &&
      !Array.isArray(doc.importedResults)
        ? (doc.importedResults as Record<string, unknown>)
        : null;
    const declaredAt = reportMeasuredAt(doc, summary, imported);
    const summaryTier = parseEvidenceTier(summary?.achievedTier);
    if (
      (summaryTier === "E4" || summaryTier === "E5") &&
      measuredAtFresh(declaredAt)
    ) {
      return true;
    }
    if (summary?.measuredEvidence === true && measuredAtFresh(declaredAt)) {
      return true;
    }

    if (imported?.found === true && measuredAtFresh(declaredAt)) {
      return true;
    }
    // Coverage JSON style: top-level measuredAt with PASS-unlock fields present.
    if (
      typeof doc.measuredAt === "string" &&
      measuredAtFresh(doc.measuredAt) &&
      !reportRef.includes("-report.json")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Provenance-backed evidence type IDs from import JSON + graph signals. */
function observedEvidenceTypesFor(
  outDir: string,
  reportRef: string | undefined,
  related: EvidenceNode[],
): string[] {
  const ids = new Set<string>();
  for (const n of related) {
    for (const s of n.signals ?? []) {
      if (typeof s === "string" && /^[a-z][a-z0-9_]*$/.test(s)) ids.add(s);
    }
  }
  if (!reportRef?.startsWith("imports/")) return [...ids];
  const path = join(outDir, reportRef);
  if (!existsSync(path)) return [...ids];
  try {
    const doc = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    const buckets: unknown[] = [
      doc.evidenceTypes,
      doc.matchedEvidence,
      doc.summary &&
      typeof doc.summary === "object" &&
      !Array.isArray(doc.summary)
        ? (doc.summary as Record<string, unknown>).evidenceTypes
        : null,
    ];
    for (const bucket of buckets) {
      if (!Array.isArray(bucket)) continue;
      for (const raw of bucket) {
        if (typeof raw === "string" && /^[a-z][a-z0-9_]*$/.test(raw)) {
          ids.add(raw);
        }
      }
    }
  } catch {
    /* ignore unreadable reports */
  }
  return [...ids];
}

function pluginEmitsTierFor(pluginId: string | undefined): EvidenceTier | null {
  if (!pluginId) return null;
  return parseEvidenceTier(
    (pluginEvidenceTierMap as Record<string, string>)[pluginId],
  );
}

function nodesForCheck(
  graph: EvidenceGraph | undefined,
  checkId: string,
): EvidenceNode[] {
  if (!graph?.nodes?.length) return [];
  const excerptRank = (n: EvidenceNode): number => {
    const ex = (n.excerpt ?? "").trim();
    if (!ex) return 0;
    // Prefer customer prose over truncated JSON dumps in the flyout.
    if (ex.startsWith("{") || ex.startsWith("[")) return 1;
    if (/:\s*found=true|accept unauthenticated|declared route/i.test(ex)) {
      return 3;
    }
    return 2;
  };
  const idRank = (n: EvidenceNode): number =>
    /:report(?:$|:)/i.test(n.id) ? 2 : /:catalog(?:$|:)/i.test(n.id) ? 0 : 1;
  return graph.nodes
    .filter((n) => n.relatedCheckIds?.includes(checkId))
    .sort((a, b) => {
      const pr = (PRECEDENCE[b.class] ?? 0) - (PRECEDENCE[a.class] ?? 0);
      if (pr !== 0) return pr;
      const er = excerptRank(b) - excerptRank(a);
      if (er !== 0) return er;
      const ir = idRank(b) - idRank(a);
      if (ir !== 0) return ir;
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
  recommendedScore: number | null;
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
  // No recommended Checks in scope (profile-only assess) → gate PASS only → C.
  if (recommendedScore == null) return "C";
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
    // Profile (+ lenses) only. Collector hints outside the gate must not expand
    // the scored set — use --full for the whole catalog.
    for (const id of mandatoryIds) checkIds.add(id);
  }

  const controls: ControlOut[] = [];

  for (const checkId of [...checkIds].sort()) {
    const rule = rulesById.get(checkId);
    if (!rule || rule.status === "deprecated") continue;

    const mapped = hints.get(checkId);
    const hint: HintStatus = mapped?.hint ?? "not_demonstrated";
    let status = HINT_TO_STATUS[hint];
    const gate: "mandatory" | "recommended" = mandatoryIds.has(checkId)
      ? "mandatory"
      : "recommended";

    const related = nodesForCheck(graph, checkId);
    const conf = confidenceFromEvidence(related, Boolean(mapped));
    const minimumTier = resolveMinimumTier(
      rule.evidencePolicy,
      rule.detection?.capability,
    );
    const independentVerification = related.some(
      (n) =>
        n.signals?.includes("independent-verification") ||
        n.signals?.includes("independent_assessment"),
    );
    // Never treat statusHint=pass as measured — only fresh import packs.
    const measuredImportPresent = reportHasMeasuredImport(
      outDir,
      mapped?.reportRef,
    );
    const rawRepoSignals =
      related.some((n) => n.ref && n.ref !== "not-demonstrated") ||
      hint === "partial" ||
      hint === "fail" ||
      hint === "pass" ||
      Boolean(mapped?.reportRef?.startsWith("imports/"));
    const repoSignalsPresent =
      hint !== "not_demonstrated" &&
      hint !== "not_applicable" &&
      rawRepoSignals;
    const achievedTier = classifyAchievedTier({
      evidenceClasses: related.map((n) => n.class),
      measuredImportPresent,
      independentVerification,
      selfAttestationOnly:
        hint !== "not_demonstrated" &&
        related.length > 0 &&
        related.every((n) => n.class === "user"),
      repoSignalsPresent,
      pluginEmitsTier: pluginEmitsTierFor(mapped?.pluginId),
    });
    // Below-floor evidence cannot PASS (APRF-RFC-0011).
    if (status === "PASS" && !tierMeetsFloor(achievedTier, minimumTier)) {
      status = "PARTIAL";
    }
    const notApplicable = status === "NOT_APPLICABLE";
    // scoring.yaml: N/A is excluded, not a pass
    const passed = status === "PASS";
    const acceptable = rule.evidencePolicy?.acceptableEvidence ?? [];
    const matchedTypes = matchedEvidenceTypes({
      evidenceClasses: related.map((n) => n.class),
      acceptable,
      observedEvidenceTypes: observedEvidenceTypesFor(
        outDir,
        mapped?.reportRef,
        related,
      ),
      independentVerification,
      repoSignalsPresent,
    });
    const evidenceTier: ControlEvidenceTier = {
      minimum: minimumTier,
      achieved: achievedTier,
      acceptable: [...acceptable],
      matched: matchedTypes,
      verification: verificationFor({
        status,
        achieved: achievedTier,
        minimum: minimumTier,
      }),
    };
    // Floor-met PARTIAL with substance = metrics incomplete (not UNVERIFIED).
    if (
      status === "PARTIAL" &&
      evidenceTier.verification === "NONE" &&
      achievedTier !== "E0" &&
      repoSignalsPresent
    ) {
      evidenceTier.partialReason = "metrics_incomplete";
    }
    const tierGapNote =
      evidenceTier.verification === "UNVERIFIED"
        ? `Evidence tier ${achievedTier} is below required ${minimumTier} — UNVERIFIED; PASS needs measured evidence at or above ${minimumTier}.`
        : null;

    // Evidence found: prefer report signals where found=true (and their refs).
    // Fall back to graph node excerpts. Never invent statusHint=… (plugin=…) rows.
    const evidenceFound: Array<{ ref: string; excerpt?: string }> = [];
    if (mapped?.reportRef) {
      for (const e of evidenceFromFoundSignals(outDir, mapped.reportRef)) {
        evidenceFound.push(e);
      }
    }
    if (evidenceFound.length === 0) {
      // Prefer :report / prose excerpts; skip raw JSON when a better node exists.
      const hasProse = related.some((n) => {
        const ex = (n.excerpt ?? "").trim();
        return ex.length > 0 && !ex.startsWith("{") && !ex.startsWith("[");
      });
      for (const n of related.slice(0, 8)) {
        if (evidenceFound.some((e) => e.ref === n.ref)) continue;
        const raw = n.excerpt?.trim() ?? "";
        const looksJson = raw.startsWith("{") || raw.startsWith("[");
        if (hasProse && looksJson) continue;
        const maxLen = looksJson ? 4000 : 400;
        const excerpt =
          raw.length > 0
            ? raw.length > maxLen
              ? raw.slice(0, maxLen)
              : raw
            : undefined;
        evidenceFound.push({
          ref: n.ref,
          ...(excerpt ? { excerpt } : {}),
        });
      }
    }
    if (
      evidenceFound.length === 0 &&
      mapped?.reportRef?.startsWith("imports/")
    ) {
      evidenceFound.push({ ref: mapped.reportRef });
    }

    // NOT_DEMONSTRATED: "no signals" collector notes are not Evidence found —
    // show a clear default; actionable asks belong in Evidence still required.
    if (status === "NOT_DEMONSTRATED") {
      evidenceFound.length = 0;
      evidenceFound.push({
        ref: "not-demonstrated",
        excerpt:
          "No evidence demonstrated yet for this Check. Add the required imports or re-run collect with the needed signals.",
      });
    }

    // Prefer collector gap notes (already customer-facing when loaded). Avoid
    // dumping camelCase import recipes or raw catalog evidenceRequired lists.
    const requiredEvidenceMissing =
      status === "PASS" || status === "NOT_APPLICABLE"
        ? []
        : [
            ...(tierGapNote ? [tierGapNote] : []),
            ...(mapped?.gapNotes?.length
              ? mapped.gapNotes.map(softenGapJargon)
              : status === "NOT_DEMONSTRATED"
                ? [
                    mapped
                      ? `No measured evidence yet for this check. Add recent results under imports/${mapped.pluginId}/, or attest that this surface is out of scope.`
                      : `No scored collector report for this check yet. Re-run collect, or add measured evidence under imports/<plugin>/.`,
                    ...(rule.evidenceRequired ?? [])
                      .slice(0, 2)
                      .map(softenGapJargon),
                  ]
                : mapped
                  ? [customerFacingImportGap(mapped.pluginId)]
                  : [...(rule.evidenceRequired ?? [])].map(softenGapJargon)),
          ];

    // Collector may escalate (e.g. AGN-M1 high → critical when inventory unproven).
    const severity = mapped?.severityHint ?? rule.severity;
    const priority = priorityFor(gate, severity, status);
    const domain = domainForCategory(
      rule.category,
      catalog.domains ?? [],
      categoryDomain,
    );

    const fix = rule.recommendedFixes?.[0] ?? "";
    const threatIntel = getThreatIntelForCheck(checkId);
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
      crosswalks: getCrosswalksForCheck(checkId).map((c) => ({
        framework: c.framework,
        frameworkId: c.frameworkId,
        controlRef: c.controlRef,
        controlTitle: c.controlTitle,
        relation: c.relation,
        ...(c.url ? { url: c.url } : {}),
        ...(c.relatedPeerControlIds?.length
          ? { relatedPeerControlIds: c.relatedPeerControlIds }
          : {}),
        ...(c.relatedPeerRefs?.length
          ? { relatedPeerRefs: c.relatedPeerRefs }
          : {}),
      })),
      ...(threatIntel ? { threatIntel } : {}),
      gate,
      severity,
      status,
      passed,
      ...(notApplicable ? { notApplicable: true } : {}),
      confidence: conf.label,
      confidenceScore: Number(conf.score.toFixed(3)),
      evidenceFound,
      requiredEvidenceMissing,
      evidenceTier,
      reasoning: mapped
        ? `Evidence ${evidenceTier.achieved} (required ${evidenceTier.minimum}, ${evidenceTier.verification}). Primary class=${related[0]?.class ?? "ci"} (${evidenceFound.length} refs). Deterministic assess (no LLM).`
        : `No scored collector report — marked NOT_DEMONSTRATED (evidence ${evidenceTier.achieved}, required ${evidenceTier.minimum}). Add imports/ evidence or re-run collect. Manual: ${rule.manualVerification}`,
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
        ? {
            naReason:
              mapped?.naReason ??
              "Collector reported not_applicable (surface absent).",
          }
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

  // recommendedScore — recommended Checks only, severity-weighted.
  // Profile-only assess has no recommended Checks in scope → null (not 100).
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
  const recommendedScore: number | null =
    recWeight === 0 ? null : Math.round((recPassWeight / recWeight) * 100);

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
    if (c.gate === "mandatory" && c.status !== "PASS") {
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
      narrative: `APRF CLI assess against ${profile.name}${lenses.length ? ` + lenses [${lenses.map((l) => l.name).join(", ")}]` : ""}: ${hintedCount}/${controls.length} Checks scored from collector statusHints; unscored → NOT_DEMONSTRATED. Gate ${overallGatePassed ? "PASS" : "FAIL"} (${blockers.length} mandatory blockers, ${criticalBlockers.length} critical). recommendedScore=${recommendedScore == null ? "n/a" : recommendedScore} (prioritization only).`,
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
