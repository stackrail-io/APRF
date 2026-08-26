/**
 * Unit tests for threat composition evaluator (APRF-RFC-0014).
 * Run: npx tsx scripts/test-threat-composition.ts
 */
import {
  evaluateThreat,
  evaluateThreatComposition,
  indicatorSatisfied,
  unknownSignalIds,
  buildCheckThreatReverseIndex,
  type SignalDef,
  type SignalObservation,
  type SignalRegistry,
  type ThreatCompositionDoc,
  type ThreatDef,
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

const signalDefs = new Map<string, SignalDef>([
  [
    "agent.inventory.missing",
    {
      id: "agent.inventory.missing",
      kind: "artifact",
      defaultTier: "E2",
      description: "missing inventory",
    },
  ],
  [
    "agent.runtime.unenumerated",
    {
      id: "agent.runtime.unenumerated",
      kind: "behavioral",
      defaultTier: "E4",
      description: "runtime gap",
    },
  ],
  [
    "agent.shadow.attested",
    {
      id: "agent.shadow.attested",
      kind: "attested",
      defaultTier: "E1",
      description: "attested shadow",
    },
  ],
]);

const threat: ThreatDef = {
  id: "THR-shadow-agents",
  title: "Shadow Agents",
  severityHint: "critical",
  description: "test",
  indicators: [
    {
      allOf: [
        { signal: "agent.inventory.missing" },
        { signal: "agent.runtime.unenumerated" },
      ],
    },
    { signal: "agent.shadow.attested" },
  ],
  mitigations: [
    { checkId: "AGN-M1", role: "primary" },
    { checkId: "AGN-M2", role: "supporting" },
  ],
};

// Nested allOf/anyOf
const nestedOk = indicatorSatisfied(
  {
    allOf: [
      {
        anyOf: [
          { signal: "agent.inventory.missing" },
          { signal: "agent.shadow.attested" },
        ],
      },
      { signal: "agent.runtime.unenumerated" },
    ],
  },
  new Map([
    [
      "agent.inventory.missing",
      [{ signalId: "agent.inventory.missing", fired: true }],
    ],
    [
      "agent.runtime.unenumerated",
      [{ signalId: "agent.runtime.unenumerated", fired: true }],
    ],
  ]),
);
assert(nestedOk && nestedOk.length >= 2, "recursive allOf/anyOf must satisfy");

// anyOf must accumulate all satisfied branches (order-independent confirmation)
{
  const anyOfBoth = indicatorSatisfied(
    {
      anyOf: [
        { signal: "agent.inventory.missing" },
        { signal: "agent.runtime.unenumerated" },
      ],
    },
    new Map([
      [
        "agent.inventory.missing",
        [{ signalId: "agent.inventory.missing", fired: true }],
      ],
      [
        "agent.runtime.unenumerated",
        [{ signalId: "agent.runtime.unenumerated", fired: true }],
      ],
    ]),
  );
  assert(
    anyOfBoth &&
      anyOfBoth.some((o) => o.signalId === "agent.inventory.missing") &&
      anyOfBoth.some((o) => o.signalId === "agent.runtime.unenumerated"),
    "anyOf must collect every satisfied branch",
  );

  const threatAnyOf: ThreatDef = {
    id: "THR-anyof-order",
    title: "Order test",
    severityHint: "high",
    description: "test",
    indicators: [
      {
        anyOf: [
          { signal: "agent.inventory.missing" },
          { signal: "agent.runtime.unenumerated" },
        ],
      },
    ],
    mitigations: [{ checkId: "AGN-M1", role: "primary" }],
  };
  const r = evaluateThreat(
    threatAnyOf,
    [
      { signalId: "agent.inventory.missing", fired: true },
      { signalId: "agent.runtime.unenumerated", fired: true },
    ],
    { "AGN-M1": "FAIL" },
    kinds,
    signalDefs,
  );
  assert(
    r.confirmed && r.status === "confirmed_exposure",
    "artifact-first anyOf must still confirm when behavioral also fires",
  );
}

// Artifact-only → suspected
{
  const obs: SignalObservation[] = [
    { signalId: "agent.shadow.attested", fired: true },
  ];
  const r = evaluateThreat(
    threat,
    obs,
    { "AGN-M1": "FAIL", "AGN-M2": "FAIL" },
    kinds,
    signalDefs,
  );
  assert(r.indicated, "attested should indicate");
  assert(!r.confirmed, "attested must not confirm");
  assert(r.status === "suspected_exposure", `expected suspected, got ${r.status}`);
  assert(r.exposure, "unmitigated indicated → exposure");
}

// Behavioral corroboration → confirmed
{
  const obs: SignalObservation[] = [
    { signalId: "agent.inventory.missing", fired: true },
    { signalId: "agent.runtime.unenumerated", fired: true },
  ];
  const r = evaluateThreat(
    threat,
    obs,
    { "AGN-M1": "FAIL", "AGN-M2": "PASS" },
    kinds,
    signalDefs,
  );
  assert(r.confirmed, "behavioral must confirm");
  assert(r.status === "confirmed_exposure", `expected confirmed_exposure, got ${r.status}`);
  // Supporting FAIL must not block mitigation when primary PASS
  const mitigated = evaluateThreat(
    threat,
    obs,
    { "AGN-M1": "PASS", "AGN-M2": "FAIL" },
    kinds,
    signalDefs,
  );
  assert(mitigated.mitigated, "primary PASS mitigates despite supporting FAIL");
  assert(mitigated.status === "mitigated", "status mitigated");
  assert(!mitigated.exposure, "no exposure when mitigated");
}

// unknownSignalIds
{
  const unknown = unknownSignalIds(
    [
      { signalId: "agent.inventory.missing", fired: true },
      { signalId: "agent.runtime.unknown", fired: true },
    ],
    {
      id: "aprf-signal-registry",
      name: "t",
      version: "0.1.0",
      kinds,
      signals: [...signalDefs.values()],
    },
  );
  assert(
    unknown.length === 1 && unknown[0] === "agent.runtime.unknown",
    "unknown ids detected",
  );
}

// reverse index
{
  const doc: ThreatCompositionDoc = {
    id: "aprf-threat-composition",
    name: "t",
    version: "0.1.0",
    threats: {
      "THR-shadow-agents": {
        title: threat.title,
        severityHint: threat.severityHint,
        description: threat.description,
        indicators: threat.indicators,
        mitigations: threat.mitigations,
      },
    },
  };
  const idx = buildCheckThreatReverseIndex(doc);
  assert(idx["AGN-M1"]?.includes("THR-shadow-agents"), "AGN-M1 reverse index");
  assert(idx["AGN-M2"]?.includes("THR-shadow-agents"), "AGN-M2 reverse index");

  const registry: SignalRegistry = {
    id: "aprf-signal-registry",
    name: "t",
    version: "0.1.0",
    kinds,
    signals: [...signalDefs.values()],
  };
  const results = evaluateThreatComposition(
    doc,
    [{ signalId: "agent.shadow.attested", fired: true }],
    { "AGN-M1": "NOT_APPLICABLE" },
    registry,
  );
  assert(results.length === 1, "one threat result");
  assert(results[0].status === "mitigated", "NA primary mitigates");
}

console.log("OK: test-threat-composition");
