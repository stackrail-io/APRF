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
