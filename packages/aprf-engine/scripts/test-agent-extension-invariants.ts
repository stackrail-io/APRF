/**
 * Architectural invariants for APRF-RFC-0015 (and RFC-0014 coupling).
 */
import {
  evaluateThreatComposition,
  type SignalDef,
  type SignalRegistry,
  type ThreatCompositionDoc,
} from "../src/threat-composition.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const kinds: SignalRegistry["kinds"] = {
  artifact: {
    question: "What exists?",
    confirmingEligible: false,
    defaultAssurance: "signal-only",
  },
  config: {
    question: "What is configured?",
    confirmingEligible: false,
    defaultAssurance: "signal-only",
  },
  process: {
    question: "What was executed?",
    confirmingEligible: false,
    defaultAssurance: "signal-only",
  },
  behavioral: {
    question: "What happened?",
    confirmingEligible: true,
    defaultAssurance: "gate-eligible",
  },
  exercise: {
    question: "What was tested?",
    confirmingEligible: true,
    defaultAssurance: "gate-eligible",
  },
  attested: {
    question: "What was stated?",
    confirmingEligible: false,
    defaultAssurance: "signal-only",
  },
  inferred: {
    question: "What is believed?",
    confirmingEligible: false,
    defaultAssurance: "signal-only",
  },
};

const registry: SignalRegistry = {
  id: "aprf-signal-registry",
  name: "test",
  version: "0.1.0",
  kinds,
  signals: [
    {
      id: "harness.bypass.attempt_succeeded",
      kind: "exercise",
      defaultTier: "E4",
      description: "bypass",
    },
    {
      id: "mcp.confused_deputy.path",
      kind: "inferred",
      defaultTier: "E2",
      description: "inferred hop",
    },
    {
      id: "tool.unauthorized.succeeded",
      kind: "exercise",
      defaultTier: "E4",
      description: "exercise fail",
    },
    {
      id: "agent.shadow.attested",
      kind: "attested",
      defaultTier: "E1",
      description: "attested",
    },
  ],
};

const composition: ThreatCompositionDoc = {
  id: "aprf-threat-composition",
  name: "test",
  version: "0.2.0",
  threats: {
    "THR-harness-bypass": {
      title: "Harness bypass",
      severityHint: "critical",
      description: "out of band",
      indicators: [{ signal: "harness.bypass.attempt_succeeded" }],
      mitigations: [
        { checkId: "AGN-M5", role: "primary" },
        { checkId: "TOL-M1", role: "supporting" },
      ],
    },
    "THR-confused-deputy-mcp": {
      title: "Confused deputy",
      severityHint: "critical",
      description: "mcp hop",
      indicators: [{ signal: "mcp.confused_deputy.path" }],
      mitigations: [{ checkId: "TOL-M6", role: "primary" }],
    },
  },
};

void (registry.signals as SignalDef[]);

function fired(id: string) {
  return { signalId: id, fired: true };
}

const gateStatuses: Record<string, string> = {
  "AGN-M5": "FAIL",
  "TOL-M1": "PASS",
  "TOL-M6": "PASS",
};
const before = { ...gateStatuses };
const eval1 = evaluateThreatComposition(
  composition,
  [fired("harness.bypass.attempt_succeeded")],
  gateStatuses,
  registry,
);
assert(
  gateStatuses["AGN-M5"] === before["AGN-M5"],
  "1: threat eval must not mutate check statuses",
);
const harnessFail = eval1.find((r) => r.threatId === "THR-harness-bypass");
assert(harnessFail?.exposure === true, "harness bypass exposed when primary FAIL");
assert(
  !JSON.stringify(composition.threats["THR-harness-bypass"].indicators).includes(
    "AGN-M5",
  ),
  "2: indicators must not cite Check IDs",
);

const inferred = evaluateThreatComposition(
  composition,
  [fired("mcp.confused_deputy.path")],
  { "TOL-M6": "FAIL" },
  registry,
);
const confused = inferred.find((r) => r.threatId === "THR-confused-deputy-mcp");
assert(confused?.indicated === true, "inferred can indicate");
assert(confused?.confirmed === false, "4: inferred cannot confirm");
assert(confused?.status === "suspected_exposure", "inferred → suspected");

const attestedComp: ThreatCompositionDoc = {
  ...composition,
  threats: {
    "THR-attested-only": {
      title: "attested",
      severityHint: "high",
      description: "attested",
      indicators: [{ signal: "agent.shadow.attested" }],
      mitigations: [{ checkId: "AGN-M1", role: "primary" }],
    },
  },
};
const att = evaluateThreatComposition(
  attestedComp,
  [fired("agent.shadow.attested")],
  { "AGN-M1": "FAIL" },
  registry,
);
assert(att[0]?.confirmed === false, "8: attested cannot confirm");

const mitigated = evaluateThreatComposition(
  composition,
  [fired("harness.bypass.attempt_succeeded")],
  { "AGN-M5": "PASS", "TOL-M1": "PASS" },
  registry,
);
const h = mitigated.find((r) => r.threatId === "THR-harness-bypass");
assert(h?.indicated === true, "10: passing check does not delete indicators");
assert(h?.mitigated === true, "primary PASS mitigates");
assert(h?.exposure === false, "mitigated has no exposure");
assert(
  h?.contributingSignalIds.includes("harness.bypass.attempt_succeeded"),
  "signals retained",
);

const supportingOnly = evaluateThreatComposition(
  composition,
  [fired("harness.bypass.attempt_succeeded")],
  { "AGN-M5": "FAIL", "TOL-M1": "PASS" },
  registry,
);
assert(
  supportingOnly.find((r) => r.threatId === "THR-harness-bypass")?.exposure ===
    true,
  "10: supporting PASS does not clear exposure",
);

const noEvidence = evaluateThreatComposition(
  composition,
  [],
  { "AGN-M5": "FAIL", "TOL-M1": "FAIL", "TOL-M6": "FAIL" },
  registry,
);
assert(
  noEvidence.every((r) => r.indicated !== true && r.confirmed !== true),
  "3/9: no observations → threats not indicated or confirmed (collector ran ≠ evidence)",
);

console.log("test-agent-extension-invariants OK");
