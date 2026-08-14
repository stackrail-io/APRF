#!/usr/bin/env npx tsx
/**
 * Render aprf-assessment/REPORT.html from assessment.json
 *
 *   npx tsx skills/aprf-auditor/scripts/render-html-report.ts \
 *     --in ./aprf-assessment/assessment.json \
 *     --out ./aprf-assessment/REPORT.html
 *
 * Catalog fields (title, description, whyItMatters, …) are merged from
 * packages/aprf-engine/rules/by-domain Check YAML so incomplete agent
 * assessment.json still shows full Check text.
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { dirname, resolve, join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  getCrosswalksForCheck,
  getThreatIntelForCheck,
  SEVERITY_WEIGHT,
  getGeneratedCatalog,
  resolveMinimumTier,
  type DetectionCapability,
  type EvidenceTier,
} from "@stackrail-io/aprf-engine";
import { allPassSamples, getPassSamples } from "./pass-samples.ts";
import {
  customerFacingGap,
  pluginIdFromText,
} from "../collectors/lib/customer-gaps.ts";

const STACKRAIL = {
  home: "https://stackrail.io",
  aprf: "https://stackrail.io/aprf/",
  how: "https://stackrail.io/aprf/how/",
  assess: "https://stackrail.io/aprf/assess/",
  github: "https://github.com/stackrail-io/APRF",
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(SKILL_ROOT, "../..");
const RULES_ROOT = resolve(REPO_ROOT, "packages/aprf-engine/rules/by-domain");

/** Resolve StackRail owl mark for self-contained REPORT.html embedding. */
function resolveOwlMarkPath(): string | null {
  const candidates = [
    join(SCRIPT_DIR, "assets", "owl-mark.png"), // packages/aprf/dist/assets (bundled CLI)
    join(SCRIPT_DIR, "..", "assets", "owl-mark.png"), // skills/aprf-auditor/assets
    join(REPO_ROOT, "plugins", "aprf", "assets", "owl-mark.png"),
    join(process.cwd(), "plugins", "aprf", "assets", "owl-mark.png"),
    // From dist/cli.js → ../../../plugins/aprf/assets
    join(SCRIPT_DIR, "..", "..", "..", "plugins", "aprf", "assets", "owl-mark.png"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function brandLogoDataUri(): string | null {
  const path = resolveOwlMarkPath();
  if (!path) return null;
  try {
    const buf = readFileSync(path);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

type CatalogRule = {
  id: string;
  category?: string;
  title?: string;
  description?: string;
  whyItMatters?: string;
  passCondition?: string;
  evidenceRequired?: string[];
  evidencePolicy?: {
    minimumTier?: EvidenceTier | string;
    acceptableEvidence?: string[];
  };
  detection?: { capability?: DetectionCapability | string };
  recommendedFixes?: string[];
  manualVerification?: string;
  falsePositiveGuidance?: string;
  gate?: string;
  severity?: string;
  references?: Array<{ title?: string; url?: string } | string>;
};

function walkYamlFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walkYamlFiles(p, out);
    else if (ent.isFile() && (extname(ent.name) === ".yaml" || extname(ent.name) === ".yml")) {
      out.push(p);
    }
  }
  return out;
}

function loadCatalogById(rulesRoot = RULES_ROOT): Map<string, CatalogRule> {
  const map = new Map<string, CatalogRule>();
  // Prefer published generated catalog (works from npm CLI without repo tree).
  try {
    for (const rule of getGeneratedCatalog().rules) {
      if (rule?.id) map.set(String(rule.id), rule as CatalogRule);
    }
    if (map.size > 0) return map;
  } catch {
    /* fall through to YAML walk */
  }
  for (const file of walkYamlFiles(rulesRoot)) {
    try {
      const doc = parseYaml(readFileSync(file, "utf8")) as CatalogRule;
      if (doc?.id) map.set(String(doc.id), doc);
    } catch {
      /* skip unreadable */
    }
  }
  return map;
}

/** Prefer catalog YAML over agent paraphrases for normative Check fields. */
function enrichControlsFromCatalog(
  controls: Control[],
  catalog: Map<string, CatalogRule>,
): Control[] {
  return controls.map((c) => {
    const rule = catalog.get(c.checkId);
    if (!rule) return c;
    const recommendedFixes =
      rule.recommendedFixes?.length ? rule.recommendedFixes : c.recommendedFixes;
    const recommendedAction =
      recommendedFixes?.length ?
        recommendedFixes.map((f, i) => `${i + 1}) ${f}`).join(" ")
      : c.recommendedAction;
    const remFix =
      recommendedFixes?.length ? recommendedFixes[0] : c.remediation?.fix;
    const minimum = resolveMinimumTier(
      rule.evidencePolicy as
        | { minimumTier?: EvidenceTier; acceptableEvidence?: string[] }
        | undefined,
      rule.detection?.capability as DetectionCapability | undefined,
    );
    const acceptable = rule.evidencePolicy?.acceptableEvidence ?? [];
    const evidenceTier: Control["evidenceTier"] = c.evidenceTier
      ? {
          ...c.evidenceTier,
          minimum: c.evidenceTier.minimum ?? minimum,
          acceptable:
            c.evidenceTier.acceptable?.length ?
              c.evidenceTier.acceptable
            : [...acceptable],
        }
      : undefined;
    return {
      ...c,
      title: rule.title || c.title,
      category: rule.category || c.category,
      gate: rule.gate || c.gate,
      severity: rule.severity || c.severity,
      description: rule.description ?? c.description,
      whyItMatters: rule.whyItMatters ?? c.whyItMatters,
      passCondition: rule.passCondition ?? c.passCondition,
      evidenceRequired: rule.evidenceRequired ?? c.evidenceRequired,
      ...(evidenceTier ? { evidenceTier } : {}),
      recommendedFixes,
      manualVerification: rule.manualVerification ?? c.manualVerification,
      falsePositiveGuidance:
        rule.falsePositiveGuidance ?? c.falsePositiveGuidance,
      references: rule.references ?? c.references,
      recommendedAction,
      remediation:
        c.remediation || remFix ?
          {
            fix: remFix || c.remediation?.fix || "",
            example: c.remediation?.example,
            owner: c.remediation?.owner,
            estimatedEffort: c.remediation?.estimatedEffort,
          }
        : c.remediation,
    };
  });
}

type Finding = {
  checkId: string;
  title?: string;
  status: string;
  summary: string;
  priority?: string;
};

type Control = {
  checkId: string;
  title: string;
  category: string;
  /** APRF domain (security, agents, …). Falls back from category when omitted. */
  domain?: string;
  gate: string;
  severity: string;
  status: string;
  confidence: string;
  confidenceScore?: number;
  priority: string;
  reasoning: string;
  recommendedAction: string;
  naReason?: string;
  /** Verbatim from Check YAML — required for faithful reporting */
  passCondition?: string;
  evidenceRequired?: string[];
  recommendedFixes?: string[];
  manualVerification?: string;
  falsePositiveGuidance?: string;
  description?: string;
  whyItMatters?: string;
  references?: Array<{ title?: string; url?: string } | string>;
  evidenceFound?: Array<{ ref: string; excerpt?: string }>;
  requiredEvidenceMissing?: string[];
  /** Evidence Assurance Tier rollup (APRF-RFC-0011). */
  evidenceTier?: {
    minimum?: string;
    achieved?: string;
    acceptable?: string[];
    matched?: string[];
    verification?: "NONE" | "UNVERIFIED" | "VERIFIED" | "NOT_APPLICABLE" | string;
    partialReason?: "metrics_incomplete" | string;
  };
  /** Why the control exists; falls back to the catalog threat map. */
  threatIntel?: {
    securityIntent?: string;
    threats?: string[];
    protects?: string[];
    mitre?: { atlas?: string[]; attack?: string[] };
    mappingRationale?: string;
  };
  /** Informative peer-framework alignment; falls back to the catalog crosswalks. */
  crosswalks?: Array<{
    framework: string;
    frameworkId?: string;
    controlRef: string;
    controlTitle?: string;
    relation: string;
    url?: string;
    relatedPeerControlIds?: string[];
    relatedPeerRefs?: string[];
  }>;
  remediation?: {
    fix: string;
    example?: string;
    owner?: string;
    estimatedEffort?: string;
  };
};

type Assessment = {
  aprfVersion: string;
  skillVersion: string;
  assessedAt: string;
  subject: { name: string; path: string; gitCommit?: string };
  scope: {
    profileId: string;
    criticality: number;
    lensIds?: string[];
    systemType?: string;
    assessmentKind?: string;
    scopeId?: string;
    reportBanner?: string;
    excludedCheckIds?: Array<{ id: string; reason: string }>;
  };
  executiveSummary: {
    overallGatePassed: boolean;
    criticalityTier?: number;
    criticalityName?: string;
    requiredCapabilityLevel?: number;
    requiredCapabilityName?: string;
    assessedCapabilityLevel?: number;
    assessedCapabilityName?: string;
    maturityUrl?: string;
    overallGrade?: string;
    riskLevel?: string;
    assessmentConfidence: string;
    recommendedScore: number | null;
    blockerCount: number;
    criticalBlockerCount: number;
    narrative: string;
  };
  domainScores: Array<{
    domain: string;
    score: number;
    mandatoryGatePassed: boolean;
  }>;
  controls: Control[];
  findings: {
    critical: Finding[];
    high: Finding[];
    medium: Finding[];
    low: Finding[];
    quickWins: Finding[];
    productionBlockers: Finding[];
  };
  /** Canonical: days30/days90/longTerm string[]. Aliases/objects normalized at render. */
  roadmaps: Record<string, unknown>;
  discovery?: {
    found?: string[];
    notObserved?: string[];
    requiredEvidenceMissing?: string[];
    /** @deprecated use notObserved */
    absent?: string[];
  };
  disclaimer: string;
};

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Pretty-print JSON inside an evidence excerpt when present; otherwise escape as text. */
function formatEvidenceExcerpt(excerpt: string): string {
  const trimmed = excerpt.trim();
  if (!trimmed) return "";

  const tryParse = (raw: string): string | null => {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return null;
    }
  };

  // Whole excerpt is JSON
  const whole = tryParse(trimmed);
  if (whole != null) {
    return `<pre class="evidence-json" tabindex="0"><code>${esc(whole)}</code></pre>`;
  }

  // Common collector shape: "statusHint=fail; {…}" (or any prefix before first { / [)
  const objStart = trimmed.search(/[\[{]/);
  if (objStart >= 0) {
    const prefix = trimmed.slice(0, objStart).replace(/[;\s]+$/, "").trim();
    const jsonRaw = trimmed.slice(objStart);
    const pretty = tryParse(jsonRaw);
    if (pretty != null) {
      const lead = prefix ? `<span class="evidence-lead">${esc(prefix)}</span>` : "";
      return `${lead}<pre class="evidence-json" tabindex="0"><code>${esc(pretty)}</code></pre>`;
    }
    // Truncated JSON (assess used to slice mid-object): show in a code block anyway.
    if (/^[\[{]/.test(jsonRaw) && (jsonRaw.includes('"') || jsonRaw.includes(":"))) {
      const lead = prefix ? `<span class="evidence-lead">${esc(prefix)}</span>` : "";
      return `${lead}<pre class="evidence-json" tabindex="0"><code>${esc(jsonRaw)}</code></pre>`;
    }
  }

  // Semicolon-separated findings → readable list (declared route failures, etc.)
  if (trimmed.includes("; ") && /→|HTTP\s+\d{3}|declared route/i.test(trimmed)) {
    const parts = trimmed.split(/;\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return `<ul class="evidence-findings">${parts
        .map((p) => `<li>${esc(p)}</li>`)
        .join("")}</ul>`;
    }
  }

  return ` — ${esc(excerpt)}`;
}

function formatEvidenceItem(e: { ref: string; excerpt?: string }): string {
  const excerpt = (e.excerpt ?? "").trim();
  // Default placeholder for NOT_DEMONSTRATED (not a real artifact ref).
  if (e.ref === "not-demonstrated") {
    return `<li class="evidence-item evidence-none">${esc(
      excerpt ||
        "No evidence demonstrated yet for this Check. Add the required imports or re-run collect with the needed signals.",
    )}</li>`;
  }
  // Signal refs that are already the finding (METHOD path → status [file])
  const findingRef = /→|HTTP\s+\d{3}/i.test(e.ref);
  const foundMatch = excerpt.match(
    /^([A-Za-z0-9_-]+):\s*found=true(?:\s*[—–-]\s*(.+))?$/i,
  );
  if (findingRef && foundMatch) {
    const detail = (foundMatch[2] ?? "unauthenticated caller not rejected").trim();
    return `<li class="evidence-item evidence-finding"><code>${esc(e.ref)}</code><span class="evidence-detail"> — ${esc(detail)}</span></li>`;
  }

  const excerptHtml = excerpt ? formatEvidenceExcerpt(excerpt) : "";
  const hasBlock =
    excerptHtml.includes('class="evidence-json"') ||
    excerptHtml.includes('class="evidence-findings"');
  if (hasBlock) {
    return `<li class="evidence-item"><div class="evidence-ref"><code>${esc(e.ref)}</code></div>${excerptHtml}</li>`;
  }
  return `<li class="evidence-item"><code>${esc(e.ref)}</code>${excerptHtml}</li>`;
}

/** Split catalog prose like "1) … 2) … 3) …" into ordered-list items. */
function splitNumberedSteps(text: string): string[] | null {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!/^\d+\)\s/.test(trimmed)) return null;
  const chunks = trimmed.split(/\s+(?=\d+\)\s)/);
  if (chunks.length < 2) return null;
  if (!chunks.every((c) => /^\d+\)\s+\S/.test(c))) return null;
  return chunks.map((c) => c.replace(/^\d+\)\s*/, "").trim());
}

function formatManualVerification(text: string): string {
  const steps = splitNumberedSteps(text);
  if (!steps) {
    return `<p><strong>Manual verification:</strong> ${esc(text)}</p>`;
  }
  return `<p><strong>Manual verification:</strong></p><ol class="manual-steps">${steps
    .map((s) => `<li>${esc(s)}</li>`)
    .join("")}</ol>`;
}

type RoadmapItem =
  | string
  | {
      checkId?: string;
      title?: string;
      action?: string;
      priority?: string;
    };

type RoadmapRef = { checkId: string; priority?: string };

/** Extract check id (+ optional priority) from schema strings or object items. */
function parseRoadmapRef(item: RoadmapItem): RoadmapRef | null {
  if (item && typeof item === "object") {
    const checkId = (item.checkId ?? "").trim();
    if (!checkId) return null;
    const priority = (item.priority ?? "").trim() || undefined;
    return { checkId, priority };
  }
  if (typeof item !== "string") return null;
  const trimmed = item.trim();
  // "SEC2-M1: …" / "AGN-M1 (P1) — …" / "AUTHN-M1 (P1) — Title: action"
  const m = trimmed.match(
    /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)(?:\s*\(([Pp][0-3])\))?/,
  );
  if (!m) return null;
  return { checkId: m[1], priority: m[2]?.toUpperCase() };
}

function pickRoadmapBucket(
  raw: Record<string, unknown>,
  keys: string[],
): RoadmapItem[] {
  for (const k of keys) {
    const v = raw[k];
    if (Array.isArray(v) && v.length > 0) return v as RoadmapItem[];
  }
  for (const k of keys) {
    const v = raw[k];
    if (Array.isArray(v)) return v as RoadmapItem[];
  }
  return [];
}

/** Map schema + common aliases to compact check refs for the HTML roadmap. */
function normalizeRoadmaps(raw: unknown): {
  days30: RoadmapRef[];
  days90: RoadmapRef[];
  longTerm: RoadmapRef[];
} {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const toRefs = (items: RoadmapItem[]) =>
    items
      .map(parseRoadmapRef)
      .filter((r): r is RoadmapRef => r != null)
      .filter(
        (r, i, arr) => arr.findIndex((x) => x.checkId === r.checkId) === i,
      );
  return {
    days30: toRefs(pickRoadmapBucket(obj, ["days30", "30days"])),
    // 60days is a non-schema mid bucket some assessments use; fold into days90
    days90: toRefs(pickRoadmapBucket(obj, ["days90", "90days", "60days"])),
    longTerm: toRefs(
      pickRoadmapBucket(obj, ["longTerm", "longterm", "long-term", "long_term"]),
    ),
  };
}

function renderRoadmapBucket(label: string, items: RoadmapRef[]): string {
  if (!items.length) {
    return `<section class="block"><h3>${esc(label)}</h3><p class="empty">None</p></section>`;
  }
  const lis = items
    .map((r) => {
      const prio = r.priority
        ? `<span class="prio">${esc(r.priority)}</span>`
        : "";
      return `<li><button type="button" class="roadmap-check" data-control-id="${esc(r.checkId)}" aria-label="Open details for ${esc(r.checkId)}"><code>${esc(r.checkId)}</code>${prio}</button></li>`;
    })
    .join("");
  return `<section class="block"><h3>${esc(label)}</h3><ul class="roadmap-list">${lis}</ul></section>`;
}

const BELOW_FLOOR_LABEL = "UNVERIFIED — below floor";
const METRICS_INCOMPLETE_LABEL = "Implemented — metrics incomplete";

function evidenceTierLine(c: Control): string {
  const t = c.evidenceTier;
  if (!t?.minimum && !t?.achieved) return "";
  const achieved = t.achieved ?? "E0";
  const minimum = t.minimum ?? "E0";
  const ver = t.verification ?? "NONE";
  return `Evidence: ${achieved} · Required: ${minimum} · ${ver}`;
}

/** APRF-RFC-0011: achieved tier below Check minimumTier. */
function isBelowFloor(c: Control): boolean {
  return c.evidenceTier?.verification === "UNVERIFIED";
}

/**
 * PARTIAL with floor met but incomplete measured metrics — prefer assess
 * evidenceTier.partialReason; legacy fallback is PARTIAL + evidenceFound when
 * not below floor. Must not be labeled UNVERIFIED.
 */
function isMetricsIncomplete(c: Control): boolean {
  if (isBelowFloor(c)) return false;
  if (c.evidenceTier?.partialReason === "metrics_incomplete") return true;
  // Legacy assessments (pre-partialReason): do not treat every PARTIAL as
  // metrics-incomplete — only when verification is NONE (floor met) with refs.
  if ((c.status || "").toUpperCase().replace(/-/g, "_") !== "PARTIAL") {
    return false;
  }
  if (
    c.evidenceTier?.verification &&
    c.evidenceTier.verification !== "NONE"
  ) {
    return false;
  }
  if (!c.evidenceTier?.achieved || c.evidenceTier.achieved === "E0") {
    return false;
  }
  return (c.evidenceFound ?? []).some(
    (e) => e?.ref && e.ref !== "not-demonstrated",
  );
}

/** Table filter: below-floor UNVERIFIED or metrics-incomplete PARTIAL. */
function needsVerification(c: Control): boolean {
  return isBelowFloor(c) || isMetricsIncomplete(c);
}

function verificationSubLabel(c: Control): string {
  if (isBelowFloor(c)) return BELOW_FLOOR_LABEL;
  if (isMetricsIncomplete(c)) return METRICS_INCOMPLETE_LABEL;
  return "";
}

function statusClass(status: string): string {
  switch (status) {
    case "PASS":
      return "ok";
    case "FAIL":
      return "bad";
    case "PARTIAL":
      return "warn";
    case "NOT_DEMONSTRATED":
      return "muted";
    case "NOT_APPLICABLE":
      return "na";
    default:
      return "muted";
  }
}

function countByStatus(controls: Control[]): Record<string, number> {
  const order = [
    "PASS",
    "FAIL",
    "PARTIAL",
    "NOT_DEMONSTRATED",
    "NOT_APPLICABLE",
  ];
  const counts: Record<string, number> = Object.fromEntries(
    order.map((k) => [k, 0]),
  );
  for (const c of controls) {
    counts[c.status] = (counts[c.status] ?? 0) + 1;
  }
  return counts;
}

function countBySeverity(controls: Control[]): Record<string, number> {
  const order = ["critical", "high", "medium", "low"];
  const counts: Record<string, number> = Object.fromEntries(
    order.map((k) => [k, 0]),
  );
  for (const c of controls) {
    const s = (c.severity || "medium").toLowerCase();
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}

/** SVG donut from status counts */
function statusDonut(counts: Record<string, number>): string {
  const colors: Record<string, string> = {
    PASS: "#1b6b3a",
    FAIL: "#9b1c1c",
    PARTIAL: "#8a5a00",
    NOT_DEMONSTRATED: "#6b7280",
    NOT_APPLICABLE: "#94a3b8",
  };
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0) || 1;
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = entries
    .map(([label, n]) => {
      const len = (n / total) * c;
      const circle = `<circle class="donut-seg" r="${r}" cx="50" cy="50" fill="transparent"
        stroke="${colors[label] ?? "#666"}" stroke-width="14"
        stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}"
        transform="rotate(-90 50 50)">
        <title>${esc(label)}: ${n}</title>
      </circle>`;
      offset += len;
      return circle;
    })
    .join("\n");
  const legend = entries
    .map(
      ([label, n]) =>
        `<li><span class="swatch" style="background:${colors[label]}"></span>${esc(label)} <strong>${n}</strong> (${Math.round((n / total) * 100)}%)</li>`,
    )
    .join("");
  return `<div class="viz-card">
  <h3>Control status mix</h3>
  <div class="viz-row">
    <svg viewBox="0 0 100 100" class="donut" role="img" aria-label="Control status distribution">
      <circle r="42" cx="50" cy="50" fill="transparent" stroke="#e8ecef" stroke-width="14"></circle>
      ${arcs}
      <text x="50" y="48" text-anchor="middle" class="donut-center">${total}</text>
      <text x="50" y="58" text-anchor="middle" class="donut-sub">controls</text>
    </svg>
    <ul class="legend">${legend}</ul>
  </div>
</div>`;
}

function severityBars(counts: Record<string, number>): string {
  const total = Object.values(counts).reduce((s, n) => s + n, 0) || 1;
  const colors: Record<string, string> = {
    critical: "#9b1c1c",
    high: "#b45309",
    medium: "#0f3d4c",
    low: "#64748b",
  };
  const rows = Object.entries(counts)
    .map(([k, n]) => {
      const w = Math.round((n / total) * 100);
      return `<div class="bar-row">
  <div class="bar-label">${esc(k)}</div>
  <div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${colors[k] ?? "#666"}"></div></div>
  <div class="bar-val">${n}</div>
</div>`;
    })
    .join("\n");
  return `<div class="viz-card">
  <h3>Severity mix</h3>
  <div class="bars">${rows}</div>
</div>`;
}

function scoreGauge(score: number | null, gatePass: boolean): string {
  if (score == null) {
    return `<div class="viz-card">
  <h3>Recommended score <span class="meta">(non-gate)</span></h3>
  <div class="gauge-wrap">
    <svg viewBox="0 0 120 70" class="gauge" role="img" aria-label="Recommended score not scored">
      <path d="M 14 60 A 46 46 0 0 1 106 60" fill="none" stroke="#e8ecef" stroke-width="10" stroke-linecap="round"/>
      <text x="60" y="58" text-anchor="middle" class="gauge-val">n/a</text>
    </svg>
    <p class="meta">Gate ${gatePass ? "PASS" : "FAIL"} · recommended Checks not in scope (use --full)</p>
  </div>
</div>`;
  }
  const s = Math.max(0, Math.min(100, score));
  const r = 46;
  const c = Math.PI * r; // half circle
  const fill = (s / 100) * c;
  const color = gatePass ? "#1b6b3a" : "#9b1c1c";
  return `<div class="viz-card">
  <h3>Recommended score <span class="meta">(non-gate)</span></h3>
  <div class="gauge-wrap">
    <svg viewBox="0 0 120 70" class="gauge" role="img" aria-label="Recommended score ${s}">
      <path d="M 14 60 A 46 46 0 0 1 106 60" fill="none" stroke="#e8ecef" stroke-width="10" stroke-linecap="round"/>
      <path d="M 14 60 A 46 46 0 0 1 106 60" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"
        stroke-dasharray="${fill} ${c}" />
      <text x="60" y="58" text-anchor="middle" class="gauge-val">${s}</text>
    </svg>
    <p class="meta">Gate ${gatePass ? "PASS" : "FAIL"} · prioritization only, not certification</p>
  </div>
</div>`;
}

function tierLabel(a: Assessment): string {
  const t = a.executiveSummary.criticalityTier ?? a.scope.criticality;
  const name =
    a.executiveSummary.criticalityName ??
    ({ 0: "Sandbox", 1: "Internal", 2: "Production", 3: "Mission Critical" }[
      t as 0 | 1 | 2 | 3
    ] ?? "—");
  return `Tier ${t} · ${name}`;
}

function capabilityLabel(a: Assessment): string {
  const lvl =
    a.executiveSummary.requiredCapabilityLevel ??
    ({ 0: 1, 1: 2, 2: 3, 3: 4 }[a.scope.criticality as 0 | 1 | 2 | 3] ?? 3);
  const name =
    a.executiveSummary.requiredCapabilityName ??
    ({
      1: "Initial",
      2: "Managed",
      3: "Defined",
      4: "Quantitatively Managed",
      5: "Optimizing",
    }[lvl as 1 | 2 | 3 | 4 | 5] ?? "—");
  return `L${lvl} · ${name}`;
}

function discoveryList(
  label: string,
  items: string[] | undefined,
  note?: string,
): string {
  const body =
    items?.length ?
      items.map((x) => `<code>${esc(x)}</code>`).join(" ")
    : `<span class="empty">—</span>`;
  return `<p><strong>${esc(label)}:</strong> ${body}${note ? ` <span class="meta">— ${esc(note)}</span>` : ""}</p>`;
}

/** Category id → display name — mirrors packages/aprf-engine/rules/_index/categories.yaml */
const CATEGORY_LABEL: Record<string, string> = {
  "ai-security": "Adversarial Security",
  authentication: "Authentication",
  authorization: "Authorization",
  secrets: "Secrets",
  "tool-safety": "Tool Safety",
  "supply-chain": "Supply Chain Integrity",
  infrastructure: "Infrastructure",
  "safety-responsible-ai": "Safety & Responsible AI",
  explainability: "Explainability & Transparency",
  "data-privacy": "Data Privacy",
  "data-governance": "Data Governance & Quality",
  "memory-management": "Memory Management",
  "model-governance": "Model Governance",
  "prompt-engineering": "Prompt Engineering",
  "context-engineering": "Context Engineering",
  evaluation: "Evaluation",
  "agent-governance": "Agent Governance",
  "human-approval": "Human Approval",
  observability: "Observability",
  "performance-slo": "Performance & SLO Engineering",
  "reliability-continuity": "Reliability & Continuity",
  "change-management": "Change Management & Release",
  "incident-readiness": "Incident Readiness",
  "cost-optimization": "Cost Optimization",
  "organizational-governance": "Organizational Governance",
  compliance: "Compliance",
  "platform-engineering": "Platform Engineering",
};

/** Category (pillar) → APRF domain id — mirrors categories.yaml */
const DOMAIN_BY_CATEGORY: Record<string, string> = {
  "ai-security": "security",
  authentication: "security",
  authorization: "security",
  secrets: "security",
  "tool-safety": "security",
  "supply-chain": "security",
  infrastructure: "security",
  "safety-responsible-ai": "safety",
  explainability: "safety",
  "data-privacy": "data",
  "data-governance": "data",
  "memory-management": "data",
  "model-governance": "model-lifecycle",
  "prompt-engineering": "model-lifecycle",
  "context-engineering": "model-lifecycle",
  evaluation: "model-lifecycle",
  "agent-governance": "agents",
  "human-approval": "agents",
  observability: "reliability",
  "performance-slo": "reliability",
  "reliability-continuity": "reliability",
  "change-management": "reliability",
  "incident-readiness": "reliability",
  "cost-optimization": "cost",
  "organizational-governance": "governance",
  compliance: "governance",
  "platform-engineering": "cross-cutting",
};

function titleCaseDomain(domain: string): string {
  return domain
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Resolve APRF domain id (security, data, …) — never leave a category slug as the domain. */
function domainIdForControl(c: Control): string {
  const raw = (c.domain && c.domain.trim()) || "";
  // If assessment wrongly stored category as domain, map it.
  if (raw && DOMAIN_BY_CATEGORY[raw]) return DOMAIN_BY_CATEGORY[raw];
  if (raw === "platform") return "cross-cutting";
  if (raw && Object.values(DOMAIN_BY_CATEGORY).includes(raw)) return raw;
  if (DOMAIN_BY_CATEGORY[c.category]) return DOMAIN_BY_CATEGORY[c.category];
  return raw || c.category || "other";
}

function controlDomain(c: Control): string {
  return titleCaseDomain(domainIdForControl(c));
}

/** Roll up domain scores from controls (corrects category-as-domain mistakes in assessment.json). */
function domainScoresFromControls(
  controls: Control[],
): Assessment["domainScores"] {
  const order = [
    "security",
    "safety",
    "data",
    "model-lifecycle",
    "agents",
    "reliability",
    "cost",
    "governance",
    "cross-cutting",
  ];
  const byDomain = new Map<string, Control[]>();
  for (const c of controls) {
    const id = domainIdForControl(c);
    const list = byDomain.get(id) ?? [];
    list.push(c);
    byDomain.set(id, list);
  }
  const ids = [
    ...order.filter((d) => byDomain.has(d)),
    ...[...byDomain.keys()].filter((d) => !order.includes(d)),
  ];
  return ids.map((domain) => {
    const list = byDomain.get(domain) ?? [];
    const applicable = list.filter((c) => c.status !== "NOT_APPLICABLE");
    const satisfied = applicable.filter((c) => c.status === "PASS");
    const notDemonstrated = applicable.filter(
      (c) => c.status === "NOT_DEMONSTRATED",
    ).length;
    const blockers = applicable.filter((c) =>
      ["FAIL", "PARTIAL", "NOT_DEMONSTRATED"].includes(c.status),
    );
    const score =
      applicable.length === 0
        ? 100
        : Math.round((satisfied.length / applicable.length) * 100);
    return {
      domain: titleCaseDomain(domain),
      score,
      mandatoryGatePassed: blockers.length === 0,
      applicable: applicable.length,
      satisfied: satisfied.length,
      notDemonstrated,
    };
  });
}

/** Human category from Check YAML `category` (pillar), not the rolled-up domain. */
function controlCategory(c: Control): string {
  return CATEGORY_LABEL[c.category] || titleCaseDomain(c.category);
}

function tagClass(tag: string): string {
  switch (tag.toLowerCase()) {
    case "production blocker":
    case "critical":
      return "bad";
    case "high":
      return "warn";
    case "medium":
      return "muted";
    case "low":
    case "quick win":
      return "ok";
    default:
      return "muted";
  }
}

function collectTags(a: Assessment): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  const add = (id: string, tag: string) => {
    const cur = tags.get(id) ?? [];
    if (!cur.some((t) => t.toLowerCase() === tag.toLowerCase())) cur.push(tag);
    tags.set(id, cur);
  };
  // Pack tags only — do not mirror Status (PASS/FAIL/…) here.
  for (const f of a.findings.productionBlockers ?? [])
    add(f.checkId, "Production blocker");
  for (const f of a.findings.critical ?? []) add(f.checkId, "Critical");
  for (const f of a.findings.high ?? []) add(f.checkId, "High");
  for (const f of a.findings.medium ?? []) add(f.checkId, "Medium");
  for (const f of a.findings.low ?? []) add(f.checkId, "Low");
  for (const f of a.findings.quickWins ?? []) add(f.checkId, "Quick win");
  return tags;
}

function tagPills(tags: string[]): string {
  return tags
    .map((t) => `<span class="pill ${tagClass(t)}">${esc(t)}</span>`)
    .join(" ");
}

/** checkId → collector plugin ids (from generated plugin-check-map). */
let checkToPluginsCache: Map<string, string[]> | null = null;
function checkToPluginsMap(): Map<string, string[]> {
  if (checkToPluginsCache) return checkToPluginsCache;
  const map = new Map<string, string[]>();
  const candidates = [
    join(REPO_ROOT, "packages/aprf/src/generated/plugin-check-map.json"),
    join(SCRIPT_DIR, "generated/plugin-check-map.json"),
    join(SCRIPT_DIR, "../generated/plugin-check-map.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, string[]>;
      for (const [pluginId, checks] of Object.entries(raw)) {
        for (const checkId of checks ?? []) {
          const cur = map.get(checkId) ?? [];
          if (!cur.includes(pluginId)) cur.push(pluginId);
          map.set(checkId, cur);
        }
      }
      break;
    } catch {
      /* try next */
    }
  }
  checkToPluginsCache = map;
  return map;
}

const CLOUD_IMPORT_PLUGINS = new Set(["aws", "azure", "gcp"]);

/** Pick the most useful imports/ folder when several collectors map to one Check. */
function pickPrimaryPlugin(plugins: string[]): string | undefined {
  if (plugins.length === 0) return undefined;
  if (plugins.length === 1) return plugins[0];
  const nonCloud = plugins.filter((p) => !CLOUD_IMPORT_PLUGINS.has(p));
  const pool = nonCloud.length > 0 ? nonCloud : plugins;
  const score = (p: string) => {
    let s = 0;
    if (
      /hygiene|probe|inventory|redaction|limits|gate|charter|authz|authn|secrets/.test(
        p,
      )
    ) {
      s += 20;
    }
    if (p === "github-actions") s -= 8;
    if (CLOUD_IMPORT_PLUGINS.has(p)) s -= 20;
    s += Math.min(p.length, 40) * 0.01;
    return s;
  };
  return [...pool].sort((a, b) => score(b) - score(a) || a.localeCompare(b))[0];
}

function pluginForControl(c: Control): string | undefined {
  const mapped = checkToPluginsMap().get(c.checkId) ?? [];
  // Prefer an imports/ path already present on evidence for this control.
  for (const e of c.evidenceFound ?? []) {
    const id = pluginIdFromText(String(e.ref ?? ""));
    if (id && (mapped.length === 0 || mapped.includes(id))) return id;
  }
  for (const n of c.requiredEvidenceMissing ?? []) {
    const id = pluginIdFromText(n);
    if (
      id &&
      !CLOUD_IMPORT_PLUGINS.has(id) &&
      (mapped.length === 0 || mapped.includes(id))
    ) {
      return id;
    }
  }
  return pickPrimaryPlugin(mapped);
}

/** Soften leftover assess jargon for customer-facing REPORT.html. */
function customerFacingRequiredEvidence(
  note: string,
  fallbackPlugin?: string,
): string {
  const n = note.trim();
  // Prefer the Check's collector plugin over a path mentioned in a merged note.
  const plugin = fallbackPlugin ?? pluginIdFromText(n);
  if (/Evidence not yet demonstrated — import measured results/i.test(n)) {
    return plugin
      ? `No measured evidence yet for this check. Add recent results under imports/${plugin}/, or attest that this surface is out of scope.`
      : "No measured evidence yet for this check. Add recent measured results, or attest that this surface is out of scope.";
  }
  if (/No scored collector report for this Check/i.test(n)) {
    return plugin
      ? `No scored collector report for this check yet. Re-run collect, or add measured evidence under imports/${plugin}/.`
      : "No scored collector report for this check yet. Re-run collect, or add measured evidence under imports/<plugin>/.";
  }
  return customerFacingGap(n, plugin);
}

/**
 * One de-duplicated, customer-facing list for "What you need next".
 * Catalog recommendedFixes are deliberately NOT mixed in here — they render in
 * their own section and describe the whole control, not the remaining gap.
 */
function nextStepsForControl(c: Control): string[] {
  const plugin = pluginForControl(c);
  const steps = (c.requiredEvidenceMissing ?? [])
    .map((m) => customerFacingRequiredEvidence(m, plugin))
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
  return [...new Set(steps)];
}

/**
 * Peer-framework crosswalks for a Check. Prefers what the assessment recorded
 * (so a report stays faithful to the catalog version it was written against),
 * and falls back to the shipped catalog for assessments that predate the field.
 */
function crosswalksForControl(c: Control): NonNullable<Control["crosswalks"]> {
  // Distinguish absent (legacy assessment) from recorded empty (no mapping then).
  if (c.crosswalks !== undefined) return c.crosswalks;
  return getCrosswalksForCheck(c.checkId).map((x) => ({
    framework: x.framework,
    frameworkId: x.frameworkId,
    controlRef: x.controlRef,
    controlTitle: x.controlTitle,
    relation: x.relation,
    url: x.url,
    ...(x.relatedPeerControlIds?.length
      ? { relatedPeerControlIds: x.relatedPeerControlIds }
      : {}),
    ...(x.relatedPeerRefs?.length
      ? { relatedPeerRefs: x.relatedPeerRefs }
      : {}),
  }));
}

/** Threat context for a Check, preferring the assessment then the shipped catalog. */
function threatIntelForControl(c: Control): Control["threatIntel"] | null {
  if (c.threatIntel?.securityIntent) return c.threatIntel;
  return getThreatIntelForCheck(c.checkId);
}

/**
 * Deep-link a MITRE technique. ATLAS addresses sub-techniques by their full
 * dotted ID; ATT&CK nests them as a path segment under the parent technique.
 */
function mitreUrl(id: string, framework: "atlas" | "attack"): string {
  if (framework === "atlas") {
    return `https://atlas.mitre.org/techniques/${id}`;
  }
  const [parent, sub] = id.split(".");
  return sub
    ? `https://attack.mitre.org/techniques/${parent}/${sub}/`
    : `https://attack.mitre.org/techniques/${parent}/`;
}

function threatIntelBlock(c: Control): string {
  const ti = threatIntelForControl(c);
  if (!ti?.securityIntent) return "";

  const chips = (items: string[] | undefined, cls: string): string =>
    items?.length
      ? `<div class="meta-chips">${items
          .map((t) => `<span class="chip ${cls}">${esc(t)}</span>`)
          .join("")}</div>`
      : "";

  const atlas = ti.mitre?.atlas ?? [];
  const attack = ti.mitre?.attack ?? [];
  const techLinks = [
    ...atlas.map((id) => ({ id, url: mitreUrl(id, "atlas"), label: "ATLAS" })),
    ...attack.map((id) => ({ id, url: mitreUrl(id, "attack"), label: "ATT&CK" })),
  ];
  const mitreLine = techLinks.length
    ? `<p class="meta">MITRE: ${techLinks
        .map(
          (t) =>
            `<a href="${esc(t.url)}" rel="noopener">${esc(t.label)} ${esc(t.id)}</a>`,
        )
        .join(" · ")}</p>`
    : `<p class="meta">MITRE: no technique mapped — this control addresses governance or assurance rather than a specific adversary technique.</p>`;

  return `<div class="threat-intel">
  <p><strong>Why this control exists</strong> <span class="meta">— informative threat context; mappings reduce exposure and do not guarantee mitigation</span></p>
  <p>${esc(ti.securityIntent)}</p>
  ${ti.threats?.length ? `<p class="meta">Threats mitigated</p>${chips(ti.threats, "risk")}` : ""}
  ${ti.protects?.length ? `<p class="meta">Protects</p>${chips(ti.protects, "asset")}` : ""}
  ${mitreLine}
  ${ti.mappingRationale ? `<p>${esc(ti.mappingRationale)}</p>` : ""}
</div>`;
}

type ThreatExposure = {
  threat: string;
  checkIds: string[];
  blockers: number;
  weight: number;
};

/**
 * Rank threats by the exposure left open by unmet controls, so the summary can
 * answer "what is this system most exposed to right now" without opening every
 * Check. "Unmet" matches the domain-score and gate definition (FAIL, PARTIAL,
 * NOT_DEMONSTRATED) — it therefore includes controls that are merely unproven.
 */
function topThreatExposure(controls: Control[], limit = 6): ThreatExposure[] {
  const unmet = new Set(["FAIL", "PARTIAL", "NOT_DEMONSTRATED"]);
  const byThreat = new Map<string, ThreatExposure>();

  for (const c of controls) {
    const status = (c.status || "").toUpperCase().replace(/-/g, "_");
    if (!unmet.has(status)) continue;
    const threats = threatIntelForControl(c)?.threats ?? [];
    if (threats.length === 0) continue;

    const mandatory = (c.gate ?? "").toLowerCase() === "mandatory";
    const severity = (c.severity ?? "").toLowerCase() as keyof typeof SEVERITY_WEIGHT;
    // Gate-blocking controls count double: they hold production readiness open.
    const weight = (SEVERITY_WEIGHT[severity] ?? 1) * (mandatory ? 2 : 1);

    for (const threat of new Set(threats)) {
      const entry = byThreat.get(threat) ?? {
        threat,
        checkIds: [],
        blockers: 0,
        weight: 0,
      };
      entry.checkIds.push(c.checkId);
      if (mandatory) entry.blockers += 1;
      entry.weight += weight;
      byThreat.set(threat, entry);
    }
  }

  return [...byThreat.values()]
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        b.checkIds.length - a.checkIds.length ||
        a.threat.localeCompare(b.threat),
    )
    .slice(0, limit);
}

function topThreatsBlock(controls: Control[]): string {
  const top = topThreatExposure(controls);
  if (top.length === 0) return "";

  const rows = top
    .map((t) => {
      const shown = t.checkIds.slice(0, 4).map(esc).join(", ");
      const extra = t.checkIds.length - 4;
      const blockerNote =
        t.blockers > 0
          ? `<span class="pill bad">${t.blockers} gate-blocking</span>`
          : `<span class="pill muted">non-gate</span>`;
      return `<tr>
        <td><span class="chip risk">${esc(t.threat)}</span></td>
        <td>${t.checkIds.length}</td>
        <td>${blockerNote}</td>
        <td class="meta">${shown}${extra > 0 ? ` +${extra} more` : ""}</td>
      </tr>`;
    })
    .join("");

  return `<section class="threat-rollup">
  <h3>Top threat exposure</h3>
  <p class="meta" style="max-width:72ch">Threats carried by controls that are not yet met (failed, partial, or not demonstrated). Ranked by the severity of those controls, counting gate-blocking ones double. Threat context is informative — an unmet control means the exposure is unmitigated or unproven, not that an attack has occurred.</p>
  <div class="panel">
  <table>
    <thead><tr><th>Threat</th><th>Unmet controls</th><th>Gate impact</th><th>Checks</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>
  </section>`;
}

type EvidenceCoverage = {
  applicable: number;
  pass: number;
  partial: number;
  notDemonstrated: number;
  fail: number;
  needsVerification: number;
  metricsIncomplete: number;
  verified: number;
  belowFloor: number;
  requiredItems: number;
  missingItems: number;
};

/**
 * Status rollup for in-scope Checks assessed from the repo (and any
 * measured imports present) — derived from control statuses and evidence lists.
 */
function evidenceCoverage(controls: Control[]): EvidenceCoverage {
  const applicable = controls.filter((c) => {
    const s = (c.status || "").toUpperCase().replace(/-/g, "_");
    return s !== "NOT_APPLICABLE";
  });

  let pass = 0;
  let partial = 0;
  let notDemonstrated = 0;
  let fail = 0;
  let needsVerificationCount = 0;
  let metricsIncomplete = 0;
  let verified = 0;
  let belowFloor = 0;
  let requiredItems = 0;
  let missingItems = 0;

  for (const c of applicable) {
    const s = (c.status || "").toUpperCase().replace(/-/g, "_");
    if (s === "PASS") pass++;
    else if (s === "PARTIAL") partial++;
    else if (s === "NOT_DEMONSTRATED") notDemonstrated++;
    else if (s === "FAIL") fail++;

    if (needsVerification(c)) needsVerificationCount++;
    if (isMetricsIncomplete(c)) metricsIncomplete++;
    if (c.evidenceTier?.verification === "VERIFIED") verified++;
    if (isBelowFloor(c)) belowFloor++;

    requiredItems += (c.evidenceRequired ?? []).length;
    missingItems += (c.requiredEvidenceMissing ?? []).length;
  }

  return {
    applicable: applicable.length,
    pass,
    partial,
    notDemonstrated,
    fail,
    needsVerification: needsVerificationCount,
    metricsIncomplete,
    verified,
    belowFloor,
    requiredItems,
    missingItems,
  };
}

function evidenceCoverageBlock(controls: Control[]): string {
  const cov = evidenceCoverage(controls);
  if (cov.applicable === 0) return "";

  const passPct = Math.round((cov.pass / cov.applicable) * 100);
  const zeroPass = cov.pass === 0;

  return `<section class="evidence-coverage">
  <h3>Evidence coverage</h3>
  <p class="pass-callout" style="max-width:72ch"><strong>Repo collectors alone cannot produce PASS.</strong>
  Almost every APRF Check is <em>hybrid</em>: scanning the codebase finds signals (often shown as PARTIAL), but a PASS requires measured proof — drop results under <code>aprf-assessment/imports/&lt;plugin&gt;/</code> with a recent <code>measuredAt</code>, or run live probes where the collector supports them.
  <strong>You will not see PASS from a code scan alone</strong> — expect PARTIAL / NOT_DEMONSTRATED until measured imports exist.
  ${
    zeroPass
      ? `<strong>This assessment has 0 PASS</strong> among ${cov.applicable} in-scope Checks from the repo (expected for repo-only collect).`
      : `<strong>This assessment has ${cov.pass} PASS</strong> among ${cov.applicable} in-scope Checks from the repo (measured evidence was available for those).`
  }</p>
  <div class="grid" style="margin-top:0.85rem">
    <div class="stat"><div class="label">In-scope Checks from repo</div><div class="value">${cov.applicable}</div></div>
    <div class="stat"><div class="label">PASS</div><div class="value ${cov.pass ? "ok" : "muted"}">${cov.pass} <span class="meta">(${passPct}%)</span></div></div>
    <div class="stat"><div class="label">Verified (tier met)</div><div class="value ${cov.verified ? "ok" : "muted"}">${cov.verified}</div></div>
    <div class="stat"><div class="label">UNVERIFIED (below floor)</div><div class="value">${cov.belowFloor}</div></div>
    <div class="stat"><div class="label">PARTIAL</div><div class="value">${cov.partial}</div></div>
    <div class="stat"><div class="label">Not demonstrated</div><div class="value">${cov.notDemonstrated}</div></div>
    <div class="stat"><div class="label">FAIL</div><div class="value">${cov.fail}</div></div>
  </div>
  <p class="meta" style="max-width:72ch;margin-top:0.75rem">${cov.belowFloor} Check${cov.belowFloor === 1 ? "" : "s"} are <em>UNVERIFIED</em> — evidence tier below the Check floor (filter <em>Needs verification</em>).
  ${cov.metricsIncomplete} Check${cov.metricsIncomplete === 1 ? "" : "s"} have repo signals but incomplete measured metrics (same filter; not UNVERIFIED).
  Catalog lists ${cov.requiredItems} evidence item${cov.requiredItems === 1 ? "" : "s"} across in-scope Checks; this run still asks for ${cov.missingItems} gap note${cov.missingItems === 1 ? "" : "s"} (imports, probes, or scope attestation).</p>
  </section>`;
}

function controlDetailBody(c: Control): string {
  const statusKey = (c.status || "").toUpperCase().replace(/-/g, "_");
  const evidence =
    c.evidenceFound?.length ?
      `<ul class="evidence-list">${c.evidenceFound.map(formatEvidenceItem).join("")}</ul>`
    : statusKey === "NOT_DEMONSTRATED"
      ? `<p class="empty">No evidence demonstrated yet for this check.</p>`
      : `<p class="empty">None</p>`;
  const steps = nextStepsForControl(c);
  const missing =
    steps.length > 0
      ? `<p><strong>What you need next</strong></p><ul>${steps.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`
      : "";
  const samples = getPassSamples(c.checkId);
  const showPassSample =
    samples.length > 0 && statusKey !== "PASS" && statusKey !== "NOT_APPLICABLE";
  const passSampleAttach = showPassSample
    ? `<div class="pass-sample-attach">
    <p><strong>PASS samples</strong></p>
    <p class="meta">Click an attachment to preview. Copy into the destination path, then re-run collect + assess.</p>
    <ul class="pass-sample-list">${samples
      .map(
        (sample) => `<li>
      <button type="button" class="pass-sample-open" data-sample-id="${esc(sample.id)}" aria-haspopup="dialog">
        ${esc(sample.filename)}
      </button>
      <span class="meta">→ <code>${esc(sample.destination)}</code></span>
      <span class="meta">${esc(sample.hint)}</span>
    </li>`,
      )
      .join("")}</ul>
  </div>`
    : "";
  const evidenceRequired =
    c.evidenceRequired?.length ?
      `<p><strong>Evidence required</strong></p><ul>${c.evidenceRequired.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`
    : "";
  const recommendedFixes =
    c.recommendedFixes?.length ?
      `<p><strong>Recommended fixes</strong></p><ol>${c.recommendedFixes.map((m) => `<li>${esc(m)}</li>`).join("")}</ol>`
    : "";
  const refs =
    c.references?.length ?
      `<p><strong>References</strong></p><ul>${c.references
        .map((r) => {
          if (typeof r === "string") return `<li>${esc(r)}</li>`;
          const label = r.title || r.url || "link";
          return r.url
            ? `<li><a href="${esc(r.url)}" rel="noopener">${esc(label)}</a></li>`
            : `<li>${esc(label)}</li>`;
        })
        .join("")}</ul>`
    : "";
  const crosswalks = crosswalksForControl(c);
  const crosswalkBlock = (() => {
    if (crosswalks.length === 0) return "";
    const byFramework = new Map<string, NonNullable<Control["crosswalks"]>>();
    for (const x of crosswalks) {
      const key = x.frameworkId || x.framework;
      const list = byFramework.get(key) ?? [];
      list.push(x);
      byFramework.set(key, list);
    }
    const groups = [...byFramework.entries()]
      .map(([, items]) => {
        const name = items[0]?.framework ?? "Peer framework";
        const bullets = items
          .map((x) => {
            const label = `${x.controlRef}${x.controlTitle ? ` — ${x.controlTitle}` : ""}`;
            const linked = x.url
              ? `<a href="${esc(x.url)}" rel="noopener">${esc(label)}</a>`
              : esc(label);
            const relatedValues = x.relatedPeerRefs?.length
              ? x.relatedPeerRefs
              : (x.relatedPeerControlIds ?? []);
            const related =
              relatedValues.length > 0
                ? ` <span class="meta">related: ${esc(relatedValues.join(", "))}</span>`
                : "";
            return `<li>${linked} <span class="meta">(${esc(x.relation)})</span>${related}</li>`;
          })
          .join("");
        return `<li><strong>${esc(name)}</strong><ul>${bullets}</ul></li>`;
      })
      .join("");
    return `<p><strong>Framework crosswalk</strong> <span class="meta">— informative alignment only; not certification or proof of compliance</span></p>
      <ul>${groups}</ul>`;
  })();
  const catalogMissing =
    !c.description &&
    !c.whyItMatters &&
    !c.passCondition &&
    !c.recommendedFixes?.length &&
    !c.evidenceRequired?.length &&
    !c.references?.length;
  const catalog = `
  <p><strong>Title:</strong> ${esc(c.title)}</p>
  <p class="meta">Category: <code>${esc(c.category)}</code> (${esc(controlCategory(c))}) · Domain: ${esc(controlDomain(c))}</p>
  ${c.description ? `<p><strong>Description:</strong> ${esc(c.description)}</p>` : ""}
  ${c.whyItMatters ? `<p><strong>Why it matters:</strong> ${esc(c.whyItMatters)}</p>` : ""}
  ${threatIntelBlock(c)}
  ${refs}
  ${crosswalkBlock}
  ${c.passCondition ? `<p><strong>Pass condition:</strong> ${esc(c.passCondition)}</p>` : ""}
  ${evidenceRequired}
  ${c.manualVerification ? formatManualVerification(c.manualVerification) : ""}
  ${c.falsePositiveGuidance ? `<p><strong>False-positive guidance:</strong> ${esc(c.falsePositiveGuidance)}</p>` : ""}
  ${recommendedFixes}`;

  // Assessment-only block — do not repeat recommendedFixes / priority pills here.
  // Skip placeholder owners (e.g. "unassigned") and empty effort from CLI assess.
  const ownerRaw = (c.remediation?.owner ?? "").trim();
  const ownerOk =
    ownerRaw.length > 0 &&
    !/^(unassigned|unknown|n\/a|none|-)$/i.test(ownerRaw);
  const effortRaw = (c.remediation?.estimatedEffort ?? "").trim();
  const remMeta = [
    ownerOk ? `owner ${esc(ownerRaw)}` : "",
    effortRaw ? `effort ${esc(effortRaw)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const rem =
    remMeta || c.remediation?.example ?
      `<p><strong>Remediation tracking:</strong> ${remMeta || "—"}${c.remediation?.example ? `<br/><span class="meta">Repo note: ${esc(c.remediation.example)}</span>` : ""}</p>`
    : "";

  return `
  <p class="meta">${esc(controlCategory(c))} · ${esc(c.gate)} · ${esc(c.severity)} ·
    <span class="pill ${statusClass(c.status)}">${esc(c.status)}</span> ·
    confidence ${esc(c.confidence)}${c.confidenceScore != null ? ` (${esc(c.confidenceScore)})` : ""} ·
    ${esc(c.priority)}</p>
  ${
    evidenceTierLine(c)
      ? `<p class="meta"><strong>${esc(evidenceTierLine(c))}</strong></p>`
      : ""
  }
  ${
    isBelowFloor(c)
      ? `<p class="verify-callout"><strong>${esc(BELOW_FLOOR_LABEL)}</strong> — evidence tier is below the Check’s required assurance floor (${esc(c.evidenceTier?.achieved ?? "E0")} &lt; ${esc(c.evidenceTier?.minimum ?? "the floor")}). Status stays ${esc(c.status)} until measured evidence meets the floor.</p>`
      : isMetricsIncomplete(c)
        ? `<p class="verify-callout"><strong>${esc(METRICS_INCOMPLETE_LABEL)}</strong> — in-repo signals were found, but measured metrics or imports are still incomplete. Status stays ${esc(c.status)} (not UNVERIFIED).</p>`
        : ""
  }
  <section class="assessment-findings">
    <h4>This assessment</h4>
    <p><strong>Evidence found</strong></p>${evidence}
    ${missing}
    ${passSampleAttach}
    <p><strong>Reasoning:</strong> ${esc(c.reasoning)}</p>
    ${c.naReason ? `<p><strong>N/A rationale:</strong> ${esc(c.naReason)}</p>` : ""}
    ${rem}
  </section>
  <section class="catalog-rule">
    <h4>APRF Check (catalog)</h4>
    ${catalogMissing ? `<p class="empty">Catalog fields missing — Check YAML not found for ${esc(c.checkId)}.</p>` : catalog}
  </section>`;
}

/** Table listing + hidden detail panels for the flyout. */
function controlsTableAndFlyout(
  ordered: Control[],
  tagsById: Map<string, string[]>,
  statusCounts: Record<string, number>,
): { table: string; panels: string } {
  const rows = ordered
    .map((c) => {
      const tags = tagsById.get(c.checkId) ?? [];
      const verify = needsVerification(c);
      const verifyLabel = verificationSubLabel(c);
      return `<tr class="control-row" tabindex="0" role="button" data-control-id="${esc(c.checkId)}" data-status="${esc(c.status)}"${verify ? ` data-verify="1"` : ""}${isBelowFloor(c) ? ` data-below-floor="1"` : ""} aria-label="Open details for ${esc(c.checkId)}">
  <td><code>${esc(c.checkId)}</code></td>
  <td>${esc(c.title)}</td>
  <td>${esc(controlCategory(c))}<span class="domain-sub">${esc(controlDomain(c))} domain</span></td>
  <td><span class="pill ${statusClass(c.status)}">${esc(c.status)}</span>${verifyLabel ? `<span class="verify-sub">${esc(verifyLabel)}</span>` : ""}${evidenceTierLine(c) ? `<span class="verify-sub">${esc(evidenceTierLine(c))}</span>` : ""}</td>
  <td>${esc(c.confidence)}${c.confidenceScore != null ? ` <span class="meta">(${esc(c.confidenceScore)})</span>` : ""}</td>
  <td>${tagPills(tags) || `<span class="empty">—</span>`}</td>
  <td>${esc(c.priority)}</td>
</tr>`;
    })
    .join("\n");

  const table = `<div class="status-filter" role="group" aria-label="Filter by status">
  <button type="button" class="filter-chip active" data-filter="all">All <strong>${ordered.length}</strong></button>
  <button type="button" class="filter-chip" data-filter="PASS">Passed <strong>${statusCounts.PASS ?? 0}</strong></button>
  <button type="button" class="filter-chip" data-filter="FAIL">Failed <strong>${statusCounts.FAIL ?? 0}</strong></button>
  <button type="button" class="filter-chip" data-filter="NEEDS_VERIFICATION">Needs verification <strong>${ordered.filter(needsVerification).length}</strong></button>
  <button type="button" class="filter-chip" data-filter="NOT_DEMONSTRATED">Not demonstrated <strong>${statusCounts.NOT_DEMONSTRATED ?? 0}</strong></button>
  <button type="button" class="filter-chip" data-filter="NOT_APPLICABLE">N/A <strong>${statusCounts.NOT_APPLICABLE ?? 0}</strong></button>
</div>
<div class="panel">
<div class="table-wrap">
<table class="controls-table">
  <thead>
    <tr>
      <th>Check</th>
      <th>Title</th>
      <th>Category</th>
      <th>Status</th>
      <th>Confidence</th>
      <th>Tags</th>
      <th>Priority</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>
</div>
</div>
<p class="help">Category is the Check YAML <code>category</code> (e.g. Data Privacy). Domain is the APRF grouping (e.g. Data). Click a row for assessment findings and full catalog text.</p>`;

  const panels = ordered
    .map(
      (c) =>
        `<div class="flyout-panel" id="detail-${esc(c.checkId)}" hidden data-title="${esc(c.checkId)} — ${esc(c.title)}">
${controlDetailBody(c)}
</div>`,
    )
    .join("\n");

  return { table, panels };
}

/** Sort: blockers → open gaps by severity → partial → passed → N/A. */
function sortControls(controls: Control[], tags: Map<string, string[]>): Control[] {
  const rank = (c: Control): number => {
    const t = (tags.get(c.checkId) ?? []).map((x) => x.toLowerCase());
    if (t.includes("production blocker")) return 0;
    if (c.status === "FAIL") return 1;
    if (c.status === "NOT_DEMONSTRATED") return 2;
    if (c.status === "PARTIAL") return 3;
    if (t.includes("critical")) return 4;
    if (t.includes("high")) return 5;
    if (t.includes("medium")) return 6;
    if (t.includes("low")) return 7;
    if (t.includes("quick win")) return 8;
    if (c.status === "PASS") return 9;
    if (c.status === "NOT_APPLICABLE") return 10;
    return 11;
  };
  return [...controls].sort((a, b) => {
    const d = rank(a) - rank(b);
    return d !== 0 ? d : a.checkId.localeCompare(b.checkId);
  });
}

function stackrailLinks(): string {
  return `<nav class="sr-links" aria-label="StackRail">
  <a href="${STACKRAIL.home}" rel="noopener">stackrail.io</a>
  <a href="${STACKRAIL.aprf}" rel="noopener">APRF</a>
  <a href="${STACKRAIL.how}" rel="noopener">How APRF works</a>
  <a href="${STACKRAIL.assess}" rel="noopener">Assess</a>
  <a href="${STACKRAIL.github}" rel="noopener">GitHub</a>
</nav>`;
}

function render(a: Assessment): string {
  const catalog = loadCatalogById();
  a = {
    ...a,
    controls: enrichControlsFromCatalog(a.controls, catalog),
  };
  const gate = a.executiveSummary.overallGatePassed ? "PASS" : "FAIL";
  const gateClass = a.executiveSummary.overallGatePassed ? "ok" : "bad";
  const lenses = (a.scope.lensIds ?? []).join(", ") || "none";
  const banner = a.scope.reportBanner
    ? `<div class="banner">${esc(a.scope.reportBanner)}</div>`
    : a.scope.assessmentKind === "non-ai-platform-subset"
      ? `<div class="banner">NON-AI / PLATFORM SUBSET — not an APRF Core AI production-readiness claim.</div>`
      : "";

  const statusCounts = countByStatus(a.controls);
  const severityCounts = countBySeverity(a.controls);
  const belowFloorCount = a.controls.filter(isBelowFloor).length;
  const metricsIncompleteCount = a.controls.filter(isMetricsIncomplete).length;

  // Prefer rollup from controls so category slugs never appear as "domains"
  const domainScores = domainScoresFromControls(a.controls);
  const domainsTable = domainScores
    .map(
      (d) =>
        `<tr><td>${esc(d.domain)}</td><td>${esc(d.score)}</td><td class="${d.mandatoryGatePassed ? "ok" : "bad"}">${d.mandatoryGatePassed ? "pass" : "fail"}</td></tr>`,
    )
    .join("\n");

  const tagsById = collectTags(a);
  const ordered = sortControls(a.controls, tagsById);
  const { table: controlsTable, panels: flyoutPanels } = controlsTableAndFlyout(
    ordered,
    tagsById,
    statusCounts,
  );
  const passSamplesPayload = JSON.stringify(
    Object.fromEntries(
      allPassSamples().map((s) => [
        s.id,
        {
          filename: s.filename,
          destination: s.destination,
          hint: s.hint,
          content: s.content,
        },
      ]),
    ),
  );
  const logoUri = brandLogoDataUri();
  const brandLogo = logoUri
    ? `<img class="brand-logo" src="${logoUri}" width="32" height="32" alt="StackRail" />`
    : "";
  const favicon = logoUri
    ? `<link rel="icon" type="image/png" href="${logoUri}" />`
    : "";
  const excluded =
    a.scope.excludedCheckIds?.length ?
      `<ul>${a.scope.excludedCheckIds.map((e) => `<li><strong>${esc(e.id)}</strong> — ${esc(e.reason)}</li>`).join("")}</ul>`
    : `<p class="empty">None — full profile/catalog scope.</p>`;

  const roadmaps = normalizeRoadmaps(a.roadmaps);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>APRF Assessment — ${esc(a.subject.name)}</title>
  ${favicon}
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&display=swap" rel="stylesheet" />
  <style>
    :root {
      --ink: #15202b;
      --muted: #5a6a78;
      --line: #e2e8ee;
      --line-strong: #c5d0da;
      --bg: #eef2f5;
      --bg-accent: #dce8ef;
      --card: #ffffff;
      --ok: #0d6b3c;
      --ok-bg: #e6f5ec;
      --bad: #b42318;
      --bad-bg: #fdeceb;
      --warn: #9a6700;
      --warn-bg: #fff6e0;
      --na: #4b5c6b;
      --na-bg: #eef1f4;
      --accent: #0b4f63;
      --accent-soft: #e4f1f5;
      --shadow: 0 1px 2px rgba(21, 32, 43, 0.04), 0 8px 24px rgba(21, 32, 43, 0.06);
      --sans: "DM Sans", "Segoe UI", sans-serif;
      --serif: "Newsreader", Georgia, serif;
      --mono: ui-monospace, Menlo, Consolas, monospace;
      --radius: 10px;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      font-family: var(--sans);
      color: var(--ink);
      background:
        radial-gradient(900px 420px at 8% -8%, var(--bg-accent) 0%, transparent 60%),
        radial-gradient(700px 380px at 100% 0%, #e8eef2 0%, transparent 55%),
        var(--bg);
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }
    a { color: var(--accent); }
    a:hover { text-decoration: underline; }
    .shell { max-width: 1120px; margin: 0 auto; padding: 1.75rem 1.5rem 3rem; }
    header.hero {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: calc(var(--radius) + 4px);
      box-shadow: var(--shadow);
      padding: 1.75rem 1.85rem 1.5rem;
      margin-bottom: 1.75rem;
      animation: rise 0.45s ease both;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: none; }
    }
    .brand-row {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
      gap: 0.75rem 1.25rem; margin-bottom: 0.85rem;
    }
    .brand {
      display: inline-flex; align-items: center; gap: 0.6rem;
      letter-spacing: 0.1em; text-transform: uppercase;
      font-size: 0.72rem; color: var(--accent); font-weight: 700;
    }
    .brand-logo {
      width: 32px; height: 32px; display: block; flex: 0 0 auto;
      border-radius: 8px; object-fit: contain;
      background: #0f1c26; padding: 3px; box-sizing: border-box;
    }
    .brand a { color: inherit; text-decoration: none; }
    .gate-badge {
      display: inline-flex; align-items: center; gap: 0.4rem;
      font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em;
      padding: 0.35rem 0.7rem; border-radius: 999px;
    }
    .gate-badge.ok { background: var(--ok-bg); color: var(--ok); }
    .gate-badge.bad { background: var(--bad-bg); color: var(--bad); }
    .sr-links {
      display: flex; flex-wrap: wrap; gap: 0.55rem 1rem;
      margin: 0.35rem 0 0.85rem; font-size: 0.84rem;
    }
    .sr-links a { text-decoration: none; border-bottom: 1px solid transparent; }
    .sr-links a:hover { border-bottom-color: var(--accent); text-decoration: none; }
    h1 {
      font-weight: 700; font-size: clamp(1.65rem, 2.5vw, 2.15rem);
      margin: 0 0 0.65rem; letter-spacing: -0.03em; line-height: 1.15;
    }
    .meta-chips {
      display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.75rem 0 0.5rem;
    }
    .chip {
      display: inline-flex; align-items: center;
      background: var(--accent-soft); color: var(--accent);
      border: 1px solid #c9dde5; border-radius: 999px;
      padding: 0.22rem 0.65rem; font-size: 0.75rem; font-weight: 600;
    }
    .chip.risk { background: var(--bad-bg); color: var(--bad); border-color: #e6c9c9; }
    .chip.asset { background: var(--na-bg); color: var(--na); border-color: #d5d5d5; }
    .threat-intel {
      border-left: 3px solid var(--accent); padding: 0.1rem 0 0.1rem 0.9rem;
      margin: 0.9rem 0;
    }
    .threat-intel .meta-chips { margin: 0.3rem 0 0.6rem; }
    .lede {
      font-family: var(--serif); font-size: 1.05rem; color: var(--muted);
      margin: 0.65rem 0 0; max-width: 62ch;
    }
    h2 {
      font-size: 1.05rem; font-weight: 700; letter-spacing: -0.01em;
      margin: 2.35rem 0 0.95rem; padding-bottom: 0.45rem;
      border-bottom: 2px solid var(--ink);
      display: flex; align-items: baseline; justify-content: space-between; gap: 1rem;
    }
    h2 .hint { font-size: 0.78rem; font-weight: 500; color: var(--muted); border: 0; letter-spacing: 0; }
    h3 { font-size: 0.95rem; font-weight: 650; margin: 0 0 0.75rem; }
    .threat-rollup { margin-top: 2rem; }
    .threat-rollup h3 { margin-bottom: 0.35rem; }
    .threat-rollup .panel { margin-top: 0.75rem; }
    .evidence-coverage { margin-top: 2rem; }
    .evidence-coverage h3 { margin-bottom: 0.35rem; }
    .pass-callout {
      margin: 0.5rem 0 0; padding: 0.7rem 0.85rem;
      background: var(--warn-bg); border-left: 4px solid var(--warn);
      border-radius: 0 6px 6px 0; font-family: var(--sans); font-size: 0.9rem;
      line-height: 1.5;
    }
    .pass-callout code {
      font-size: 0.84em; background: rgba(0,0,0,0.05); padding: 0.1em 0.35em;
      border-radius: 3px;
    }
    .meta, .empty, footer { color: var(--muted); font-size: 0.9rem; }
    .banner {
      background: var(--warn-bg); border: 1px solid #efd9a0; border-left: 4px solid var(--warn);
      padding: 0.8rem 1rem; margin: 1rem 0 0; border-radius: 0 var(--radius) var(--radius) 0;
      font-size: 0.9rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 0.75rem; margin: 0.25rem 0 1.1rem;
    }
    .viz-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1rem; margin: 0.25rem 0 0.5rem;
    }
    .viz-card, .stat {
      background: var(--card); border: 1px solid var(--line);
      border-radius: var(--radius); padding: 1rem 1.1rem;
      box-shadow: var(--shadow);
      transition: transform 0.18s ease, box-shadow 0.18s ease;
    }
    .stat:hover, .viz-card:hover {
      transform: translateY(-1px);
      box-shadow: 0 2px 4px rgba(21,32,43,0.05), 0 12px 28px rgba(21,32,43,0.08);
    }
    .stat .label {
      font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--muted); font-weight: 650;
    }
    .stat .value { font-size: 1.35rem; font-weight: 700; margin-top: 0.25rem; letter-spacing: -0.02em; }
    .viz-row { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
    .donut { width: 140px; height: 140px; flex: 0 0 auto; }
    .donut-center { font-family: var(--sans); font-size: 14px; font-weight: 700; fill: var(--ink); }
    .donut-sub { font-family: var(--sans); font-size: 7px; fill: var(--muted); }
    .legend { list-style: none; padding: 0; margin: 0; font-size: 0.85rem; }
    .legend li { margin: 0.28rem 0; display: flex; align-items: center; gap: 0.45rem; }
    .swatch { width: 0.7rem; height: 0.7rem; display: inline-block; border-radius: 3px; }
    .bars { display: flex; flex-direction: column; gap: 0.55rem; }
    .bar-row { display: grid; grid-template-columns: 7.5rem 1fr 5.5rem; gap: 0.5rem; align-items: center; font-size: 0.82rem; }
    .bar-label { color: var(--muted); }
    .bar-track { height: 0.55rem; background: #e8ecef; border-radius: 99px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 99px; background: var(--accent); }
    .bar-fill.ok { background: var(--ok); }
    .bar-fill.bad { background: var(--bad); }
    .bar-val { text-align: right; font-variant-numeric: tabular-nums; }
    .gauge-wrap { text-align: center; }
    .gauge { width: 200px; max-width: 100%; }
    .gauge-val { font-family: var(--sans); font-size: 18px; font-weight: 700; fill: var(--ink); }
    .panel {
      background: var(--card); border: 1px solid var(--line);
      border-radius: var(--radius); box-shadow: var(--shadow);
      overflow: hidden; margin: 0.25rem 0 0.5rem;
    }
    table { width: 100%; border-collapse: collapse; background: var(--card); }
    th, td {
      text-align: left; padding: 0.7rem 0.85rem; border-bottom: 1px solid var(--line);
      font-size: 0.88rem; vertical-align: top;
    }
    th {
      color: var(--muted); font-weight: 650; font-size: 0.72rem;
      text-transform: uppercase; letter-spacing: 0.06em;
      background: #f4f7f9; position: sticky; top: 0; z-index: 2;
    }
    .table-wrap { overflow-x: auto; max-height: min(70vh, 820px); overflow-y: auto; }
    .controls-table { margin: 0; }
    .controls-table td:nth-child(2) { min-width: 16rem; max-width: 28rem; font-weight: 500; line-height: 1.4; }
    .controls-table .domain-sub { display: block; margin-top: 0.2rem; font-size: 0.75rem; color: var(--muted); font-weight: 500; }
    .verify-sub {
      display: block; margin-top: 0.25rem; font-size: 0.7rem; line-height: 1.3;
      color: var(--muted); font-weight: 600; max-width: 11rem;
    }
    .verify-callout {
      margin: 0.5rem 0 0.15rem; padding: 0.55rem 0.7rem;
      background: var(--warn-bg); border-left: 3px solid var(--warn);
      border-radius: 6px; font-family: var(--sans); font-size: 0.84rem;
      line-height: 1.45;
    }
    .control-row { cursor: pointer; transition: background 0.12s ease; }
    .control-row:hover, .control-row:focus { background: #f3f8fa; outline: none; }
    .control-row:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
    .control-row.active { background: var(--accent-soft); }
    .control-row[hidden] { display: none; }
    .status-filter {
      display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0 0 0.85rem;
      padding: 0.35rem; background: var(--card); border: 1px solid var(--line);
      border-radius: 999px; width: fit-content; max-width: 100%;
      box-shadow: var(--shadow);
    }
    .filter-chip {
      border: 0; background: transparent; color: var(--muted);
      padding: 0.4rem 0.75rem; cursor: pointer; font-size: 0.8rem; font-weight: 600;
      border-radius: 999px; font-family: var(--sans);
      transition: background 0.15s ease, color 0.15s ease;
    }
    .filter-chip strong { font-variant-numeric: tabular-nums; margin-left: 0.2rem; }
    .filter-chip:hover { background: var(--bg); color: var(--ink); }
    .filter-chip.active { background: var(--accent); color: #fff; }
    .pill {
      display: inline-block; font-size: 0.68rem; font-weight: 700;
      letter-spacing: 0.03em; padding: 0.2rem 0.5rem; border-radius: 6px;
      margin: 0.08rem 0.12rem 0.08rem 0; border: 0;
    }
    .pill.ok { color: var(--ok); background: var(--ok-bg); }
    .pill.bad { color: var(--bad); background: var(--bad-bg); }
    .pill.warn { color: var(--warn); background: var(--warn-bg); }
    .pill.muted, .pill.na { color: var(--na); background: var(--na-bg); }
    .ok { color: var(--ok); } .bad { color: var(--bad); } .warn { color: var(--warn); }
    .muted, .na { color: var(--na); }
    .prio { font-size: 0.75rem; color: var(--muted); font-weight: 600; }
    .roadmap-list {
      list-style: none; margin: 0.35rem 0 0; padding: 0;
      display: flex; flex-wrap: wrap; gap: 0.4rem;
    }
    .roadmap-list li { margin: 0; }
    .roadmap-check {
      display: inline-flex; align-items: center; gap: 0.35rem;
      border: 1px solid var(--line); background: #fff; color: var(--ink);
      font-family: var(--sans); font-size: 0.82rem; font-weight: 600;
      padding: 0.28rem 0.55rem; border-radius: 8px; cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .roadmap-check:hover, .roadmap-check:focus-visible {
      background: var(--accent-soft); border-color: #c9dde5; outline: none;
    }
    .roadmap-check.active {
      background: var(--accent); border-color: var(--accent); color: #fff;
    }
    .roadmap-check.active code { background: rgba(255,255,255,0.18); color: inherit; }
    .roadmap-check.active .prio { color: rgba(255,255,255,0.85); }
    .roadmap-check .prio { margin: 0; }
    code { font-family: var(--mono); font-size: 0.84em; background: #f0f4f7; padding: 0.08em 0.35em; border-radius: 4px; }
    ul { padding-left: 1.15rem; }
    .evidence-list { margin: 0.35rem 0 0.65rem; padding-left: 1.15rem; }
    .evidence-item { margin: 0.45rem 0; word-break: break-word; }
    .evidence-finding code { font-size: 0.92em; }
    .evidence-detail { color: var(--muted, #5c6570); }
    .evidence-findings { margin: 0.35rem 0 0; padding-left: 1.1rem; }
    .evidence-findings li { margin: 0.2rem 0; }
    .evidence-none { color: var(--muted, #5c6570); list-style: disc; }
    .evidence-ref { margin-bottom: 0.3rem; }
    .evidence-lead {
      display: block; font-family: var(--sans); font-size: 0.84rem;
      color: var(--muted); margin: 0.15rem 0 0.35rem;
    }
    .evidence-json {
      margin: 0.25rem 0 0; padding: 0.65rem 0.75rem;
      background: #f3f6f8; border: 1px solid var(--line); border-radius: 8px;
      font-family: var(--mono); font-size: 0.78rem; line-height: 1.45;
      overflow-x: auto; max-width: 100%; white-space: pre;
      color: var(--ink);
    }
    .evidence-json code {
      background: transparent; padding: 0; border-radius: 0;
      font-size: inherit; color: inherit;
    }
    .manual-steps {
      margin: 0.35rem 0 0.75rem; padding-left: 1.35rem;
    }
    .manual-steps li { margin: 0.35rem 0; }
    .help { margin: 0.65rem 0 0; font-size: 0.82rem; color: var(--muted); }
    .roadmap-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 0.85rem;
    }
    .block {
      background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 1rem 1.1rem; box-shadow: var(--shadow);
    }
    footer {
      margin-top: 2.75rem; padding-top: 1.25rem; border-top: 1px solid var(--line-strong);
      font-size: 0.85rem;
    }
    .flyout-backdrop {
      position: fixed; inset: 0; background: rgba(15, 28, 38, 0.42);
      backdrop-filter: blur(2px);
      opacity: 0; pointer-events: none; transition: opacity 0.22s ease; z-index: 40;
    }
    .flyout-backdrop.open { opacity: 1; pointer-events: auto; }
    .flyout {
      position: fixed; top: 0; right: 0; height: 100%; width: min(520px, 96vw);
      background: var(--card); border-left: 1px solid var(--line);
      box-shadow: -12px 0 40px rgba(15, 28, 38, 0.14);
      transform: translateX(100%); transition: transform 0.26s cubic-bezier(0.22, 1, 0.36, 1);
      z-index: 50; display: flex; flex-direction: column;
    }
    .flyout.open { transform: translateX(0); }
    .flyout-header {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem;
      padding: 1.15rem 1.25rem; border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, #f7fafb 0%, #fff 100%);
    }
    .flyout-header h3 {
      margin: 0; font-size: 1.02rem; line-height: 1.35; font-weight: 700;
      letter-spacing: -0.015em;
    }
    .flyout-close {
      border: 1px solid var(--line); background: #fff; color: var(--ink);
      font-family: var(--sans); font-size: 0.82rem; font-weight: 600;
      padding: 0.4rem 0.7rem; cursor: pointer; border-radius: 8px; flex: 0 0 auto;
      transition: background 0.15s ease;
    }
    .flyout-close:hover { background: var(--bg); }
    .flyout-body {
      padding: 1.15rem 1.25rem 2.25rem; overflow-y: auto; overflow-x: hidden; flex: 1;
      font-family: var(--serif); font-size: 0.98rem; min-width: 0;
      overflow-wrap: anywhere;
    }
    .flyout-body .meta { font-family: var(--sans); font-size: 0.82rem; }
    .flyout-body h4 {
      font-family: var(--sans); font-size: 0.7rem; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--muted); margin: 0.15rem 0 0.7rem; font-weight: 700;
    }
    .flyout-body p { margin: 0.45rem 0; }
    .flyout-body strong { font-family: var(--sans); font-size: 0.86rem; }
    .assessment-findings { margin: 0.15rem 0 1.15rem; }
    .pass-sample-attach { margin: 0.85rem 0 0.35rem; }
    .pass-sample-list { list-style: none; padding: 0; margin: 0.5rem 0 0; display: grid; gap: 0.65rem; }
    .pass-sample-list li { display: grid; gap: 0.2rem; }
    .pass-sample-open {
      display: inline-flex; align-items: center; gap: 0.35rem; justify-self: start;
      border: 1px solid var(--line); background: #fff;
      color: var(--ink); font-family: var(--sans); font-size: 0.82rem; font-weight: 600;
      padding: 0.45rem 0.75rem; border-radius: 8px; cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .pass-sample-open:hover { background: var(--bg); border-color: var(--accent, #2f6f7e); }
    .sample-modal-backdrop {
      position: fixed; inset: 0; background: rgba(15, 28, 38, 0.55);
      z-index: 80; display: flex; align-items: center; justify-content: center;
      padding: 1.25rem; opacity: 0; pointer-events: none; transition: opacity 0.18s ease;
    }
    .sample-modal-backdrop.open { opacity: 1; pointer-events: auto; }
    .sample-modal {
      width: min(760px, 96vw); max-height: min(88vh, 860px);
      background: var(--card); border: 1px solid var(--line); border-radius: 12px;
      box-shadow: 0 24px 60px rgba(15, 28, 38, 0.28);
      display: flex; flex-direction: column; overflow: hidden;
      isolation: isolate;
    }
    .sample-modal-header {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem;
      padding: 0.9rem 1.15rem; border-bottom: 1px solid var(--line);
      background: #fff; flex: 0 0 auto; position: relative; z-index: 1;
    }
    .sample-modal-header h3 {
      margin: 0; font-size: 0.98rem; line-height: 1.35; font-weight: 700;
    }
    .sample-modal-header .meta { margin: 0.35rem 0 0; max-width: 52rem; }
    .sample-modal-dest {
      display: block; margin-top: 0.35rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.74rem; color: var(--ink); word-break: break-all;
    }
    .sample-modal-actions {
      display: flex; gap: 0.4rem; flex: 0 0 auto; align-items: center;
    }
    .sample-modal-copy {
      border: 1px solid var(--line); background: #fff; color: var(--ink);
      font-family: var(--sans); font-size: 0.82rem; font-weight: 600;
      padding: 0.4rem 0.7rem; cursor: pointer; border-radius: 8px;
    }
    .sample-modal-copy:hover { background: var(--bg); }
    .sample-modal-scroll {
      margin: 0; flex: 1 1 auto; min-height: 0; overflow: auto;
      overscroll-behavior: contain; background: #0f1c26;
      -webkit-overflow-scrolling: touch;
    }
    .sample-modal-body {
      margin: 0; padding: 1rem 1.15rem 1.35rem;
      color: #e8eef2; font-size: 0.78rem; line-height: 1.45;
      background: transparent;
    }
    .sample-modal-body code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: pre; color: inherit; background: transparent;
    }
    .catalog-rule {
      background: #f5f8fa; border: 1px solid var(--line);
      padding: 0.9rem 1rem; margin: 0.35rem 0 0; border-radius: var(--radius);
    }
    .flyout-panels { display: none; }
    @media (max-width: 720px) {
      .shell { padding: 1rem; }
      .status-filter { border-radius: var(--radius); }
      .controls-table td:nth-child(2) { min-width: 12rem; }
    }
    @media print {
      body { background: white; }
      .stat, .viz-card, .panel, .block { break-inside: avoid; box-shadow: none; }
      .flyout, .flyout-backdrop, .status-filter { display: none !important; }
      .flyout-panels { display: block !important; }
      .flyout-panel { display: block !important; border: 1px solid var(--line); padding: 0.85rem; margin: 0.75rem 0; page-break-inside: avoid; }
      .flyout-panel[hidden] { display: block !important; }
      .table-wrap { max-height: none; overflow: visible; }
    }
  </style>
</head>
<body>
  <div class="shell">
  <header class="hero">
    <div class="brand-row">
      <div class="brand">${brandLogo}<span>APRF Auditor · <a href="${STACKRAIL.home}" rel="noopener">StackRail</a></span></div>
      <div class="gate-badge ${gateClass}" title="Overall mandatory gate">Gate ${gate}</div>
    </div>
    <h1>${esc(a.subject.name)}</h1>
    ${stackrailLinks()}
    <div class="meta-chips">
      <span class="chip" title="Check catalog (@stackrail-io/aprf-engine)">catalog ${esc(a.aprfVersion)}</span>
      <span class="chip" title="CLI (@stackrail-io/aprf)">cli ${esc(a.skillVersion)}</span>
      <span class="chip">${esc(a.scope.profileId)}${a.scope.scopeId ? ` · ${esc(a.scope.scopeId)}` : ""}</span>
      <span class="chip">tier ${esc(a.scope.criticality)}</span>
      <span class="chip">${esc(a.scope.systemType ?? "—")}</span>
      <span class="chip">lenses: ${esc(lenses)}</span>
    </div>
    <p class="meta" style="margin:0.35rem 0 0">${esc(a.assessedAt)}${a.subject.gitCommit ? ` · <code>${esc(a.subject.gitCommit)}</code>` : ""}<br/><span style="word-break:break-all">${esc(a.subject.path)}</span></p>
    ${banner}
    <p class="lede">Self-attested local assessment against the public <a href="${STACKRAIL.aprf}" rel="noopener">APRF</a> catalog — not third-party certification. Framework: <a href="${STACKRAIL.github}" rel="noopener">github.com/stackrail-io/APRF</a>.</p>
  </header>
  <main>
    <h2>Executive summary</h2>
    <div class="grid">
      <div class="stat"><div class="label">Gate</div><div class="value ${gateClass}">${gate}</div></div>
      <div class="stat"><div class="label">Criticality</div><div class="value" style="font-size:1.05rem">${esc(tierLabel(a))}</div></div>
      <div class="stat"><div class="label">Required capability</div><div class="value" style="font-size:1.05rem">${esc(capabilityLabel(a))}</div></div>
      <div class="stat"><div class="label">Confidence</div><div class="value">${esc(a.executiveSummary.assessmentConfidence)}</div></div>
      <div class="stat"><div class="label">Blockers</div><div class="value">${esc(a.executiveSummary.blockerCount)} <span class="meta">(${esc(a.executiveSummary.criticalBlockerCount)} critical)</span></div></div>
      <div class="stat"><div class="label">Recommended (non-gate)</div><div class="value">${esc(a.executiveSummary.recommendedScore == null ? "n/a" : a.executiveSummary.recommendedScore)}</div></div>
    </div>
    <p class="meta">Maturity model: <a href="${a.executiveSummary.maturityUrl ?? "https://stackrail.io/aprf/how/#maturity"}" rel="noopener">stackrail.io/aprf/how/#maturity</a>
      ${a.executiveSummary.overallGrade != null ? ` · Grade (secondary): ${esc(a.executiveSummary.overallGrade)}` : ""}
      ${a.executiveSummary.riskLevel != null ? ` · Risk (secondary): ${esc(a.executiveSummary.riskLevel)}` : ""}
    </p>
    <p class="lede" style="max-width:72ch">${esc(a.executiveSummary.narrative)}</p>
    ${
      belowFloorCount > 0
        ? `<p class="verify-callout" style="max-width:72ch"><strong>${belowFloorCount} check${belowFloorCount === 1 ? "" : "s"} ${belowFloorCount === 1 ? "is" : "are"} UNVERIFIED (below floor).</strong> Repo signals exist, but the achieved evidence tier is below the Check’s required floor — add measured proof (import, probe, or drill with a fresh <code>measuredAt</code>). Filter the table by <em>Needs verification</em> to see them.</p>`
        : ""
    }
    ${
      metricsIncompleteCount > 0
        ? `<p class="meta" style="max-width:72ch;margin-top:0.5rem">${metricsIncompleteCount} check${metricsIncompleteCount === 1 ? "" : "s"} ${metricsIncompleteCount === 1 ? "has" : "have"} repo signals with incomplete measured metrics (PARTIAL, not UNVERIFIED) — same filter.</p>`
        : ""
    }
    ${evidenceCoverageBlock(a.controls)}
    ${topThreatsBlock(a.controls)}

    <h2>Visual overview</h2>
    <div class="viz-grid">
      ${scoreGauge(a.executiveSummary.recommendedScore, a.executiveSummary.overallGatePassed)}
      ${statusDonut(statusCounts)}
      ${severityBars(severityCounts)}
    </div>

    <h2>Domain scores</h2>
    <div class="panel">
    <table>
      <thead><tr><th>Domain</th><th>Score</th><th>Mandatory gate</th></tr></thead>
      <tbody>${domainsTable}</tbody>
    </table>
    </div>

    <h2>Discovery</h2>
    ${discoveryList("Found", a.discovery?.found)}
    ${discoveryList(
      "Not observed",
      a.discovery?.notObserved ?? a.discovery?.absent,
      "optional / tech-dependent — not a defect by itself",
    )}
    ${discoveryList(
      "What you need next",
      [...new Set((a.discovery?.requiredEvidenceMissing ?? []).map((n) => customerFacingRequiredEvidence(n)))],
      "in-scope checks — gate-relevant",
    )}

    <h2>Controls &amp; Findings <span class="hint">Click a row for details</span></h2>
    ${controlsTable}

    <h2>Roadmaps</h2>
    <div class="roadmap-grid">
    ${renderRoadmapBucket("30 days", roadmaps.days30)}
    ${renderRoadmapBucket("90 days", roadmaps.days90)}
    ${renderRoadmapBucket("Long term", roadmaps.longTerm)}
    </div>

    <h2>Excluded checks (non-AI subset)</h2>
    <div class="block">${excluded}</div>

    <h2>Disclaimer</h2>
    <p class="meta">${esc(a.disclaimer)}</p>
    <p class="meta">Learn more: <a href="${STACKRAIL.aprf}" rel="noopener">stackrail.io/aprf</a> · <a href="${STACKRAIL.how}" rel="noopener">How APRF works</a> · <a href="${STACKRAIL.assess}" rel="noopener">Reference assess</a></p>
  </main>
  <footer>
    Generated by APRF Auditor ·
    <a href="${STACKRAIL.home}" rel="noopener">stackrail.io</a> ·
    <a href="${STACKRAIL.github}" rel="noopener">APRF on GitHub</a>
  </footer>
  </div>

  <div class="flyout-backdrop" id="flyout-backdrop" hidden></div>
  <aside class="flyout" id="control-flyout" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="flyout-title">
    <div class="flyout-header">
      <h3 id="flyout-title">Control details</h3>
      <button type="button" class="flyout-close" id="flyout-close" aria-label="Close details">Close</button>
    </div>
    <div class="flyout-body" id="flyout-body"></div>
  </aside>
  <div class="flyout-panels" id="flyout-panels">${flyoutPanels}</div>

  <div class="sample-modal-backdrop" id="sample-modal-backdrop" hidden>
    <div class="sample-modal" role="dialog" aria-modal="true" aria-labelledby="sample-modal-title">
      <div class="sample-modal-header">
        <div>
          <h3 id="sample-modal-title">PASS sample</h3>
          <p class="meta" id="sample-modal-meta"></p>
          <code class="sample-modal-dest" id="sample-modal-dest" hidden></code>
        </div>
        <div class="sample-modal-actions">
          <button type="button" class="sample-modal-copy" id="sample-modal-copy">Copy</button>
          <button type="button" class="flyout-close" id="sample-modal-close" aria-label="Close sample">Close</button>
        </div>
      </div>
      <div class="sample-modal-scroll" id="sample-modal-scroll">
        <pre class="sample-modal-body" tabindex="0"><code id="sample-modal-code"></code></pre>
      </div>
    </div>
  </div>
  <script type="application/json" id="pass-samples-data">${passSamplesPayload.replace(/</g, "\\u003c")}</script>

  <script>
    (function () {
      var backdrop = document.getElementById("flyout-backdrop");
      var flyout = document.getElementById("control-flyout");
      var body = document.getElementById("flyout-body");
      var title = document.getElementById("flyout-title");
      var closeBtn = document.getElementById("flyout-close");
      var panels = document.getElementById("flyout-panels");
      var sampleBackdrop = document.getElementById("sample-modal-backdrop");
      var sampleTitle = document.getElementById("sample-modal-title");
      var sampleMeta = document.getElementById("sample-modal-meta");
      var sampleDest = document.getElementById("sample-modal-dest");
      var sampleScroll = document.getElementById("sample-modal-scroll");
      var sampleCode = document.getElementById("sample-modal-code");
      var sampleClose = document.getElementById("sample-modal-close");
      var sampleCopy = document.getElementById("sample-modal-copy");
      var samplesEl = document.getElementById("pass-samples-data");
      var passSamples = {};
      try {
        passSamples = samplesEl ? JSON.parse(samplesEl.textContent || "{}") : {};
      } catch (e) {
        passSamples = {};
      }
      if (!backdrop || !flyout || !body || !title || !closeBtn || !panels) return;

      function openFlyout(id) {
        var panel = document.getElementById("detail-" + id);
        if (!panel) return;
        title.textContent = panel.getAttribute("data-title") || id;
        body.innerHTML = panel.innerHTML;
        document.querySelectorAll(".control-row, .roadmap-check").forEach(function (r) {
          r.classList.toggle("active", r.getAttribute("data-control-id") === id);
        });
        backdrop.hidden = false;
        requestAnimationFrame(function () {
          backdrop.classList.add("open");
          flyout.classList.add("open");
        });
        flyout.setAttribute("aria-hidden", "false");
        closeBtn.focus();
      }

      function closeFlyout() {
        backdrop.classList.remove("open");
        flyout.classList.remove("open");
        flyout.setAttribute("aria-hidden", "true");
        document.querySelectorAll(".control-row.active, .roadmap-check.active").forEach(function (r) {
          r.classList.remove("active");
        });
        setTimeout(function () { backdrop.hidden = true; }, 220);
      }

      var sampleOpener = null;

      function openSample(id, opener) {
        var sample = passSamples[id];
        if (!sample || !sampleBackdrop || !sampleTitle || !sampleMeta || !sampleCode) return;
        sampleOpener = opener || null;
        sampleTitle.textContent = sample.filename || "PASS sample";
        sampleMeta.textContent = sample.hint || "";
        if (sampleDest) {
          if (sample.destination) {
            sampleDest.hidden = false;
            sampleDest.textContent = "→ " + sample.destination;
          } else {
            sampleDest.hidden = true;
            sampleDest.textContent = "";
          }
        }
        sampleCode.textContent = sample.content || "";
        if (sampleCopy) sampleCopy.textContent = "Copy";
        sampleBackdrop.hidden = false;
        requestAnimationFrame(function () {
          sampleBackdrop.classList.add("open");
          if (sampleScroll) sampleScroll.scrollTop = 0;
        });
        if (sampleClose) sampleClose.focus();
      }

      function closeSample() {
        if (!sampleBackdrop) return;
        sampleBackdrop.classList.remove("open");
        setTimeout(function () {
          sampleBackdrop.hidden = true;
          if (sampleOpener && typeof sampleOpener.focus === "function") {
            sampleOpener.focus();
          }
          sampleOpener = null;
        }, 180);
      }

      if (sampleCopy) {
        sampleCopy.addEventListener("click", function () {
          var text = sampleCode ? sampleCode.textContent || "" : "";
          if (!text) return;
          var done = function () {
            sampleCopy.textContent = "Copied";
            setTimeout(function () { sampleCopy.textContent = "Copy"; }, 1200);
          };
          var fail = function () {
            sampleCopy.textContent = "Copy failed";
            setTimeout(function () { sampleCopy.textContent = "Copy"; }, 1200);
          };
          var fallback = function () {
            var ta = document.createElement("textarea");
            try {
              ta.value = text;
              ta.setAttribute("readonly", "");
              ta.style.position = "fixed";
              ta.style.left = "-9999px";
              document.body.appendChild(ta);
              ta.select();
              if (document.execCommand("copy")) done();
              else fail();
            } catch (err) {
              fail();
            } finally {
              if (ta.parentNode) document.body.removeChild(ta);
            }
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(fallback);
          } else {
            fallback();
          }
        });
      }

      document.querySelectorAll(".control-row, .roadmap-check").forEach(function (row) {
        row.addEventListener("click", function () {
          openFlyout(row.getAttribute("data-control-id"));
        });
        row.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openFlyout(row.getAttribute("data-control-id"));
          }
        });
      });
      closeBtn.addEventListener("click", closeFlyout);
      backdrop.addEventListener("click", closeFlyout);
      body.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest ? e.target.closest(".pass-sample-open") : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        openSample(btn.getAttribute("data-sample-id"), btn);
      });
      if (sampleClose) sampleClose.addEventListener("click", closeSample);
      if (sampleBackdrop) {
        sampleBackdrop.addEventListener("click", function (e) {
          if (e.target === sampleBackdrop) closeSample();
        });
      }
      document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        if (sampleBackdrop && sampleBackdrop.classList.contains("open")) {
          closeSample();
          return;
        }
        if (flyout.classList.contains("open")) closeFlyout();
      });

      document.querySelectorAll(".filter-chip").forEach(function (chip) {
        chip.addEventListener("click", function () {
          var filter = chip.getAttribute("data-filter") || "all";
          document.querySelectorAll(".filter-chip").forEach(function (c) {
            c.classList.toggle("active", c === chip);
          });
          document.querySelectorAll(".control-row").forEach(function (row) {
            var status = row.getAttribute("data-status");
            var match =
              filter === "all" ||
              (filter === "NEEDS_VERIFICATION"
                ? row.getAttribute("data-verify") === "1"
                : status === filter);
            if (match) row.removeAttribute("hidden");
            else row.setAttribute("hidden", "");
          });
        });
      });
    })();
  </script>
</body>
</html>
`;
}
function parseArgs(argv: string[]) {
  let input = resolve(process.cwd(), "aprf-assessment/assessment.json");
  let output = resolve(process.cwd(), "aprf-assessment/REPORT.html");
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--in") input = resolve(argv[++i] ?? input);
    else if (argv[i] === "--out") output = resolve(argv[++i] ?? output);
    else if (argv[i] === "--help") {
      console.log(
        "Usage: render-html-report.ts --in assessment.json --out REPORT.html",
      );
      process.exit(0);
    }
  }
  return { input, output };
}

/** Render assessment.json → REPORT.html string (catalog-enriched). */
export function renderAssessmentHtml(assessment: Assessment): string {
  return render(assessment);
}

/** Read assessment.json and write REPORT.html. */
export function writeAssessmentHtmlReport(
  inputPath: string,
  outputPath: string,
): void {
  const assessment = JSON.parse(readFileSync(inputPath, "utf8")) as Assessment;
  const html = render(assessment);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, "utf8");
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
const isMain =
  /(?:^|[/\\])render-html-report\.(?:ts|js|mjs)$/.test(entry) &&
  import.meta.url === pathToFileURL(entry).href;

if (isMain) {
  const { input, output } = parseArgs(process.argv);
  writeAssessmentHtmlReport(input, output);
  console.log(`Wrote ${output}`);
}