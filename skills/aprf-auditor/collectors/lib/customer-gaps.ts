/**
 * Customer-facing gap copy for assessment.json / REPORT.html.
 *
 * Collectors often phrase gaps as import recipes
 * ("import syntheticSensitiveFieldRedactionOrAclPct=100 … to PASS"). Those help
 * an engineer wire imports/, but they are noise to the person reading the
 * report. This module keeps the *substance* of an ask (counts, thresholds,
 * artifacts) and drops only the machine field names.
 *
 * Shared by packages/aprf assess (write time) and the HTML renderer (display
 * time, so older assessment.json still reads well).
 */

/**
 * camelCase import field, with or without an =/≥/≤ comparison.
 * Lowercase/digit runs and Uppercase segments use disjoint classes so the
 * pattern cannot exponentially backtrack on long uppercase strings.
 */
const FIELD_TOKEN_RE =
  /\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+\b(?:\s*(?:>=|<=|[=≥≤])\s*[^\s,;.()]+)?/g;

/** Words that carry no signal when deciding whether an ask is substantive. */
const STOPWORDS = new Set([
  "with",
  "and",
  "or",
  "for",
  "the",
  "to",
  "under",
  "import",
  "imports",
  "pass",
  "unlock",
  "set",
  "when",
  "that",
  "this",
  "are",
  "alone",
  "partial",
  "true",
  "false",
  "n/a",
  "na",
  "plus",
]);

/** Strip machine field names, then tidy the leftover punctuation. */
function stripFieldTokens(text: string): string {
  return text
    .replace(FIELD_TOKEN_RE, " ")
    .replace(/\(\s*[,;+]*\s*\)/g, " ")
    .replace(/\s*[+,;]\s*(?=[+,;])/g, " ")
    .replace(/^[\s+,;–—-]+/, "")
    .replace(/\s*[+,;]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** True when enough real words survive to be worth showing verbatim. */
function isSubstantive(text: string): boolean {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9/≥≤%-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return words.length >= 2;
}

/** True when a note is only an import recipe with no customer-visible ask. */
export function isImportFieldRecipe(note: string): boolean {
  const n = note.trim();
  if (!n) return false;
  if (/\bstatusHint\s*=|\bseverityHint\s*=/i.test(n)) return true;
  if (/^We found related controls in the repository/i.test(n)) return true;
  const scaffolded =
    /\balone (?:is|are) PARTIAL\b/i.test(n) ||
    /\bimport .{0,200}to (?:PASS|unlock)\b/i.test(n) ||
    FIELD_TOKEN_RE.test(n);
  FIELD_TOKEN_RE.lastIndex = 0;
  if (!scaffolded) return false;
  return !isSubstantive(stripFieldTokens(extractAsk(n) ?? n));
}

/**
 * Pull the real ask out of "<X> signals alone are PARTIAL — import <ASK> under
 * imports/<plugin>/ to PASS." Returns undefined when there is no such scaffold.
 */
function extractAsk(note: string): string | undefined {
  const m =
    note.match(/\bimport\s+(.+?)\s+under\s+imports\/[a-z0-9-]+\//i) ??
    note.match(/\bimport\s+(.+?)\s+to\s+(?:PASS|unlock)\b/i);
  return m?.[1]?.trim();
}

/** Resolve the imports/<plugin>/ folder referenced by a note. */
export function pluginIdFromText(text: string): string | undefined {
  return (
    text.match(/\bimports\/([a-z0-9-]+)\//i)?.[1] ??
    text.match(/\bunder imports\/([a-z0-9-]+)\b/i)?.[1]
  );
}

/** Generic next step when nothing specific survives. */
export function customerFacingImportGap(pluginId?: string): string {
  if (pluginId) {
    return (
      `Provide recent measured evidence (within 90 days) under imports/${pluginId}/ to pass. ` +
      `If this surface does not apply to your system, place an out-of-scope attestation in that folder.`
    );
  }
  return (
    "Provide recent measured evidence (within 90 days) for this check to pass. " +
    "If this surface does not apply to your system, attest that it is out of scope."
  );
}

/** Soften remaining jargon tokens in otherwise-good notes. */
export function softenGapJargon(note: string): string {
  return note
    .replace(/\bNOT_APPLICABLE\b/g, "not applicable")
    .replace(/\bNOT_DEMONSTRATED\b/g, "not yet demonstrated")
    .replace(/\bunlock\s+PASS\b/gi, "pass")
    .replace(/\bto PASS\b/g, "to pass")
    .replace(/\bcannot PASS\b/g, "cannot pass")
    .replace(/\bPARTIAL\b/g, "incomplete")
    .replace(/\battest N\/A\b/gi, "attest that it is out of scope");
}

/**
 * Rewrite a single collector note into customer-facing copy, preserving any
 * concrete ask (e.g. "≥10 attack cases with 0 unauthorized successes").
 */
export function customerFacingGap(
  note: string,
  fallbackPlugin?: string,
): string {
  const n = note.trim();
  if (!n) return "";
  const plugin = fallbackPlugin ?? pluginIdFromText(n);

  // Boilerplate-only notes → generic import ask. Substantive "Provide recent
  // measured evidence of …" notes (e.g. sensitive-field redaction) continue
  // through the normal strip path below.
  if (
    /^We found related controls in the repository/i.test(n) ||
    /\bstatusHint\s*=|\bseverityHint\s*=/i.test(n)
  ) {
    return customerFacingImportGap(plugin);
  }
  if (/^Provide recent measured evidence\b/i.test(n)) {
    const stripped = stripFieldTokens(n);
    if (!isSubstantive(stripped)) return customerFacingImportGap(plugin);
    return softenGapJargon(stripped);
  }

  // "<X> alone is PARTIAL — import <ASK> under imports/<plugin>/ to PASS."
  const ask = extractAsk(n);
  if (ask) {
    const cleaned = stripFieldTokens(ask)
      .replace(/\bunder\s+imports\/[a-z0-9-]+\/?/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (isSubstantive(cleaned)) {
      // Do not repeat the freshness window when the ask already states it.
      const statesWindow = /90[\s-]?d(?:ay)?|within \d+ days/i.test(cleaned);
      const suffix = statesWindow ? "" : " (measured within the last 90 days)";
      return softenGapJargon(
        plugin
          ? `Add ${cleaned} under imports/${plugin}/${suffix}.`
          : `Add ${cleaned}${suffix}.`,
      );
    }
    return customerFacingImportGap(plugin);
  }

  // No scaffold: drop field names but keep the sentence when it still reads.
  const stripped = stripFieldTokens(n);
  if (stripped !== n) {
    return isSubstantive(stripped)
      ? softenGapJargon(stripped)
      : customerFacingImportGap(plugin);
  }
  return softenGapJargon(n);
}

/** Rewrite and de-duplicate a collector's gap notes. */
export function toCustomerFacingGaps(
  notes: string[],
  pluginId?: string,
): string[] {
  const out = notes
    .map((n) => customerFacingGap(n, pluginId))
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  return [...new Set(out)].slice(0, 8);
}
