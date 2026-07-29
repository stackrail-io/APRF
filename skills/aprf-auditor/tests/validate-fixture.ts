/**
 * Validates skills/aprf-auditor example fixture against output-schema.json
 * and enforces N/A ⇒ passed:false invariant.
 *
 * Run from APRF repo root:
 *   npx tsx skills/aprf-auditor/tests/validate-fixture.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(here, "..");

const schema = JSON.parse(
  readFileSync(join(skillRoot, "output-schema.json"), "utf8"),
);
const fixture = JSON.parse(
  readFileSync(join(skillRoot, "examples/minimal-assessment.json"), "utf8"),
) as {
  controls?: Array<{
    checkId: string;
    status?: string;
    passed?: boolean;
    notApplicable?: boolean;
    evidenceFound?: unknown[];
    requiredEvidenceMissing?: string[];
  }>;
};

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

if (!validate(fixture)) {
  console.error("Schema validation failed:");
  console.error(validate.errors);
  process.exit(1);
}

for (const c of fixture.controls ?? []) {
  if (c.notApplicable === true && c.passed !== false) {
    console.error(`N/A invariant failed for ${c.checkId}: passed must be false`);
    process.exit(1);
  }
  if (c.status === "NOT_APPLICABLE" && c.notApplicable !== true) {
    console.error(`Status NOT_APPLICABLE requires notApplicable:true (${c.checkId})`);
    process.exit(1);
  }
  if (
    c.status === "NOT_DEMONSTRATED" &&
    Array.isArray(c.evidenceFound) &&
    c.evidenceFound.length === 0 &&
    (!c.requiredEvidenceMissing || c.requiredEvidenceMissing.length === 0)
  ) {
    console.error(
      `NOT_DEMONSTRATED without evidence should list requiredEvidenceMissing (${c.checkId})`
    );
    process.exit(1);
  }
}

console.log("aprf-auditor fixture OK");
