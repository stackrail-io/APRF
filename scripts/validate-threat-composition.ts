/**
 * Validate spec/aprf-threat-composition.yaml against registry + Check catalog.
 * Run from repo root: npm run aprf:threats
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parse } from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { getGeneratedCatalog } from "../packages/aprf-engine/src/catalog.ts";
import {
  collectSignalIds,
  signalIdsReferencedByThreats,
  type Indicator,
  type ThreatCompositionDoc,
} from "../packages/aprf-engine/src/threat-composition.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors: string[] = [];

function check(cond: unknown, msg: string): void {
  if (!cond) errors.push(msg);
}

const compositionPath = join(root, "spec", "aprf-threat-composition.yaml");
const schemaPath = join(root, "schemas", "aprf-threat-composition-0.1.json");
const registryPath = join(root, "spec", "aprf-signal-registry.yaml");

check(existsSync(compositionPath), "spec/aprf-threat-composition.yaml missing");
check(existsSync(schemaPath), "schemas/aprf-threat-composition-0.1.json missing");
check(existsSync(registryPath), "spec/aprf-signal-registry.yaml missing");

const doc = parse(readFileSync(compositionPath, "utf8")) as ThreatCompositionDoc;
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(doc)) {
  for (const e of validate.errors ?? []) {
    errors.push(`schema: ${e.instancePath || "/"} ${e.message}`);
  }
}

const registry = parse(readFileSync(registryPath, "utf8")) as {
  signals?: Array<{ id?: string }>;
};
const knownSignals = new Set(
  (registry.signals ?? []).map((s) => s.id).filter(Boolean) as string[],
);
const catalogIds = new Set(getGeneratedCatalog().rules.map((r) => r.id));

const threatIds = Object.keys(doc.threats ?? {});
check(threatIds.length > 0, "no threats defined");
for (const id of threatIds) {
  check(/^THR-[a-z0-9-]+$/.test(id), `${id}: threat id must match THR-[a-z0-9-]+`);
  const body = doc.threats[id];
  const primary = (body.mitigations ?? []).filter((m) => m.role === "primary");
  check(primary.length >= 1, `${id}: at least one primary mitigation required`);
  for (const m of body.mitigations ?? []) {
    if (!catalogIds.has(m.checkId)) {
      errors.push(`${id}: unknown Check ${m.checkId}`);
    }
  }
  for (const ind of body.indicators ?? []) {
    validateIndicator(id, ind, knownSignals);
  }
}

function validateIndicator(
  threatId: string,
  ind: Indicator,
  known: Set<string>,
): void {
  if ("signal" in ind) {
    if (!known.has(ind.signal)) {
      errors.push(`${threatId}: unknown signal ${ind.signal}`);
    }
    return;
  }
  if ("allOf" in ind) {
    for (const x of ind.allOf) validateIndicator(threatId, x, known);
    return;
  }
  if ("anyOf" in ind) {
    for (const x of ind.anyOf) validateIndicator(threatId, x, known);
  }
}

const referenced = signalIdsReferencedByThreats(doc);
for (const sid of referenced) {
  check(knownSignals.has(sid), `composition references unknown signal ${sid}`);
}

// Ensure collectSignalIds covers nested trees (smoke).
for (const [id, body] of Object.entries(doc.threats ?? {})) {
  const set = new Set<string>();
  for (const ind of body.indicators) collectSignalIds(ind, set);
  check(set.size > 0, `${id}: indicators reference no signals`);
}

if (errors.length > 0) {
  console.error(`FAIL: ${errors.length} threat-composition problem(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `OK: threat composition (${threatIds.length} threats, ${referenced.length} signal refs)`,
);
