import type { Collector } from "./types.ts";
import { repoFilesystemCollector } from "./repo-filesystem.ts";
import { githubActionsCollector } from "./github-actions.ts";
import { otelCollector } from "./otel.ts";
import { promptfooCollector } from "./promptfoo.ts";
import { httpAuthProbeCollector } from "./http-auth-probe.ts";
import { mcpS2sInventoryCollector } from "./mcp-s2s-inventory.ts";
import { authzEntryTestsCollector } from "./authz-entry-tests.ts";
import { crossTenantTestsCollector } from "./cross-tenant-tests.ts";
import { secretsHygieneCollector } from "./secrets-hygiene.ts";
import { secretRedactionCollector } from "./secret-redaction.ts";
import { injectionPolicyGateCollector } from "./injection-policy-gate.ts";
import {
  awsCollector,
  azureCollector,
  gcpCollector,
} from "./iac-cloud.ts";
import { importIngestCollector, customImportCollector } from "./import-ingest.ts";

/** Collectors with real TypeScript executors (local and/or import ingest). */
export const COLLECTORS: Collector[] = [
  repoFilesystemCollector,
  githubActionsCollector,
  otelCollector,
  promptfooCollector,
  httpAuthProbeCollector,
  mcpS2sInventoryCollector,
  authzEntryTestsCollector,
  crossTenantTestsCollector,
  secretsHygieneCollector,
  secretRedactionCollector,
  injectionPolicyGateCollector,
  awsCollector,
  azureCollector,
  gcpCollector,
  // Export-only runtime plugins (drop files under imports/<id>/)
  importIngestCollector("langsmith"),
  importIngestCollector("phoenix"),
  importIngestCollector("helicone"),
  importIngestCollector("wandb"),
  importIngestCollector("prometheus"),
  importIngestCollector("grafana"),
  importIngestCollector("cloudwatch"),
  // Out-of-plugin customer evidence
  customImportCollector,
];

export function getCollector(id: string): Collector | undefined {
  return COLLECTORS.find((c) => c.id === id);
}
