/**
 * Smoke: short-lived-agent-tokens needs 100% TTL coverage + 0 static keys in prompts.
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  shortLivedAgentTokensCollector,
  type ShortLivedAgentTokensReport,
} from "../collectors/short-lived-agent-tokens.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<ShortLivedAgentTokensReport> {
  await shortLivedAgentTokensCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "short-lived-agent-tokens",
        "short-lived-agent-tokens-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-authn-r1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "token-ttl.md"),
      "token_ttl short_lived_token policy for agent_credential access_token_lifetime\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.authnR1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "security"), { recursive: true });
    writeFileSync(
      join(t2, "security", "gitleaks.toml"),
      "secret_scan gitleaks covering prompts tool_token agent_api_key\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "short-lived-agent-tokens"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "short-lived-agent-tokens", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct: 100,
        longLivedStaticApiKeysInPromptsOrConfig: 0,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.authnR1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "short-lived-agent-tokens"), {
      recursive: true,
    });
    writeFileSync(
      join(outFail, "imports", "short-lived-agent-tokens", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct: 100,
        longLivedStaticApiKeysInPromptsOrConfig: 3,
      }),
    );
    const rFail = await run(t2, outFail);
    if (
      rFail.summary.statusHint !== "fail" ||
      rFail.summary.authnR1Satisfied !== false
    ) {
      throw new Error(`fail expected: ${JSON.stringify(rFail.summary)}`);
    }

    const outExc = join(root, "o-exc");
    mkdirSync(join(outExc, "imports", "short-lived-agent-tokens"), {
      recursive: true,
    });
    writeFileSync(
      join(outExc, "imports", "short-lived-agent-tokens", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct: 100,
        longLivedStaticApiKeysInPromptsOrConfig: 0,
        ownedExceptionsWithin30Days: false,
      }),
    );
    const rExc = await run(t2, outExc);
    if (
      rExc.summary.statusHint !== "fail" ||
      rExc.summary.authnR1Satisfied !== false
    ) {
      throw new Error(
        `ownedExceptionsWithin30Days=false should fail: ${JSON.stringify(rExc.summary)}`,
      );
    }

    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });

    // Vacuous PASS: good metrics without present=true and without in-repo signals
    const outVacuous = join(root, "o-vacuous");
    mkdirSync(join(outVacuous, "imports", "short-lived-agent-tokens"), {
      recursive: true,
    });
    writeFileSync(
      join(outVacuous, "imports", "short-lived-agent-tokens", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct: 100,
        longLivedStaticApiKeysInPromptsOrConfig: 0,
      }),
    );
    const rVacuous = await run(tEmpty, outVacuous);
    if (
      rVacuous.summary.statusHint !== "partial" ||
      rVacuous.summary.authnR1Satisfied !== false
    ) {
      throw new Error(
        `metrics without present/signals must stay partial: ${JSON.stringify(rVacuous.summary)}`,
      );
    }

    const outPresent = join(root, "o-present");
    mkdirSync(join(outPresent, "imports", "short-lived-agent-tokens"), {
      recursive: true,
    });
    writeFileSync(
      join(outPresent, "imports", "short-lived-agent-tokens", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        agentToolCredentialsInProductionPromptsOrConfigPresent: true,
        agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct: 100,
        longLivedStaticApiKeysInPromptsOrConfig: 0,
      }),
    );
    const rPresent = await run(tEmpty, outPresent);
    if (
      rPresent.summary.statusHint !== "pass" ||
      rPresent.summary.authnR1Satisfied !== true
    ) {
      throw new Error(
        `present=true + metrics should pass: ${JSON.stringify(rPresent.summary)}`,
      );
    }

    // present=false must not N/A when in-repo secret-scan signals exist
    const outPresentFalse = join(root, "o-present-false");
    mkdirSync(join(outPresentFalse, "imports", "short-lived-agent-tokens"), {
      recursive: true,
    });
    writeFileSync(
      join(
        outPresentFalse,
        "imports",
        "short-lived-agent-tokens",
        "coverage.json",
      ),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        agentToolCredentialsInProductionPromptsOrConfigPresent: false,
        agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct: 100,
        longLivedStaticApiKeysInPromptsOrConfig: 0,
      }),
    );
    const rPresentFalse = await run(t2, outPresentFalse);
    if (rPresentFalse.summary.statusHint === "not_applicable") {
      throw new Error(
        `in-repo signals must override present=false N/A: ${JSON.stringify(rPresentFalse.summary)}`,
      );
    }
    if (
      rPresentFalse.summary.statusHint !== "pass" ||
      rPresentFalse.summary.authnR1Satisfied !== true
    ) {
      throw new Error(
        `present=false + in-repo signals + metrics should pass: ${JSON.stringify(rPresentFalse.summary)}`,
      );
    }

    // present=false + credentials inventory → inventory proves surface
    const outNaCreds = join(root, "o-na-creds");
    mkdirSync(join(outNaCreds, "imports", "short-lived-agent-tokens"), {
      recursive: true,
    });
    writeFileSync(
      join(outNaCreds, "imports", "short-lived-agent-tokens", "a-na.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        agentToolCredentialsInProductionPromptsOrConfigPresent: false,
      }),
    );
    writeFileSync(
      join(outNaCreds, "imports", "short-lived-agent-tokens", "b-creds.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        longLivedStaticApiKeysInPromptsOrConfig: 0,
        credentials: [{ ttlMinutes: 30 }, { ttlMinutes: 15 }],
      }),
    );
    const rNaCreds = await run(tEmpty, outNaCreds);
    if (rNaCreds.summary.statusHint === "not_applicable") {
      throw new Error(
        `credentials inventory must clear present=false N/A: ${JSON.stringify(rNaCreds.summary)}`,
      );
    }
    if (
      rNaCreds.summary.statusHint !== "pass" ||
      rNaCreds.importedResults
        .agentToolCredentialsInProductionPromptsOrConfigPresent !== true
    ) {
      throw new Error(
        `credentials should prove present and pass: ${JSON.stringify(rNaCreds.summary)}`,
      );
    }

    // TTL-only inventory clears stale ownedExceptionsWithin30Days=false
    const outTtlOwned = join(root, "o-ttl-owned");
    mkdirSync(join(outTtlOwned, "imports", "short-lived-agent-tokens"), {
      recursive: true,
    });
    writeFileSync(
      join(outTtlOwned, "imports", "short-lived-agent-tokens", "a-false.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        ownedExceptionsWithin30Days: false,
      }),
    );
    writeFileSync(
      join(outTtlOwned, "imports", "short-lived-agent-tokens", "b-creds.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        longLivedStaticApiKeysInPromptsOrConfig: 0,
        credentials: [{ ttlMinutes: 30 }, { ttlMinutes: 45 }],
      }),
    );
    const rTtlOwned = await run(tEmpty, outTtlOwned);
    if (
      rTtlOwned.summary.statusHint !== "pass" ||
      rTtlOwned.importedResults.ownedExceptionsWithin30Days === false
    ) {
      throw new Error(
        `TTL-only inventory must clear ownedExceptions=false: ${JSON.stringify(rTtlOwned.summary)} owned=${rTtlOwned.importedResults.ownedExceptionsWithin30Days}`,
      );
    }

    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "short-lived-agent-tokens"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "short-lived-agent-tokens", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        agentToolCredentialsInProductionPromptsOrConfigPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`n/a expected: ${JSON.stringify(rNa.summary)}`);
    }

    console.log("short-lived-agent-tokens smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
