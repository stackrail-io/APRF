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
