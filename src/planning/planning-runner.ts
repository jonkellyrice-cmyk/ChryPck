import { NATIVE_ANALYZERS, runNativeDiagnostics } from "../analysis/diagnostic-runner.js";
import type { AnalysisResult, Analyzer } from "../analysis/analyzer.js";
import type { RepositoryModel } from "../repository/model.js";
import { assessPropagation, type ProposedChange, type ChangePropagationReport } from "./change-propagation.js";
import { buildContextPack, type CorridorContextPack } from "./context-pack.js";
import { planPatchCorridor, type PatchCorridor } from "./patch-corridor.js";
import { planPatchStages, type PatchStagingPlan } from "./patch-staging.js";
import { planRuntimeProbes, type RuntimeProbePlan } from "./runtime-probes.js";
import type { CertifiedTracePlanningEvidence } from "./trace-handoff.js";
import type { ContractMap } from "../repository/contract-types.js";
import { reconcileContractMap } from "../analysis/contract-reconciliation.js";

export interface NativeContractRecord {
  readonly id: string;
  readonly source: string;
  readonly data: unknown;
}

export interface NativePlanningExtensions {
  readonly additionalAnalyzers?: readonly Analyzer[];
  readonly runtimeProbePlanner?: (corridor: PatchCorridor, model: RepositoryModel) => RuntimeProbePlan;
  readonly nativeContractProvider?: (model: RepositoryModel) => readonly NativeContractRecord[];
}

export interface NativePlanningRequest {
  readonly objective: string;
  readonly model: RepositoryModel;
  readonly proposedChanges?: readonly ProposedChange[];
  readonly traceEvidence?: CertifiedTracePlanningEvidence;
  readonly maxFilesPerStage?: number;
  readonly extensions?: NativePlanningExtensions;
}

export interface NativePlanningResult {
  readonly diagnostics: readonly AnalysisResult[];
  readonly corridor: PatchCorridor;
  readonly context: CorridorContextPack | null;
  readonly staging: PatchStagingPlan | null;
  readonly propagation: ChangePropagationReport | null;
  readonly runtimeProbes: RuntimeProbePlan;
  readonly nativeContracts: readonly NativeContractRecord[];
  readonly traceEvidence: CertifiedTracePlanningEvidence | null;
  readonly contractMap: ContractMap;
}

function analyzersFor(extensions: NativePlanningExtensions | undefined): readonly Analyzer[] {
  const output = new Map<string, Analyzer>();
  for (const analyzer of [...NATIVE_ANALYZERS, ...(extensions?.additionalAnalyzers ?? [])]) output.set(analyzer.name, analyzer);
  return Object.freeze([...output.values()]);
}

export function runNativePlanning(request: NativePlanningRequest): NativePlanningResult {
  const nativeContracts = Object.freeze([...(request.extensions?.nativeContractProvider?.(request.model) ?? [])]);
  const contractMap = reconcileContractMap(request.model.contractMap, nativeContracts);
  const diagnosticModel = Object.freeze({ ...request.model, contractMap });
  const diagnostics = runNativeDiagnostics(diagnosticModel, analyzersFor(request.extensions));
  const corridor = planPatchCorridor(request.objective, request.model, {
    diagnostics,
    traceEvidence: request.traceEvidence,
    contractMap
  });
  const planningModel = Object.freeze({ ...request.model, contractMap });
  const context = corridor.certified ? buildContextPack(corridor, planningModel) : null;
  const staging = corridor.certified ? planPatchStages(corridor, request.model, request.maxFilesPerStage ?? 1) : null;
  const propagation = request.proposedChanges ? assessPropagation(request.proposedChanges, planningModel, corridor) : null;
  const runtimeProbes = request.extensions?.runtimeProbePlanner?.(corridor, request.model) ?? planRuntimeProbes(corridor, request.model);
  return Object.freeze({
    diagnostics,
    corridor,
    context,
    staging,
    propagation,
    runtimeProbes,
    nativeContracts,
    traceEvidence: request.traceEvidence ?? null,
    contractMap
  });
}
