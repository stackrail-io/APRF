/**
 * Smoke: vendor obs collectors scan repo config + ingest imports/.
 */
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  langsmithCollector,
  phoenixCollector,
  wandbCollector,
  heliconeCollector,
  prometheusCollector,
  grafanaCollector,
  cloudwatchCollector,
} from "../collectors/runtime-vendor.ts";
import type { CollectorContext } from "../collectors/types.ts";

function ctx(target: string, outDir: string): CollectorContext {
  return {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    live: false,
    maxFiles: 2000,
  };
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-runtime-vendor-"));
  try {
    const empty = join(root, "empty");
    mkdirSync(empty, { recursive: true });
    const rEmpty = await langsmithCollector.collect(
      ctx(empty, join(root, "o-empty")),
    );
    if (rEmpty.status !== "needs-user" || rEmpty.nodes.length !== 0) {
      throw new Error(`empty langsmith unexpected: ${JSON.stringify(rEmpty)}`);
    }

    // Env-only wiring (underscore prefix must match LANGSMITH_API_KEY).
    const envOnly = join(root, "env-only");
    mkdirSync(envOnly, { recursive: true });
    writeFileSync(join(envOnly, ".env"), "LANGSMITH_API_KEY=sk-test\n");
    const envHit = await langsmithCollector.collect(
      ctx(envOnly, join(root, "o-env")),
    );
    if (envHit.status !== "ran" || envHit.nodes.length < 1) {
      throw new Error(`LANGSMITH_API_KEY miss: ${JSON.stringify(envHit)}`);
    }

    const t = join(root, "app");
    mkdirSync(join(t, "src"), { recursive: true });
    mkdirSync(join(t, "ops"), { recursive: true });
    mkdirSync(join(t, "ops", "prometheus"), { recursive: true });
    mkdirSync(join(t, "ops", "grafana"), { recursive: true });
    mkdirSync(join(t, "infra"), { recursive: true });
    mkdirSync(join(t, "lib"), { recursive: true });
    mkdirSync(join(t, "dashboards"), { recursive: true });
    writeFileSync(
      join(t, "src", "tracing.ts"),
      'export const x = 1; process.env.LANGSMITH_API_KEY; import { Client } from "langsmith";\n',
    );
    writeFileSync(
      join(t, "src", "phoenix_setup.py"),
      "from phoenix.otel import register\nregister()\n",
    );
    writeFileSync(
      join(t, "src", "train.py"),
      "import wandb\nwandb.init(project='aprf')\n",
    );
    writeFileSync(
      join(t, "src", "proxy.ts"),
      'const base = "https://gateway.helicone.ai";\nprocess.env.HELICONE_API_KEY;\n',
    );
    writeFileSync(
      join(t, "src", "cw_sdk.ts"),
      'import { CloudWatch } from "aws-sdk";\nnew CloudWatch().putMetricAlarm({ AlarmName: "x" });\n',
    );
    writeFileSync(
      join(t, "lib", "monitoring-stack.ts"),
      'import { CfnAlarm } from "aws-cdk-lib/aws-cloudwatch";\nnew CfnAlarm(this, "A", {} as never);\n',
    );
    writeFileSync(
      join(t, "ops", "prometheus", "rules.yml"),
      "groups:\n  - name: llm\n    rules:\n      - record: llm:latency:p99\n        expr: histogram_quantile(0.99, token_latency_bucket)\n",
    );
    // Path lacks prometheus hints — contentScanExtensions must still find it.
    writeFileSync(
      join(t, "ops", "alerts.yaml"),
      "apiVersion: monitoring.coreos.com/v1\nkind: PrometheusRule\nmetadata:\n  name: llm\n",
    );
    writeFileSync(
      join(t, "ops", "cfn-logs.json"),
      JSON.stringify({
        Resources: {
          AiLogs: { Type: "AWS::Logs::LogGroup", Properties: { LogGroupName: "/ai" } },
        },
      }),
    );
    // dashboard in filename, not under grafana/ — must still match Grafana JSON shape.
    writeFileSync(
      join(t, "ops", "llm-dashboard.json"),
      JSON.stringify({
        title: "LLM SLO",
        schemaVersion: 38,
        panels: [{ title: "token latency", datasource: "prometheus" }],
      }),
    );
    // Non-Grafana dashboard under dashboards/ — must NOT match.
    writeFileSync(
      join(t, "dashboards", "metabase.json"),
      JSON.stringify({
        name: "Metabase export",
        panels: [{ id: 1 }],
        datasource: "postgres",
      }),
    );
    writeFileSync(
      join(t, "infra", "cloudwatch.tf"),
      'resource "aws_cloudwatch_metric_alarm" "llm_errors" {\n  alarm_name = "llm-errors"\n}\n',
    );
    mkdirSync(join(t, "vendor", "phoenix-db"), { recursive: true });
    writeFileSync(join(t, "vendor", "phoenix-db", "README.md"), "# Apache\n");

    const out = join(root, "out");
    mkdirSync(join(out, "imports", "langsmith"), { recursive: true });
    writeFileSync(
      join(out, "imports", "langsmith", "traces.json"),
      JSON.stringify([{ id: "t1", name: "tool-call" }]),
    );

    const ls = await langsmithCollector.collect(ctx(t, out));
    if (ls.status !== "ran" || ls.nodes.length < 2) {
      throw new Error(`langsmith hybrid unexpected: ${JSON.stringify(ls)}`);
    }
    const lsImport = ls.nodes.find((n) => n.id.includes(":import:"));
    const lsRepo = ls.nodes.find((n) => n.id.includes(":repo:"));
    if (!lsImport) throw new Error("langsmith missing import node");
    if (!lsRepo) throw new Error("langsmith missing repo node");
    if (lsRepo.class !== "runtime-config") {
      throw new Error(
        `langsmith repo class should be runtime-config, got ${lsRepo.class}`,
      );
    }
    if (lsImport.class !== "runtime") {
      throw new Error(
        `langsmith import class should be runtime, got ${lsImport.class}`,
      );
    }
    if (!lsImport.relatedCheckIds?.includes("OBS-M1")) {
      throw new Error("langsmith import missing relatedCheckIds");
    }

    const ph = await phoenixCollector.collect(ctx(t, join(root, "o-ph")));
    if (
      ph.status !== "ran" ||
      !ph.nodes.some((n) => n.ref.includes("phoenix_setup"))
    ) {
      throw new Error(`phoenix.otel miss: ${JSON.stringify(ph)}`);
    }
    if (ph.nodes.some((n) => n.ref.includes("phoenix-db"))) {
      throw new Error("phoenix path-only false positive");
    }

    const wb = await wandbCollector.collect(ctx(t, join(root, "o-wb")));
    if (wb.status !== "ran" || !wb.nodes.some((n) => n.ref.includes("train.py"))) {
      throw new Error(`wandb miss: ${JSON.stringify(wb)}`);
    }
    if (wb.nodes.some((n) => n.class !== "runtime-config")) {
      throw new Error("wandb repo nodes must be runtime-config");
    }

    const hc = await heliconeCollector.collect(ctx(t, join(root, "o-hc")));
    if (hc.status !== "ran" || !hc.nodes.some((n) => n.ref.includes("proxy.ts"))) {
      throw new Error(`helicone miss: ${JSON.stringify(hc)}`);
    }

    const prom = await prometheusCollector.collect(
      ctx(t, join(root, "o-prom")),
    );
    if (
      prom.status !== "ran" ||
      !prom.nodes.some((n) => n.ref.includes("alerts.yaml"))
    ) {
      throw new Error(`prometheus content-scan miss: ${JSON.stringify(prom)}`);
    }

    const graf = await grafanaCollector.collect(ctx(t, join(root, "o-graf")));
    if (
      graf.status !== "ran" ||
      !graf.nodes.some((n) => n.ref.includes("llm-dashboard.json"))
    ) {
      throw new Error(`grafana dashboard path miss: ${JSON.stringify(graf)}`);
    }
    if (graf.nodes.some((n) => n.ref.includes("metabase"))) {
      throw new Error("grafana false positive on non-Grafana panels JSON");
    }

    const cw = await cloudwatchCollector.collect(ctx(t, join(root, "o-cw")));
    if (cw.status !== "ran" || cw.nodes.length < 1) {
      throw new Error(`cloudwatch unexpected: ${JSON.stringify(cw)}`);
    }
    if (!cw.nodes.some((n) => n.class === "iac" && n.ref.endsWith(".tf"))) {
      throw new Error("cloudwatch expected iac class from TF");
    }
    if (cw.nodes.some((n) => n.ref.includes("cw_sdk.ts"))) {
      throw new Error("cloudwatch should not emit bare SDK putMetricAlarm hits");
    }
    const cdkNode = cw.nodes.find((n) => n.ref.includes("monitoring-stack.ts"));
    if (!cdkNode || cdkNode.class !== "iac") {
      throw new Error(`cloudwatch CDK CfnAlarm should be iac: ${JSON.stringify(cdkNode)}`);
    }
    if (!cw.nodes.some((n) => n.ref.includes("cfn-logs.json") && n.class === "iac")) {
      throw new Error("cloudwatch AWS::Logs::LogGroup miss");
    }

    console.log("aprf-auditor runtime-vendor smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
