import type {
  AprfCheckProjection,
  AprfRule,
  CategoryDef,
  DomainDef,
  PillarDef,
  RuleGate,
  RuleIndex,
  Severity,
  Technology,
} from "./types.js";
import { resolveMinimumTier } from "./evidence-tiers.js";

export function buildRuleIndex(
  rules: AprfRule[],
  categories: CategoryDef[],
  domains: DomainDef[] = [],
  pillars: PillarDef[] = [],
): RuleIndex {
  const byId = new Map<string, AprfRule>();
  const byCategory = new Map<string, AprfRule[]>();
  const byTag = new Map<string, AprfRule[]>();
  const byTechnology = new Map<Technology, AprfRule[]>();
  const bySeverity = new Map<Severity, AprfRule[]>();
  const byGate = new Map<RuleGate, AprfRule[]>();
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const domainById = new Map(domains.map((d) => [d.id, d]));
  const pillarById = new Map(pillars.map((p) => [p.id, p]));
  const pillarBySlug = new Map(pillars.map((p) => [p.slug, p]));

  for (const rule of rules) {
    byId.set(rule.id, rule);

    const catList = byCategory.get(rule.category) ?? [];
    catList.push(rule);
    byCategory.set(rule.category, catList);

    for (const tag of rule.tags) {
      const list = byTag.get(tag) ?? [];
      list.push(rule);
      byTag.set(tag, list);
    }

    for (const tech of rule.applicability.technologies ?? []) {
      const list = byTechnology.get(tech) ?? [];
      list.push(rule);
      byTechnology.set(tech, list);
    }

    const sevList = bySeverity.get(rule.severity) ?? [];
    sevList.push(rule);
    bySeverity.set(rule.severity, sevList);

    const gateList = byGate.get(rule.gate) ?? [];
    gateList.push(rule);
    byGate.set(rule.gate, gateList);
  }

  return {
    rules,
    byId,
    byCategory,
    byTag,
    byTechnology,
    bySeverity,
    byGate,
    categories,
    categoryById,
    domains,
    domainById,
    pillars,
    pillarById,
    pillarBySlug,
  };
}

export function ruleToCheckProjection(rule: AprfRule): AprfCheckProjection {
  const capability = rule.detection.capability;
  const method =
    capability === "none"
      ? "manual"
      : (capability as "automated" | "manual" | "hybrid");

  return {
    id: rule.id,
    requirement: rule.description,
    artifact: rule.evidenceRequired[0] ?? rule.title,
    passCondition: rule.passCondition,
    method,
    minimumTier: resolveMinimumTier(
      rule.evidencePolicy,
      rule.detection.capability,
    ),
    requiredFromLevel: rule.applicability.requiredFromLevel,
    minCriticality: rule.applicability.minCriticality,
    ...(rule.deprecated || rule.status === "deprecated"
      ? {
          deprecated: true,
          replacedBy: rule.replacedBy,
          deprecationNote: rule.deprecationNote,
        }
      : {}),
  };
}

export function checksForCategory(
  index: RuleIndex,
  category: string,
  gate?: RuleGate,
): AprfCheckProjection[] {
  const rules = index.byCategory.get(category) ?? [];
  return rules
    .filter((r) => r.status !== "draft")
    .filter((r) => (gate ? r.gate === gate : true))
    .map(ruleToCheckProjection);
}

export function getRuleById(
  index: RuleIndex,
  id: string,
): AprfRule | undefined {
  return index.byId.get(id);
}
