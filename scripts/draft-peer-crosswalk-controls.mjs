#!/usr/bin/env node
/**
 * Draft (and optionally apply) fine-grained peer crosswalk controls from
 * OWASP secure-agent-playbook frontmatter. Does not vendor playbook corpora.
 *
 * Usage:
 *   node scripts/draft-peer-crosswalk-controls.mjs [--playbook-root PATH] [--out FILE]
 *   node scripts/draft-peer-crosswalk-controls.mjs --apply
 *
 * --apply merges new frameworks into spec/aprf-spec.json, enriches
 * owasp-llm-top-10.controls with relatedPeerControlIds, and refreshes
 * metadata.compatibility.crosswalks.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const DISCLAIMER =
  "Informative alignment only. Does not constitute certification, accreditation, or official endorsement.";

function parseArgs(argv) {
  const out = {
    playbookRoot: process.env.PLAYBOOK_ROOT || "",
    out: "",
    apply: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--playbook-root") out.playbookRoot = argv[++i] ?? "";
    else if (a === "--out") out.out = argv[++i] ?? "";
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: draft-peer-crosswalk-controls.mjs [--playbook-root PATH] [--out FILE] [--apply]`);
      process.exit(0);
    }
  }
  if (!out.playbookRoot) {
    const sibling = resolve(repoRoot, "../stackrail/secure-agent-playbook");
    const alt = resolve(repoRoot, "../../stackrail/secure-agent-playbook");
    out.playbookRoot = existsSync(sibling)
      ? sibling
      : existsSync(alt)
        ? alt
        : sibling;
  }
  return out;
}

function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { meta: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: text };
  const raw = text.slice(4, end);
  const meta = {};
  let listKey = null;
  let objListKey = null;
  let currentObj = null;
  for (const line of raw.split("\n")) {
    if (/^\s*-\s+section:\s*/.test(line) && objListKey) {
      currentObj = { section: line.replace(/^\s*-\s+section:\s*/, "").replace(/^["']|["']$/g, "").trim() };
      meta[objListKey].push(currentObj);
      continue;
    }
    if (currentObj && /^\s+title:\s*/.test(line)) {
      currentObj.title = line.replace(/^\s+title:\s*/, "").replace(/^["']|["']$/g, "").trim();
      continue;
    }
    if (currentObj && /^\s+requirements:/.test(line)) {
      currentObj.requirements = [];
      continue;
    }
    if (currentObj?.requirements && /^\s+-\s+/.test(line)) {
      currentObj.requirements.push(line.replace(/^\s+-\s+/, "").replace(/^["']|["']$/g, "").trim());
      continue;
    }
    if (/^\s*-\s+cre_id:\s*/.test(line) && objListKey === "opencre_mappings") {
      currentObj = { cre_id: line.replace(/^\s*-\s+cre_id:\s*/, "").replace(/^["']|["']$/g, "").trim() };
      meta.opencre_mappings.push(currentObj);
      continue;
    }
    if (currentObj && objListKey === "opencre_mappings" && /^\s+cre_name:\s*/.test(line)) {
      currentObj.cre_name = line.replace(/^\s+cre_name:\s*/, "").replace(/^["']|["']$/g, "").trim();
      continue;
    }
    const keyMatch = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (keyMatch) {
      currentObj = null;
      const key = keyMatch[1];
      const val = keyMatch[2].trim();
      if (val === "" || val === "|" || val === ">") {
        if (key === "aisvs_mappings" || key === "opencre_mappings") {
          objListKey = key;
          listKey = null;
          meta[key] = [];
        } else {
          listKey = key;
          objListKey = null;
          meta[key] = [];
        }
      } else {
        listKey = null;
        objListKey = null;
        meta[key] = val.replace(/^["']|["']$/g, "");
      }
      continue;
    }
    if (listKey && /^\s*-\s+/.test(line)) {
      meta[listKey].push(line.replace(/^\s*-\s+/, "").replace(/^["']|["']$/g, "").trim());
    }
  }
  return { meta, body: text.slice(end + 4) };
}

function listMd(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
    .sort()
    .map((f) => join(dir, f));
}

function mapRow(peerControlId, pillars, checks, relation = "partial") {
  const row = { peerControlId, relation };
  if (pillars?.length) row.aprfPillarSlugs = pillars;
  if (checks?.length) row.aprfCheckIds = checks;
  return row;
}

/** OWASP LLM Top 10 → APRF (mirrors existing spec mappings for AISVS seed). */
const LLM_TO_APRF = {
  "01": {
    pillars: ["ai-security", "prompt-engineering", "tool-safety"],
    checks: ["SEC-M1", "SEC-M3", "PRM-M1", "TOL-M1"],
    relation: "supports",
  },
  "02": {
    pillars: ["data-privacy", "context-engineering", "secrets", "memory-management"],
    checks: ["PRI-M1", "PRI-M2", "SEC2-M1", "MEM-M1"],
    relation: "supports",
  },
  "03": {
    pillars: ["supply-chain", "model-governance", "infrastructure"],
    checks: ["SCI-M1", "SCI-M2", "MOD-M1"],
    relation: "supports",
  },
  "04": {
    pillars: ["data-governance", "memory-management", "model-governance", "evaluation"],
    checks: ["DG-M2", "MEM-M2", "MOD-R4", "EVL-M1"],
    relation: "supports",
  },
  "05": {
    pillars: ["ai-security", "tool-safety", "safety-responsible-ai"],
    checks: ["SEC-M3", "TOL-M2", "SAF-M1"],
    relation: "supports",
  },
  "06": {
    pillars: ["tool-safety", "agent-governance", "human-approval", "authorization"],
    checks: ["TOL-M1", "TOL-M2", "TOL-M3", "AGN-M2", "HUM-M1", "AUTHZ-M1"],
    relation: "supports",
  },
  "07": {
    pillars: ["prompt-engineering", "ai-security", "secrets"],
    checks: ["PRM-M2", "SEC-M1", "SEC2-M2"],
    relation: "aligns-with",
  },
  "08": {
    pillars: ["memory-management", "context-engineering", "data-governance"],
    checks: ["MEM-M1", "MEM-M3", "CTX-M2", "DG-M3"],
    relation: "supports",
  },
  "09": {
    pillars: ["safety-responsible-ai", "evaluation", "explainability"],
    checks: ["SAF-M2", "EVL-M2", "EXP-M1"],
    relation: "aligns-with",
  },
  "10": {
    pillars: ["cost-optimization", "reliability-continuity", "performance-slo"],
    checks: ["COST-M1", "COST-M3", "REL-M1", "PERF-M1"],
    relation: "supports",
  },
};

const AISVS_CHAPTER_DEFAULTS = {
  C1: {
    pillars: ["data-governance", "evaluation"],
    checks: ["DG-M2", "EVL-M1"],
    relation: "partial",
  },
  C2: {
    pillars: ["ai-security", "prompt-engineering"],
    checks: ["SEC-M1", "PRM-M1"],
    relation: "partial",
  },
  C3: {
    pillars: ["model-governance", "evaluation"],
    checks: ["MOD-M1", "EVL-M1"],
    relation: "partial",
  },
  C4: {
    pillars: ["infrastructure", "platform-engineering"],
    checks: ["INF-M1", "INF-M2"],
    relation: "partial",
  },
  C5: {
    pillars: ["authentication", "authorization", "secrets"],
    checks: ["AUTHN-M1", "AUTHZ-M1", "SEC2-M1"],
    relation: "partial",
  },
  C6: {
    pillars: ["supply-chain", "model-governance"],
    checks: ["SCI-M1", "MOD-M1"],
    relation: "partial",
  },
  C7: {
    pillars: ["safety-responsible-ai", "ai-security"],
    checks: ["SAF-M1", "SEC-M3"],
    relation: "partial",
  },
  C8: {
    pillars: ["memory-management", "context-engineering"],
    checks: ["MEM-M1", "CTX-M2"],
    relation: "partial",
  },
  C9: {
    pillars: ["agent-governance", "tool-safety", "human-approval"],
    checks: ["AGN-M2", "TOL-M1", "HUM-M1"],
    relation: "partial",
  },
  C10: {
    pillars: ["safety-responsible-ai", "model-governance", "ai-security"],
    checks: ["SAF-M2", "MOD-M1", "SEC-M4"],
    relation: "partial",
  },
  C11: {
    pillars: ["data-privacy", "data-governance"],
    checks: ["PRI-M1", "DG-M1"],
    relation: "partial",
  },
  C12: {
    pillars: ["observability", "incident-readiness"],
    checks: ["OBS-M1", "INC-M1"],
    relation: "partial",
  },
  C13: {
    pillars: ["reliability-continuity", "incident-readiness", "human-approval"],
    checks: ["REL-M1", "INC-M1", "HUM-M1"],
    relation: "partial",
  },
};

/**
 * ASVS 5.0 chapter map (not ASVS 4). Prefer explicit Check IDs; keep at most one
 * pillar slug to limit report flood from pillar expansion.
 */
const ASVS_CHAPTER_DEFAULTS = {
  V1: {
    pillars: ["ai-security"],
    checks: ["SEC-M1", "PRM-M1"],
    relation: "partial",
  },
  V2: {
    pillars: ["ai-security"],
    checks: ["SEC-M1", "TOL-M2"],
    relation: "partial",
  },
  V3: {
    pillars: ["ai-security"],
    checks: ["SEC-M3", "TOL-M2"],
    relation: "partial",
  },
  V4: {
    pillars: ["authorization"],
    checks: ["AUTHZ-M1", "SEC-M1"],
    relation: "aligns-with",
  },
  V5: {
    pillars: ["infrastructure"],
    checks: ["INF-M1", "DG-M3"],
    relation: "partial",
  },
  V6: {
    pillars: ["authentication"],
    checks: ["AUTHN-M1", "AUTHN-M3", "SEC2-M1"],
    relation: "aligns-with",
  },
  V7: {
    pillars: ["authentication"],
    checks: ["AUTHN-M1", "AUTHZ-M1"],
    relation: "aligns-with",
  },
  V8: {
    pillars: ["authorization"],
    checks: ["AUTHZ-M1", "AUTHZ-M2"],
    relation: "aligns-with",
  },
  V9: {
    pillars: ["authentication"],
    checks: ["AUTHN-M2", "SEC2-M1"],
    relation: "aligns-with",
  },
  V10: {
    pillars: ["authentication"],
    checks: ["AUTHN-M1", "AUTHZ-M1"],
    relation: "aligns-with",
  },
  V11: {
    pillars: ["secrets"],
    checks: ["SEC2-M1", "INF-M2"],
    relation: "partial",
  },
  V12: {
    pillars: ["infrastructure"],
    checks: ["INF-M1", "INF-M2"],
    relation: "aligns-with",
  },
  V13: {
    pillars: ["infrastructure"],
    checks: ["INF-M1", "CHG-M1"],
    relation: "partial",
  },
  V14: {
    pillars: ["data-privacy"],
    checks: ["PRI-M1", "DG-M1"],
    relation: "aligns-with",
  },
  V15: {
    pillars: ["ai-security"],
    checks: ["SEC-M1", "CHG-M1"],
    relation: "partial",
  },
  V16: {
    pillars: ["observability"],
    checks: ["OBS-M1", "INC-M1"],
    relation: "aligns-with",
  },
  V17: {
    pillars: ["infrastructure"],
    checks: ["INF-M1", "REL-M1"],
    relation: "partial",
  },
};

/** LLM10 (unbounded consumption) only seeds these AISVS sections; others keep chapter affinity. */
const LLM10_CONSUMPTION_SECTIONS = new Set(["C2.6", "C4.6"]);

// Only use known APRF pillar slugs — drop placeholders that aren't in APRF.
const APRF_PILLARS = new Set([
  "ai-security",
  "authentication",
  "authorization",
  "secrets",
  "tool-safety",
  "supply-chain",
  "infrastructure",
  "safety-responsible-ai",
  "explainability",
  "data-privacy",
  "data-governance",
  "memory-management",
  "model-governance",
  "prompt-engineering",
  "context-engineering",
  "evaluation",
  "agent-governance",
  "human-approval",
  "observability",
  "performance-slo",
  "reliability-continuity",
  "change-management",
  "incident-readiness",
  "cost-optimization",
  "organizational-governance",
  "compliance",
  "platform-engineering",
]);

function filterPillars(slugs) {
  return (slugs ?? []).filter((s) => APRF_PILLARS.has(s));
}

function asvsDefaults(ref) {
  const chapter = ref.match(/^(V\d+)/)?.[1] ?? "V1";
  const d = ASVS_CHAPTER_DEFAULTS[chapter] ?? {
    pillars: ["ai-security"],
    checks: ["SEC-M1"],
    relation: "partial",
  };
  return {
    pillars: filterPillars(d.pillars),
    checks: d.checks ?? [],
    relation: d.relation,
  };
}

/** Prefer Check IDs; one pillar max to limit report flood. */
const FIASSE_DEFAULTS = {
  S1: {
    pillars: ["organizational-governance"],
    checks: ["ORG-M1", "CMP-M1"],
    relation: "partial",
  },
  S2: {
    pillars: ["change-management"],
    checks: ["ORG-M1", "CHG-M1"],
    relation: "partial",
  },
  S3: {
    pillars: ["platform-engineering"],
    checks: ["CHG-M1", "INF-M1"],
    relation: "aligns-with",
  },
  S4: {
    pillars: ["ai-security"],
    checks: ["SEC-M1", "SCI-M1"],
    relation: "partial",
  },
  S5: {
    pillars: ["evaluation"],
    checks: ["EVL-M1", "OBS-M1"],
    relation: "partial",
  },
  S6: {
    pillars: ["incident-readiness"],
    checks: ["INC-M1", "OBS-M1"],
    relation: "partial",
  },
  S7: {
    pillars: ["compliance"],
    checks: ["ORG-M1", "CMP-M1"],
    relation: "partial",
  },
  S8: {
    pillars: ["reliability-continuity"],
    checks: ["REL-M1", "INF-M1"],
    relation: "partial",
  },
  SA: {
    pillars: ["evaluation"],
    checks: ["EVL-M1", "OBS-M1"],
    relation: "aligns-with",
  },
};

function fiasseDefaults(ref) {
  const key = ref.startsWith("SA") ? "SA" : ref.match(/^(S\d+)/)?.[1] ?? "S1";
  const d = FIASSE_DEFAULTS[key] ?? FIASSE_DEFAULTS.S1;
  return {
    pillars: filterPillars(d.pillars),
    checks: d.checks ?? [],
    relation: d.relation,
  };
}

function aisvsChapterDefaults(ref) {
  const chapter = ref.match(/^(C\d+)/)?.[1] ?? "C2";
  return AISVS_CHAPTER_DEFAULTS[chapter] ?? AISVS_CHAPTER_DEFAULTS.C2;
}

function mergeRelation(a, b) {
  const rank = { supports: 3, "aligns-with": 2, partial: 1, "evidence-for": 2 };
  return (rank[a] ?? 0) >= (rank[b] ?? 0) ? a : b;
}

const OPENCRE_MAP = {
  "CWE-16": {
    pillars: ["infrastructure", "change-management"],
    checks: ["INF-M1", "CHG-M1"],
    relation: "partial",
  },
  "CWE-22": {
    pillars: ["ai-security", "tool-safety"],
    checks: ["SEC-M1", "TOL-M1"],
    relation: "partial",
  },
  "CWE-78": {
    pillars: ["tool-safety", "ai-security"],
    checks: ["TOL-M1", "TOL-M2", "SEC-M1"],
    relation: "aligns-with",
  },
  "CWE-79": {
    pillars: ["ai-security", "tool-safety"],
    checks: ["SEC-M3", "TOL-M2"],
    relation: "partial",
  },
  "CWE-89": {
    pillars: ["tool-safety", "data-governance"],
    checks: ["TOL-M1", "DG-M3"],
    relation: "partial",
  },
  "CWE-200": {
    pillars: ["data-privacy", "secrets"],
    checks: ["PRI-M1", "SEC2-M1", "SEC2-M2"],
    relation: "aligns-with",
  },
  "CWE-287": {
    pillars: ["authentication"],
    checks: ["AUTHN-M1", "AUTHN-M2", "AUTHN-M3"],
    relation: "aligns-with",
  },
  "CWE-327": {
    pillars: ["secrets", "infrastructure"],
    checks: ["SEC2-M1", "INF-M2"],
    relation: "partial",
  },
  "CWE-352": {
    pillars: ["authentication", "authorization"],
    checks: ["AUTHN-M1", "AUTHZ-M1"],
    relation: "partial",
  },
  "CWE-384": {
    pillars: ["authentication", "authorization"],
    checks: ["AUTHN-M1", "AUTHZ-M2"],
    relation: "partial",
  },
  "CWE-502": {
    pillars: ["tool-safety", "ai-security"],
    checks: ["TOL-M2", "SEC-M1"],
    relation: "partial",
  },
  "CWE-778": {
    pillars: ["observability", "incident-readiness"],
    checks: ["OBS-M1", "INC-M1"],
    relation: "aligns-with",
  },
  "CWE-798": {
    pillars: ["secrets"],
    checks: ["SEC2-M1", "SEC2-M2"],
    relation: "aligns-with",
  },
};

const MAESTRO_CONTROLS = [
  {
    id: "maestro:L1",
    ref: "L1",
    title: "Foundation Models",
    summary: "Core LLMs, model APIs, inference engines.",
    pillars: ["model-governance", "ai-security", "supply-chain"],
    checks: ["MOD-M1", "SCI-M1", "SEC-M3"],
    relation: "supports",
  },
  {
    id: "maestro:L2",
    ref: "L2",
    title: "Data Operations",
    summary: "Memory stores, vector databases, RAG pipelines, context management.",
    pillars: ["memory-management", "context-engineering", "data-governance"],
    checks: ["MEM-M1", "MEM-M3", "CTX-M2", "DG-M3"],
    relation: "supports",
  },
  {
    id: "maestro:L3",
    ref: "L3",
    title: "Agent Frameworks",
    summary: "Orchestration logic, agent-tool bindings, routing decisions.",
    pillars: ["agent-governance", "tool-safety"],
    checks: ["AGN-M1", "AGN-M2", "TOL-M1", "TOL-M3"],
    relation: "supports",
  },
  {
    id: "maestro:L4",
    ref: "L4",
    title: "Deployment & Infrastructure",
    summary: "Containers, orchestration, cloud/on-premise resources.",
    pillars: ["infrastructure", "platform-engineering", "supply-chain"],
    checks: ["INF-M1", "INF-M2", "SCI-M2"],
    relation: "supports",
  },
  {
    id: "maestro:L5",
    ref: "L5",
    title: "Evaluation & Observability",
    summary: "Monitoring, metrics, anomaly detection, performance tracking.",
    pillars: ["observability", "evaluation", "performance-slo"],
    checks: ["OBS-M1", "EVL-M1", "PERF-M1"],
    relation: "supports",
  },
  {
    id: "maestro:L6",
    ref: "L6",
    title: "Security & Compliance",
    summary: "Cross-cutting security controls and compliance frameworks.",
    pillars: ["ai-security", "compliance", "organizational-governance"],
    checks: ["SEC-M1", "SEC-M4", "CMP-M1"],
    relation: "supports",
  },
  {
    id: "maestro:L7",
    ref: "L7",
    title: "Agent Ecosystem",
    summary: "User-facing applications, agent marketplace, business integrations.",
    pillars: ["agent-governance", "human-approval", "authorization"],
    checks: ["AGN-M1", "HUM-M1", "AUTHZ-M1"],
    relation: "supports",
  },
  {
    id: "maestro:reasoning-collapse",
    ref: "reasoning-collapse",
    title: "Reasoning Collapse",
    summary: "Chain-of-thought breakdowns across agent delegation.",
    pillars: ["agent-governance", "evaluation", "explainability"],
    checks: ["AGN-M2", "EVL-M2", "EXP-M1"],
    relation: "aligns-with",
  },
  {
    id: "maestro:emergent-covert-coordination",
    ref: "emergent-covert-coordination",
    title: "Emergent Covert Coordination",
    summary: "Autonomous symbolic protocol development between agents.",
    pillars: ["agent-governance", "ai-security", "observability"],
    checks: ["AGN-M1", "SEC-M4", "OBS-M1"],
    relation: "aligns-with",
  },
  {
    id: "maestro:heterogeneous-multi-agent-exploits",
    ref: "heterogeneous-multi-agent-exploits",
    title: "Heterogeneous Multi-Agent Exploits",
    summary: "Coordinated attacks using diverse agent capabilities.",
    pillars: ["agent-governance", "tool-safety", "ai-security"],
    checks: ["AGN-M1", "TOL-M1", "SEC-M1", "SEC-M3"],
    relation: "aligns-with",
  },
  {
    id: "maestro:goal-drift",
    ref: "goal-drift",
    title: "Goal Drift in Delegated Chains",
    summary: "Intent mutation through agent handoffs.",
    pillars: ["agent-governance", "human-approval", "evaluation"],
    checks: ["AGN-M2", "HUM-M1", "EVL-M1"],
    relation: "aligns-with",
  },
  {
    id: "maestro:trust-misuse",
    ref: "trust-misuse",
    title: "Trust Misuse Between Legitimate Agents",
    summary: "Strategic misreporting within valid roles.",
    pillars: ["agent-governance", "authorization", "observability"],
    checks: ["AGN-M1", "AUTHZ-M1", "OBS-M1"],
    relation: "aligns-with",
  },
];

function buildFromPlaybook(playbookRoot) {
  if (!existsSync(playbookRoot)) {
    throw new Error(`Playbook root not found: ${playbookRoot}`);
  }

  // --- LLM → AISVS bridges ---
  const llmBridgeByNum = {};
  for (const path of listMd(join(playbookRoot, "data/llm-top10"))) {
    const { meta } = parseFrontmatter(readFileSync(path, "utf8"));
    const id = String(meta.owasp_llm_id || "").replace("LLM", "");
    const sections = (meta.aisvs_mappings || []).map((m) => m.section).filter(Boolean);
    if (id) llmBridgeByNum[id.padStart(2, "0")] = sections;
  }

  // Invert LLM→AISVS for seeding (LLM10 only onto consumption-core sections).
  const aisvsSeed = new Map(); // section -> { pillars, checks, relation }
  for (const [num, sections] of Object.entries(llmBridgeByNum)) {
    const src = LLM_TO_APRF[num];
    if (!src) continue;
    for (const section of sections) {
      if (num === "10" && !LLM10_CONSUMPTION_SECTIONS.has(section)) continue;
      const prev = aisvsSeed.get(section) ?? {
        pillars: new Set(),
        checks: new Set(),
        relation: src.relation,
      };
      for (const p of src.pillars) prev.pillars.add(p);
      for (const c of src.checks) prev.checks.add(c);
      prev.relation = mergeRelation(prev.relation, src.relation);
      aisvsSeed.set(section, prev);
    }
  }

  // --- AISVS ---
  const aisvsControls = [];
  const aisvsMappings = [];
  for (const path of listMd(join(playbookRoot, "data/aisvs"))) {
    const { meta } = parseFrontmatter(readFileSync(path, "utf8"));
    const ref = meta.aisvs_chapter || path.replace(/.*\//, "").replace(/\.md$/, "");
    const title = (meta.title || ref).replace(/^C[\d.]+\s+/, "");
    const id = `aisvs:${ref}`;
    aisvsControls.push({
      id,
      ref,
      title,
      ...(meta.summary ? { summary: meta.summary } : {}),
    });
    // Always keep chapter affinity; merge LLM seed on top when present.
    const chapter = aisvsChapterDefaults(ref);
    const pillars = new Set(filterPillars(chapter.pillars));
    const checks = new Set(chapter.checks ?? []);
    let relation = chapter.relation;
    const seed = aisvsSeed.get(ref);
    if (seed) {
      for (const p of seed.pillars) pillars.add(p);
      for (const c of seed.checks) checks.add(c);
      relation = mergeRelation(relation, seed.relation);
    }
    aisvsMappings.push(
      mapRow(id, filterPillars([...pillars]), [...checks], relation),
    );
  }

  // --- ASVS ---
  const asvsControls = [];
  const asvsMappings = [];
  for (const path of listMd(
    join(playbookRoot, "plugins/code-security-skills/data/asvs"),
  )) {
    const { meta } = parseFrontmatter(readFileSync(path, "utf8"));
    const ref = meta.asvs_chapter || path.replace(/.*\//, "").replace(/\.md$/, "");
    const title = (meta.title || ref).replace(/^V[\d.]+\s+/, "");
    const id = `asvs:${ref}`;
    asvsControls.push({
      id,
      ref,
      title,
      ...(meta.summary ? { summary: meta.summary } : {}),
    });
    const d = asvsDefaults(ref);
    // Check IDs only — avoid pillar expansion flooding every auth/infra Check.
    asvsMappings.push(mapRow(id, undefined, d.checks, d.relation));
  }

  // --- FIASSE ---
  const fiasseControls = [];
  const fiasseMappings = [];
  for (const path of listMd(
    join(playbookRoot, "plugins/code-security-skills/data/fiasse"),
  )) {
    const { meta } = parseFrontmatter(readFileSync(path, "utf8"));
    const ref =
      meta.fiasse_section || path.replace(/.*\//, "").replace(/\.md$/, "");
    const title = (meta.title || ref).replace(/^(S|SA)[\d.]+\s+/, "");
    const id = `fiasse:${ref}`;
    const control = {
      id,
      ref,
      title,
      ...(meta.summary ? { summary: meta.summary } : {}),
    };
    fiasseControls.push(control);
    const d = fiasseDefaults(ref);
    // Check IDs only — FIASSE sections are broad; pillar expansion over-attaches.
    fiasseMappings.push(mapRow(id, undefined, d.checks, d.relation));
  }

  // --- OpenCRE ---
  const opencreControls = [];
  const opencreMappings = [];
  for (const path of listMd(join(playbookRoot, "data/opencre"))) {
    const { meta } = parseFrontmatter(readFileSync(path, "utf8"));
    const ref = meta.cwe_id || path.replace(/.*\//, "").replace(/\.md$/, "");
    const title = (meta.title || ref).replace(/^CWE-\d+\s+/, "");
    const creIds = (meta.opencre_mappings || [])
      .map((m) => m.cre_id)
      .filter(Boolean);
    const id = `opencre:${ref}`;
    opencreControls.push({
      id,
      ref,
      title,
      summary: [
        meta.summary,
        creIds.length ? `OpenCRE: ${creIds.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    });
    const d = OPENCRE_MAP[ref] ?? {
      pillars: ["ai-security"],
      checks: ["SEC-M1"],
      relation: "partial",
    };
    opencreMappings.push(
      mapRow(id, filterPillars(d.pillars), d.checks, d.relation),
    );
  }

  // --- MAESTRO ---
  const maestroControls = MAESTRO_CONTROLS.map(
    ({ id, ref, title, summary }) => ({ id, ref, title, summary }),
  );
  const maestroMappings = MAESTRO_CONTROLS.map((c) =>
    mapRow(c.id, filterPillars(c.pillars), c.checks, c.relation),
  );

  // --- LLM relatedPeerControlIds payload ---
  const llmRelated = {};
  for (const [num, sections] of Object.entries(llmBridgeByNum)) {
    llmRelated[`owasp-llm:${num}`] = sections.map((s) => `aisvs:${s}`);
  }

  const frameworks = [
    {
      id: "aisvs",
      name: "OWASP AI Application Security Verification Standard (AISVS)",
      peerVersion: "section-level (playbook inventory)",
      url: "https://owasp.org/www-project-ai-application-security-verification-standard/",
      disclaimer: DISCLAIMER,
      controls: aisvsControls,
      mappings: aisvsMappings,
    },
    {
      id: "asvs",
      name: "OWASP Application Security Verification Standard",
      peerVersion: "5.0",
      url: "https://owasp.org/www-project-application-security-verification-standard/",
      disclaimer: DISCLAIMER,
      controls: asvsControls,
      mappings: asvsMappings,
    },
    {
      id: "opencre",
      name: "OpenCRE (Open Common Requirements Enumeration)",
      peerVersion: "CWE bridge set (playbook inventory)",
      url: "https://www.opencre.org/",
      disclaimer: DISCLAIMER,
      controls: opencreControls,
      mappings: opencreMappings,
    },
    {
      id: "maestro",
      name: "CSA MAESTRO (Multi-Agentic Threat Model)",
      peerVersion: "7-layer architecture + extended multi-agent threats",
      url: "https://cloudsecurityalliance.org/",
      disclaimer: DISCLAIMER,
      controls: maestroControls,
      mappings: maestroMappings,
    },
    {
      id: "fiasse",
      name: "OWASP FIASSE / SSEM",
      peerVersion: "1.0.4",
      url: "https://owasp.org/www-project-fiasse/",
      disclaimer: DISCLAIMER,
      controls: fiasseControls,
      mappings: fiasseMappings,
    },
  ];

  return { frameworks, llmRelated };
}

function applyToSpec(payload) {
  const specPath = join(repoRoot, "spec/aprf-spec.json");
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  const keepIds = new Set([
    "nist-ai-rmf",
    "iso-42001",
    "owasp-llm-top-10",
    "soc2-tsc",
    "aws-well-architected",
    "slsa",
  ]);
  const existing = (spec.crosswalks ?? []).filter((c) => keepIds.has(c.id));
  const llm = existing.find((c) => c.id === "owasp-llm-top-10");
  if (llm) {
    for (const control of llm.controls ?? []) {
      const related = payload.llmRelated[control.id];
      if (related?.length) control.relatedPeerControlIds = related;
    }
  }
  // Insert new frameworks after owasp-llm-top-10 for readability
  const out = [];
  for (const cw of existing) {
    out.push(cw);
    if (cw.id === "owasp-llm-top-10") {
      out.push(...payload.frameworks);
    }
  }
  // If llm missing for some reason, append
  if (!existing.some((c) => c.id === "owasp-llm-top-10")) {
    out.push(...payload.frameworks);
  }
  spec.crosswalks = out;

  spec.metadata = spec.metadata ?? {};
  spec.metadata.compatibility = {
    crosswalks: [
      "NIST AI RMF",
      "ISO/IEC 42001",
      "SOC 2 Trust Services Criteria (evidence reuse)",
      "OWASP LLM Top 10 (with AISVS bridges)",
      "OWASP AISVS",
      "OWASP ASVS 5.0",
      "OpenCRE",
      "CSA MAESTRO",
      "OWASP FIASSE / SSEM",
      "AWS Well-Architected (conceptual)",
      "SLSA / supply-chain",
    ],
    note: "Machine-readable maps for NIST AI RMF, ISO/IEC 42001, OWASP LLM Top 10 (incl. AISVS relatedPeerControlIds), AISVS, ASVS, OpenCRE, MAESTRO, FIASSE, SOC 2, AWS Well-Architected, and SLSA ship in the APRF spec under crosswalks[]. Informative alignment only — not certification.",
  };

  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  const counts = payload.frameworks.map(
    (f) => `${f.id}:${f.controls.length}c/${f.mappings.length}m`,
  );
  console.log(`Applied to ${specPath}`);
  console.log(`  ${counts.join("  ")}`);
  console.log(
    `  LLM bridges: ${Object.keys(payload.llmRelated).length} controls`,
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = buildFromPlaybook(args.playbookRoot);
  if (args.apply) {
    applyToSpec(payload);
    return;
  }
  const json = JSON.stringify(payload, null, 2);
  if (args.out) {
    mkdirSync(dirname(resolve(args.out)), { recursive: true });
    writeFileSync(args.out, `${json}\n`);
    console.log(`Wrote ${args.out}`);
  } else {
    process.stdout.write(`${json}\n`);
  }
  for (const f of payload.frameworks) {
    console.error(
      `${f.id}: ${f.controls.length} controls, ${f.mappings.length} mappings`,
    );
  }
}

main();
