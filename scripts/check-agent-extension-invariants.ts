/**
 * Repo-level RFC-0015 invariants (profiles live in framework-definition; CLI/skill
 * must not duplicate Check-ID lists; inferred/attested kinds stay non-confirming).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const profiles = readFileSync(
  join(root, "packages/framework-definition/src/profiles.ts"),
  "utf8",
);
assert(profiles.includes("PROFILE_CORE"), "6: PROFILE_CORE in framework-definition");
assert(profiles.includes("PROFILE_REGULATED"), "6: PROFILE_REGULATED in framework-definition");
assert(
  !profiles.includes("PROFILE_AGENT"),
  "6: no PROFILE_AGENT in framework-definition",
);
assert(!profiles.includes("AGN-M5"), "6: Core/Regulated must not list AGN-M5");
assert(!profiles.includes("TOL-M6"), "6: Core/Regulated must not list TOL-M6");
assert(!profiles.includes("REL-M9"), "6: Core/Regulated must not list REL-M9");

const lenses = readFileSync(
  join(root, "packages/framework-definition/src/lenses.ts"),
  "utf8",
);
assert(lenses.includes("LENS_ID_AGENTS"), "6: Agents is a lens, not a profile");
assert(lenses.includes("AGN-M5"), "Agents lens lists AGN-M5");
assert(lenses.includes("REL-M9"), "Agents lens lists REL-M9");
assert(!lenses.includes("REL-M6"), "do not reuse vacated REL-M6");

const cli = readFileSync(join(root, "packages/aprf/src/cli.ts"), "utf8");
assert(
  !/mandatoryCheckIds\s*[:=]\s*\[/.test(cli),
  "7: CLI must not duplicate mandatory Check-ID arrays",
);
assert(
  !cli.includes("PROFILE_CORE") || cli.includes("resolveAssessmentTarget"),
  "7: CLI resolves targets via framework-definition",
);

const skill = readFileSync(
  join(root, "skills/aprf-auditor/SKILL.md"),
  "utf8",
);
assert(
  !skill.includes("AGN-M5") || !/mandatoryCheckIds/.test(skill),
  "7: skill must not duplicate Check-ID lists",
);

const registry = yaml.parse(
  readFileSync(join(root, "spec/aprf-signal-registry.yaml"), "utf8"),
) as {
  kinds: Record<string, { confirmingEligible: boolean }>;
  signals: Array<{ id: string; kind: string }>;
};
assert(registry.kinds.inferred?.confirmingEligible === false, "4: inferred not confirming");
assert(registry.kinds.attested?.confirmingEligible === false, "8: attested not confirming");
assert(registry.kinds.exercise?.confirmingEligible === true, "exercise confirming");

for (const id of [
  "harness.bypass.attempt_succeeded",
  "mcp.confused_deputy.path",
  "tool.unauthorized.succeeded",
  "agent.graph.memory_hop",
  "eval.security.llm_judge_only",
  "rel.non_idempotent.duplicate_commit",
  "memory.poison.write_accepted",
  "tool.result.treated_as_instruction",
  "agent.loop.continue_after_abort",
]) {
  assert(
    registry.signals.some((s) => s.id === id),
    `signal ${id} registered`,
  );
}

const graphKind = registry.signals.find((s) => s.id === "mcp.confused_deputy.path");
assert(graphKind?.kind === "inferred", "confused deputy path is inferred");

const specText = readFileSync(join(root, "spec/aprf-spec.json"), "utf8");
const spec = JSON.parse(specText) as {
  stats?: { checkCount?: number };
};
assert(spec.stats?.checkCount === 184, "spec stats.checkCount is 184");
assert(specText.includes('"id": "AGN-M5"'), "AGN-M5 in spec");
assert(specText.includes('"id": "REL-M9"'), "REL-M9 in spec");
assert(!/"id": "REL-M6"/.test(specText), "REL-M6 remains vacated");

const rfc = readFileSync(
  join(root, "rfcs/0015-agent-harness-eval-production-readiness.md"),
  "utf8",
);
assert(
  /\|\s*Status\s*\|\s*accepted\s*\|/i.test(rfc) ||
    /^Status:\s*accepted/m.test(rfc),
  "RFC-0015 Status: accepted",
);

const inventorySchemaPath = join(root, "schemas/aprf-agent-inventory-0.1.json");
const graphSchemaPath = join(root, "schemas/aprf-agent-capability-graph-0.1.json");
assert(existsSync(inventorySchemaPath), "inventory schema");
assert(existsSync(graphSchemaPath), "graph schema");

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const inventorySchema = JSON.parse(readFileSync(inventorySchemaPath, "utf8"));
const graphSchema = JSON.parse(readFileSync(graphSchemaPath, "utf8"));
assert(
  inventorySchema.$id === "https://stackrail.io/aprf/agent-inventory/0.1",
  "inventory schema $id",
);
assert(
  graphSchema.$id === "https://stackrail.io/aprf/agent-capability-graph/0.1",
  "graph schema $id",
);
const validateInventory = ajv.compile(inventorySchema);
const validateGraph = ajv.compile(graphSchema);
const sampleInventory = {
  schemaVersion: "0.1.0",
  inventoryId: "inv:sample",
  generatedAt: "2026-11-14T00:00:00.000Z",
  collectorId: "agent-charter-inventory",
  subject: { path: "/tmp/sample" },
  agents: [
    {
      agentId: "a1",
      discovery: { classes: ["declared"], sources: ["import"] },
      provenance: [{ evidenceNodeId: "n1" }],
    },
  ],
  history: [
    {
      at: "2026-11-14T00:00:00.000Z",
      inventoryDigest: "sha256:abc",
      agentCount: 1,
    },
  ],
};
const sampleGraph = {
  schemaVersion: "0.1.0",
  graphId: "capgraph:sample",
  generatedAt: "2026-11-14T00:00:00.000Z",
  inventoryId: "inv:sample",
  nodes: [{ id: "agent:a1", type: "Agent", evidenceNodeIds: ["n1"] }],
  edges: [
    {
      id: "e1",
      from: "agent:a1",
      to: "tool:t1",
      rel: "agent_invokes_tool",
      accessKind: "direct",
      signalKind: "config",
      evidenceNodeIds: ["n1"],
    },
  ],
  derivedPaths: [
    {
      id: "p1",
      from: "agent:a1",
      to: "api:x",
      edgeIds: ["e1", "e2"],
      riskHint: "data_access",
      signalKind: "inferred",
      evidenceNodeIds: ["n1"],
    },
  ],
};
assert(validateInventory(sampleInventory), `inventory schema: ${JSON.stringify(validateInventory.errors)}`);
assert(validateGraph(sampleGraph), `graph schema: ${JSON.stringify(validateGraph.errors)}`);

const assess = readFileSync(join(root, "packages/aprf/src/assess.ts"), "utf8");
assert(
  assess.includes("Never treat statusHint=pass as measured"),
  "3/9: assess must not treat statusHint=pass as measured evidence",
);
assert(
  assess.includes("threats remain informative") ||
    assess.includes("Threats never participate") ||
    /threatExposure/.test(assess),
  "threats stay out of gate math",
);

const exercise = readFileSync(
  join(root, "skills/aprf-auditor/collectors/lib/exercise-import-collector.ts"),
  "utf8",
);
assert(
  exercise.includes("listedCaseCount"),
  "3: exercise PASS requires listed cases/results/samples",
);
assert(
  exercise.includes("naReason"),
  "5: N/A must record naReason",
);

const threats = readFileSync(
  join(root, "spec/aprf-threat-composition.yaml"),
  "utf8",
);
assert(
  threats.includes("memory.poison.write_accepted"),
  "THR-memory-poisoning uses memory poison signal",
);
assert(
  !/THR-memory-poisoning[\s\S]*eval\.security\.llm_judge_only/.test(threats),
  "THR-memory-poisoning must not use eval.security.llm_judge_only",
);

console.log("check-agent-extension-invariants OK");
