import type { DataflowSliceResult } from "../analysis/dataflow-slice.js";
import type { TraceResult } from "../analysis/trace.js";
import { validateTraceHandoff, type CertifiedTracePlanningEvidence, type TraceHandoffExpectation } from "./trace-handoff.js";

export interface AnalysisHandoffReference {
  readonly run_id: string;
  readonly artifact_id?: string;
}

export interface AnalysisHandoffSource {
  readonly runId: string;
  readonly repository: string;
  readonly commitSha: string;
  readonly projectProfile: string;
  readonly trace: TraceResult | null;
  readonly dataflowSlice: DataflowSliceResult | null;
}

export interface CertifiedDataflowPlanningNode {
  readonly id: string;
  readonly file: string;
  readonly symbol: string;
  readonly kind: string;
  readonly line: number;
}

export interface CertifiedDataflowPlanningEvidence {
  readonly sourceRunId: string;
  readonly certificateId: string;
  readonly sliceStatus: "CERTIFIED" | "PARTIAL";
  readonly direction: DataflowSliceResult["direction"];
  readonly criterion: CertifiedDataflowPlanningNode;
  readonly nodes: readonly CertifiedDataflowPlanningNode[];
  readonly edgeIds: readonly string[];
  readonly sourceNodeIds: readonly string[];
  readonly sinkNodeIds: readonly string[];
  readonly unresolvedNodeIds: readonly string[];
}

export type CertifiedAnalysisPlanningEvidence =
  | Readonly<{ kind: "trace"; trace: CertifiedTracePlanningEvidence }>
  | Readonly<{ kind: "dataflow-slice"; dataflow: CertifiedDataflowPlanningEvidence }>;

function rejected(message: string): never { throw new Error(`Analysis handoff rejected: ${message}`); }
function planningNode(node: DataflowSliceResult["nodes"][number]): CertifiedDataflowPlanningNode {
  return Object.freeze({ id: node.id, file: node.file, symbol: node.symbol, kind: node.kind, line: node.lineStart });
}

export function validateAnalysisHandoff(reference: AnalysisHandoffReference, source: AnalysisHandoffSource, expected: TraceHandoffExpectation): CertifiedAnalysisPlanningEvidence {
  if (!reference.run_id.trim() || reference.run_id !== source.runId) rejected("source run identifier does not match the stored analysis run");
  if (source.repository !== expected.repository) rejected("source analysis belongs to a different repository");
  if (source.commitSha !== expected.commitSha) rejected("source analysis belongs to a different immutable commit");
  if (source.projectProfile !== expected.projectProfile) rejected("source analysis belongs to a different project profile");

  if (source.dataflowSlice) {
    const slice = source.dataflowSlice;
    if (slice.status !== "CERTIFIED" && slice.status !== "PARTIAL") rejected(`Dataflow Slice status ${slice.status} is not eligible for planning lineage`);
    if (!slice.certificate || !slice.criterion || slice.nodes.length === 0) rejected("source Dataflow Slice has no certifiable artifact");
    if (reference.artifact_id && reference.artifact_id !== slice.certificate.certificateId) rejected("supplied artifact does not match the authoritative Dataflow Slice certificate");
    return Object.freeze({ kind: "dataflow-slice" as const, dataflow: Object.freeze({
      sourceRunId: source.runId,
      certificateId: slice.certificate.certificateId,
      sliceStatus: slice.status,
      direction: slice.direction,
      criterion: planningNode(slice.criterion),
      nodes: Object.freeze(slice.nodes.map(planningNode)),
      edgeIds: Object.freeze(slice.edges.map(edge => edge.id)),
      sourceNodeIds: slice.sources,
      sinkNodeIds: slice.sinks,
      unresolvedNodeIds: Object.freeze(slice.unresolvedFrontier.map(frontier => frontier.nodeId))
    }) });
  }
  if (source.trace) {
    const trace = validateTraceHandoff(
      { run_id: reference.run_id, ...(reference.artifact_id ? { certificate_id: reference.artifact_id } : {}) },
      { runId: source.runId, repository: source.repository, commitSha: source.commitSha, projectProfile: source.projectProfile, trace: source.trace },
      expected
    );
    return Object.freeze({ kind: "trace" as const, trace });
  }
  return rejected("source run has no persisted focused-analysis artifact");
}
