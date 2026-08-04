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
import { getGeneratedCatalog } from "@stackrail-io/aprf-engine";
import { allPassSamples, getPassSamples } from "./pass-samples.ts";

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

type CatalogRule = {
  id: string;
  category?: string;
  title?: string;
  description?: string;
  whyItMatters?: string;
  passCondition?: string;
  evidenceRequired?: string[];
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
    recommendedScore: number;
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
  }

  return ` — ${esc(excerpt)}`;
}

function formatEvidenceItem(e: { ref: string; excerpt?: string }): string {
  const excerptHtml = e.excerpt ? formatEvidenceExcerpt(e.excerpt) : "";
  const hasBlock = excerptHtml.includes('class="evidence-json"');
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

function scoreGauge(score: number, gatePass: boolean): string {
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

function controlDetailBody(c: Control): string {
  const evidence =
    c.evidenceFound?.length ?
      `<ul class="evidence-list">${c.evidenceFound.map(formatEvidenceItem).join("")}</ul>`
    : `<p class="empty">None</p>`;
  const missing =
    c.requiredEvidenceMissing?.length ?
      `<p><strong>Evidence still required</strong></p><ul>${c.requiredEvidenceMissing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`
    : "";
  const statusKey = (c.status || "").toUpperCase().replace(/-/g, "_");
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
  ${refs}
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
      return `<tr class="control-row" tabindex="0" role="button" data-control-id="${esc(c.checkId)}" data-status="${esc(c.status)}" aria-label="Open details for ${esc(c.checkId)}">
  <td><code>${esc(c.checkId)}</code></td>
  <td>${esc(c.title)}</td>
  <td>${esc(controlCategory(c))}<span class="domain-sub">${esc(controlDomain(c))} domain</span></td>
  <td><span class="pill ${statusClass(c.status)}">${esc(c.status)}</span></td>
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
  <button type="button" class="filter-chip" data-filter="PARTIAL">Partial <strong>${statusCounts.PARTIAL ?? 0}</strong></button>
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
      letter-spacing: 0.1em; text-transform: uppercase;
      font-size: 0.72rem; color: var(--accent); font-weight: 700;
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
      position: fixed; inset: 0; background: rgba(15, 28, 38, 0.45);
      z-index: 80; display: flex; align-items: center; justify-content: center;
      padding: 1.25rem; opacity: 0; pointer-events: none; transition: opacity 0.18s ease;
    }
    .sample-modal-backdrop.open { opacity: 1; pointer-events: auto; }
    .sample-modal {
      width: min(640px, 96vw); max-height: min(80vh, 720px);
      background: var(--card); border: 1px solid var(--line); border-radius: 12px;
      box-shadow: 0 24px 60px rgba(15, 28, 38, 0.28);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .sample-modal-header {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem;
      padding: 1rem 1.15rem; border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, #f7fafb 0%, #fff 100%);
    }
    .sample-modal-header h3 {
      margin: 0; font-size: 0.98rem; line-height: 1.35; font-weight: 700;
    }
    .sample-modal-header .meta { margin: 0.25rem 0 0; }
    .sample-modal-body {
      margin: 0; padding: 1rem 1.15rem 1.25rem; overflow: auto; flex: 1;
      background: #0f1c26; color: #e8eef2; font-size: 0.78rem; line-height: 1.45;
    }
    .sample-modal-body code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; }
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
      <div class="brand">APRF Auditor · <a href="${STACKRAIL.home}" rel="noopener">StackRail</a></div>
      <div class="gate-badge ${gateClass}" title="Overall mandatory gate">Gate ${gate}</div>
    </div>
    <h1>${esc(a.subject.name)}</h1>
    ${stackrailLinks()}
    <div class="meta-chips">
      <span class="chip">APRF ${esc(a.aprfVersion)}</span>
      <span class="chip">skill ${esc(a.skillVersion)}</span>
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
      <div class="stat"><div class="label">Recommended (non-gate)</div><div class="value">${esc(a.executiveSummary.recommendedScore)}</div></div>
    </div>
    <p class="meta">Maturity model: <a href="${a.executiveSummary.maturityUrl ?? "https://stackrail.io/aprf/how/#maturity"}" rel="noopener">stackrail.io/aprf/how/#maturity</a>
      ${a.executiveSummary.overallGrade != null ? ` · Grade (secondary): ${esc(a.executiveSummary.overallGrade)}` : ""}
      ${a.executiveSummary.riskLevel != null ? ` · Risk (secondary): ${esc(a.executiveSummary.riskLevel)}` : ""}
    </p>
    <p class="lede" style="max-width:72ch">${esc(a.executiveSummary.narrative)}</p>

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
      "Required evidence missing",
      a.discovery?.requiredEvidenceMissing,
      "in-scope Checks — gate-relevant",
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
        </div>
        <button type="button" class="flyout-close" id="sample-modal-close" aria-label="Close sample">Close</button>
      </div>
      <pre class="sample-modal-body" tabindex="0"><code id="sample-modal-code"></code></pre>
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
      var sampleCode = document.getElementById("sample-modal-code");
      var sampleClose = document.getElementById("sample-modal-close");
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
        sampleMeta.textContent = (sample.hint || "") +
          (sample.destination ? " Destination: " + sample.destination : "");
        sampleCode.textContent = sample.content || "";
        sampleBackdrop.hidden = false;
        requestAnimationFrame(function () {
          sampleBackdrop.classList.add("open");
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
            if (filter === "all" || status === filter) row.removeAttribute("hidden");
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