#!/usr/bin/env npx tsx
/**
 * Verify REPORT.html was produced by the official renderer.
 * Exit 1 if required markers are missing (hand-written / stale HTML).
 *
 *   npx tsx skills/aprf-auditor/scripts/verify-html-report.ts ./aprf-assessment/REPORT.html
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED = [
  "stackrail.io",
  "Visual overview",
  "Control status mix",
  "APRF Auditor",
  "brand-logo",
  "<!DOCTYPE html>",
  "controls-table",
  "control-flyout",
] as const;

export type VerifyHtmlResult =
  | { ok: true; path: string }
  | { ok: false; path: string; missing: string[] };

export function verifyHtmlReport(path: string): VerifyHtmlResult {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    return { ok: false, path: resolved, missing: ["(file missing)"] };
  }
  const html = readFileSync(resolved, "utf8");
  const missing = REQUIRED.filter((n) => !html.includes(n));
  if (missing.length) return { ok: false, path: resolved, missing: [...missing] };
  return { ok: true, path: resolved };
}

function main() {
  const path = resolve(process.argv[2] ?? "aprf-assessment/REPORT.html");
  const result = verifyHtmlReport(path);
  if (!result.ok) {
    if (result.missing[0] === "(file missing)") {
      console.error(`Missing file: ${result.path}`);
    } else {
      console.error(
        `REPORT.html is incomplete or hand-written. Missing: ${result.missing.join(", ")}`,
      );
      console.error(
        "Re-run: npm run aprf:report-html -- --in …/assessment.json --out …/REPORT.html",
      );
    }
    process.exit(1);
  }
  console.log(`OK: ${result.path} looks like an official APRF Auditor HTML report`);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
const isMain =
  /(?:^|[/\\])verify-html-report\.(?:ts|js|mjs)$/.test(entry) &&
  import.meta.url === pathToFileURL(entry).href;

if (isMain) main();
