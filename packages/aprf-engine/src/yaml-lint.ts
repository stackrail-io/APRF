/**
 * Extra Check-YAML lint rules beyond Ajv schema.
 * Used by validate-catalog.ts (CLI + unit catalog sweep) and fixture unit tests.
 */
import type { AprfRule } from "./types.js";

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const GATES = ["mandatory", "recommended"] as const;
export const STATUSES = ["active", "deprecated", "draft"] as const;
export const DETECTION_CAPABILITIES = [
  "automated",
  "manual",
  "hybrid",
  "none",
] as const;

/** Spec check row projected for YAML↔spec mapping. */
export interface SpecCheckRef {
  id: string;
  gate: "mandatory" | "recommended";
  pillarSlug: string;
  pillarId: string;
  pillarSeverity?: string;
  domain: string | null;
  method: "automated" | "manual" | "hybrid";
  requiredFromLevel: number;
  minCriticality: number;
  passCondition: string;
  requirement: string;
}

export interface YamlLintContext {
  /** Allowed category / pillar slugs. */
  pillarSlugs: Set<string>;
  /** Check id → published spec row (from aprf-spec.json pillars). */
  specById: Map<string, SpecCheckRef>;
  /**
   * When true, require detection.capability === spec.method.
   * Default false: catalog YAML is SoT after detector-honesty fixes.
   */
  enforceMethodMatch?: boolean;
  /**
   * When true, require normalized passCondition === spec.passCondition.
   * Default false while catalog prose is being improved ahead of spec sync.
   */
  enforcePassConditionMatch?: boolean;
}

const MANDATORY_TOP_LEVEL = [
  "id",
  "category",
  "title",
  "description",
  "whyItMatters",
  "severity",
  "weight",
  "gate",
  "passCondition",
  "evidenceRequired",
  "detection",
  "manualVerification",
  "falsePositiveGuidance",
  "recommendedFixes",
  "references",
  "relatedRules",
  "tags",
  "applicability",
  "status",
] as const;

/** Truncation / placeholder markers that must not appear in normative prose. */
const FORBIDDEN_PROSE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\u2026/, label: "unicode ellipsis (…) — likely truncated prose" },
  { re: /\.\.\./, label: "ASCII ellipsis (...) — likely truncated prose" },
  { re: /\bTODO\b/i, label: "TODO placeholder" },
  { re: /\bFIXME\b/i, label: "FIXME placeholder" },
  { re: /\bTBD\b/, label: "TBD placeholder" },
  { re: /\[placeholder\]/i, label: "[placeholder] marker" },
  { re: /lorem ipsum/i, label: "lorem ipsum placeholder" },
];

/** Markers forbidden anywhere in Check YAML source (including comments). */
const FORBIDDEN_RAW_FILE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\u2026/, label: "unicode ellipsis (…)" },
  { re: /\.\.\./, label: "ASCII ellipsis (...)" },
];

const PROSE_FIELDS: Array<keyof AprfRule | "detection.hint"> = [
  "title",
  "description",
  "whyItMatters",
  "passCondition",
  "manualVerification",
  "falsePositiveGuidance",
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function collectStringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringLeaves(item, out);
    return out;
  }
  if (isRecord(value)) {
    for (const v of Object.values(value)) collectStringLeaves(v, out);
  }
  return out;
}

export function missingMandatoryFields(raw: unknown): string[] {
  if (!isRecord(raw)) return ["document must be a YAML mapping/object"];
  const missing: string[] = [];
  for (const key of MANDATORY_TOP_LEVEL) {
    if (!(key in raw) || raw[key] === null || raw[key] === undefined) {
      missing.push(`missing mandatory field "${key}"`);
    }
  }
  if (isRecord(raw.detection) && !("capability" in raw.detection)) {
    missing.push('missing mandatory field "detection.capability"');
  }
  if (isRecord(raw.applicability)) {
    if (!("minCriticality" in raw.applicability)) {
      missing.push('missing mandatory field "applicability.minCriticality"');
    }
    if (!("requiredFromLevel" in raw.applicability)) {
      missing.push('missing mandatory field "applicability.requiredFromLevel"');
    }
  }
  if (
    Array.isArray(raw.evidenceRequired) &&
    raw.evidenceRequired.length === 0
  ) {
    missing.push("evidenceRequired must be a non-empty array");
  }
  if (
    Array.isArray(raw.recommendedFixes) &&
    raw.recommendedFixes.length === 0
  ) {
    missing.push("recommendedFixes must be a non-empty array");
  }
  if (Array.isArray(raw.references) && raw.references.length === 0) {
    missing.push("references must be a non-empty array");
  }
  return missing;
}

export function lintForbiddenProse(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) return errors;

  const checkText = (label: string, text: string) => {
    for (const { re, label: what } of FORBIDDEN_PROSE_PATTERNS) {
      if (re.test(text)) {
        errors.push(`${label}: contains ${what}`);
      }
    }
  };

  for (const field of PROSE_FIELDS) {
    const v = raw[field as string];
    if (typeof v === "string") checkText(field, v);
  }

  if (Array.isArray(raw.evidenceRequired)) {
    raw.evidenceRequired.forEach((item, i) => {
      if (typeof item === "string") checkText(`evidenceRequired[${i}]`, item);
    });
  }
  if (Array.isArray(raw.recommendedFixes)) {
    raw.recommendedFixes.forEach((item, i) => {
      if (typeof item === "string") checkText(`recommendedFixes[${i}]`, item);
    });
  }
  if (Array.isArray(raw.references)) {
    raw.references.forEach((item, i) => {
      for (const s of collectStringLeaves(item)) {
        checkText(`references[${i}]`, s);
      }
    });
  }

  if (isRecord(raw.detection) && Array.isArray(raw.detection.detectors)) {
    for (const [i, det] of raw.detection.detectors.entries()) {
      if (!isRecord(det) || !isRecord(det.params)) continue;
      if (typeof det.params.hint === "string") {
        checkText(`detection.detectors[${i}].params.hint`, det.params.hint);
      }
    }
  }

  return errors;
}

/**
 * Reject truncation ellipsis anywhere in Check YAML source text
 * (prose, hints, comments). Used by the by-domain catalog sweep.
 */
export function lintRawYamlNoEllipsis(source: string): string[] {
  const errors: string[] = [];
  for (const { re, label } of FORBIDDEN_RAW_FILE_PATTERNS) {
    if (re.test(source)) {
      errors.push(`file contains ${label} — truncated or incomplete Check prose`);
    }
  }
  return errors;
}

export function lintFixedEnums(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) return errors;

  if (
    typeof raw.severity === "string" &&
    !SEVERITIES.includes(raw.severity as (typeof SEVERITIES)[number])
  ) {
    errors.push(
      `severity "${raw.severity}" not in fixed set [${SEVERITIES.join(", ")}]`,
    );
  }
  if (
    typeof raw.gate === "string" &&
    !GATES.includes(raw.gate as (typeof GATES)[number])
  ) {
    errors.push(`gate "${raw.gate}" not in fixed set [${GATES.join(", ")}]`);
  }
  if (
    typeof raw.status === "string" &&
    !STATUSES.includes(raw.status as (typeof STATUSES)[number])
  ) {
    errors.push(
      `status "${raw.status}" not in fixed set [${STATUSES.join(", ")}]`,
    );
  }
  if (isRecord(raw.detection) && typeof raw.detection.capability === "string") {
    const cap = raw.detection.capability;
    if (
      !DETECTION_CAPABILITIES.includes(
        cap as (typeof DETECTION_CAPABILITIES)[number],
      )
    ) {
      errors.push(
        `detection.capability "${cap}" not in fixed set [${DETECTION_CAPABILITIES.join(", ")}]`,
      );
    }
  }
  return errors;
}

export function lintIdGateConvention(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) return errors;
  const id = typeof raw.id === "string" ? raw.id : "";
  const gate = typeof raw.gate === "string" ? raw.gate : "";
  if (!id || !gate) return errors;

  // PREFIX-M# → mandatory, PREFIX-R# → recommended (allow optional suffix)
  if (/^[A-Z0-9]+-M\d+/i.test(id) && gate !== "mandatory") {
    errors.push(`id ${id} uses -M# but gate is "${gate}" (expected mandatory)`);
  }
  if (/^[A-Z0-9]+-R\d+/i.test(id) && gate !== "recommended") {
    errors.push(
      `id ${id} uses -R# but gate is "${gate}" (expected recommended)`,
    );
  }
  return errors;
}

/**
 * Titles must use obligation language:
 * - mandatory → contains "must have" (or at least "must")
 * - recommended → contains "should have" (or at least "should")
 * Prefer the "must have" / "should have" phrases when present.
 */
export function lintTitleObligation(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) return errors;
  const title = typeof raw.title === "string" ? raw.title : "";
  const gate = typeof raw.gate === "string" ? raw.gate : "";
  if (!title) return errors;

  const hasMustHave = /\bmust have\b/i.test(title);
  const hasShouldHave = /\bshould have\b/i.test(title);
  const hasMust = /\bmust\b/i.test(title);
  const hasShould = /\bshould\b/i.test(title);

  if (!hasMustHave && !hasShouldHave && !hasMust && !hasShould) {
    errors.push(
      'title must include obligation language ("must have" / "should have", or "must" / "should")',
    );
    return errors;
  }

  if (gate === "mandatory") {
    if (hasShouldHave || (hasShould && !hasMust)) {
      errors.push(
        'title for mandatory Check must use "must" / "must have" (not only "should")',
      );
    } else if (!hasMustHave && !hasMust) {
      errors.push('title for mandatory Check must include "must have" or "must"');
    }
  } else if (gate === "recommended") {
    if (hasMustHave || (hasMust && !hasShould)) {
      errors.push(
        'title for recommended Check must use "should" / "should have" (not "must")',
      );
    } else if (!hasShouldHave && !hasShould) {
      errors.push(
        'title for recommended Check must include "should have" or "should"',
      );
    }
  }

  return errors;
}

/**
 * The Check's own id may appear only in the `id` field (and as peers in
 * relatedRules / replacedBy — never as prose or as a self-reference).
 */
export function lintOwnIdNotRepeated(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) return errors;
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!id) return errors;

  const idRe = new RegExp(
    `\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
  );

  const visit = (value: unknown, path: string) => {
    if (typeof value === "string") {
      if (idRe.test(value)) {
        errors.push(
          `${path}: must not repeat Check id "${id}" (id belongs only in the id field)`,
        );
      }
      return;
    }
    if (Array.isArray(value)) {
      // relatedRules / replacedBy may list *other* Check ids, not self
      if (path === "relatedRules" || path === "replacedBy") {
        value.forEach((item, i) => {
          if (typeof item === "string" && item === id) {
            errors.push(
              `${path}[${i}]: must not reference this Check's own id "${id}"`,
            );
          }
        });
        return;
      }
      value.forEach((item, i) => visit(item, `${path}[${i}]`));
      return;
    }
    if (isRecord(value)) {
      for (const [k, v] of Object.entries(value)) {
        const next = path ? `${path}.${k}` : k;
        if (next === "id") continue;
        visit(v, next);
      }
    }
  };

  for (const [k, v] of Object.entries(raw)) {
    if (k === "id") continue;
    visit(v, k);
  }

  return errors;
}

/**
 * Ban echoing `category` into prose as "(agent-governance): …" or
 * "(Agent Governance, mandatory): …". Category belongs only in the category field.
 */
export function lintCategoryNotEchoedInProse(
  raw: unknown,
  pillarSlugs: Set<string> = new Set(),
): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) return errors;
  const category = typeof raw.category === "string" ? raw.category.trim() : "";

  const slugSet = new Set(pillarSlugs);
  if (category) slugSet.add(category);

  const slugAlts = [...slugSet]
    .filter(Boolean)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  const slugEchoRe =
    slugAlts.length > 0
      ? new RegExp(`\\((?:${slugAlts.join("|")})\\)\\s*:`, "i")
      : null;

  // Template leftover: "(Some Pillar Name, mandatory):" / "(…, recommended):"
  const namedGateEchoRe = /\([^)]+,\s*(?:mandatory|recommended)\)\s*:/i;

  const visit = (value: unknown, path: string) => {
    if (typeof value === "string") {
      if (path === "category") return;
      if (slugEchoRe?.test(value)) {
        errors.push(
          `${path}: must not echo category as "(${category || "pillar-slug"}):" in prose — keep category only in the category field`,
        );
      }
      if (namedGateEchoRe.test(value)) {
        errors.push(
          `${path}: must not prefix prose with "(Name, mandatory|recommended):" — that echoes catalog metadata`,
        );
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => visit(item, `${path}[${i}]`));
      return;
    }
    if (isRecord(value)) {
      for (const [k, v] of Object.entries(value)) {
        visit(v, path ? `${path}.${k}` : k);
      }
    }
  };

  for (const [k, v] of Object.entries(raw)) {
    visit(v, k);
  }

  return errors;
}

function normWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Lint one parsed Check document against fixed sets + published spec mapping.
 */
export function lintYamlRule(
  raw: unknown,
  ctx: YamlLintContext,
): string[] {
  const errors: string[] = [
    ...missingMandatoryFields(raw),
    ...lintFixedEnums(raw),
    ...lintForbiddenProse(raw),
    ...lintIdGateConvention(raw),
    ...lintTitleObligation(raw),
    ...lintOwnIdNotRepeated(raw),
    ...lintCategoryNotEchoedInProse(raw, ctx.pillarSlugs),
  ];

  if (!isRecord(raw)) return errors;

  const id = typeof raw.id === "string" ? raw.id : "";
  const category = typeof raw.category === "string" ? raw.category : "";
  const gate = typeof raw.gate === "string" ? raw.gate : "";
  const severity = typeof raw.severity === "string" ? raw.severity : "";

  if (category && ctx.pillarSlugs.size > 0 && !ctx.pillarSlugs.has(category)) {
    errors.push(
      `category "${category}" not in fixed pillar/category set (${ctx.pillarSlugs.size} known)`,
    );
  }

  if (id && ctx.specById.size > 0) {
    const spec = ctx.specById.get(id);
    if (!spec) {
      errors.push(`id "${id}" does not map to any Check in aprf-spec.json`);
    } else {
      if (gate && gate !== spec.gate) {
        errors.push(
          `gate "${gate}" does not map to spec (spec lists ${id} under ${spec.gate}Checks)`,
        );
      }
      if (category && category !== spec.pillarSlug) {
        errors.push(
          `category "${category}" does not map to spec pillar slug "${spec.pillarSlug}" for ${id}`,
        );
      }
      if (
        severity &&
        spec.pillarSeverity &&
        SEVERITIES.includes(severity as (typeof SEVERITIES)[number]) &&
        SEVERITIES.includes(
          spec.pillarSeverity as (typeof SEVERITIES)[number],
        )
      ) {
        // Check severity must not be *lower* urgency than a looser reading —
        // require Check severity ∈ fixed set only; optionally warn if mandatory
        // on a critical pillar is "low".
        if (spec.gate === "mandatory" && severity === "low") {
          errors.push(
            `severity "low" is not allowed for mandatory Check ${id} (pillar ${spec.pillarId} is ${spec.pillarSeverity})`,
          );
        }
      }

      if (isRecord(raw.applicability)) {
        const lvl = raw.applicability.requiredFromLevel;
        const crit = raw.applicability.minCriticality;
        if (typeof lvl === "number" && lvl !== spec.requiredFromLevel) {
          errors.push(
            `applicability.requiredFromLevel ${lvl} does not map to spec (${spec.requiredFromLevel})`,
          );
        }
        if (typeof crit === "number" && crit !== spec.minCriticality) {
          errors.push(
            `applicability.minCriticality ${crit} does not map to spec (${spec.minCriticality})`,
          );
        }
      }

      if (ctx.enforceMethodMatch && isRecord(raw.detection)) {
        const cap = raw.detection.capability;
        if (typeof cap === "string" && cap !== spec.method) {
          errors.push(
            `detection.capability "${cap}" does not map to spec.method "${spec.method}"`,
          );
        }
      }

      if (
        ctx.enforcePassConditionMatch &&
        typeof raw.passCondition === "string" &&
        normWs(raw.passCondition) !== normWs(spec.passCondition)
      ) {
        errors.push(
          `passCondition does not map to published spec for ${id}`,
        );
      }
    }
  }

  if (
    typeof raw.title === "string" &&
    typeof raw.description === "string" &&
    raw.title.trim().toLowerCase() === raw.description.trim().toLowerCase()
  ) {
    errors.push("title must differ from description");
  }

  return errors;
}

/** Build SpecCheckRef map from parsed aprf-spec.json pillars. */
export function buildSpecCheckIndex(spec: {
  pillars?: Array<{
    id: string;
    slug: string;
    domain?: string | null;
    severity?: string;
    mandatoryChecks?: Array<{
      id: string;
      method: "automated" | "manual" | "hybrid";
      requiredFromLevel: number;
      minCriticality: number;
      passCondition: string;
      requirement: string;
    }>;
    recommendedChecks?: Array<{
      id: string;
      method: "automated" | "manual" | "hybrid";
      requiredFromLevel: number;
      minCriticality: number;
      passCondition: string;
      requirement: string;
    }>;
  }>;
}): Map<string, SpecCheckRef> {
  const map = new Map<string, SpecCheckRef>();
  for (const pillar of spec.pillars ?? []) {
    for (const c of pillar.mandatoryChecks ?? []) {
      map.set(c.id, {
        id: c.id,
        gate: "mandatory",
        pillarSlug: pillar.slug,
        pillarId: pillar.id,
        pillarSeverity: pillar.severity,
        domain: pillar.domain ?? null,
        method: c.method,
        requiredFromLevel: c.requiredFromLevel,
        minCriticality: c.minCriticality,
        passCondition: c.passCondition,
        requirement: c.requirement,
      });
    }
    for (const c of pillar.recommendedChecks ?? []) {
      map.set(c.id, {
        id: c.id,
        gate: "recommended",
        pillarSlug: pillar.slug,
        pillarId: pillar.id,
        pillarSeverity: pillar.severity,
        domain: pillar.domain ?? null,
        method: c.method,
        requiredFromLevel: c.requiredFromLevel,
        minCriticality: c.minCriticality,
        passCondition: c.passCondition,
        requirement: c.requirement,
      });
    }
  }
  return map;
}
