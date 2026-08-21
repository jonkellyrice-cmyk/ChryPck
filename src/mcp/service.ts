import { createHash } from "node:crypto";
import type { RepositoryAdapter } from "../repository/adapter.js";
import { buildRepositoryModel } from "../repository/model-builder.js";
import { buildRepositoryOrientation, type RepositoryOrientation } from "../repository/repository-atlas.js";
import { runNativePlanning, type NativePlanningResult } from "../planning/planning-runner.js";
import { buildContextPack } from "../planning/context-pack.js";
import { planPatchStages } from "../planning/patch-staging.js";
import { planRuntimeProbes } from "../planning/runtime-probes.js";
import { validateTraceHandoff, type CertifiedTracePlanningEvidence } from "../planning/trace-handoff.js";
import { createStructuralValidator } from "../validation/structural-validator.js";
import { buildValidationCommandPlan } from "../validation/command-plan.js";
import { DisabledSandboxRunner, type SandboxRunner } from "../validation/sandbox-runner.js";
import { executeNativeRepositoryRun } from "../core/run/repository-execution.js";
import { NativeOrchestrator } from "../core/run/orchestrator.js";
import { summarizeRunArtifacts } from "../core/run/run-artifacts.js";
import type { ProjectProfileRegistry } from "../project/registry.js";
import type { ProjectProfile } from "../project/profile.js";
import { architectureCorridor, planArchitecture, type ArchitecturePlan } from "../architecture/index.js";
import { analyzeTrace, type TraceResult } from "../analysis/trace.js";
import { analyzeDataflowSlice, type DataflowSliceResult } from "../analysis/dataflow-slice.js";
import { buildDataflowGraph } from "../analysis/dataflow-linker.js";
import { validateAnalysisHandoff, type CertifiedAnalysisPlanningEvidence } from "../planning/analysis-handoff.js";
import type { AuthoringIntent } from "../mutation/authoring-compiler.js";
import { InMemorySemanticAtlasCache, semanticAtlasCacheKey, type SemanticAtlasCache } from "../semantic/cache.js";
import {
  DEFAULT_SEMANTIC_BOOTSTRAP_REGIONS_PER_CHUNK,
  SemanticBootstrapCoordinator,
  type SemanticBootstrapSessionStore
} from "../semantic/bootstrap.js";
import { DEFAULT_SEMANTIC_MAX_REGIONS } from "../semantic/region-builder.js";
import { prepareSemanticAtlas } from "../semantic/semantic-atlas.js";
import { mergeSemanticOrientation, pendingSemanticExpansion, scopeSemanticOrientation } from "../semantic/expansion.js";
import type { SemanticBootstrapChunk, SemanticCoverageLedger, SemanticOrientation } from "../semantic/types.js";
import type { PlanInput, ContextInput, ExecuteInput, ResultInput } from "./schemas.js";
import {
  projectContextContinuation,
  projectContextIndexSegment,
  projectContextSourceSegment,
  projectDiagnosticMaps,
  projectNativeContractMaps,
  projectCompactResponse
} from "./response-projection.js";
import { projectContractMap } from "./contract-map-projection.js";
import { projectEffectRuntimeAtlas } from "./effect-runtime-projection.js";
import { projectDataflowSlice } from "./dataflow-slice-projection.js";

export interface NativeMcpServiceOptions {
  readonly allowedRepositories: ReadonlySet<string>;
  readonly defaultTargetRef: string;
  readonly maxMutationFileBytes: number;
  readonly projectProfiles: ProjectProfileRegistry;
  readonly sandboxRunner?: SandboxRunner;
  readonly semanticMaxRegions?: number;
  readonly semanticRegionsPerChunk?: number;
  readonly semanticCacheEntries?: number;
  readonly semanticAtlasCache?: SemanticAtlasCache;
  readonly semanticBootstrapStore?: SemanticBootstrapSessionStore;
}

function responseForMode(responseMode: "compact" | "full" | undefined, response: Readonly<Record<string, any>>) {
  return responseMode === "compact" ? projectCompactResponse(response) : response;
}

interface RunBinding {
  readonly targetRef: string;
  readonly baseCommitSha: string;
  readonly profileId: string;
  readonly architecturePlan: ArchitecturePlan | null;
  readonly allowedNewPaths: readonly string[];
  readonly orientation: RepositoryOrientation;
  readonly semanticOrientation: SemanticOrientation;
  readonly traceHandoff: CertifiedTracePlanningEvidence | null;
  readonly analysisHandoff: CertifiedAnalysisPlanningEvidence | null;
}

function repositoryName(value: string): string {
  const normalized = value.trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  if (!/^[^/\s]+\/[^/\s]+$/.test(normalized)) throw new Error(`Repository must be owner/name: ${value}`);
  return normalized;
}

function requestId(input: PlanInput): string {
  return `native-${createHash("sha256")
    .update(JSON.stringify({
      objective: input.objective.trim(),
      architecture: input.architecture ?? null,
      analysis: input.analysis ?? null,
      trace_handoff: input.trace_handoff ?? null
      ,analysis_handoff: input.analysis_handoff ?? null
    }))
    .digest("hex")
    .slice(0, 12)}`;
}

function architecturePaths(input: PlanInput): string[] {
  if (input.architecture?.kind === "move") {
    return [...new Set(input.architecture.moves.flatMap(move => [move.from, move.to]))].sort();
  }
  if (input.architecture?.kind === "decompose") return [...new Set(input.architecture.paths ?? [])].sort();
  return [];
}

function requestForPlan(input: PlanInput): Record<string, unknown> {
  const goal = input.objective.trim();
  if (!goal) throw new Error("Planning objective is required.");
  const id = requestId(input);
  const paths = architecturePaths(input);
  return {
    schema_version: 2,
    id,
    planning_goal: goal,
    architecture_request: input.architecture ?? null,
    analysis_request: input.analysis ?? null,
    trace_handoff: input.trace_handoff ?? null,
    analysis_handoff: input.analysis_handoff ?? null,
    moves: input.architecture?.kind === "move" ? input.architecture.moves : [],
    candidates: input.architecture?.kind === "decompose"
      ? (input.architecture.paths ?? []).map(source => ({ source, units: [] }))
      : [],
    scope_lock: {
      schema_version: 1,
      lock_id: id,
      original_user_instruction: goal,
      authorized_deliverables: [goal],
      authorized_paths: paths,
      forbidden_expansions: [
        "unrelated repository changes",
        "capability construction not requested by the user"
      ],
      allow_capability_construction: false,
      authorized_capabilities: []
    },
    operations: []
  };
}

function structuralMaxBytes(max: number, profile: ProjectProfile): number {
  return profile.validation.structural.maxFileBytes === undefined
    ? max
    : Math.min(max, profile.validation.structural.maxFileBytes);
}

function architecturePlanning(
  base: NativePlanningResult,
  model: ReturnType<typeof buildRepositoryModel>,
  architecturePlan: ArchitecturePlan | null
): NativePlanningResult {
  if (!architecturePlan) return base;
  const corridor = architectureCorridor(base.corridor.objective, model, architecturePlan, base.diagnostics);
  const context = corridor.certified ? buildContextPack(corridor, model, 24, base.effectRuntimeAtlas) : null;
  return Object.freeze({
    ...base,
    corridor,
    context,
    staging: corridor.certified ? planPatchStages(corridor, model, 1) : null,
    propagation: null,
    runtimeProbes: planRuntimeProbes(corridor, model)
  });
}

function pendingSemanticCoverage(regionCount: number, chunkCount: number): SemanticCoverageLedger {
  return Object.freeze({
    schema_version: 1,
    candidate_regions: regionCount,
    returned_regions: 0,
    synthesized_regions: 0,
    deterministic_only_regions: 0,
    partial_regions: 0,
    rejected_claims: 0,
    bootstrap_required: true,
    bootstrap_complete: false,
    bootstrap_chunk_count: chunkCount,
    cache_hit: false
    ,global_mapped_regions: 0
    ,global_unmapped_regions: regionCount
    ,objective_region_count: 1
    ,objective_mapped_regions: 0
    ,objective_sufficient: false
    ,active_frontier_region_ids: Object.freeze([])
  });
}

function projectTraceHandoff(evidence: CertifiedTracePlanningEvidence | null | undefined) {
  if (!evidence) return null;
  return Object.freeze({
    source_run_id: evidence.sourceRunId,
    certificate_id: evidence.certificateId,
    trace_status: evidence.traceStatus,
    path_length: evidence.path.length
  });
}

function projectAnalysisHandoff(evidence: CertifiedAnalysisPlanningEvidence | null | undefined) {
  if (!evidence) return null;
  return evidence.kind === "trace"
    ? Object.freeze({ kind: "trace" as const, source_run_id: evidence.trace.sourceRunId, artifact_id: evidence.trace.certificateId, status: evidence.trace.traceStatus, evidence_count: evidence.trace.path.length })
    : Object.freeze({ kind: "dataflow-slice" as const, source_run_id: evidence.dataflow.sourceRunId, artifact_id: evidence.dataflow.certificateId, status: evidence.dataflow.sliceStatus, evidence_count: evidence.dataflow.nodes.length });
}

export class NativeMcpService {
  readonly orchestrator = new NativeOrchestrator();
  readonly #bindings = new Map<string, RunBinding>();
  readonly #semanticBootstrap: SemanticBootstrapCoordinator;
  readonly #semanticCache: SemanticAtlasCache;

  constructor(
    private readonly adapter: RepositoryAdapter,
    private readonly options: NativeMcpServiceOptions
  ) {
    this.#semanticBootstrap = new SemanticBootstrapCoordinator(
      options.semanticRegionsPerChunk ?? DEFAULT_SEMANTIC_BOOTSTRAP_REGIONS_PER_CHUNK,
      options.semanticBootstrapStore
    );
    this.#semanticCache = options.semanticAtlasCache ?? new InMemorySemanticAtlasCache(options.semanticCacheEntries ?? 32);
  }

  private allowedRepository(value: string): string {
    const repository = repositoryName(value);
    if (!this.options.allowedRepositories.has(repository)) throw new Error(`Repository is not allowed: ${repository}`);
    return repository;
  }

  private profileFor(repository: string): ProjectProfile {
    return this.options.projectProfiles.resolve(repository);
  }

  private semanticBootstrapResult(args: {
    readonly runId: string;
    readonly targetRef: string;
    readonly profileId: string;
    readonly baseCommitSha: string;
    readonly orientation: RepositoryOrientation;
    readonly regionCount: number;
    readonly chunkCount: number;
    readonly currentChunk: SemanticBootstrapChunk;
    readonly semanticOrientation: SemanticOrientation | null;
    readonly restartReason?: string;
    readonly responseMode?: "compact" | "full";
  }) {
    const run = this.orchestrator.store.require(args.runId);
    return responseForMode(args.responseMode, Object.freeze({
      run_id: run.runId,
      state: run.state,
      repository: run.repository,
      project_profile: args.profileId,
      base_ref: args.targetRef,
      base_commit_sha: args.baseCommitSha,
      scope_lock_fingerprint: run.scopeLock.fingerprint,
      repository_atlas: args.orientation.atlas,
      coverage: args.orientation.coverage,
      semantic_atlas: args.semanticOrientation?.atlas ?? null,
      semantic_coverage: args.semanticOrientation?.coverage ?? Object.freeze({ ...pendingSemanticCoverage(args.regionCount, args.chunkCount), active_frontier_region_ids: Object.freeze(args.currentChunk.regions.map(region => region.id)) }),
      semantic_bootstrap: Object.freeze({
        status: "required" as const,
        mode: "lazy-objective-expansion" as const,
        ...(args.restartReason ? { restart_reason: args.restartReason } : {}),
        bootstrap_id: args.currentChunk.bootstrap_id,
        current_chunk: args.currentChunk
      }),
      trace_handoff: null,
      analysis_handoff: null,
      corridor: null,
      diagnostics: Object.freeze([]),
      contract_map: null,
      effect_runtime_atlas: null,
      native_contracts: Object.freeze([]),
      architecture_plan: null,
      architecture_requires_review: false,
      context_available: false,
      context_segment_count: 0,
      context_index: Object.freeze([]),
      permitted_next_action: "submit_objective_semantic_expansion_via_chrypck_plan_then_resume_repository_work"
    }));
  }

  async plan(input: PlanInput) {
    const repository = this.allowedRepository(input.repository);
    const profile = this.profileFor(repository);
    const targetRef = input.base_ref?.trim() || this.options.defaultTargetRef;
    if (!targetRef || targetRef === "HEAD") throw new Error("Planning requires an explicit branch/ref, not HEAD.");
    if (input.trace_handoff && input.analysis_handoff) {
      throw new Error("Use analysis_handoff or the trace_handoff compatibility input, never both.");
    }
    if ((input.trace_handoff || input.analysis_handoff) && input.analysis) {
      throw new Error("Analysis handoff is a normal-planning input and cannot be combined with a new analysis request.");
    }
    if ((input.trace_handoff || input.analysis_handoff) && input.architecture) {
      throw new Error("Analysis handoff is a normal-planning input and cannot be combined with an architecture request.");
    }

    const request = requestForPlan(input);
    const run = this.orchestrator.admitRequest({ repository, request, requestPath: "mcp://chrypck_plan" });
    if (run.artifacts.planning) {
      const binding = this.#bindings.get(run.runId);
      return this.planResult(
        run.runId,
        binding?.targetRef ?? targetRef,
        binding?.baseCommitSha ?? run.requestCommitSha ?? "",
        binding?.profileId ?? profile.id,
        binding?.architecturePlan ?? null,
        input.response_mode
      );
    }

    const snapshot = await this.adapter.snapshot(repository, targetRef);
    this.orchestrator.bindRequestCommit(run.runId, snapshot.commitSha);
    const model = buildRepositoryModel(snapshot, { profile: profile.sourceProfile });
    const orientation = buildRepositoryOrientation(model);

    const semanticKey = semanticAtlasCacheKey({
      repository,
      commitSha: snapshot.commitSha,
      projectProfile: profile.id
    });
    let semanticOrientation = await this.#semanticCache.get(semanticKey);
    const semanticPreparation = prepareSemanticAtlas(model, {
      maxRegions: this.options.semanticMaxRegions ?? DEFAULT_SEMANTIC_MAX_REGIONS,
      nativeContracts: profile.nativeContractProvider?.(model) ?? []
    });

    if (input.semantic_bootstrap) {
      try {
        const advanced = await this.#semanticBootstrap.advance(input.semantic_bootstrap, {
          repository,
          commitSha: snapshot.commitSha,
          projectProfile: profile.id
        });
        if (!advanced.complete) {
          return this.semanticBootstrapResult({
            runId: run.runId, targetRef, profileId: profile.id, baseCommitSha: snapshot.commitSha,
            orientation, semanticOrientation, regionCount: semanticPreparation.packets.length,
            chunkCount: advanced.currentChunk.chunk_count, currentChunk: advanced.currentChunk, responseMode: input.response_mode
          });
        }
        semanticOrientation = mergeSemanticOrientation({
          repository, commitSha: snapshot.commitSha, projectProfile: profile.id,
          packets: semanticPreparation.packets, objective: input.objective.trim(),
          existing: semanticOrientation, expansion: advanced.orientation
        });
        await this.#semanticCache.put(semanticKey, semanticOrientation);
      } catch (error) {
        if (!(error instanceof Error) || !/Unknown or expired semantic bootstrap/.test(error.message)) throw error;
        const packets = pendingSemanticExpansion(semanticPreparation.packets, input.objective, semanticOrientation);
        if (!packets.length) throw error;
        const restarted = await this.#semanticBootstrap.begin({ repository, commitSha: snapshot.commitSha, projectProfile: profile.id, packets });
        return this.semanticBootstrapResult({
          runId: run.runId, targetRef, profileId: profile.id, baseCommitSha: snapshot.commitSha,
          orientation, semanticOrientation, regionCount: semanticPreparation.packets.length,
          chunkCount: restarted.chunkCount, currentChunk: restarted.currentChunk,
          responseMode: input.response_mode,
          restartReason: "semantic_expansion_session_expired_and_was_restarted"
        });
      }
    } else {
      const packets = pendingSemanticExpansion(semanticPreparation.packets, input.objective, semanticOrientation);
      if (packets.length) {
        const started = await this.#semanticBootstrap.begin({ repository, commitSha: snapshot.commitSha, projectProfile: profile.id, packets });
        return this.semanticBootstrapResult({
          runId: run.runId, targetRef, profileId: profile.id, baseCommitSha: snapshot.commitSha,
          orientation, semanticOrientation, regionCount: semanticPreparation.packets.length,
          chunkCount: started.chunkCount, currentChunk: started.currentChunk, responseMode: input.response_mode
        });
      }
    }
    if (!semanticOrientation) throw new Error("Objective-local semantic expansion did not produce a usable Semantic Atlas region.");
    semanticOrientation = scopeSemanticOrientation({
      repository, commitSha: snapshot.commitSha, projectProfile: profile.id,
      packets: semanticPreparation.packets, objective: input.objective.trim(), orientation: semanticOrientation
    });

    let traceEvidence: CertifiedTracePlanningEvidence | undefined;
    let analysisEvidence: CertifiedAnalysisPlanningEvidence | undefined;
    const handoffReference = input.analysis_handoff ?? (input.trace_handoff ? Object.freeze({ run_id: input.trace_handoff.run_id, artifact_id: input.trace_handoff.certificate_id }) : undefined);
    if (handoffReference) {
      let sourceRun;
      try {
        sourceRun = this.orchestrator.store.require(handoffReference.run_id);
      } catch {
        throw new Error(`${input.trace_handoff ? "Trace" : "Analysis"} handoff rejected: source run does not exist in this ChryPck runtime.`);
      }
      const sourceBinding = this.#bindings.get(sourceRun.runId);
      if (!sourceBinding) {
        throw new Error(`${input.trace_handoff ? "Trace" : "Analysis"} handoff rejected: source run is missing its immutable repository/profile binding.`);
      }
      const source = {
          runId: sourceRun.runId,
          repository: sourceRun.repository,
          commitSha: sourceBinding.baseCommitSha,
          projectProfile: sourceBinding.profileId,
          trace: sourceRun.artifacts.trace,
          dataflowSlice: sourceRun.artifacts.dataflowSlice
        };
      const expected = {
          repository,
          commitSha: snapshot.commitSha,
          projectProfile: profile.id
        };
      if (input.trace_handoff) {
        traceEvidence = validateTraceHandoff(input.trace_handoff, source, expected);
        analysisEvidence = Object.freeze({ kind: "trace" as const, trace: traceEvidence });
      } else {
        analysisEvidence = validateAnalysisHandoff(handoffReference, source, expected);
        if (analysisEvidence.kind === "trace") traceEvidence = analysisEvidence.trace;
      }
    }

    const base = runNativePlanning({
      objective: input.objective.trim(),
      model,
      traceEvidence,
      dataflowEvidence: analysisEvidence?.kind === "dataflow-slice" ? analysisEvidence.dataflow : undefined,
      extensions: {
        additionalAnalyzers: profile.additionalAnalyzers,
        runtimeProbePlanner: profile.runtimeProbePlanner,
        nativeContractProvider: profile.nativeContractProvider
      }
    });

    if (input.analysis?.kind === "dataflow-slice") {
      this.orchestrator.recordArtifact(run.runId, "planning", base, {
        projectProfile: profile.id,
        corridorCertified: base.corridor.certified,
        contextSegments: base.context?.segments.length ?? 0,
        diagnostics: base.diagnostics.length,
        semanticRegions: semanticOrientation.atlas.region_count,
        architecture: null
      });
      const sliceResult: DataflowSliceResult = analyzeDataflowSlice({
        requestId: run.runId,
        repository,
        commitSha: snapshot.commitSha,
        objective: input.objective.trim(),
        criterion: input.analysis.criterion,
        direction: input.analysis.direction,
        target: input.analysis.target,
        options: input.analysis.options
      }, Object.freeze({ ...model, contractMap: base.contractMap }), buildDataflowGraph(Object.freeze({ ...model, contractMap: base.contractMap }), base.effectRuntimeAtlas));
      this.orchestrator.recordArtifact(run.runId, "dataflowSlice", sliceResult, {
        status: sliceResult.status,
        certificateId: sliceResult.certificate?.certificateId ?? null,
        direction: sliceResult.direction,
        nodes: sliceResult.nodes.length,
        edges: sliceResult.edges.length,
        frontier: sliceResult.unresolvedFrontier.length
      });
      const binding = Object.freeze({ targetRef, baseCommitSha: snapshot.commitSha, profileId: profile.id, architecturePlan: null, allowedNewPaths: Object.freeze([]), orientation, semanticOrientation, traceHandoff: null, analysisHandoff: null });
      this.#bindings.set(run.runId, binding);
      if (sliceResult.status === "UNABLE_TO_CERTIFY" || sliceResult.status === "LIMITS_EXCEEDED") this.orchestrator.transition(run.runId, "CAPABILITY_GAP", "native_dataflow_slice_gap");
      else this.orchestrator.transition(run.runId, "SUCCEEDED", "native_dataflow_slice_complete");
      return responseForMode(input.response_mode, Object.freeze({
        run_id: run.runId, state: run.state, repository: run.repository, project_profile: profile.id,
        base_ref: targetRef, base_commit_sha: snapshot.commitSha, scope_lock_fingerprint: run.scopeLock.fingerprint,
        repository_atlas: orientation.atlas, coverage: orientation.coverage, semantic_atlas: semanticOrientation.atlas,
        semantic_coverage: semanticOrientation.coverage, semantic_bootstrap: Object.freeze({ status: "complete" as const, bootstrap_id: null, current_chunk: null }),
        trace_handoff: null, analysis_handoff: null, corridor: base.corridor,
        diagnostics: projectDiagnosticMaps(base.diagnostics, base.corridor),
        contract_map: projectContractMap(base.contractMap, base.corridor.objective, base.corridor.corridor),
        effect_runtime_atlas: projectEffectRuntimeAtlas(base.effectRuntimeAtlas, base.corridor.objective, base.corridor.corridor),
        native_contracts: projectNativeContractMaps(base.nativeContracts, base.corridor),
        architecture_plan: null, architecture_requires_review: false,
        context_available: Boolean(base.context?.segments.length),
        context_segment_count: base.context?.segments.length ?? 0,
        context_index: Object.freeze(base.context?.segments.map(projectContextIndexSegment) ?? []),
        analysis: Object.freeze({ kind: "dataflow-slice" as const, result: projectDataflowSlice(sliceResult) }),
        permitted_next_action: sliceResult.status === "CERTIFIED" || sliceResult.status === "PARTIAL" ? "create_normal_plan_with_analysis_handoff" : "chrypck_result"
      }));
    }

    if (input.analysis?.kind === "trace") {
      this.orchestrator.recordArtifact(run.runId, "planning", base, {
        projectProfile: profile.id,
        corridorCertified: base.corridor.certified,
        contextSegments: base.context?.segments.length ?? 0,
        diagnostics: base.diagnostics.length,
        nativeContracts: base.nativeContracts.length,
        semanticRegions: semanticOrientation.atlas.region_count,
        architecture: null
      });

      const traceResult: TraceResult = analyzeTrace({
        requestId: run.runId,
        repository,
        commitSha: snapshot.commitSha,
        objective: input.objective.trim(),
        sourceSymbol: input.analysis.sourceSymbol,
        targetEffect: input.analysis.targetEffect,
        options: input.analysis.options
      }, model, base.corridor, base.effectRuntimeAtlas);

      this.orchestrator.recordArtifact(run.runId, "trace", traceResult, {
        status: traceResult.status,
        certificateId: traceResult.certificate?.certificateId ?? null,
        pathLength: traceResult.path.length,
        blocker: traceResult.firstBlocker?.symbol ?? null,
        terminalEffect: traceResult.terminalEffect?.kind ?? null
      });

      const binding = Object.freeze({
        targetRef,
        baseCommitSha: snapshot.commitSha,
        profileId: profile.id,
        architecturePlan: null,
        allowedNewPaths: Object.freeze([]),
        orientation,
        semanticOrientation,
        traceHandoff: null,
        analysisHandoff: null
      });
      this.#bindings.set(run.runId, binding);

      if (traceResult.status === "UNABLE_TO_CERTIFY") {
        this.orchestrator.transition(run.runId, "CAPABILITY_GAP", "native_plan_gap");
      } else {
        this.orchestrator.transition(run.runId, "SUCCEEDED", "native_trace_complete");
      }

      return responseForMode(input.response_mode, Object.freeze({
        run_id: run.runId,
        state: run.state,
        repository: run.repository,
        project_profile: profile.id,
        base_ref: targetRef,
        base_commit_sha: snapshot.commitSha,
        scope_lock_fingerprint: run.scopeLock.fingerprint,
        repository_atlas: orientation.atlas,
        coverage: orientation.coverage,
        semantic_atlas: semanticOrientation.atlas,
        semantic_coverage: semanticOrientation.coverage,
        semantic_bootstrap: Object.freeze({ status: "complete" as const, bootstrap_id: null, current_chunk: null }),
        trace_handoff: null,
        analysis_handoff: null,
        corridor: base.corridor ?? null,
        diagnostics: projectDiagnosticMaps(base.diagnostics, base.corridor),
        contract_map: projectContractMap(base.contractMap, base.corridor.objective, base.corridor.corridor),
        effect_runtime_atlas: projectEffectRuntimeAtlas(base.effectRuntimeAtlas, base.corridor.objective, base.corridor.corridor),
        native_contracts: projectNativeContractMaps(base.nativeContracts, base.corridor),
        architecture_plan: null,
        architecture_requires_review: false,
        context_available: Boolean(base.context?.segments.length),
        context_segment_count: base.context?.segments.length ?? 0,
        context_index: Object.freeze(base.context?.segments.map(projectContextIndexSegment) ?? []),
        analysis: Object.freeze({ kind: "trace" as const, result: traceResult }),
        permitted_next_action: traceResult.status === "UNABLE_TO_CERTIFY" ? "chrypck_result" : "create_normal_plan_with_trace_handoff"
      }));
    }

    const architecturePlan = input.architecture ? planArchitecture(model, input.architecture) : null;
    const planning = architecturePlanning(base, model, architecturePlan);
    this.orchestrator.recordArtifact(run.runId, "planning", planning, {
      projectProfile: profile.id,
      corridorCertified: planning.corridor.certified,
      contextSegments: planning.context?.segments.length ?? 0,
      diagnostics: planning.diagnostics.length,
      nativeContracts: planning.nativeContracts.length,
      semanticRegions: semanticOrientation.atlas.region_count,
      traceSourceRunId: traceEvidence?.sourceRunId ?? null,
      traceCertificateId: traceEvidence?.certificateId ?? null,
      architecture: architecturePlan?.kind ?? null
    });
    const binding = Object.freeze({
      targetRef,
      baseCommitSha: snapshot.commitSha,
      profileId: profile.id,
      architecturePlan,
      allowedNewPaths: Object.freeze([...(architecturePlan?.authorizedNewPaths ?? [])]),
      orientation,
      semanticOrientation,
      traceHandoff: traceEvidence ?? null
      ,analysisHandoff: analysisEvidence ?? null
    });
    this.#bindings.set(run.runId, binding);
    if (!planning.corridor.certified || !planning.context || planning.context.segments.length === 0 || architecturePlan?.gaps.length) {
      this.orchestrator.transition(run.runId, "CAPABILITY_GAP", "native_plan_gap");
    }
    return this.planResult(run.runId, targetRef, snapshot.commitSha, profile.id, architecturePlan, input.response_mode);
  }

  private planResult(
    runId: string,
    targetRef: string,
    baseCommitSha: string,
    profileId: string,
    architecturePlan: ArchitecturePlan | null,
    responseMode?: "compact" | "full"
  ) {
    const run = this.orchestrator.store.require(runId);
    const binding = this.#bindings.get(runId);
    const planning = run.artifacts.planning;
    const contextIndex = planning?.context
      ? planning.context.segments.map(projectContextIndexSegment)
      : [];
    return responseForMode(responseMode, Object.freeze({
      run_id: run.runId,
      state: run.state,
      repository: run.repository,
      project_profile: profileId,
      base_ref: targetRef,
      base_commit_sha: baseCommitSha,
      scope_lock_fingerprint: run.scopeLock.fingerprint,
      repository_atlas: binding?.orientation.atlas ?? null,
      coverage: binding?.orientation.coverage ?? null,
      semantic_atlas: binding?.semanticOrientation.atlas ?? null,
      semantic_coverage: binding?.semanticOrientation.coverage ?? null,
      semantic_bootstrap: Object.freeze({ status: "complete" as const, bootstrap_id: null, current_chunk: null }),
      trace_handoff: projectTraceHandoff(binding?.traceHandoff),
      analysis_handoff: projectAnalysisHandoff(binding?.analysisHandoff),
      corridor: planning?.corridor ?? null,
      diagnostics: planning ? projectDiagnosticMaps(planning.diagnostics, planning.corridor) : [],
      contract_map: planning ? projectContractMap(planning.contractMap, planning.corridor.objective, planning.corridor.corridor) : null,
      effect_runtime_atlas: planning ? projectEffectRuntimeAtlas(planning.effectRuntimeAtlas, planning.corridor.objective, planning.corridor.corridor) : null,
      native_contracts: planning ? projectNativeContractMaps(planning.nativeContracts, planning.corridor) : [],
      architecture_plan: architecturePlan,
      architecture_requires_review: Boolean(architecturePlan),
      context_available: contextIndex.length > 0,
      context_segment_count: contextIndex.length,
      context_index: Object.freeze(contextIndex),
      permitted_next_action: run.state === "READY" ? "chrypck_context_or_execute" : "chrypck_result"
    }));
  }

  context(input: ContextInput) {
    const run = this.orchestrator.store.require(input.run_id);
    const focusedAnalysis = Boolean(run.artifacts.trace || run.artifacts.dataflowSlice);
    const contextReadable = run.state === "READY" || (focusedAnalysis && (run.state === "SUCCEEDED" || run.state === "CAPABILITY_GAP"));
    if (!contextReadable) throw new Error(`Context is unavailable for run state ${run.state}. READY normal plans and terminal focused-analysis runs may expand certified read-only grants.`);
    const context = run.artifacts.planning?.context;
    if (!context || context.segments.length === 0) throw new Error("Run has no certified Context Pack expansion. Complete any required objective-local semantic expansion and normal planning first.");

    const taskSatisfied = focusedAnalysis && run.state === "SUCCEEDED";
    const control = {
      state: run.state,
      task_satisfied: taskSatisfied,
      completion_reason: taskSatisfied ? "focused_analysis_certified" : null
    };

    if (!input.segment_id && !input.target) {
      return Object.freeze({
        ...control,
        evidence_sufficient: taskSatisfied,
        run_id: run.runId,
        repository: run.repository,
        base_commit_sha: context.commitSha,
        certified: true,
        authority: focusedAnalysis ? "read-only-analysis-context" : "normal-plan-context",
        mode: "index",
        segments: Object.freeze(context.segments.map(projectContextIndexSegment)),
        omissions: context.omissions,
        granted_paths: context.grantedPaths,
        continuation: Object.freeze({
          available: true,
          kind: "select_certified_target",
          allowed_selectors: Object.freeze(["segment_id", "target.path", "target.symbol"])
        }),
        permitted_next_action: "call chrypck_context with one server-issued segment_id or an exact target path/symbol from this certified index"
      });
    }

    const selectedSegment = input.target
      ? context.segments.find(candidate =>
          candidate.path === input.target?.path &&
          (!input.target.symbol || candidate.symbols.some(symbol => symbol.name === input.target?.symbol))
        )
      : context.segments.find(candidate => candidate.id === input.segment_id);

    if (input.target && !selectedSegment) {
      throw new Error(`Target is not present in this run's certified Context Pack: ${input.target.path}${input.target.symbol ? `#${input.target.symbol}` : ""}. Request another certified plan/analysis segment; arbitrary path access is not permitted.`);
    }

    if (selectedSegment) {
      const projected = projectContextSourceSegment(selectedSegment) as Record<string, unknown>;
      const continuations = Array.isArray(projected.continuations) ? projected.continuations as Array<Record<string, unknown>> : [];
      const matchingContinuation = input.target?.symbol
        ? continuations.find(row => row.symbol === input.target?.symbol)
        : continuations[0];
      const nextSegmentId = typeof matchingContinuation?.next_segment_id === "string"
        ? matchingContinuation.next_segment_id
        : null;
      const evidenceSufficient = taskSatisfied || nextSegmentId === null;
      return Object.freeze({
        ...control,
        evidence_sufficient: evidenceSufficient,
        run_id: run.runId,
        repository: run.repository,
        base_commit_sha: context.commitSha,
        certified: true,
        authority: focusedAnalysis ? "read-only-analysis-context" : "normal-plan-context",
        mode: input.target ? "target" : "segment",
        target: Object.freeze({ path: selectedSegment.path, symbol: input.target?.symbol ?? null }),
        segments: Object.freeze([projected]),
        omissions: context.omissions,
        granted_paths: context.grantedPaths,
        continuation: Object.freeze({
          available: nextSegmentId !== null,
          kind: nextSegmentId ? "expand_symbol_continuation" : "none",
          next_segment_id: nextSegmentId,
          target_path: selectedSegment.path,
          target_symbol: input.target?.symbol ?? null
        }),
        permitted_next_action: nextSegmentId
          ? "call chrypck_context with continuation.next_segment_id"
          : "report the certified read-only evidence if it satisfies the user objective, otherwise select another certified target"
      });
    }

    const continuation = context.continuations.find(candidate => candidate.id === input.segment_id);
    if (!continuation) throw new Error(`Unknown server-issued Context Pack segment: ${input.segment_id}`);
    const evidenceSufficient = taskSatisfied || continuation.nextContinuationId === null;
    return Object.freeze({
      ...control,
      evidence_sufficient: evidenceSufficient,
      run_id: run.runId,
      repository: run.repository,
      base_commit_sha: context.commitSha,
      certified: true,
      authority: focusedAnalysis ? "read-only-analysis-context" : "normal-plan-context",
      mode: "continuation",
      segments: Object.freeze([projectContextContinuation(continuation)]),
      omissions: context.omissions,
      granted_paths: context.grantedPaths,
      continuation: Object.freeze({
        available: continuation.nextContinuationId !== null,
        kind: continuation.nextContinuationId ? "expand_symbol_continuation" : "none",
        next_segment_id: continuation.nextContinuationId,
        target_path: continuation.path,
        target_symbol: continuation.symbol
      }),
      permitted_next_action: continuation.nextContinuationId
        ? "call chrypck_context with continuation.next_segment_id"
        : "report the certified read-only evidence if it satisfies the user objective, otherwise select another certified target"
    });
  }

  async execute(input: ExecuteInput) {
    const run = this.orchestrator.store.require(input.run_id);
    if (run.state !== "READY") throw new Error(`Execution requires READY state; run is ${run.state}.`);
    const binding = this.#bindings.get(run.runId);
    if (!binding) throw new Error("Run is missing its repository/ref binding. Complete any required objective-local semantic expansion and normal planning before execution.");
    const profile = this.options.projectProfiles.get(binding.profileId);
    if (!profile) throw new Error(`Run references an unavailable project profile: ${binding.profileId}`);

    let intent: AuthoringIntent;
    if ("architecture_approval" in input && input.architecture_approval) {
      const plan = binding.architecturePlan;
      if (!plan || plan.planId !== input.architecture_approval.plan_id) {
        throw new Error("Architecture approval does not match this run's server-issued plan.");
      }
      if (plan.kind !== "path-move") {
        throw new Error("Domain decomposition remains review-driven: submit the reviewed extraction as authoring_intent using the decomposer-authorized target paths.");
      }
      if (plan.gaps.length) throw new Error("Path move plan contains unresolved gaps and cannot execute.");
      intent = Object.freeze({
        id: plan.planId,
        objective: run.envelope.intent.goal ?? "approved path move",
        edits: plan.edits
      });
    } else if ("authoring_intent" in input && input.authoring_intent) {
      intent = input.authoring_intent;
    } else {
      throw new Error("Execution requires authoring_intent or architecture_approval.");
    }

    const maxFileBytes = structuralMaxBytes(this.options.maxMutationFileBytes, profile);
    const result = await executeNativeRepositoryRun(this.orchestrator, {
      runId: run.runId,
      adapter: this.adapter,
      targetRef: binding.targetRef,
      commitMessage: input.commit_message?.trim() || `ChryPck: ${intent.id}`,
      intent,
      sourceProfile: profile.sourceProfile,
      allowedNewPaths: binding.allowedNewPaths,
      filePatcherPolicy: { maxSingleFileBytes: maxFileBytes },
      structuralValidators: [
        createStructuralValidator({
          maxFileBytes,
          rejectConflictMarkers: profile.validation.structural.rejectConflictMarkers
        })
      ],
      commandPlan: buildValidationCommandPlan(profile.validation.commands, profile.validation.commandPolicy),
      sandboxRunner: this.options.sandboxRunner ?? new DisabledSandboxRunner(),
      planningExtensions: {
        additionalAnalyzers: profile.additionalAnalyzers,
        runtimeProbePlanner: profile.runtimeProbePlanner,
        nativeContractProvider: profile.nativeContractProvider
      }
    });
    return this.result({ run_id: result.run.runId });
  }

  result(input: ResultInput) {
    const run = this.orchestrator.store.require(input.run_id);
    const binding = this.#bindings.get(run.runId);
    return responseForMode(input.response_mode, Object.freeze({
      run_id: run.runId,
      repository: run.repository,
      project_profile: binding?.profileId ?? this.profileFor(run.repository).id,
      state: run.state,
      terminal: run.stateRecord.terminal,
      task_satisfied: run.stateRecord.terminal || Boolean(
        (run.artifacts.trace || run.artifacts.dataflowSlice) &&
        run.state === "SUCCEEDED"
      ),
      evidence_sufficient: run.stateRecord.terminal || Boolean(
        (run.artifacts.trace || run.artifacts.dataflowSlice) &&
        run.state === "SUCCEEDED"
      ),
      completion_reason: run.stateRecord.terminal
        ? "governed_run_terminal"
        : (run.artifacts.trace || run.artifacts.dataflowSlice) && run.state === "SUCCEEDED"
          ? "focused_analysis_certified"
          : null,
      continuation: run.state === "READY"
        ? Object.freeze({
            available: true,
            kind: "select_certified_target",
            permitted_tool: "chrypck_context"
          })
        : Object.freeze({ available: false, kind: "none" }),
      request_fingerprint: run.requestIdentity.fingerprint,
      scope_lock_fingerprint: run.scopeLock.fingerprint,
      base_commit_sha: run.requestCommitSha,
      result_commit_sha: run.resultCommitSha,
      permitted_next_action: run.stateRecord.permitted_next_action,
      architecture_plan: binding?.architecturePlan ?? null,
      trace_handoff: projectTraceHandoff(binding?.traceHandoff),
      analysis_handoff: projectAnalysisHandoff(binding?.analysisHandoff),
      analysis: run.artifacts.dataflowSlice
        ? Object.freeze({ kind: "dataflow-slice" as const, result: projectDataflowSlice(run.artifacts.dataflowSlice) })
        : run.artifacts.trace
        ? Object.freeze({ kind: "trace" as const, result: run.artifacts.trace })
        : null,
      semantic_atlas: binding?.semanticOrientation.atlas ?? null,
      semantic_coverage: binding?.semanticOrientation.coverage ?? null,
      contract_map: run.artifacts.planning
        ? projectContractMap(
          run.artifacts.planning.contractMap,
          run.artifacts.planning.corridor.objective,
          run.artifacts.planning.corridor.corridor
        )
        : null,
      effect_runtime_atlas: run.artifacts.planning
        ? projectEffectRuntimeAtlas(run.artifacts.planning.effectRuntimeAtlas, run.artifacts.planning.corridor.objective, run.artifacts.planning.corridor.corridor)
        : null,
      artifacts: summarizeRunArtifacts(run.artifacts),
      failure: run.artifacts.failure,
      telemetry: run.telemetry.snapshot()
    }));
  }
}
