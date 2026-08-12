#!/usr/bin/env node
/**
 * Build join maps from skills/aprf-auditor/plugins/*.yaml:
 *   - pluginId → Check IDs (mapsToChecks)     → plugin-check-map.json
 *   - detectorId → plugin IDs (detectorIds)  → detector-plugin-map.json
 *   - pluginId → emitsEvidenceTier (E0–E5)   → plugin-evidence-tier-map.json
 *
 * Detector IDs and plugin IDs are separate namespaces; scoring joins via
 * mapsToChecks. detectorIds is the explicit bridge for automated join/validate.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const pluginsDir = resolve(here, "../../../skills/aprf-auditor/plugins");
const outDir = resolve(here, "../src/generated");
const pluginCheckOut = join(outDir, "plugin-check-map.json");
const detectorPluginOut = join(outDir, "detector-plugin-map.json");
const pluginTierOut = join(outDir, "plugin-evidence-tier-map.json");

const TIERS = new Set(["E0", "E1", "E2", "E3", "E4", "E5"]);
/** Default emitsEvidenceTier from evidenceClass when plugin omits the field. */
const CLASS_DEFAULT_TIER = {
  user: "E1",
  docs: "E2",
  code: "E2",
  iac: "E3",
  policy: "E3",
  "runtime-config": "E3",
  ci: "E3",
  runtime: "E4",
};

/** @type {Record<string, string[]>} */
const pluginCheckMap = {};
/** @type {Record<string, string[]>} */
const detectorPluginMap = {};
/** @type {Record<string, string>} */
const pluginTierMap = {};

for (const name of readdirSync(pluginsDir).sort()) {
  if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
  if (name.startsWith("_")) continue;
  const doc = parseYaml(readFileSync(join(pluginsDir, name), "utf8"));
  if (!doc?.id) continue;
  const pluginId = String(doc.id);

  if (Array.isArray(doc.mapsToChecks) && doc.mapsToChecks.length) {
    pluginCheckMap[pluginId] = doc.mapsToChecks.map(String);
  }

  if (Array.isArray(doc.detectorIds) && doc.detectorIds.length) {
    for (const raw of doc.detectorIds) {
      const detectorId = String(raw);
      if (!detectorPluginMap[detectorId]) detectorPluginMap[detectorId] = [];
      if (!detectorPluginMap[detectorId].includes(pluginId)) {
        detectorPluginMap[detectorId].push(pluginId);
      }
    }
  }

  const rawTier =
    typeof doc.emitsEvidenceTier === "string"
      ? doc.emitsEvidenceTier.trim().toUpperCase()
      : "";
  if (TIERS.has(rawTier)) {
    pluginTierMap[pluginId] = rawTier;
  } else if (
    typeof doc.evidenceClass === "string" &&
    CLASS_DEFAULT_TIER[doc.evidenceClass]
  ) {
    pluginTierMap[pluginId] = CLASS_DEFAULT_TIER[doc.evidenceClass];
  }
}

for (const ids of Object.values(detectorPluginMap)) ids.sort();
const sortedDetectors = Object.fromEntries(
  Object.keys(detectorPluginMap)
    .sort()
    .map((k) => [k, detectorPluginMap[k]]),
);
const sortedTiers = Object.fromEntries(
  Object.keys(pluginTierMap)
    .sort()
    .map((k) => [k, pluginTierMap[k]]),
);

mkdirSync(outDir, { recursive: true });
writeFileSync(pluginCheckOut, `${JSON.stringify(pluginCheckMap, null, 2)}\n`, "utf8");
writeFileSync(
  detectorPluginOut,
  `${JSON.stringify(sortedDetectors, null, 2)}\n`,
  "utf8",
);
writeFileSync(pluginTierOut, `${JSON.stringify(sortedTiers, null, 2)}\n`, "utf8");
console.log(
  `Wrote ${pluginCheckOut} (${Object.keys(pluginCheckMap).length} plugins → Check IDs)`,
);
console.log(
  `Wrote ${detectorPluginOut} (${Object.keys(sortedDetectors).length} detectors → plugins)`,
);
console.log(
  `Wrote ${pluginTierOut} (${Object.keys(sortedTiers).length} plugins → evidence tiers)`,
);
