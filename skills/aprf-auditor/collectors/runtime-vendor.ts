/**
 * Local + import collectors for vendor observability / eval platforms.
 * Repo scan finds SDK/config wiring (runtime-config / iac); measured runtime
 * evidence still comes from imports/<id>/.
 */
import type { Collector } from "./types.ts";
import { repoImportCollector } from "./lib/repo-import-collector.ts";

const SRC_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".env"];

/** Env-style PREFIX_… — `_` is a word char, so do not use trailing `\b` after `_`. */
const ENV_PREFIX = (p: string) => `(?:^|[^A-Za-z0-9_])${p}[A-Za-z0-9_]+`;

export const langsmithCollector: Collector = repoImportCollector({
  id: "langsmith",
  pathHints: [
    "langsmith",
    "langfuse",
    "langchain",
    ".env",
    "package.json",
    "pyproject",
    "requirements",
    "poetry.lock",
  ],
  contentPattern: new RegExp(
    `\\b(?:langsmith|langfuse|LangSmith|Langfuse)\\b|${ENV_PREFIX("LANGSMITH_")}|${ENV_PREFIX("LANGFUSE_")}`,
    "i",
  ),
  contentScanExtensions: SRC_EXTS,
  signals: ["llm-trace", "tool-call", "prompt-version"],
  relatedCheckIds: ["OBS-M1", "OBS-R4", "PRM-M1", "TOL-M1", "SEC-M1"],
  evidenceClass: "runtime-config",
  emptyDetail:
    "No LangSmith/Langfuse SDK or config in repo and no imports/langsmith/ — drop a trace export to demonstrate runtime evidence",
});

export const phoenixCollector: Collector = repoImportCollector({
  id: "phoenix",
  pathHints: [
    "phoenix",
    "arize",
    "package.json",
    "pyproject",
    "requirements",
    "poetry.lock",
  ],
  contentPattern: new RegExp(
    [
      String.raw`\b(?:@arizeai/phoenix(?:-otel)?|arize[_-]?phoenix|phoenix\.otel)\b`,
      String.raw`\bfrom\s+phoenix(?:\.otel)?\s+import\b`,
      String.raw`\bimport\s+phoenix(?:\.otel)?\b`,
      ENV_PREFIX("PHOENIX_"),
      ENV_PREFIX("ARIZE_"),
    ].join("|"),
    "i",
  ),
  contentScanExtensions: SRC_EXTS,
  signals: ["eval-run", "trace"],
  relatedCheckIds: ["EVL-M1", "OBS-M1", "SEC-M1"],
  evidenceClass: "runtime-config",
  emptyDetail:
    "No Arize Phoenix config in repo and no imports/phoenix/ — provide a span/eval export",
});

export const wandbCollector: Collector = repoImportCollector({
  id: "wandb",
  pathHints: ["wandb", "package.json", "pyproject", "requirements", ".wandb"],
  contentPattern: new RegExp(
    String.raw`\b(?:wandb\.|import\s+wandb|from\s+wandb|weights[\s_-]?and[\s_-]?biases)\b|` +
      ENV_PREFIX("WANDB_"),
    "i",
  ),
  contentScanExtensions: SRC_EXTS,
  signals: ["experiment", "eval", "model-version"],
  relatedCheckIds: ["MOD-M1", "MOD-R4", "EVL-M1"],
  evidenceClass: "runtime-config",
  emptyDetail:
    "No W&B init/config in repo and no imports/wandb/ — drop a run summary export",
});

export const heliconeCollector: Collector = repoImportCollector({
  id: "helicone",
  pathHints: [
    "helicone",
    ".env",
    "package.json",
    "pyproject",
    "requirements",
    "proxy",
  ],
  contentPattern: new RegExp(
    String.raw`\b(?:helicone|Helicone-Auth|gateway\.helicone)\b|` +
      ENV_PREFIX("HELICONE_"),
    "i",
  ),
  contentScanExtensions: SRC_EXTS,
  signals: ["request-log", "cost", "cache"],
  relatedCheckIds: ["OBS-M1", "COST-M1", "COST-M2"],
  evidenceClass: "runtime-config",
  emptyDetail:
    "No Helicone proxy/config in repo and no imports/helicone/ — drop a request-log export",
});

export const prometheusCollector: Collector = repoImportCollector({
  id: "prometheus",
  pathHints: [
    "prometheus",
    "alertmanager",
    "recording",
    "servicemonitor",
    "podmonitor",
  ],
  contentPattern:
    /\b(?:scrape_configs|alerting_rules|recording_rules|PrometheusRule|ServiceMonitor|histogram_quantile)\b|(?:^|[^A-Za-z0-9_])(?:llm_|token_|prompt_)[A-Za-z0-9_]+/i,
  signals: ["metric", "alert-rule"],
  relatedCheckIds: ["OBS-M1", "PERF-M1", "COST-M2"],
  evidenceClass: "runtime-config",
  extensions: [".yml", ".yaml", ".json", ".toml", ".tf"],
  emptyDetail:
    "No Prometheus scrape/alert rules in repo and no imports/prometheus/ — provide rules or a metrics snapshot",
});

export const grafanaCollector: Collector = repoImportCollector({
  id: "grafana",
  pathHints: ["grafana", "dashboards", "dashboard"],
  // Require a Grafana marker — not bare panels/schemaVersion (other dashboard formats).
  contentPattern:
    /(?:\bgrafana\b|"__inputs"\s*:|"editable"\s*:\s*(?:true|false)\s*,[\s\S]{0,200}"panels"\s*:|"timezone"\s*:\s*"[^"]*"\s*,[\s\S]{0,200}"schemaVersion"\s*:|"schemaVersion"\s*:\s*\d+[\s\S]{0,400}"panels"\s*:)/i,
  contentScanExtensions: [".json", ".yml", ".yaml"],
  signals: ["dashboard", "slo"],
  relatedCheckIds: ["OBS-M1", "PERF-M1", "COST-M1"],
  evidenceClass: "runtime-config",
  extensions: [".json", ".yml", ".yaml", ".tf"],
  emptyDetail:
    "No Grafana dashboard-as-code in repo and no imports/grafana/ — provide dashboards covering LLM/tool/cost SLOs",
});

export const cloudwatchCollector: Collector = repoImportCollector({
  id: "cloudwatch",
  pathHints: ["cloudwatch", "cw_", "monitoring", "alarms", "cdk", "serverless"],
  // Prefer IaC resource types; avoid bare SDK method names that match app code.
  contentPattern:
    /(?:\baws_cloudwatch(?:_metric_alarm|_log_group)?\b|\bcloudwatch_(?:metric_alarm|log_group)\b|AWS::CloudWatch::(?:Alarm|LogGroup)|\baws_cloudwatch_log_group\b|\bCfnAlarm\b|\bCfnLogGroup\b|\blogs\.CreateLogGroup\b)/i,
  contentScanExtensions: [".tf", ".json", ".yml", ".yaml", ".ts", ".py", ".bicep"],
  signals: ["alarm", "log-group"],
  relatedCheckIds: ["OBS-M1", "INC-M1", "COST-M2"],
  evidenceClass: (relPath) =>
    /\.(?:tf|bicep)$/i.test(relPath) ||
    /(?:^|\/)(?:infra|terraform|cdk|cloudformation|pulumi|bicep|templates)\//i.test(
      relPath,
    )
      ? "iac"
      : "runtime-config",
  extensions: [".tf", ".json", ".yml", ".yaml", ".ts", ".py", ".bicep"],
  emptyDetail:
    "No CloudWatch alarm/log definitions in repo and no imports/cloudwatch/ — provide IaC or an export",
});
