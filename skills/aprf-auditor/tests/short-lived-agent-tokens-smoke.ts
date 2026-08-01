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

    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
