/**
 * Shared types for APRF Auditor collectors.
 * Emits nodes compatible with evidence-graph.schema.json.
 */

export type EvidenceClass =
  | "runtime"
  | "ci"
  | "iac"
  | "runtime-config"
  | "policy"
  | "code"
  | "docs"
  | "user";

export type CollectorStatus = "ran" | "skipped" | "failed" | "needs-user";

export interface EvidenceNode {
  id: string;
  class: EvidenceClass;
  ref: string;
  excerpt?: string;
  pluginId: string;
  lastModified?: string;
  gitCommit?: string;
  buildId?: string;
  evidenceAgeDays?: number | null;
  relatedCheckIds?: string[];
  signals?: string[];
}

export interface CollectorResult {
  pluginId: string;
  status: CollectorStatus;
  detail?: string;
  nodes: EvidenceNode[];
}

export interface CollectorContext {
  targetPath: string;
  outputDir: string;
  assessedAt: Date;
  gitCommit?: string;
  /** When true, collectors may call external APIs if credentials exist. */
  live: boolean;
  /** Limit filesystem walk depth / file count for determinism + speed */
  maxFiles?: number;
  /**
   * Optional base URL for live HTTP probes (http-auth-probe / AUTHN-M1).
   * Also accepted via APRF_AUTH_PROBE_BASE_URL.
   */
  baseUrl?: string;
  /**
   * Optional admin bearer token for live config fetch (mcp-s2s-inventory / AUTHN-M2).
   * Also accepted via APRF_ADMIN_TOKEN.
   */
  adminToken?: string;
  /** Optional admin email for password login (obtains token). APRF_ADMIN_EMAIL. */
  adminEmail?: string;
  /** Optional admin password for password login. APRF_ADMIN_PASSWORD — never log/persist. */
  adminPassword?: string;
  /**
   * Optional limited (non-admin) principal for AUTHZ-M1 live denial probes.
   * APRF_AUTHZ_LIMITED_EMAIL / APRF_AUTHZ_LIMITED_PASSWORD / APRF_AUTHZ_LIMITED_TOKEN.
   */
  limitedEmail?: string;
  limitedPassword?: string;
  limitedToken?: string;
}

export interface Collector {
  id: string;
  collect(ctx: CollectorContext): Promise<CollectorResult>;
}

export interface EvidenceGraph {
  schemaVersion: "0.2.0";
  assessedAt: string;
  subject: {
    path: string;
    name: string;
    gitCommit?: string;
  };
  collectors: Array<{
    pluginId: string;
    status: CollectorStatus;
    detail?: string;
  }>;
  nodes: EvidenceNode[];
  edges: Array<{ from: string; to: string; rel: string }>;
}
