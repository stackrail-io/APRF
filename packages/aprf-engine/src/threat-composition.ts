/**
 * Threat composition types + deterministic evaluator (APRF-RFC-0014).
 * Threats never participate in gate computation.
 * Checks never participate in signal composition.
 * The only coupling is that threats may cite Checks as mitigations.
 */

export type SignalKind =
  | "artifact"
  | "config"
  | "process"
  | "behavioral"
  | "exercise"
  | "attested"
  | "inferred";

export type SignalAssurance = "gate-eligible" | "signal-only";

export type SignalOrigin = "system" | "owner" | "external" | "independent";

export type SignalPolarity = "positive" | "negative";

export type EvidenceTierId = "E0" | "E1" | "E2" | "E3" | "E4" | "E5";

export interface SignalKindMeta {
  question: string;
  confirmingEligible: boolean;
  defaultAssurance: SignalAssurance;
  description?: string;
}

/** Vocabulary authority entry — no freshness/origin/polarity. */
export interface SignalDef {
  id: string;
  kind: SignalKind;
  defaultTier: EvidenceTierId;
  description: string;
  evidenceTypes?: string[];
  emitters?: string[];
}

export interface SignalRegistry {
  id: string;
  name: string;
  version: string;
  aprfVersion?: string;
  disclaimer?: string;
  kinds: Record<SignalKind, SignalKindMeta>;
  signals: SignalDef[];
}

/** Emitted at assess time — must resolve to exactly one SignalDef. */
export interface SignalObservation {
  signalId: string;
  fired: boolean;
  polarity?: SignalPolarity;
  measuredAt?: string;
  origin?: SignalOrigin;
  assurance?: SignalAssurance;
  confidence?: number;
  evidenceNode?: string;
}

export type Indicator =
  | { signal: string }
  | { allOf: Indicator[] }
  | { anyOf: Indicator[] };

export type MitigationRole = "primary" | "supporting";

export interface ThreatMitigation {
  checkId: string;
  role: MitigationRole;
}

export interface ThreatDef {
  id: string;
  title: string;
  severityHint: "critical" | "high" | "medium" | "low";
  description: string;
  /** Optional human labels aligned with aprf-threat-map vocabulary. */
  displayThreats?: string[];
  indicators: Indicator[];
  mitigations: ThreatMitigation[];
}

export interface ThreatCompositionDoc {
  id: string;
  name: string;
  version: string;
  aprfVersion?: string;
  disclaimer?: string;
  threats: Record<string, Omit<ThreatDef, "id">>;
}

export type ThreatEvalStatus =
  | "not_indicated"
  | "mitigated"
  | "confirmed_exposure"
  | "suspected_exposure";

export type CheckStatusLike =
  | "PASS"
  | "FAIL"
  | "PARTIAL"
  | "NOT_DEMONSTRATED"
  | "NOT_APPLICABLE"
  | string;

export interface ThreatEvalResult {
  threatId: string;
  title: string;
  severityHint: ThreatDef["severityHint"];
  status: ThreatEvalStatus;
  indicated: boolean;
  confirmed: boolean;
  mitigated: boolean;
  exposure: boolean;
  primaryCheckIds: string[];
  supportingCheckIds: string[];
  contributingSignalIds: string[];
  displayThreats?: string[];
}

function isSignal(ind: Indicator): ind is { signal: string } {
  return "signal" in ind && typeof (ind as { signal?: unknown }).signal === "string";
}

function isAllOf(ind: Indicator): ind is { allOf: Indicator[] } {
  return "allOf" in ind && Array.isArray((ind as { allOf?: unknown }).allOf);
}

function isAnyOf(ind: Indicator): ind is { anyOf: Indicator[] } {
  return "anyOf" in ind && Array.isArray((ind as { anyOf?: unknown }).anyOf);
}

/** Collect signal ids referenced by an indicator tree. */
export function collectSignalIds(ind: Indicator, out = new Set<string>()): Set<string> {
  if (isSignal(ind)) {
    out.add(ind.signal);
    return out;
  }
  if (isAllOf(ind)) {
    for (const x of ind.allOf) collectSignalIds(x, out);
    return out;
  }
  if (isAnyOf(ind)) {
    for (const x of ind.anyOf) collectSignalIds(x, out);
    return out;
  }
  return out;
}

/**
 * Returns contributing fired observations when the indicator is satisfied,
 * otherwise null.
 */
export function indicatorSatisfied(
  ind: Indicator,
  firedById: Map<string, SignalObservation[]>,
): SignalObservation[] | null {
  if (isSignal(ind)) {
    const obs = (firedById.get(ind.signal) ?? []).filter((o) => o.fired);
    return obs.length > 0 ? obs : null;
  }
  if (isAllOf(ind)) {
    const contrib: SignalObservation[] = [];
    for (const x of ind.allOf) {
      const part = indicatorSatisfied(x, firedById);
      if (!part) return null;
      contrib.push(...part);
    }
    return contrib;
  }
  if (isAnyOf(ind)) {
    const contrib: SignalObservation[] = [];
    for (const x of ind.anyOf) {
      const part = indicatorSatisfied(x, firedById);
      if (part) contrib.push(...part);
    }
    return contrib.length > 0 ? contrib : null;
  }
  return null;
}

function buildFiredIndex(
  observations: SignalObservation[],
): Map<string, SignalObservation[]> {
  const map = new Map<string, SignalObservation[]>();
  for (const o of observations) {
    if (!o.fired) continue;
    const list = map.get(o.signalId) ?? [];
    list.push(o);
    map.set(o.signalId, list);
  }
  return map;
}

function isMitigatingStatus(status: CheckStatusLike): boolean {
  const s = String(status).toUpperCase().replace(/-/g, "_");
  return s === "PASS" || s === "NOT_APPLICABLE";
}

/**
 * Deterministic threat evaluation (APRF-RFC-0014).
 * Confirmation uses kinds[].confirmingEligible from the registry — never hardcoded.
 */
export function evaluateThreat(
  threat: ThreatDef,
  observations: SignalObservation[],
  checkStatuses: Record<string, CheckStatusLike>,
  kinds: Record<string, Pick<SignalKindMeta, "confirmingEligible">>,
  signalDefs: Map<string, SignalDef>,
): ThreatEvalResult {
  const firedById = buildFiredIndex(observations);
  const contributing: SignalObservation[] = [];
  let indicated = false;

  for (const ind of threat.indicators) {
    const part = indicatorSatisfied(ind, firedById);
    if (part) {
      indicated = true;
      contributing.push(...part);
    }
  }

  const uniqueContrib = new Map<string, SignalObservation>();
  for (const o of contributing) {
    if (!uniqueContrib.has(o.signalId)) uniqueContrib.set(o.signalId, o);
  }

  const confirmed =
    indicated &&
    [...uniqueContrib.values()].some((o) => {
      const def = signalDefs.get(o.signalId);
      const kind = def?.kind;
      if (!kind) return false;
      return kinds[kind]?.confirmingEligible === true;
    });

  const primary = threat.mitigations.filter((m) => m.role === "primary");
  const supporting = threat.mitigations.filter((m) => m.role === "supporting");
  const mitigated =
    primary.length > 0 &&
    primary.every((m) => isMitigatingStatus(checkStatuses[m.checkId] ?? "NOT_DEMONSTRATED"));

  const exposure = indicated && !mitigated;

  let status: ThreatEvalStatus;
  if (!indicated) status = "not_indicated";
  else if (mitigated) status = "mitigated";
  else if (confirmed) status = "confirmed_exposure";
  else status = "suspected_exposure";

  return {
    threatId: threat.id,
    title: threat.title,
    severityHint: threat.severityHint,
    status,
    indicated,
    confirmed,
    mitigated,
    exposure,
    primaryCheckIds: primary.map((m) => m.checkId),
    supportingCheckIds: supporting.map((m) => m.checkId),
    contributingSignalIds: [...uniqueContrib.keys()].sort(),
    ...(threat.displayThreats?.length ? { displayThreats: threat.displayThreats } : {}),
  };
}

/** Evaluate all threats in a composition document. */
export function evaluateThreatComposition(
  doc: ThreatCompositionDoc,
  observations: SignalObservation[],
  checkStatuses: Record<string, CheckStatusLike>,
  registry: SignalRegistry,
): ThreatEvalResult[] {
  const signalDefs = new Map(registry.signals.map((s) => [s.id, s]));
  const results: ThreatEvalResult[] = [];
  for (const [id, body] of Object.entries(doc.threats)) {
    const threat: ThreatDef = { id, ...body };
    results.push(
      evaluateThreat(threat, observations, checkStatuses, registry.kinds, signalDefs),
    );
  }
  return results.sort((a, b) => a.threatId.localeCompare(b.threatId));
}

/** Build Check ID → threat IDs reverse index from composition mitigations. */
export function buildCheckThreatReverseIndex(
  doc: ThreatCompositionDoc,
): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  for (const [threatId, body] of Object.entries(doc.threats)) {
    for (const m of body.mitigations) {
      const list = index[m.checkId] ?? [];
      if (!list.includes(threatId)) list.push(threatId);
      index[m.checkId] = list;
    }
  }
  for (const id of Object.keys(index)) {
    index[id].sort((a, b) => a.localeCompare(b));
  }
  return index;
}

/**
 * Validate that every observation signalId resolves to a SignalDef.
 * Returns unknown ids (empty = ok).
 */
export function unknownSignalIds(
  observations: SignalObservation[],
  registry: SignalRegistry,
): string[] {
  const known = new Set(registry.signals.map((s) => s.id));
  const unknown = new Set<string>();
  for (const o of observations) {
    if (!known.has(o.signalId)) unknown.add(o.signalId);
  }
  return [...unknown].sort();
}

/** Collect all signal ids referenced by threat indicators. */
export function signalIdsReferencedByThreats(doc: ThreatCompositionDoc): string[] {
  const out = new Set<string>();
  for (const body of Object.values(doc.threats)) {
    for (const ind of body.indicators) collectSignalIds(ind, out);
  }
  return [...out].sort();
}
