/**
 * Node-only YAML rule loader. Do not import from browser bundles.
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { AprfRule, CategoryDef, RuleIndex } from "./types.js";
import { TECHNOLOGIES } from "./types.js";
import { buildRuleIndex } from "./index-builder.js";
import { listCatalogDetectorIds } from "./detectors/catalog-ids.js";

export function rulesRootDir(fromFile = import.meta.url): string {
  const here = dirname(fileURLToPath(fromFile));
  // scripts/ → ../rules  OR  src/ → ../rules
  const candidate = join(here, "..", "rules");
  if (existsSync(join(candidate, "_schema", "rule.schema.json"))) return candidate;
  return join(here, "..", "..", "rules");
}

function loadSchema(rulesRoot: string): object {
  const schemaPath = join(rulesRoot, "_schema", "rule.schema.json");
  return JSON.parse(readFileSync(schemaPath, "utf8")) as object;
}

function walkYamlFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_")) continue;
      walkYamlFiles(full, out);
    } else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) {
      out.push(full);
    }
  }
  return out;
}

export function loadCategories(rulesRoot: string): CategoryDef[] {
  const path = join(rulesRoot, "_index", "categories.yaml");
  if (!existsSync(path)) return [];
  const doc = parseYaml(readFileSync(path, "utf8")) as {
    categories?: CategoryDef[];
  };
  return doc.categories ?? [];
}

export function loadRulesFromDisk(rulesRoot?: string): {
  rules: AprfRule[];
  categories: CategoryDef[];
  index: RuleIndex;
  errors: string[];
} {
  const root = rulesRoot ?? rulesRootDir();
  const categories = loadCategories(root);
  const schema = loadSchema(root);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const files = walkYamlFiles(join(root, "by-category")).sort((a, b) =>
    a.localeCompare(b),
  );
  const rules: AprfRule[] = [];
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const categoryIds = new Set(categories.map((c) => c.id));
  const knownDetectors = new Set(listCatalogDetectorIds());
  const knownTechs = new Set<string>(TECHNOLOGIES);

  for (const file of files) {
    let raw: unknown;
    try {
      raw = parseYaml(readFileSync(file, "utf8"));
    } catch (err) {
      errors.push(`${file}: YAML parse error: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    if (!validate(raw)) {
      const detail = (validate.errors ?? [])
        .map((e) => `${e.instancePath || "/"} ${e.message}`)
        .join("; ");
      errors.push(`${file}: schema invalid: ${detail}`);
      continue;
    }

    const rule = raw as AprfRule;

    if (seenIds.has(rule.id)) {
      errors.push(`${file}: duplicate rule id ${rule.id}`);
      continue;
    }
    seenIds.add(rule.id);

    if (categoryIds.size > 0 && !categoryIds.has(rule.category)) {
      errors.push(`${file}: unknown category "${rule.category}"`);
    }

    for (const tech of rule.applicability.technologies ?? []) {
      if (!knownTechs.has(tech)) {
        errors.push(`${file}: unknown technology "${tech}"`);
      }
    }

    for (const det of rule.detection.detectors ?? []) {
      if (!knownDetectors.has(det.id)) {
        errors.push(`${file}: unknown detector id "${det.id}"`);
      }
    }

    if (rule.detection.capability === "automated") {
      const dets = rule.detection.detectors ?? [];
      const hasNonManual = dets.some((d) => d.id !== "manual-attest");
      if (!hasNonManual) {
        errors.push(
          `${file}: capability "automated" requires at least one non-manual-attest detector (use hybrid or manual)`,
        );
      }
    }

    if (rule.detection.capability === "hybrid") {
      const dets = rule.detection.detectors ?? [];
      const hasNonManual = dets.some((d) => d.id !== "manual-attest");
      if (!hasNonManual) {
        errors.push(
          `${file}: capability "hybrid" requires at least one non-manual-attest detector (use manual if attestation-only)`,
        );
      }
    }

    if (rule.gate === "mandatory" && !rule.passCondition?.trim()) {
      errors.push(`${file}: mandatory rule requires passCondition`);
    }

    if (
      rule.title.trim().toLowerCase() === rule.description.trim().toLowerCase()
    ) {
      errors.push(`${file}: title must differ from description`);
    }

    rules.push(rule);
  }

  // Referential integrity for relatedRules / replacedBy
  const idSet = new Set(rules.map((r) => r.id));
  for (const rule of rules) {
    for (const rel of rule.relatedRules) {
      if (!idSet.has(rel)) {
        errors.push(`${rule.id}: relatedRules references missing id "${rel}"`);
      }
    }
    if (rule.replacedBy && !idSet.has(rule.replacedBy)) {
      errors.push(`${rule.id}: replacedBy references missing id "${rule.replacedBy}"`);
    }
  }

  rules.sort((a, b) => a.id.localeCompare(b.id));
  const index = buildRuleIndex(rules, categories);
  return { rules, categories, index, errors };
}

