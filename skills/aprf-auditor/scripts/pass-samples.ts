/**
 * PASS sample artifacts shown as flyout attachments in REPORT.html.
 * Source files live under skills/aprf-auditor/examples/.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import agnM1Inventory from "../examples/pass-samples/AGN-M1.inventory.json" with {
  type: "json",
};

export type PassSample = {
  /** Unique key used by the flyout popup (checkId or checkId:artifact). */
  id: string;
  checkId: string;
  /** Display / download filename for the attachment chip. */
  filename: string;
  /** Where to place the file for the collector / repo to use it. */
  destination: string;
  hint: string;
  content: string;
};

const HERE = dirname(fileURLToPath(import.meta.url));

function loadAgentCharterFile(name: string): string {
  const candidates = [
    join(HERE, "../examples/agent-charter", name),
    join(HERE, "examples/agent-charter", name),
    join(process.cwd(), "skills/aprf-auditor/examples/agent-charter", name),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  throw new Error(
    `Missing agent charter example "${name}" (tried ${candidates.join(", ")})`,
  );
}

const SAMPLES: PassSample[] = [
  {
    id: "AGN-M1:inventory",
    checkId: "AGN-M1",
    filename: "inventory.json",
    destination: "aprf-assessment/imports/agent-charter-inventory/inventory.json",
    hint: "Measured inventory export that unlocks AGN-M1 PASS. Do not overwrite *-report.json. Completeness/ownership gaps escalate severity to critical.",
    content: `${JSON.stringify(agnM1Inventory, null, 2)}\n`,
  },
  {
    id: "AGN-M1:charter-spec",
    checkId: "AGN-M1",
    filename: "agent-charter.spec.yaml",
    destination: "docs/agents/agent-charter.spec.yaml",
    hint: "APRF agent charter specification (v1). Copy this template for each production agent.",
    content: loadAgentCharterFile("agent-charter.spec.yaml"),
  },
  {
    id: "AGN-M1:charter",
    checkId: "AGN-M1",
    filename: "support-agent.charter.yaml",
    destination: "docs/agents/support-agent.charter.yaml",
    hint: "Filled example charter matching the spec. Link it from inventory via charterUri.",
    content: loadAgentCharterFile("support-agent.charter.yaml"),
  },
];

export function getPassSamples(checkId: string): PassSample[] {
  return SAMPLES.filter((s) => s.checkId === checkId);
}

/** @deprecated Prefer getPassSamples — kept for single-attachment callers. */
export function getPassSample(checkId: string): PassSample | undefined {
  return getPassSamples(checkId)[0];
}

export function allPassSamples(): PassSample[] {
  return [...SAMPLES];
}
