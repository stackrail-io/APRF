/**
 * @stackrail-io/aprf — local APRF CLI (no StackRail backend).
 *
 *   npx @stackrail-io/aprf collect --target . --out ./aprf-assessment
 *   npx @stackrail-io/aprf assess  --out ./aprf-assessment --profile core
 *   npx @stackrail-io/aprf report  --in ./aprf-assessment/assessment.json
 *   npx @stackrail-io/aprf verify  ./aprf-assessment/REPORT.html
 *   npx @stackrail-io/aprf audit   --target . --profile core --base-url … …
 *   npx @stackrail-io/aprf version
 */
import { resolve } from "node:path";
import {
  runCollectors,
  type CollectOptions,
} from "../../../skills/aprf-auditor/collectors/runner.ts";
import { writeAssessmentHtmlReport } from "../../../skills/aprf-auditor/scripts/render-html-report.ts";
import { verifyHtmlReport } from "../../../skills/aprf-auditor/scripts/verify-html-report.ts";
import { writeAssessment } from "./assess.ts";
import { catalogVersion, cliVersion, frameworkVersion } from "./versions.ts";

function usage(exitCode = 0): never {
  console.log(`APRF CLI v${cliVersion()} (catalog ${catalogVersion()})

Usage:
  aprf collect  [collect options]
  aprf assess   [--out <dir>] [--profile core|regulated] [--lens rag,agents] [--full]
  aprf report   [--in assessment.json] [--out REPORT.html]
  aprf verify   [REPORT.html]
  aprf audit    [collect options] [--profile …] [--lens …] [--full]
                (collect → assess → report → verify)
  aprf version

Collect / audit options (live credentials are never written to reports):
  --target <path>        Project to scan (default: cwd)
  --out <path>           Output dir (default: ./aprf-assessment)
  --plugins a,b,c        Subset of collector ids
  --live                 Allow credentialed API calls
                         (auto-on when --base-url or admin/limited creds are set)
  --base-url <url>       Running app URL for live collectors
                         (AUTHN-M1 probe, AUTHZ-M1 denial, AUTHN-M2 inventory)
                         Env: APRF_AUTH_PROBE_BASE_URL
  --admin-token <tok>    Admin bearer token (AUTHN-M2 / AUTHZ-M1)
                         Env: APRF_ADMIN_TOKEN
  --admin-email <e>      Admin email for password sign-in
                         Env: APRF_ADMIN_EMAIL (alias: --admin-user / APRF_ADMIN_USER)
  --admin-password <p>   Admin password (never persisted)
                         Env: APRF_ADMIN_PASSWORD
  --limited-email <e>    Non-admin user for AUTHZ-M1 denial probe
                         Env: APRF_AUTHZ_LIMITED_EMAIL
  --limited-password <p> Limited-user password
                         Env: APRF_AUTHZ_LIMITED_PASSWORD
  --limited-token <t>    Limited-user bearer token
                         Env: APRF_AUTHZ_LIMITED_TOKEN
  --max-files <n>        Filesystem walk cap (default: 4000)

Assess / audit options:
  --profile <id>         aprf-profile-core | aprf-profile-regulated | core | regulated
  --lens a,b             Optional lenses: rag, agents, voice, coding
  --full                 Score full catalog (not only profile mandatories + hinted Checks)

Other collector evidence (no extra CLI flags required):
  Drop measured JSON under ./aprf-assessment/imports/<pluginId>/ before or after collect.
  Optional live APIs also read env (e.g. GITHUB_TOKEN with --live for github-actions).

Examples:
  aprf audit --target . --out ./aprf-assessment --profile core

  aprf audit --target . --out ./aprf-assessment --profile core \\
    --base-url http://127.0.0.1:8080 \\
    --admin-email "$APRF_ADMIN_EMAIL" \\
    --admin-password "$APRF_ADMIN_PASSWORD"

Assess is deterministic: collector statusHints + evidence-graph nodes. Unscored → NOT_DEMONSTRATED.
`);
  process.exit(exitCode);
}

function takeFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const value = argv[i + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function defaultOut(argv: string[]): string {
  return resolve(takeFlag(argv, "--out") ?? "aprf-assessment");
}

/** Shared collect options for `collect` and `audit`. */
export function parseCollectOptions(argv: string[]): CollectOptions {
  const baseUrl =
    takeFlag(argv, "--base-url") ?? process.env.APRF_AUTH_PROBE_BASE_URL;
  const adminToken =
    takeFlag(argv, "--admin-token") ?? process.env.APRF_ADMIN_TOKEN;
  const adminEmail =
    takeFlag(argv, "--admin-email") ??
    takeFlag(argv, "--admin-user") ??
    process.env.APRF_ADMIN_EMAIL ??
    process.env.APRF_ADMIN_USER;
  const adminPassword =
    takeFlag(argv, "--admin-password") ?? process.env.APRF_ADMIN_PASSWORD;
  const limitedEmail =
    takeFlag(argv, "--limited-email") ??
    process.env.APRF_AUTHZ_LIMITED_EMAIL ??
    process.env.APRF_LIMITED_EMAIL;
  const limitedPassword =
    takeFlag(argv, "--limited-password") ??
    process.env.APRF_AUTHZ_LIMITED_PASSWORD ??
    process.env.APRF_LIMITED_PASSWORD;
  const limitedToken =
    takeFlag(argv, "--limited-token") ?? process.env.APRF_AUTHZ_LIMITED_TOKEN;

  const liveRequested =
    hasFlag(argv, "--live") || process.env.APRF_AUDITOR_LIVE === "1";
  // Credentialed/base-url runs imply live without requiring a separate --live.
  const live =
    liveRequested ||
    Boolean(
      baseUrl ||
        adminToken ||
        (adminEmail && adminPassword) ||
        limitedToken ||
        (limitedEmail && limitedPassword),
    );

  return {
    target: resolve(takeFlag(argv, "--target") ?? process.cwd()),
    outDir: defaultOut(argv),
    live,
    plugins: takeFlag(argv, "--plugins")?.split(",").filter(Boolean),
    maxFiles: Number(takeFlag(argv, "--max-files") ?? 4000),
    baseUrl,
    adminToken,
    adminEmail,
    adminPassword,
    limitedEmail,
    limitedPassword,
    limitedToken,
  };
}

async function cmdCollect(argv: string[]) {
  return runCollectors(parseCollectOptions(argv));
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
  const htmlOut = resolve(outFlag ?? resolve(input, "../REPORT.html"));
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
  const collectOpts = parseCollectOptions(argv);
  if (collectOpts.baseUrl) {
    console.log(
      `Live collect: base-url=${collectOpts.baseUrl}` +
        (collectOpts.adminEmail || collectOpts.adminToken
          ? " (admin creds set)"
          : "") +
        (collectOpts.limitedEmail || collectOpts.limitedToken
          ? " (limited-user creds set)"
          : ""),
    );
  }
  await runCollectors(collectOpts);
  const outDir = collectOpts.outDir;
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
      usage(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
