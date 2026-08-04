#!/usr/bin/env node
/**
 * Build pluginId → Check ID map from skills/aprf-auditor/plugins/*.yaml
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const pluginsDir = resolve(here, "../../../skills/aprf-auditor/plugins");
const outDir = resolve(here, "../src/generated");
const outFile = join(outDir, "plugin-check-map.json");

const map = {};
for (const name of readdirSync(pluginsDir).sort()) {
  if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
  if (name.startsWith("_")) continue;
  const doc = parseYaml(readFileSync(join(pluginsDir, name), "utf8"));
  if (!doc?.id || !Array.isArray(doc.mapsToChecks) || !doc.mapsToChecks.length) {
    continue;
  }
  map[String(doc.id)] = doc.mapsToChecks.map(String);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, `${JSON.stringify(map, null, 2)}\n`, "utf8");
console.log(
  `Wrote ${outFile} (${Object.keys(map).length} plugins → Check IDs)`,
);
