/**
 * Validate spec/aprf-signal-registry.yaml (+ optional migration warn mode).
 * Run from repo root: npm run aprf:signals
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parse } from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors: string[] = [];
const warnings: string[] = [];

function check(cond: unknown, msg: string): void {
  if (!cond) errors.push(msg);
}

const registryPath = join(root, "spec", "aprf-signal-registry.yaml");
const schemaPath = join(root, "schemas", "aprf-signal-registry-0.1.json");
const evidenceTypesPath = join(root, "spec", "evidence-types.yaml");

check(existsSync(registryPath), "spec/aprf-signal-registry.yaml missing");
check(existsSync(schemaPath), "schemas/aprf-signal-registry-0.1.json missing");

const registry = parse(readFileSync(registryPath, "utf8")) as {
  kinds?: Record<string, { confirmingEligible?: boolean; defaultAssurance?: string }>;
  signals?: Array<{
    id?: string;
    kind?: string;
    evidenceTypes?: string[];
  }>;
};

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(registry)) {
  for (const e of validate.errors ?? []) {
    errors.push(`schema: ${e.instancePath || "/"} ${e.message}`);
  }
}

const confirming = new Set(
  Object.entries(registry.kinds ?? {})
    .filter(([, meta]) => meta.confirmingEligible === true)
    .map(([k]) => k),
);
check(
  confirming.has("behavioral") && confirming.has("exercise"),
  "kinds.behavioral and kinds.exercise must be confirmingEligible",
);
check(
  ![...confirming].some((k) => !["behavioral", "exercise"].includes(k)),
  `only behavioral/exercise may be confirmingEligible, got: ${[...confirming].join(", ")}`,
);

const ids = (registry.signals ?? []).map((s) => s.id).filter(Boolean) as string[];
check(ids.length > 0, "signals list is empty");
check(new Set(ids).size === ids.length, "duplicate signal ids");

const evidenceDoc = existsSync(evidenceTypesPath)
  ? (parse(readFileSync(evidenceTypesPath, "utf8")) as {
      types?: Array<{ id?: string }>;
    })
  : { types: [] };
const knownEvidence = new Set(
  (evidenceDoc.types ?? []).map((t) => t.id).filter(Boolean) as string[],
);

for (const sig of registry.signals ?? []) {
  if (!sig.id) continue;
  for (const et of sig.evidenceTypes ?? []) {
    if (!knownEvidence.has(et)) {
      errors.push(`${sig.id}: unknown evidenceType ${et}`);
    }
  }
}

// Migration: optional env APRF_SIGNAL_OBS=/path/to/observations.json
// When set, unknown signalIds are errors (strict). Absent = registry-only validate.
const obsPath = process.env.APRF_SIGNAL_OBS;
if (obsPath) {
  if (!existsSync(obsPath)) {
    errors.push(`APRF_SIGNAL_OBS path not found: ${obsPath}`);
  } else {
    const known = new Set(ids);
    const obs = JSON.parse(readFileSync(obsPath, "utf8")) as Array<{
      signalId?: string;
    }>;
    for (const o of obs) {
      if (o.signalId && !known.has(o.signalId)) {
        errors.push(`unknown emitted signalId: ${o.signalId}`);
      }
    }
  }
} else {
  warnings.push(
    "migration: set APRF_SIGNAL_OBS to validate emitted observations against the registry",
  );
}

for (const w of warnings) console.warn(`WARN: ${w}`);
if (errors.length > 0) {
  console.error(`FAIL: ${errors.length} signal-registry problem(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `OK: signal registry (${ids.length} signals, confirmingEligible=${[...confirming].join(",")})`,
);
