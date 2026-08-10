#!/usr/bin/env node
/**
 * Draft (and optionally apply) fine-grained peer crosswalk controls.
 *
 * AISVS sections are parsed from a local OWASP AISVS checkout (locked `1.0/en/`).
 * ASVS / OpenCRE / FIASSE use ID/title/summary inventories under
 * scripts/peer-crosswalk-inventories/ (not full peer markdown corpora).
 *
 * Usage:
 *   node scripts/draft-peer-crosswalk-controls.mjs [--aisvs-root PATH] [--out FILE]
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
import { parse as parseYaml } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const DISCLAIMER =
  "Informative alignment only. Does not constitute certification, accreditation, or official endorsement.";

function loadAprfPillars() {
  const path = join(repoRoot, "packages/aprf-engine/rules/_index/pillars.yaml");
  const doc = parseYaml(readFileSync(path, "utf8"));
  const slugs = (doc?.pillars ?? []).map((p) => p.slug).filter(Boolean);
  if (!slugs.length) throw new Error(`No pillar slugs found in ${path}`);
  return new Set(slugs);
}

/** Valid APRF pillar slugs from the engine index (fail closed on unknown). */
const APRF_PILLARS = loadAprfPillars();

function aisvsEnDir(root) {
  return join(root, "1.0", "en");
}

/** Prefer an OWASP/AISVS checkout that contains locked `1.0/en/`. */
function resolveAisvsRoot(explicit) {
  // Explicit --aisvs-root / AISVS_ROOT must be valid; never silently fall through.
  if (explicit) {
    if (existsSync(aisvsEnDir(explicit))) return explicit;
    throw new Error(
      `OWASP AISVS 1.0 not found at --aisvs-root / AISVS_ROOT: ${explicit} (expected ${aisvsEnDir(explicit)}).`,
    );
  }
  const candidates = [
    resolve(repoRoot, "../AISVS"),
    resolve(repoRoot, "../../AISVS"),
    "/tmp/AISVS",
  ];
  for (const root of candidates) {
    if (existsSync(aisvsEnDir(root))) return root;
  }
  throw new Error(
    [
      "OWASP AISVS 1.0 not found (expected <root>/1.0/en).",
      "Clone https://github.com/OWASP/AISVS and pass --aisvs-root PATH (or set AISVS_ROOT).",
      `Tried: ${candidates.join(", ")}`,
    ].join(" "),
  );
}

function parseArgs(argv) {
  const out = {
    aisvsRoot: process.env.AISVS_ROOT || "",
    out: "",
    apply: false,
    selfTest: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--self-test") out.selfTest = true;
    else if (a === "--aisvs-root") out.aisvsRoot = argv[++i] ?? "";
    else if (a === "--out") out.out = argv[++i] ?? "";
    else if (a === "--help" || a === "-h") {
      console.log(
        `Usage: draft-peer-crosswalk-controls.mjs [--aisvs-root PATH] [--out FILE] [--apply] [--self-test]`,
      );
      process.exit(0);
    }
  }
  return out;
}

function loadPeerInventory(frameworkId) {
  const path = join(here, "peer-crosswalk-inventories", `${frameworkId}.json`);
  if (!existsSync(path)) {
    throw new Error(`Peer inventory not found: ${path}`);
  }
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const controls = doc?.controls;
  if (!Array.isArray(controls) || controls.length === 0) {
    throw new Error(`Peer inventory has no controls: ${path}`);
  }
  const expectedPrefix = `${frameworkId}:`;
  const seen = new Set();
  return controls.map((c, i) => {
    const id = typeof c?.id === "string" ? c.id.trim() : "";
    const ref = typeof c?.ref === "string" ? c.ref.trim() : "";
    const title = typeof c?.title === "string" ? c.title.trim() : "";
    const summary =
      typeof c?.summary === "string" && c.summary.trim()
        ? c.summary.trim()
        : undefined;
    if (!id || !ref || !title) {
      throw new Error(
        `${path} controls[${i}] missing required id/ref/title`,
      );
    }
    if (!id.startsWith(expectedPrefix) || id !== `${frameworkId}:${ref}`) {
      throw new Error(
        `${path} controls[${i}] id/ref mismatch: id=${JSON.stringify(id)} ref=${JSON.stringify(ref)} (expected ${frameworkId}:${ref})`,
      );
    }
    if (seen.has(id)) {
      throw new Error(`${path} duplicate control id: ${id}`);
    }
    seen.add(id);
    return summary ? { id, ref, title, summary } : { id, ref, title };
  });
}

/** Regression checks for inventory + AISVS helpers (run via --self-test). */
function selfTest() {
  for (const id of ["asvs", "fiasse", "opencre"]) {
    const controls = loadPeerInventory(id);
    if (controls.length === 0) {
      throw new Error(`self-test: empty inventory ${id}`);
    }
  }
  if (aisvsPeerId("C2.1") !== "aisvs:v1.0-C2.1") {
    throw new Error(`self-test: aisvsPeerId failed: ${aisvsPeerId("C2.1")}`);
  }
  if (aisvsChapterDefaults("C10.2") !== AISVS_CHAPTER_DEFAULTS.C10) {
    throw new Error("self-test: C10 chapter defaults mis-resolved");
  }
  if (aisvsChapterDefaults("C1.1") !== AISVS_CHAPTER_DEFAULTS.C1) {
    throw new Error("self-test: C1 chapter defaults mis-resolved");
  }
  // Explicit bad root must fail closed (not fall through).
  let failed = false;
  try {
    resolveAisvsRoot("/nonexistent-aisvs-root-for-self-test");
  } catch {
    failed = true;
  }
  if (!failed) {
    throw new Error("self-test: resolveAisvsRoot should reject invalid explicit root");
  }
  console.error("draft-peer-crosswalk self-test OK");
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
  // Official AISVS 1.0: C10 = MCP Security.
  C10: {
    pillars: ["tool-safety", "authentication", "authorization", "ai-security"],
    checks: ["TOL-M1", "TOL-M2", "AUTHN-M1", "AUTHZ-M1", "SEC-M1"],
    relation: "partial",
  },
  // Official AISVS 1.0: C11 = Adversarial Robustness.
  C11: {
    pillars: ["ai-security", "safety-responsible-ai", "model-governance", "evaluation"],
    checks: ["SEC-M3", "SEC-M4", "SAF-M1", "SAF-M2", "EVL-M1", "MOD-M1"],
    relation: "partial",
  },
  C12: {
    pillars: ["observability", "incident-readiness"],
    checks: ["OBS-M1", "INC-M1"],
    relation: "partial",
  },
};

/**
 * ASVS 5.0 chapter map (not ASVS 4). Check IDs only — no pillar expansion.
 */
const ASVS_CHAPTER_DEFAULTS = {
  V1: { checks: ["SEC-M1", "PRM-M1"], relation: "partial" },
  V2: { checks: ["SEC-M1", "TOL-M2"], relation: "partial" },
  V3: { checks: ["SEC-M3", "TOL-M2"], relation: "partial" },
  V4: { checks: ["AUTHZ-M1", "SEC-M1"], relation: "aligns-with" },
  V5: { checks: ["INF-M1", "DG-M3"], relation: "partial" },
  V6: { checks: ["AUTHN-M1", "AUTHN-M3", "SEC2-M1"], relation: "aligns-with" },
  V7: { checks: ["AUTHN-M1", "AUTHZ-M1"], relation: "aligns-with" },
  V8: { checks: ["AUTHZ-M1", "AUTHZ-M2"], relation: "aligns-with" },
  V9: { checks: ["AUTHN-M2", "SEC2-M1"], relation: "aligns-with" },
  V10: { checks: ["AUTHN-M1", "AUTHZ-M1"], relation: "aligns-with" },
  V11: { checks: ["SEC2-M1", "INF-M2"], relation: "partial" },
  V12: { checks: ["INF-M1", "INF-M2"], relation: "aligns-with" },
  V13: { checks: ["INF-M1", "CHG-M1"], relation: "partial" },
  V14: { checks: ["PRI-M1", "DG-M1"], relation: "aligns-with" },
  V15: { checks: ["SEC-M1", "CHG-M1"], relation: "partial" },
  V16: { checks: ["OBS-M1", "INC-M1"], relation: "aligns-with" },
  V17: { checks: ["INF-M1", "REL-M1"], relation: "partial" },
};

/** OWASP LLM Top 10 → official AISVS 1.0 section keys (C*.*). */
const LLM_TO_AISVS_V1 = {
  "01": ["C2.1", "C7.3", "C9.3", "C11.1", "C11.4"],
  "02": ["C5.2", "C7.3", "C8.1", "C12.1"],
  "03": ["C6.1", "C6.2", "C3.1"],
  "04": ["C1.1", "C1.3", "C3.2", "C11.1"],
  "05": ["C7.1", "C7.2", "C7.3"],
  "06": ["C9.1", "C9.2", "C9.3", "C9.5", "C9.6"],
  "07": ["C2.1", "C5.1", "C7.3"],
  "08": ["C8.1", "C8.2", "C8.3"],
  "09": ["C7.2", "C7.4", "C11.1"],
  "10": ["C9.1", "C12.3", "C4.1"],
};

/** LLM10 (unbounded consumption) only seeds these AISVS sections; others keep chapter affinity. */
const LLM10_CONSUMPTION_SECTIONS = new Set(["C9.1"]);

const AISVS_RELEASE = "v1.0";

function aisvsPeerId(section) {
  return `aisvs:${AISVS_RELEASE}-${section}`;
}

function aisvsPeerRef(section) {
  return `${AISVS_RELEASE}-${section}`;
}

function filterPillars(slugs) {
  const out = [];
  const unknown = [];
  for (const s of slugs ?? []) {
    if (APRF_PILLARS.has(s)) out.push(s);
    else unknown.push(s);
  }
  if (unknown.length > 0) {
    throw new Error(`Unknown APRF pillar slug(s): ${unknown.join(", ")}`);
  }
  return out;
}

function asvsDefaults(ref) {
  const chapter = ref.match(/^(V\d+)/)?.[1] ?? "V1";
  const d = ASVS_CHAPTER_DEFAULTS[chapter] ?? {
    checks: ["SEC-M1"],
    relation: "partial",
  };
  return { checks: d.checks ?? [], relation: d.relation };
}

/** Prefer Check IDs; no pillar expansion for FIASSE. */
const FIASSE_DEFAULTS = {
  S1: { checks: ["ORG-M1", "CMP-M1"], relation: "partial" },
  S2: { checks: ["ORG-M1", "CHG-M1"], relation: "partial" },
  S3: { checks: ["CHG-M1", "INF-M1"], relation: "aligns-with" },
  S4: { checks: ["SEC-M1", "SCI-M1"], relation: "partial" },
  S5: { checks: ["EVL-M1", "OBS-M1"], relation: "partial" },
  S6: { checks: ["INC-M1", "OBS-M1"], relation: "partial" },
  S7: { checks: ["ORG-M1", "CMP-M1"], relation: "partial" },
  S8: { checks: ["REL-M1", "INF-M1"], relation: "partial" },
  SA: { checks: ["EVL-M1", "OBS-M1"], relation: "aligns-with" },
};

function fiasseDefaults(ref) {
  const key = ref.startsWith("SA") ? "SA" : ref.match(/^(S\d+)/)?.[1] ?? "S1";
  const d = FIASSE_DEFAULTS[key] ?? FIASSE_DEFAULTS.S1;
  return { checks: d.checks ?? [], relation: d.relation };
}

function aisvsSectionKey(refOrSection) {
  return String(refOrSection).match(/(C\d+\.\d+)/)?.[1] ?? String(refOrSection);
}

function aisvsChapterDefaults(refOrSection) {
  const section = aisvsSectionKey(refOrSection);
  const chapter = section.match(/^(C\d+)/)?.[1] ?? "C2";
  return AISVS_CHAPTER_DEFAULTS[chapter] ?? AISVS_CHAPTER_DEFAULTS.C2;
}

/** Parse section headings from OWASP AISVS `1.0/en/0x10-C*.md`. */
function loadOfficialAisvsSections(aisvsRoot) {
  const enDir = join(aisvsRoot, "1.0", "en");
  if (!existsSync(enDir)) {
    throw new Error(`AISVS 1.0 English tree not found: ${enDir}`);
  }
  const files = readdirSync(enDir)
    .filter((f) => /^0x10-C\d+/i.test(f) && f.endsWith(".md"))
    .sort()
    .map((f) => join(enDir, f));
  if (files.length === 0) {
    throw new Error(`No AISVS chapter files (0x10-C*.md) under ${enDir}`);
  }
  const sections = [];
  const seen = new Set();
  for (const path of files) {
    const text = readFileSync(path, "utf8");
    const re = /^##\s+(C\d+\.\d+)\s+(.+)$/gm;
    let m;
    while ((m = re.exec(text))) {
      const section = m[1];
      if (seen.has(section)) {
        throw new Error(`Duplicate AISVS section ${section} in ${path}`);
      }
      seen.add(section);
      sections.push({ section, title: m[2].trim() });
    }
  }
  if (sections.length === 0) {
    throw new Error(`No ## C*.* section headings found under ${enDir}`);
  }
  return sections;
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

function buildFromSources(aisvsRoot) {
  const resolvedAisvsRoot = resolveAisvsRoot(aisvsRoot);

  // Invert official LLM→AISVS for seeding (LLM10 only onto consumption-core sections).
  const aisvsSeed = new Map(); // section (C*.*) -> { pillars, checks, relation }
  for (const [num, sections] of Object.entries(LLM_TO_AISVS_V1)) {
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

  // --- AISVS (official OWASP AISVS 1.0) ---
  const aisvsControls = [];
  const aisvsMappings = [];
  for (const { section, title } of loadOfficialAisvsSections(resolvedAisvsRoot)) {
    const ref = aisvsPeerRef(section);
    const id = aisvsPeerId(section);
    aisvsControls.push({ id, ref, title });
    // Always keep chapter affinity; merge LLM seed on top when present.
    const chapter = aisvsChapterDefaults(section);
    const pillars = new Set(filterPillars(chapter.pillars));
    const checks = new Set(chapter.checks ?? []);
    let relation = chapter.relation;
    const seed = aisvsSeed.get(section);
    if (seed) {
      for (const p of seed.pillars) pillars.add(p);
      for (const c of seed.checks) checks.add(c);
      relation = mergeRelation(relation, seed.relation);
    }
    aisvsMappings.push(
      mapRow(id, filterPillars([...pillars]), [...checks], relation),
    );
  }

  // --- ASVS (inventory under scripts/peer-crosswalk-inventories/) ---
  const asvsControls = loadPeerInventory("asvs");
  const asvsMappings = asvsControls.map((c) => {
    const d = asvsDefaults(c.ref);
    // Check IDs only — avoid pillar expansion flooding every auth/infra Check.
    return mapRow(c.id, undefined, d.checks, d.relation);
  });

  // --- FIASSE ---
  const fiasseControls = loadPeerInventory("fiasse");
  const fiasseMappings = fiasseControls.map((c) => {
    const d = fiasseDefaults(c.ref);
    // Check IDs only — FIASSE sections are broad; pillar expansion over-attaches.
    return mapRow(c.id, undefined, d.checks, d.relation);
  });

  // --- OpenCRE ---
  const opencreControls = loadPeerInventory("opencre");
  const opencreMappings = opencreControls.map((c) => {
    const d = OPENCRE_MAP[c.ref] ?? {
      pillars: ["ai-security"],
      checks: ["SEC-M1"],
      relation: "partial",
    };
    return mapRow(c.id, filterPillars(d.pillars), d.checks, d.relation);
  });

  // --- MAESTRO ---
  const maestroControls = MAESTRO_CONTROLS.map(
    ({ id, ref, title, summary }) => ({ id, ref, title, summary }),
  );
  const maestroMappings = MAESTRO_CONTROLS.map((c) =>
    mapRow(c.id, filterPillars(c.pillars), c.checks, c.relation),
  );

  // --- LLM relatedPeerControlIds payload (official AISVS 1.0) ---
  const aisvsControlIds = new Set(aisvsControls.map((c) => c.id));
  const llmRelated = {};
  const unknownBridges = [];
  for (const [num, sections] of Object.entries(LLM_TO_AISVS_V1)) {
    const ids = sections.map((s) => aisvsPeerId(s));
    for (const id of ids) {
      if (!aisvsControlIds.has(id)) {
        unknownBridges.push(`owasp-llm:${num} → ${id}`);
      }
    }
    llmRelated[`owasp-llm:${num}`] = ids.filter((id) => aisvsControlIds.has(id));
  }
  if (unknownBridges.length > 0) {
    throw new Error(
      `LLM→AISVS bridges reference unknown AISVS controls:\n  ${unknownBridges.join("\n  ")}`,
    );
  }

  const frameworks = [
    {
      id: "aisvs",
      name: "OWASP AI Application Security Verification Standard (AISVS)",
      peerVersion: "1.0",
      url: "https://github.com/OWASP/AISVS/tree/main/1.0/en",
      disclaimer: `${DISCLAIMER} Peer control IDs cite OWASP AISVS 1.0 section tags (aisvs:v1.0-C*.*) from the locked 1.0/en tree.`,
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
      peerVersion: "CWE bridge set",
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
  // Drop only frameworks this run regenerates; preserve every other entry.
  const regeneratedIds = new Set(payload.frameworks.map((f) => f.id));
  const existing = (spec.crosswalks ?? []).filter(
    (c) => !regeneratedIds.has(c.id),
  );
  const llm = existing.find((c) => c.id === "owasp-llm-top-10");
  if (llm) {
    for (const control of llm.controls ?? []) {
      const related = payload.llmRelated[control.id];
      if (related === undefined) continue;
      if (related.length) control.relatedPeerControlIds = related;
      else delete control.relatedPeerControlIds;
    }
  }
  // Insert regenerated frameworks after owasp-llm-top-10 for readability
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

  const compatibility = {
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
  // Keep metadata + governance lists in lockstep (chips/docs vs machine maps).
  spec.metadata = spec.metadata ?? {};
  spec.metadata.compatibility = {
    ...(spec.metadata.compatibility ?? {}),
    ...compatibility,
  };
  spec.governance = spec.governance ?? {};
  spec.governance.compatibility = {
    ...(spec.governance.compatibility ?? {}),
    ...compatibility,
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
  if (args.selfTest) {
    selfTest();
    return;
  }
  const payload = buildFromSources(args.aisvsRoot);
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
