import type { TraceResult } from "../analysis/trace.js";

export interface TraceHandoffReference {
  readonly run_id: string;
  readonly certificate_id?: string;
}

export interface TraceHandoffSource {
  readonly runId: string;
  readonly repository: string;
  readonly commitSha: string;
  readonly projectProfile: string;
  readonly trace: TraceResult | null;
}

export interface TraceHandoffExpectation {
  readonly repository: string;
  readonly commitSha: string;
  readonly projectProfile: string;
}

export interface TracePlanningHop {
  readonly file: string;
  readonly symbol: string;
  readonly line: number | null;
  readonly edgeType: string | null;
}

export interface CertifiedTracePlanningEvidence {
  readonly sourceRunId: string;
  readonly certificateId: string;
  readonly traceStatus: "CERTIFIED" | "BLOCKED";
  readonly entrypoint: TracePlanningHop;
  readonly path: readonly TracePlanningHop[];
  readonly evidenceIds: readonly string[];
  readonly firstBlocker: Readonly<{
    symbol: string;
    file: string;
    line: number;
    guardKind: string;
  }> | null;
  readonly terminalEffect: Readonly<{
    kind: string;
    symbol: string | null;
    file: string | null;
  }> | null;
}

function handoffError(message: string): never {
  throw new Error(`Trace handoff rejected: ${message}`);
}

function hopForTrace(hop: TraceResult["path"][number]): TracePlanningHop {
  return Object.freeze({
    file: hop.file,
    symbol: hop.symbol,
    line: hop.lineStart ?? null,
    edgeType: hop.edgeType ?? null
  });
}

/**
 * Convert an authoritative stored Trace artifact into bounded planning evidence.
 *
 * This function deliberately grants no mutation authority. It only proves that
 * the referenced Trace belongs to the same immutable repository state/profile
 * and has a usable certificate. A later Patch Corridor must independently
 * certify any file before it becomes mutable or eligible for exact-source
 * Context Pack expansion.
 */
export function validateTraceHandoff(
  reference: TraceHandoffReference,
  source: TraceHandoffSource,
  expected: TraceHandoffExpectation
): CertifiedTracePlanningEvidence {
  if (!reference.run_id.trim() || reference.run_id !== source.runId) {
    return handoffError("source run identifier does not match the stored Trace run");
  }
  if (source.repository !== expected.repository) {
    return handoffError("source Trace belongs to a different repository");
  }
  if (source.commitSha !== expected.commitSha) {
    return handoffError("source Trace belongs to a different immutable commit");
  }
  if (source.projectProfile !== expected.projectProfile) {
    return handoffError("source Trace belongs to a different project profile");
  }

  const trace = source.trace;
  if (!trace) return handoffError("source run has no persisted Trace artifact");
  if (trace.status !== "CERTIFIED" && trace.status !== "BLOCKED") {
    return handoffError(`Trace status ${trace.status} is not eligible for planning lineage`);
  }
  if (!trace.certificate) return handoffError("source Trace has no path certificate");
  if (trace.path.length === 0 || !trace.entrypoint) return handoffError("source Trace has no certifiable path");
  if (reference.certificate_id && reference.certificate_id !== trace.certificate.certificateId) {
    return handoffError("supplied certificate does not match the authoritative Trace certificate");
  }

  const path = Object.freeze(trace.path.map(hopForTrace));
  return Object.freeze({
    sourceRunId: source.runId,
    certificateId: trace.certificate.certificateId,
    traceStatus: trace.status,
    entrypoint: hopForTrace(trace.entrypoint),
    path,
    evidenceIds: Object.freeze(trace.evidence.map(record => record.id)),
    firstBlocker: trace.firstBlocker
      ? Object.freeze({
          symbol: trace.firstBlocker.symbol,
          file: trace.firstBlocker.file,
          line: trace.firstBlocker.line,
          guardKind: trace.firstBlocker.guardKind
        })
      : null,
    terminalEffect: trace.terminalEffect
      ? Object.freeze({
          kind: trace.terminalEffect.kind,
          symbol: trace.terminalEffect.symbol ?? null,
          file: trace.terminalEffect.file ?? null
        })
      : null
  });
}
