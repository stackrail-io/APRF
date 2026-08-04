/**
 * @stackrail-io/aprf — local APRF CLI (no StackRail backend).
 *
 *   npx @stackrail-io/aprf collect --target . --out ./aprf-assessment
 *   npx @stackrail-io/aprf assess  --out ./aprf-assessment --profile core
 *   npx @stackrail-io/aprf report  --in ./aprf-assessment/assessment.json
 *   npx @stackrail-io/aprf verify  ./aprf-assessment/REPORT.html
 *   npx @stackrail-io/aprf audit   --target . --profile core
 *   npx @stackrail-io/aprf version
 */
import { resolve } from "node:path";
import { runCollectors } from "../../../skills/aprf-auditor/collectors/runner.ts";
import { writeAssessmentHtmlReport } from "../../../skills/aprf-auditor/scripts/render-html-report.ts";
import { verifyHtmlReport } from "../../../skills/aprf-auditor/scripts/verify-html-report.ts";
import { writeAssessment } from "./assess.ts";
import { catalogVersion, cliVersion, frameworkVersion } from "./versions.ts";

function usage(): never {
  console.log(`APRF CLI v${cliVersion()} (catalog ${catalogVersion()})

Usage:
  aprf collect  [--target <dir>] [--out <dir>] [--plugins a,b] [--live] …
  aprf assess   [--out <dir>] [--profile core|regulated] [--lens rag,agents] [--full]
  aprf report   [--in assessment.json] [--out REPORT.html]
  aprf verify   [REPORT.html]
  aprf audit    [--target <dir>] [--out <dir>] [--profile core|regulated] [--lens …] [--full]
                (collect → assess → report → verify)
  aprf version

Options (collect / audit):
  --target <path>      Project to scan (default: cwd)
  --out <path>         Output dir (default: ./aprf-assessment)
  --plugins a,b,c      Subset of collector ids
  --live               Allow credentialed API calls
  --base-url <url>     Live HTTP probe base URL (AUTHN-M1)
  --max-files <n>      Filesystem walk cap (default: 4000)

Options (assess / audit):
  --profile <id>       aprf-profile-core | aprf-profile-regulated | core | regulated
  --lens a,b           Optional lenses: rag, agents, voice, coding
  --full               Score full catalog (not only profile mandatories + hinted Checks)

Assess is deterministic: collector statusHints + evidence-graph nodes. Unscored → NOT_DEMONSTRATED.
`);
  process.exit(0);
}

function takeFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  return argv[i + 1];
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function defaultOut(argv: string[]): string {
  return resolve(takeFlag(argv, "--out") ?? "aprf-assessment");
}

async function cmdCollect(argv: string[]) {
  return runCollectors({
    target: resolve(takeFlag(argv, "--target") ?? process.cwd()),
    outDir: defaultOut(argv),
    live: hasFlag(argv, "--live") || process.env.APRF_AUDITOR_LIVE === "1",
    plugins: takeFlag(argv, "--plugins")?.split(",").filter(Boolean),
    maxFiles: Number(takeFlag(argv, "--max-files") ?? 4000),
    baseUrl: takeFlag(argv, "--base-url") ?? process.env.APRF_AUTH_PROBE_BASE_URL,
    adminToken: takeFlag(argv, "--admin-token") ?? process.env.APRF_ADMIN_TOKEN,
    adminEmail:
      takeFlag(argv, "--admin-email") ??
      takeFlag(argv, "--admin-user") ??
      process.env.APRF_ADMIN_EMAIL ??
      process.env.APRF_ADMIN_USER,
    adminPassword:
      takeFlag(argv, "--admin-password") ?? process.env.APRF_ADMIN_PASSWORD,
  });
}

function cmdAssess(argv: string[]) {
  const outDir = defaultOut(argv);
  const { path } = writeAssessment({
    outDir,
    profileId: takeFlag(argv, "--profile") ?? "core",
    lensIds: takeFlag(argv, "--lens")?.split(",").filter(Boolean) ?? [],
    fullCatalog: hasFlag(argv, "--full"),
  });
  console.log(`Wrote ${path}`);
  return path;
}

function cmdReport(argv: string[]) {
  const inFlag = takeFlag(argv, "--in");
  const outFlag = takeFlag(argv, "--out");
  const input = resolve(inFlag ?? resolve("aprf-assessment", "assessment.json"));
  const htmlOut = resolve(
    outFlag ?? resolve(input, "../REPORT.html"),
  );
  writeAssessmentHtmlReport(input, htmlOut);
  console.log(`Wrote ${htmlOut}`);
  return htmlOut;
}

function cmdVerify(argv: string[]) {
  const path = resolve(argv[0] ?? "aprf-assessment/REPORT.html");
  const result = verifyHtmlReport(path);
  if (!result.ok) {
    console.error(
      `REPORT.html verify failed (${result.path}): missing ${result.missing.join(", ")}`,
    );
    process.exit(1);
  }
  console.log(`OK: ${result.path}`);
}

function cmdVersion() {
  console.log(
    JSON.stringify(
      {
        cli: cliVersion(),
        catalog: catalogVersion(),
        framework: frameworkVersion(),
        name: "@stackrail-io/aprf",
      },
      null,
      2,
    ),
  );
}

async function cmdAudit(argv: string[]) {
  await cmdCollect(argv);
  const outDir = defaultOut(argv);
  cmdAssess(argv);
  const input = resolve(outDir, "assessment.json");
  const htmlOut = resolve(outDir, "REPORT.html");
  writeAssessmentHtmlReport(input, htmlOut);
  console.log(`Wrote ${htmlOut}`);
  const result = verifyHtmlReport(htmlOut);
  if (!result.ok) {
    console.error(
      `REPORT.html verify failed: missing ${result.missing.join(", ")}`,
    );
    process.exit(1);
  }
  console.log(`OK: audit complete → ${htmlOut}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") usage();

  switch (cmd) {
    case "collect":
      await cmdCollect(argv.slice(1));
      break;
    case "assess":
      cmdAssess(argv.slice(1));
      break;
    case "report":
      cmdReport(argv.slice(1));
      break;
    case "verify":
      cmdVerify(argv.slice(1));
      break;
    case "audit":
      await cmdAudit(argv.slice(1));
      break;
    case "version":
    case "--version":
    case "-v":
      cmdVersion();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
