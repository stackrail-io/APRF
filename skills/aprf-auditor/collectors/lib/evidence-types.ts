/**
 * Provenance helpers for collector report `evidenceTypes[]` (APRF-RFC-0011).
 * Assess reads top-level / summary.evidenceTypes into matched[].
 */
export function uniqueEvidenceTypes(
  ...groups: Array<Iterable<string> | string | null | undefined>
): string[] {
  const out = new Set<string>();
  for (const g of groups) {
    if (g == null) continue;
    if (typeof g === "string") {
      if (/^[a-z][a-z0-9_]*$/.test(g)) out.add(g);
      continue;
    }
    for (const id of g) {
      if (typeof id === "string" && /^[a-z][a-z0-9_]*$/.test(id)) out.add(id);
    }
  }
  return [...out].sort();
}

/** Attach evidenceTypes to a collector report object (top-level + summary). */
export function withReportEvidenceTypes<
  T extends { summary?: Record<string, unknown> },
>(report: T, types: string[]): T & { evidenceTypes: string[] } {
  const evidenceTypes = uniqueEvidenceTypes(types);
  const summary =
    report.summary && typeof report.summary === "object"
      ? { ...report.summary, evidenceTypes }
      : report.summary;
  return { ...report, evidenceTypes, ...(summary ? { summary } : {}) };
}
