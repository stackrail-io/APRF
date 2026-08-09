/**
 * Integrity gate: every Check YAML detector ID (except manual-attest) must be
 * claimed by ≥1 plugin.detectorIds. Also ensures generated join maps match
 * plugin YAML (detector-plugin-map.json + plugin-check-map.json).
 *
 * Run: npm run aprf:detector-bridge
 */
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { parse as parseYaml } from "yaml";
import { getGeneratedCatalog } from "../packages/aprf-engine/src/catalog.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginsDir = join(root, "skills/aprf-auditor/plugins");
const generatedDir = join(root, "packages/aprf/src/generated");
const detectorMapPath = join(generatedDir, "detector-plugin-map.json");
const pluginCheckMapPath = join(generatedDir, "plugin-check-map.json");
const SKIP = new Set(["manual-attest"]);

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) fail(msg);
}

type PluginDoc = {
  id?: string;
  detectorIds?: string[];
  mapsToChecks?: string[];
};

function loadPlugins(): PluginDoc[] {
  const out: PluginDoc[] = [];
  for (const name of readdirSync(pluginsDir).sort()) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    if (name.startsWith("_")) continue;
    out.push(
      parseYaml(readFileSync(join(pluginsDir, name), "utf8")) as PluginDoc,
    );
  }
  return out;
}

function expectedDetectorPluginMap(
  plugins: PluginDoc[],
): Record<string, string[]> {
  const map = new Map<string, string[]>();
  for (const doc of plugins) {
    if (!doc?.id || !Array.isArray(doc.detectorIds)) continue;
    for (const d of doc.detectorIds) {
      const id = String(d);
      const list = map.get(id) ?? [];
      if (!list.includes(doc.id)) list.push(doc.id);
      map.set(id, list);
    }
  }
  for (const [, list] of map) list.sort();
  return Object.fromEntries(
    [...map.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
}

function expectedPluginCheckMap(plugins: PluginDoc[]): Record<string, string[]> {
  /** @type {Record<string, string[]>} */
  const map: Record<string, string[]> = {};
  for (const doc of plugins) {
    if (!doc?.id || !Array.isArray(doc.mapsToChecks) || !doc.mapsToChecks.length) {
      continue;
    }
    map[String(doc.id)] = doc.mapsToChecks.map(String);
  }
  return map;
}

function readJsonOrEmpty(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

const plugins = loadPlugins();
const claims = new Map(
  Object.entries(expectedDetectorPluginMap(plugins)).map(([k, v]) => [k, v]),
);

const catalog = getGeneratedCatalog();
/** detectorId → Check IDs */
const checkDetectors = new Map<string, string[]>();
for (const rule of catalog.rules) {
  const dets = rule.detection?.detectors ?? [];
  for (const d of dets) {
    const id = d?.id;
    if (!id) continue;
    const list = checkDetectors.get(id) ?? [];
    if (!list.includes(rule.id)) list.push(rule.id);
    checkDetectors.set(id, list);
  }
}

const orphans = [...checkDetectors.keys()]
  .filter((id) => !SKIP.has(id) && !claims.has(id))
  .sort();
assert(
  orphans.length === 0,
  `Check detector IDs missing from every plugin.detectorIds:\n  ${orphans
    .map((id) => `${id} (${(checkDetectors.get(id) ?? []).join(", ")})`)
    .join("\n  ")}`,
);

const stale = [...claims.keys()]
  .filter((id) => !checkDetectors.has(id))
  .sort();
assert(
  stale.length === 0,
  `plugin.detectorIds not present in any Check YAML:\n  ${stale
    .map((id) => `${id} ← ${(claims.get(id) ?? []).join(", ")}`)
    .join("\n  ")}`,
);

const shared = [...checkDetectors.entries()]
  .filter(([id, checks]) => !SKIP.has(id) && checks.length > 1)
  .sort(([a], [b]) => a.localeCompare(b));
if (shared.length) {
  console.warn(
    `WARN: detector IDs used on multiple Checks (join is multi-edge):\n${shared
      .map(([id, checks]) => `  ${id} → ${checks.join(", ")}`)
      .join("\n")}`,
  );
}

const expectedDetectorJson = `${JSON.stringify(Object.fromEntries(claims), null, 2)}\n`;
const expectedPluginCheckJson = `${JSON.stringify(expectedPluginCheckMap(plugins), null, 2)}\n`;
const detectorDrift =
  readJsonOrEmpty(detectorMapPath) !== expectedDetectorJson;
const pluginCheckDrift =
  readJsonOrEmpty(pluginCheckMapPath) !== expectedPluginCheckJson;

if (detectorDrift || pluginCheckDrift) {
  execFileSync(
    process.execPath,
    [join(root, "packages/aprf/scripts/gen-plugin-map.mjs")],
    { cwd: root, stdio: "inherit" },
  );
  const parts = [
    detectorDrift ? "detector-plugin-map.json" : null,
    pluginCheckDrift ? "plugin-check-map.json" : null,
  ].filter(Boolean);
  fail(
    `${parts.join(" + ")} drift — regenerated; commit packages/aprf/src/generated/`,
  );
}

const covered =
  checkDetectors.size - (checkDetectors.has("manual-attest") ? 1 : 0);
console.log(
  `aprf:detector-bridge OK — checkDetectors=${checkDetectors.size} bridged=${covered} pluginClaims=${claims.size} sharedAcrossChecks=${shared.length}`,
);
