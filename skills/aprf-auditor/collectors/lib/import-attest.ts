/**
 * Shared import attestation helpers for AGN collectors.
 * PASS unlocks require a measuredAt timestamp ≤ maxAgeDays (default 90).
 */
export function parseMeasuredAt(data: Record<string, unknown>): string | null {
  const raw =
    data.measuredAt ??
    data.measured_at ??
    data.generatedAt ??
    data.generated_at ??
    data.assessedAt ??
    data.assessed_at;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export function measuredAtFresh(
  measuredAt: string | null,
  now: Date = new Date(),
  maxAgeDays = 90,
): boolean {
  if (!measuredAt) return false;
  const t = Date.parse(measuredAt);
  if (Number.isNaN(t)) return false;
  const ageMs = now.getTime() - t;
  if (ageMs < 0) return true; // clock skew / future — accept
  return ageMs <= maxAgeDays * 24 * 60 * 60 * 1000;
}

export function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

/** Conservative merge for coverage % — worse (lower) wins. */
export function mergeMinNum(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/** Conservative merge for failure counts — worse (higher) wins. */
export function mergeMaxNum(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** Conservative merge for PASS-required true flags — false wins. */
export function mergeAndBool(
  a: boolean | null,
  b: boolean | null,
): boolean | null {
  if (a === null) return b;
  if (b === null) return a;
  return a && b;
}

/**
 * Merge "surface present" flags — true wins so an N/A attest cannot wipe
 * evidence that the surface exists; N/A only when no file asserts present.
 */
export function mergeOrBool(
  a: boolean | null,
  b: boolean | null,
): boolean | null {
  if (a === null) return b;
  if (b === null) return a;
  return a || b;
}

/** Prefer the older measuredAt (stricter freshness). */
export function mergeOldestMeasuredAt(
  a: string | null,
  b: string | null,
): string | null {
  if (!a) return b;
  if (!b) return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return b;
  if (Number.isNaN(tb)) return a;
  return ta <= tb ? a : b;
}
