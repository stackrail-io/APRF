#!/usr/bin/env npx tsx
/**
 * Render aprf-assessment/REPORT.html from assessment.json
 *
 *   npx tsx skills/aprf-auditor/scripts/render-html-report.ts \
 *     --in ./aprf-assessment/assessment.json \
 *     --out ./aprf-assessment/REPORT.html
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const STACKRAIL = {
  home: "https://stackrail.io",
  aprf: "https://stackrail.io/aprf/",
  how: "https://stackrail.io/aprf/how/",
  assess: "https://stackrail.io/aprf/assess/",
  github: "https://github.com/stackrail-io/APRF",
};

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
  roadmaps: { days30: string[]; days90: string[]; longTerm: string[] };
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

/** Category (pillar) → APRF domain id — mirrors packages/aprf-engine/rules/_index/categories.yaml */
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
  "platform-engineering": "platform",
};

function titleCaseDomain(domain: string): string {
  return domain
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function controlDomain(c: Control): string {
  const raw =
    (c.domain && c.domain.trim()) ||
    DOMAIN_BY_CATEGORY[c.category] ||
    c.category;
  return titleCaseDomain(raw);
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
      `<ul>${c.evidenceFound.map((e) => `<li><code>${esc(e.ref)}</code>${e.excerpt ? ` — ${esc(e.excerpt)}` : ""}</li>`).join("")}</ul>`
    : `<p class="empty">None</p>`;
  const missing =
    c.requiredEvidenceMissing?.length ?
      `<p><strong>Evidence still required</strong></p><ul>${c.requiredEvidenceMissing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`
    : "";
  const rem = c.remediation
    ? `<p><strong>Remediation:</strong> ${esc(c.remediation.fix)}${c.remediation.owner ? ` · owner ${esc(c.remediation.owner)}` : ""}${c.remediation.estimatedEffort ? ` · effort ${esc(c.remediation.estimatedEffort)}` : ""}</p>`
    : "";
  return `
  <p class="meta">${esc(c.category)} · ${esc(c.gate)} · ${esc(c.severity)} ·
    <span class="pill ${statusClass(c.status)}">${esc(c.status)}</span> ·
    confidence ${esc(c.confidence)}${c.confidenceScore != null ? ` (${esc(c.confidenceScore)})` : ""} ·
    ${esc(c.priority)}</p>
  <p><strong>Evidence</strong></p>${evidence}
  ${missing}
  <p><strong>Reasoning:</strong> ${esc(c.reasoning)}</p>
  <p><strong>Recommended action:</strong> ${esc(c.recommendedAction)}</p>
  ${c.naReason ? `<p><strong>N/A rationale:</strong> ${esc(c.naReason)}</p>` : ""}
  ${rem}`;
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
  <td>${esc(controlDomain(c))}</td>
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
<div class="table-wrap">
<table class="controls-table">
  <thead>
    <tr>
      <th>Check</th>
      <th>Title</th>
      <th>Domain</th>
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
<p class="meta">Click a row for evidence, reasoning, and remediation. Use status chips to show Passed / Failed / Partial / …</p>`;

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

  const domainsTable = a.domainScores
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
  const excluded =
    a.scope.excludedCheckIds?.length ?
      `<ul>${a.scope.excludedCheckIds.map((e) => `<li><strong>${esc(e.id)}</strong> — ${esc(e.reason)}</li>`).join("")}</ul>`
    : `<p class="empty">None — full profile/catalog scope.</p>`;

  const roadmap = (label: string, items: string[]) =>
    `<section class="block"><h3>${esc(label)}</h3>${items?.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p class="empty">None</p>`}</section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>APRF Assessment — ${esc(a.subject.name)}</title>
  <style>
    :root {
      --ink: #1a1f24;
      --muted: #5c6670;
      --line: #d9dee3;
      --bg: #f7f5f1;
      --card: #ffffff;
      --ok: #1b6b3a;
      --bad: #9b1c1c;
      --warn: #8a5a00;
      --na: #4a5560;
      --accent: #0f3d4c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Source Serif 4", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      color: var(--ink);
      background:
        radial-gradient(1200px 500px at 10% -10%, #e7eef1 0%, transparent 55%),
        radial-gradient(900px 400px at 100% 0%, #efe8df 0%, transparent 50%),
        var(--bg);
      line-height: 1.55;
    }
    header, main, footer { max-width: 980px; margin: 0 auto; padding: 1.5rem; }
    header { padding-top: 2.5rem; border-bottom: 1px solid var(--line); }
    .brand {
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-size: 0.75rem;
      color: var(--accent);
      font-weight: 600;
    }
    .sr-links {
      display: flex; flex-wrap: wrap; gap: 0.75rem 1.1rem;
      margin: 0.75rem 0 0.25rem;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      font-size: 0.85rem;
    }
    .sr-links a { color: var(--accent); text-decoration: none; border-bottom: 1px solid transparent; }
    .sr-links a:hover { border-bottom-color: var(--accent); }
    h1 {
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      font-weight: 650; font-size: 1.85rem;
      margin: 0.4rem 0 0.75rem; letter-spacing: -0.02em;
    }
    h2 {
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      font-size: 1.15rem; margin-top: 2.25rem;
      border-bottom: 1px solid var(--line); padding-bottom: 0.35rem;
    }
    h3 { font-family: "IBM Plex Sans", "Segoe UI", sans-serif; font-size: 1rem; margin: 0 0 0.75rem; }
    .meta, .empty, footer { color: var(--muted); font-size: 0.95rem; }
    .banner {
      background: #fff4e5; border-left: 4px solid #c47b16;
      padding: 0.85rem 1rem; margin: 1rem 0;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif; font-size: 0.92rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 0.75rem; margin: 1rem 0 1.25rem;
    }
    .viz-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1rem; margin: 1rem 0 1.5rem;
    }
    .viz-card, .stat {
      background: var(--card); border: 1px solid var(--line); padding: 0.95rem 1.05rem;
    }
    .stat .label {
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted);
    }
    .stat .value { font-family: "IBM Plex Sans", "Segoe UI", sans-serif; font-size: 1.25rem; font-weight: 650; }
    .viz-row { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
    .donut { width: 140px; height: 140px; flex: 0 0 auto; }
    .donut-center { font-family: "IBM Plex Sans", sans-serif; font-size: 14px; font-weight: 700; fill: var(--ink); }
    .donut-sub { font-family: "IBM Plex Sans", sans-serif; font-size: 7px; fill: var(--muted); }
    .legend { list-style: none; padding: 0; margin: 0; font-family: "IBM Plex Sans", sans-serif; font-size: 0.85rem; }
    .legend li { margin: 0.25rem 0; display: flex; align-items: center; gap: 0.45rem; }
    .swatch { width: 0.7rem; height: 0.7rem; display: inline-block; border-radius: 2px; }
    .bars { display: flex; flex-direction: column; gap: 0.55rem; }
    .bar-row { display: grid; grid-template-columns: 7.5rem 1fr 5.5rem; gap: 0.5rem; align-items: center; font-family: "IBM Plex Sans", sans-serif; font-size: 0.82rem; }
    .bar-label { color: var(--muted); }
    .bar-track { height: 0.65rem; background: #e8ecef; border-radius: 99px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 99px; background: var(--accent); }
    .bar-fill.ok { background: var(--ok); }
    .bar-fill.bad { background: var(--bad); }
    .bar-val { text-align: right; color: var(--ink); font-variant-numeric: tabular-nums; }
    .gauge-wrap { text-align: center; }
    .gauge { width: 200px; max-width: 100%; }
    .gauge-val { font-family: "IBM Plex Sans", sans-serif; font-size: 18px; font-weight: 700; fill: var(--ink); }
    table { width: 100%; border-collapse: collapse; background: var(--card); }
    th, td { text-align: left; padding: 0.55rem 0.7rem; border-bottom: 1px solid var(--line); font-family: "IBM Plex Sans", "Segoe UI", sans-serif; font-size: 0.92rem; }
    th { color: var(--muted); font-weight: 600; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--card); }
    .controls-table { margin: 0; }
    .controls-table th { white-space: nowrap; background: #f0eeea; }
    .control-row { cursor: pointer; }
    .control-row:hover, .control-row:focus { background: #f3f7f8; outline: none; }
    .control-row:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
    .control-row[hidden] { display: none; }
    .status-filter {
      display: flex; flex-wrap: wrap; gap: 0.45rem; margin: 0.75rem 0 0.85rem;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
    }
    .filter-chip {
      border: 1px solid var(--line); background: var(--card); color: var(--ink);
      padding: 0.35rem 0.65rem; cursor: pointer; font-size: 0.82rem;
    }
    .filter-chip strong { font-variant-numeric: tabular-nums; }
    .filter-chip:hover { background: #f3f7f8; }
    .filter-chip.active { border-color: var(--accent); color: var(--accent); background: #e7eef1; }
    .pill {
      display: inline-block; font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      font-size: 0.72rem; font-weight: 650; letter-spacing: 0.04em;
      padding: 0.15rem 0.45rem; border: 1px solid currentColor;
      margin: 0.1rem 0.15rem 0.1rem 0;
    }
    .ok { color: var(--ok); } .bad { color: var(--bad); } .warn { color: var(--warn); }
    .muted, .na { color: var(--na); }
    .prio { font-family: "IBM Plex Sans", sans-serif; font-size: 0.75rem; color: var(--muted); }
    code { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 0.88em; }
    ul { padding-left: 1.2rem; }
    footer a { color: var(--accent); }
    .flyout-backdrop {
      position: fixed; inset: 0; background: rgba(26, 31, 36, 0.35);
      opacity: 0; pointer-events: none; transition: opacity 0.2s ease; z-index: 40;
    }
    .flyout-backdrop.open { opacity: 1; pointer-events: auto; }
    .flyout {
      position: fixed; top: 0; right: 0; height: 100%; width: min(420px, 94vw);
      background: var(--card); border-left: 1px solid var(--line);
      box-shadow: -8px 0 24px rgba(26, 31, 36, 0.12);
      transform: translateX(100%); transition: transform 0.22s ease;
      z-index: 50; display: flex; flex-direction: column;
      font-family: "Source Serif 4", Georgia, serif;
    }
    .flyout.open { transform: translateX(0); }
    .flyout-header {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem;
      padding: 1.1rem 1.15rem; border-bottom: 1px solid var(--line);
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
    }
    .flyout-header h3 { margin: 0; font-size: 1rem; line-height: 1.35; }
    .flyout-close {
      border: 1px solid var(--line); background: #f7f5f1; color: var(--ink);
      font-family: "IBM Plex Sans", sans-serif; font-size: 0.85rem;
      padding: 0.35rem 0.55rem; cursor: pointer; flex: 0 0 auto;
    }
    .flyout-close:hover { background: #ebe7e0; }
    .flyout-body { padding: 1.1rem 1.15rem 2rem; overflow-y: auto; flex: 1; }
    .flyout-panels { display: none; }
    @media print {
      body { background: white; }
      .stat, .viz-card, .table-wrap { break-inside: avoid; }
      .flyout, .flyout-backdrop { display: none !important; }
      .flyout-panels { display: block !important; }
      .flyout-panel { display: block !important; border: 1px solid var(--line); padding: 0.85rem; margin: 0.75rem 0; page-break-inside: avoid; }
      .flyout-panel[hidden] { display: block !important; }
    }
  </style>
</head><body>
  <header>
    <div class="brand">APRF Auditor · <a href="${STACKRAIL.home}" rel="noopener">StackRail</a></div>
    <h1>${esc(a.subject.name)}</h1>
    ${stackrailLinks()}
    <p class="meta">
      APRF ${esc(a.aprfVersion)} · skill ${esc(a.skillVersion)} · ${esc(a.assessedAt)}<br/>
      ${esc(a.subject.path)}${a.subject.gitCommit ? ` · <code>${esc(a.subject.gitCommit)}</code>` : ""}<br/>
      systemType=${esc(a.scope.systemType ?? "—")} · assessmentKind=${esc(a.scope.assessmentKind ?? "—")}<br/>
      ${esc(a.scope.profileId)}${a.scope.scopeId ? ` (${esc(a.scope.scopeId)})` : ""} · tier ${esc(a.scope.criticality)} · lenses: ${esc(lenses)}
    </p>
    ${banner}
    <p class="meta">Self-attested local assessment against the public <a href="${STACKRAIL.aprf}" rel="noopener">APRF</a> catalog — not third-party certification, not a StackRail cloud product run. Framework home: <a href="${STACKRAIL.github}" rel="noopener">github.com/stackrail-io/APRF</a>.</p>
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
    <p>${esc(a.executiveSummary.narrative)}</p>

    <h2>Visual overview</h2>
    <div class="viz-grid">
      ${scoreGauge(a.executiveSummary.recommendedScore, a.executiveSummary.overallGatePassed)}
      ${statusDonut(statusCounts)}
      ${severityBars(severityCounts)}
    </div>

    <h2>Domain scores</h2>
    <table>
      <thead><tr><th>Domain</th><th>Score</th><th>Mandatory gate</th></tr></thead>
      <tbody>${domainsTable}</tbody>
    </table>

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

    <h2>Controls &amp; Findings</h2>
    ${controlsTable}

    <h2>Roadmaps</h2>
    ${roadmap("30 days", a.roadmaps.days30)}
    ${roadmap("90 days", a.roadmaps.days90)}
    ${roadmap("Long term", a.roadmaps.longTerm)}

    <h2>Excluded checks (non-AI subset)</h2>
    ${excluded}

    <h2>Disclaimer</h2>
    <p class="meta">${esc(a.disclaimer)}</p>
    <p class="meta">Learn more: <a href="${STACKRAIL.aprf}" rel="noopener">stackrail.io/aprf</a> · <a href="${STACKRAIL.how}" rel="noopener">How APRF works</a> · <a href="${STACKRAIL.assess}" rel="noopener">Reference assess</a></p>
  </main>
  <footer>
    Generated by APRF Auditor ·
    <a href="${STACKRAIL.home}" rel="noopener">stackrail.io</a> ·
    <a href="${STACKRAIL.github}" rel="noopener">APRF on GitHub</a>
  </footer>

  <div class="flyout-backdrop" id="flyout-backdrop" hidden></div>
  <aside class="flyout" id="control-flyout" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="flyout-title">
    <div class="flyout-header">
      <h3 id="flyout-title">Control details</h3>
      <button type="button" class="flyout-close" id="flyout-close" aria-label="Close details">Close</button>
    </div>
    <div class="flyout-body" id="flyout-body"></div>
  </aside>
  <div class="flyout-panels" id="flyout-panels">${flyoutPanels}</div>

  <script>
    (function () {
      var backdrop = document.getElementById("flyout-backdrop");
      var flyout = document.getElementById("control-flyout");
      var body = document.getElementById("flyout-body");
      var title = document.getElementById("flyout-title");
      var closeBtn = document.getElementById("flyout-close");
      var panels = document.getElementById("flyout-panels");
      if (!backdrop || !flyout || !body || !title || !closeBtn || !panels) return;

      function openFlyout(id) {
        var panel = document.getElementById("detail-" + id);
        if (!panel) return;
        title.textContent = panel.getAttribute("data-title") || id;
        body.innerHTML = panel.innerHTML;
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
        setTimeout(function () { backdrop.hidden = true; }, 220);
      }

      document.querySelectorAll(".control-row").forEach(function (row) {
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
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && flyout.classList.contains("open")) closeFlyout();
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
}function parseArgs(argv: string[]) {
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

const { input, output } = parseArgs(process.argv);
const assessment = JSON.parse(readFileSync(input, "utf8")) as Assessment;
const html = render(assessment);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, html, "utf8");
console.log(`Wrote ${output}`);
