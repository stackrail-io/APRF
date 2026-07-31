/**
 * Load + lint every Check YAML under rules/by-domain/.
 * Shared by validate.ts CLI and test-yaml-validation.ts.
 * Kept under scripts/ (not src/) so the published build never pulls in loader.ts.
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { parse as parseYaml } from "yaml";
import { loadRulesFromDisk, rulesRootDir } from "../src/loader.js";
import {
  buildSpecCheckIndex,
  lintYamlRule,
  lintRawYamlNoEllipsis,
  type YamlLintContext,
} from "../src/yaml-lint.js";

export interface CatalogValidationResult {
  rulesRoot: string;
  ruleCount: number;
  domainCount: number;
  pillarCount: number;
  categoryCount: number;
  specMappedCount: number;
  fileCount: number;
  errors: string[];
}

function findRepoRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "spec", "aprf-spec.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return from;
}

export function loadSpecContext(rulesRoot: string): YamlLintContext {
  const repoRoot = findRepoRoot(rulesRoot);
  const specPath = join(repoRoot, "spec", "aprf-spec.json");
  const pillarSlugs = new Set<string>();
  let specById = new Map();

  if (existsSync(specPath)) {
    const spec = JSON.parse(readFileSync(specPath, "utf8")) as {
      pillars?: Parameters<typeof buildSpecCheckIndex>[0]["pillars"];
    };
    specById = buildSpecCheckIndex(spec);
    for (const p of spec.pillars ?? []) pillarSlugs.add(p.slug);
  }

  const pillarsPath = join(rulesRoot, "_index", "pillars.yaml");
  if (existsSync(pillarsPath)) {
    const doc = parseYaml(readFileSync(pillarsPath, "utf8")) as {
      pillars?: Array<{ slug: string }>;
    };
    for (const p of doc.pillars ?? []) pillarSlugs.add(p.slug);
  }

  return {
    pillarSlugs,
    specById,
    enforceMethodMatch: false,
    enforcePassConditionMatch: false,
  };
}

export function walkYamlFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name.startsWith("_")) continue;
      walkYamlFiles(full, out);
    } else if (ent.name.endsWith(".yaml") || ent.name.endsWith(".yml")) {
      out.push(full);
    }
  }
  return out;
}

/** Validate every by-domain Check YAML + loader errors + spec↔YAML coverage. */
export function validateAllByDomainYaml(
  rulesRoot: string = rulesRootDir(),
): CatalogValidationResult {
  const { rules, domains, pillars, categories, errors } =
    loadRulesFromDisk(rulesRoot);
  const lintErrors: string[] = [...errors];
  const ctx = loadSpecContext(rulesRoot);

  if (ctx.specById.size === 0) {
    lintErrors.push(
      "spec/aprf-spec.json not found or has no Checks — cannot map ids/gates",
    );
  }

  const files = walkYamlFiles(join(rulesRoot, "by-domain")).sort((a, b) =>
    a.localeCompare(b),
  );

  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch (err) {
      lintErrors.push(
        `${file}: unreadable (${err instanceof Error ? err.message : err})`,
      );
      continue;
    }

    for (const e of lintRawYamlNoEllipsis(source)) {
      lintErrors.push(`${file}: ${e}`);
    }

    let raw: unknown;
    try {
      raw = parseYaml(source);
    } catch (err) {
      lintErrors.push(
        `${file}: invalid YAML (${err instanceof Error ? err.message : err})`,
      );
      continue;
    }

    for (const e of lintYamlRule(raw, ctx)) {
      lintErrors.push(`${file}: ${e}`);
    }

    // Path ↔ category: by-domain/<domain>/<pillar-slug>/<ID>.yaml
    const parts = file.split(/[/\\]/);
    const idx = parts.lastIndexOf("by-domain");
    if (idx >= 0 && parts.length >= idx + 4) {
      const domainDir = parts[idx + 1]!;
      const pillarDir = parts[idx + 2]!;
      const base = parts[parts.length - 1]!.replace(/\.ya?ml$/i, "");
      const rule = raw as { id?: string; category?: string };
      if (rule.category && pillarDir !== rule.category) {
        lintErrors.push(
          `${file}: path pillar folder "${pillarDir}" != category "${rule.category}"`,
        );
      }
      if (rule.id && base !== rule.id) {
        lintErrors.push(`${file}: filename "${base}" != id "${rule.id}"`);
      }
      const spec = rule.id ? ctx.specById.get(rule.id) : undefined;
      if (spec) {
        if (spec.domain == null) {
          if (domainDir !== "cross-cutting") {
            lintErrors.push(
              `${file}: cross-cutting Check expected under by-domain/cross-cutting/ (got "${domainDir}")`,
            );
          }
        } else if (domainDir !== spec.domain) {
          lintErrors.push(
            `${file}: path domain "${domainDir}" != spec domain "${spec.domain}"`,
          );
        }
      }
    }
  }

  const ruleIds = new Set(rules.map((r) => r.id));
  for (const id of ctx.specById.keys()) {
    if (!ruleIds.has(id)) {
      lintErrors.push(`spec Check ${id} has no YAML rule in by-domain/`);
    }
  }

  return {
    rulesRoot,
    ruleCount: rules.length,
    domainCount: domains.length,
    pillarCount: pillars.length,
    categoryCount: categories.length,
    specMappedCount: ctx.specById.size,
    fileCount: files.length,
    errors: lintErrors,
  };
}
