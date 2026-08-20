import type { TraceResult } from "../../analysis/trace.js";
import type { NativePlanningResult } from "../../planning/planning-runner.js";
import type { ChangePropagationReport } from "../../planning/change-propagation.js";
import type { MutationTransaction } from "../../mutation/transaction.js";
import type { NativeValidationReport } from "../../validation/validation-runner.js";
import type { NativeFailureEvidence } from "./failure-evidence.js";

export interface NativeRunArtifacts {
  planning: NativePlanningResult | null;
  trace: TraceResult | null;
  mutation: MutationTransaction | null;
  propagation: ChangePropagationReport | null;
  validation: NativeValidationReport | null;
  failure: NativeFailureEvidence | null;
}

export function createNativeRunArtifacts(): NativeRunArtifacts {
  return {
    planning: null,
    trace: null,
    mutation: null,
    propagation: null,
    validation: null,
    failure: null
  };
}

export function summarizeRunArtifacts(artifacts: NativeRunArtifacts): Readonly<Record<string, unknown>> {
  return Object.freeze({
    corridorCertified: artifacts.planning?.corridor.certified ?? null,
    contextSegments: artifacts.planning?.context?.segments.length ?? null,
    traceStatus: artifacts.trace?.status ?? null,
    traceCertificateId: artifacts.trace?.certificate?.certificateId ?? null,
    tracePathLength: artifacts.trace?.path.length ?? null,
    mutationState: artifacts.mutation?.state ?? null,
    changedPaths: artifacts.mutation?.staged.changedPaths ?? [],
    propagationCertified: artifacts.propagation?.certified ?? null,
    validationPassed: artifacts.validation?.passed ?? null,
    failureStage: artifacts.failure?.failed_stage ?? null
  });
}
