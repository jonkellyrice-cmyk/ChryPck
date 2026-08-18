import { runNativeDiagnostics } from "../analysis/diagnostic-runner.js";
import type { AnalysisResult } from "../analysis/analyzer.js";
import type { RepositoryModel } from "../repository/model.js";
import { assessPropagation, type ProposedChange, type ChangePropagationReport } from "./change-propagation.js";
import { buildContextPack, type CorridorContextPack } from "./context-pack.js";
import { planPatchCorridor, type PatchCorridor } from "./patch-corridor.js";
import { planPatchStages, type PatchStagingPlan } from "./patch-staging.js";
import { planRuntimeProbes, type RuntimeProbePlan } from "./runtime-probes.js";

export interface NativePlanningRequest {
  readonly objective: string;
  readonly model: RepositoryModel;
  readonly proposedChanges?: readonly ProposedChange[];
  readonly maxFilesPerStage?: number;
}

export interface NativePlanningResult {
  readonly diagnostics: readonly AnalysisResult[];
  readonly corridor: PatchCorridor;
  readonly context: CorridorContextPack | null;
  readonly staging: PatchStagingPlan | null;
  readonly propagation: ChangePropagationReport | null;
  readonly runtimeProbes: RuntimeProbePlan;
}

export function runNativePlanning(request: NativePlanningRequest): NativePlanningResult {
  const diagnostics = runNativeDiagnostics(request.model);
  const corridor = planPatchCorridor(request.objective, request.model, { diagnostics });
  const context = corridor.certified ? buildContextPack(corridor, request.model) : null;
  const staging = corridor.certified ? planPatchStages(corridor, request.model, request.maxFilesPerStage ?? 1) : null;
  const propagation = request.proposedChanges ? assessPropagation(request.proposedChanges, request.model, corridor) : null;
  const runtimeProbes = planRuntimeProbes(corridor, request.model);
  return Object.freeze({ diagnostics, corridor, context, staging, propagation, runtimeProbes });
}
