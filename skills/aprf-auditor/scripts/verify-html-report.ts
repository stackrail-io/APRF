#!/usr/bin/env npx tsx
/**
 * Verify REPORT.html was produced by the official renderer.
 * Exit 1 if required markers are missing (hand-written / stale HTML).
 *
 *   npx tsx skills/aprf-auditor/scripts/verify-html-report.ts ./aprf-assessment/REPORT.html
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve(process.argv[2] ?? "aprf-assessment/REPORT.html");
if (!existsSync(path)) {
  console.error(`Missing file: ${path}`);
  process.exit(1);
}

const html = readFileSync(path, "utf8");
const required = [
  "stackrail.io",
  "Visual overview",
  "Control status mix",
  "APRF Auditor",
  "<!DOCTYPE html>",
];

const missing = required.filter((n) => !html.includes(n));
if (missing.length) {
  console.error(
    `REPORT.html is incomplete or hand-written. Missing: ${missing.join(", ")}`,
  );
  console.error(
    "Re-run: npm run aprf:report-html -- --in …/assessment.json --out …/REPORT.html",
  );
  process.exit(1);
}

console.log(`OK: ${path} looks like an official APRF Auditor HTML report`);
