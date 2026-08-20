import { createHash } from "node:crypto";
import type { RepositoryAdapter } from "../repository/adapter.js";
import { buildRepositoryModel } from "../repository/model-builder.js";
import { buildRepositoryOrientation, type RepositoryOrientation } from "../repository/repository-atlas.js";
import { runNativePlanning, type NativePlanningResult } from "../planning/planning-runner.js";
import { buildContextPack } from "../planning/context-pack.js";
import { planPatchStages } from "../planning/patch-staging.js";
import { planRuntimeProbes } from "../planning/runtime-probes.js";
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
import type { AuthoringIntent } from "../mutation/authoring-compiler.js";
import { InMemorySemanticAtlasCache, semanticAtlasCacheKey } from "../semantic/cache.js";
import {
  DEFAULT_SEMANTIC_BOOTSTRAP_REGIONS_PER_CHUNK,
  SemanticBootstrapCoordinator
} from "../semantic/bootstrap.js";
import { DEFAULT_SEMANTIC_MAX_REGIONS } from "../semantic/region-builder.js";
import { prepareSemanticAtlas } from "../semantic/semantic-atlas.js";
import type { SemanticBootstrapChunk, SemanticCoverageLedger, SemanticOrientation } from "../semantic/types.js";
import type { PlanInput, ContextInput, ExecuteInput, ResultInput } from "./schemas.js";
import {
  projectContextContinuation,
  projectContextIndexSegment,
  projectContextSourceSegment,
  projectDiagnosticMaps,
  projectNativeContractMaps
} from "./response-projection.js";

export interface NativeMcpServiceOptions {
  readonly allowedRepositories: ReadonlySet<string>;
  readonly defaultTargetRef: string;
  readonly maxMutationFileBytes: number;
  readonly projectProfiles: ProjectProfileRegistry;
  readonly sandboxRunner?: SandboxRunner;
  readonly semanticMaxRegions?: number;
  readonly semanticRegionsPerChunk?: number;
  readonly semanticCacheEntries?: number;
}

interface RunBinding {
  readonly targetRef: string;
  readonly baseCommitSha: string;
  readonly profileId: string;
  readonly architecturePlan: ArchitecturePlan | null;
  readonly allowedNewPaths: readonly string[];
  readonly orientation: RepositoryOrientation;
  readonly semanticOrientation: SemanticOrientation;
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
    .update(JSON.stringify({ objective: input.objective.trim(), architecture: input.architecture ?? null }))
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
  const context = corridor.certified ? buildContextPack(corridor, model) : null;
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
  });
}

export class NativeMcpService {
  readonly orchestrator = new NativeOrchestrator();
  readonly #bindings = new Map<string, RunBinding>();
  readonly #semanticBootstrap: SemanticBootstrapCoordinator;
  readonly #semanticCache: InMemorySemanticAtlasCache;

  constructor(
    private readonly adapter: RepositoryAdapter,
    private readonly options: NativeMcpServiceOptions
  ) {
    this.#semanticBootstrap = new SemanticBootstrapCoordinator(
      options.semanticRegionsPerChunk ?? DEFAULT_SEMANTIC_BOOTSTRAP_REGIONS_PER_CHUNK
    );
    this.#semanticCache = new InMemorySemanticAtlasCache(options.semanticCacheEntries ?? 32);
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
    readonly restartReason?: string;
  }) {
    const run = this.orchestrator.store.require(args.runId);
    return Object.freeze({
      run_id: run.runId,
      state: run.state,
      repository: run.repository,
      project_profile: args.profileId,
      base_ref: args.targetRef,
      base_commit_sha: args.baseCommitSha,
      scope_lock_fingerprint: run.scopeLock.fingerprint,
      repository_atlas: args.orientation.atlas,
      coverage: args.orientation.coverage,
      semantic_atlas: null,
      semantic_coverage: pendingSemanticCoverage(args.regionCount, args.chunkCount),
      semantic_bootstrap: Object.freeze({
        status: "required" as const,
        ...(args.restartReason ? { restart_reason: args.restartReason } : {}),
        bootstrap_id: args.currentChunk.bootstrap_id,
        current_chunk: args.currentChunk
      }),
      corridor: null,
      diagnostics: Object.freeze([]),
      native_contracts: Object.freeze([]),
      architecture_plan: null,
      architecture_requires_review: false,
      context_available: false,
      context_segment_count: 0,
      context_index: Object.freeze([]),
      permitted_next_action: "submit_semantic_bootstrap_chunk_via_chrypck_plan_before_repository_work"
    });
  }

  async plan(input: PlanInput) {
    const repository = this.allowedRepository(input.repository);
    const profile = this.profileFor(repository);
    const targetRef = input.base_ref?.trim() || this.options.defaultTargetRef;
    if (!targetRef || targetRef === "HEAD") throw new Error("Planning requires an explicit branch/ref, not HEAD.");

    const request = requestForPlan(input);
    const run = this.orchestrator.admitRequest({ repository, request, requestPath: "mcp://chrypck_plan" });
    if (run.artifacts.planning) {
      const binding = this.#bindings.get(run.runId);
      return this.planResult(
        run.runId,
        binding?.targetRef ?? targetRef,
        binding?.baseCommitSha ?? run.requestCommitSha ?? "",
        binding?.profileId ?? profile.id,
        binding?.architecturePlan ?? null
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
    let semanticOrientation = this.#semanticCache.get(semanticKey);
    if (!semanticOrientation) {
      const semanticPreparation = prepareSemanticAtlas(model, {
        maxRegions: this.options.semanticMaxRegions ?? DEFAULT_SEMANTIC_MAX_REGIONS,
        nativeContracts: profile.nativeContractProvider?.(model) ?? []
      });

      if (input.semantic_bootstrap) {
        try {
          const advanced = this.#semanticBootstrap.advance(input.semantic_bootstrap, {
            repository,
            commitSha: snapshot.commitSha,
            projectProfile: profile.id
          });
          if (!advanced.complete) {
            return this.semanticBootstrapResult({
              runId: run.runId,
              targetRef,
              profileId: profile.id,
              baseCommitSha: snapshot.commitSha,
              orientation,
              regionCount: semanticPreparation.packets.length,
              chunkCount: advanced.currentChunk.chunk_count,
              currentChunk: advanced.currentChunk
            });
          }
          semanticOrientation = advanced.orientation;
          this.#semanticCache.put(semanticKey, semanticOrientation);
        } catch (error) {
          if (!(error instanceof Error) || !/Unknown or expired semantic bootstrap/.test(error.message)) throw error;
          const restarted = this.#semanticBootstrap.begin({
            repository,
            commitSha: snapshot.commitSha,
            projectProfile: profile.id,
            packets: semanticPreparation.packets
          });
          return this.semanticBootstrapResult({
            runId: run.runId,
            targetRef,
            profileId: profile.id,
            baseCommitSha: snapshot.commitSha,
            orientation,
            regionCount: semanticPreparation.packets.length,
            chunkCount: restarted.chunkCount,
            currentChunk: restarted.currentChunk,
            restartReason: "semantic_bootstrap_session_expired_and_was_restarted"
          });
        }
      } else {
        const started = this.#semanticBootstrap.begin({
          repository,
          commitSha: snapshot.commitSha,
          projectProfile: profile.id,
          packets: semanticPreparation.packets
        });
        return this.semanticBootstrapResult({
          runId: run.runId,
          targetRef,
          profileId: profile.id,
          baseCommitSha: snapshot.commitSha,
          orientation,
          regionCount: semanticPreparation.packets.length,
          chunkCount: started.chunkCount,
          currentChunk: started.currentChunk
        });
      }
    }

    const base = runNativePlanning({
      objective: input.objective.trim(),
      model,
      extensions: {
        additionalAnalyzers: profile.additionalAnalyzers,
        runtimeProbePlanner: profile.runtimeProbePlanner,
        nativeContractProvider: profile.nativeContractProvider
      }
    });

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
      }, model, base.corridor);

      const binding = Object.freeze({
        targetRef,
        baseCommitSha: snapshot.commitSha,
        profileId: profile.id,
        architecturePlan: null,
        allowedNewPaths: Object.freeze([]),
        orientation,
        semanticOrientation
      });
      this.#bindings.set(run.runId, binding);

      if (traceResult.status === "UNABLE_TO_CERTIFY") {
        this.orchestrator.transition(run.runId, "CAPABILITY_GAP", "native_plan_gap");
      } else {
        this.orchestrator.transition(run.runId, "SUCCEEDED", "native_trace_complete");
      }

      return Object.freeze({
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
        corridor: base.corridor ?? null,
        diagnostics: projectDiagnosticMaps(base.diagnostics, base.corridor),
        native_contracts: projectNativeContractMaps(base.nativeContracts, base.corridor),
        architecture_plan: null,
        architecture_requires_review: false,
        context_available: false,
        context_segment_count: 0,
        context_index: Object.freeze([]),
        analysis: Object.freeze({ kind: "trace" as const, result: traceResult }),
        permitted_next_action: "create_normal_plan_from_trace_evidence"
      });
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
      architecture: architecturePlan?.kind ?? null
    });
    const binding = Object.freeze({
      targetRef,
      baseCommitSha: snapshot.commitSha,
      profileId: profile.id,
      architecturePlan,
      allowedNewPaths: Object.freeze([...(architecturePlan?.authorizedNewPaths ?? [])]),
      orientation,
      semanticOrientation
    });
    this.#bindings.set(run.runId, binding);
    if (!planning.corridor.certified || !planning.context || planning.context.segments.length === 0 || architecturePlan?.gaps.length) {
      this.orchestrator.transition(run.runId, "CAPABILITY_GAP", "native_plan_gap");
    }
    return this.planResult(run.runId, targetRef, snapshot.commitSha, profile.id, architecturePlan);
  }

  private planResult(
    runId: string,
    targetRef: string,
    baseCommitSha: string,
    profileId: string,
    architecturePlan: ArchitecturePlan | null
  ) {
    const run = this.orchestrator.store.require(runId);
    const binding = this.#bindings.get(runId);
    const planning = run.artifacts.planning;
    const contextIndex = planning?.context
      ? planning.context.segments.map(projectContextIndexSegment)
      : [];
    return Object.freeze({
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
      corridor: planning?.corridor ?? null,
      diagnostics: planning ? projectDiagnosticMaps(planning.diagnostics, planning.corridor) : [],
      native_contracts: planning ? projectNativeContractMaps(planning.nativeContracts, planning.corridor) : [],
      architecture_plan: architecturePlan,
      architecture_requires_review: Boolean(architecturePlan),
      context_available: contextIndex.length > 0,
      context_segment_count: contextIndex.length,
      context_index: Object.freeze(contextIndex),
      permitted_next_action: run.state === "READY" ? "chrypck_context_or_execute" : "chrypck_result"
    });
  }

  context(input: ContextInput) {
    const run = this.orchestrator.store.require(input.run_id);
    if (run.state !== "READY") throw new Error(`Context is available only for READY runs; run is ${run.state}.`);
    const context = run.artifacts.planning?.context;
    if (!context || context.segments.length === 0) throw new Error("Run has no certified Context Pack expansion. Complete any required Semantic Atlas bootstrap and normal planning first.");

    if (!input.segment_id) {
      return Object.freeze({
        run_id: run.runId,
        repository: run.repository,
        base_commit_sha: context.commitSha,
        certified: true,
        mode: "index",
        segments: Object.freeze(context.segments.map(projectContextIndexSegment)),
        omissions: context.omissions,
        granted_paths: context.grantedPaths,
        permitted_next_action: "call chrypck_context again with one server-issued segment_id for bounded source expansion"
      });
    }

    const segment = context.segments.find(candidate => candidate.id === input.segment_id);
    if (segment) {
      return Object.freeze({
        run_id: run.runId,
        repository: run.repository,
        base_commit_sha: context.commitSha,
        certified: true,
        mode: "segment",
        segments: Object.freeze([projectContextSourceSegment(segment)]),
        omissions: context.omissions,
        granted_paths: context.grantedPaths,
        permitted_next_action: "use any returned next_segment_id to expand only that truncated certified symbol, or execute/request another certified segment"
      });
    }

    const continuation = context.continuations.find(candidate => candidate.id === input.segment_id);
    if (!continuation) throw new Error(`Unknown server-issued Context Pack segment: ${input.segment_id}`);
    return Object.freeze({
      run_id: run.runId,
      repository: run.repository,
      base_commit_sha: context.commitSha,
      certified: true,
      mode: "continuation",
      segments: Object.freeze([projectContextContinuation(continuation)]),
      omissions: context.omissions,
      granted_paths: context.grantedPaths,
      permitted_next_action: continuation.nextContinuationId
        ? "call chrypck_context with the returned next_segment_id for the next bounded chunk of this same certified symbol"
        : "chrypck_execute_or_request_another_certified_segment"
    });
  }

  async execute(input: ExecuteInput) {
    const run = this.orchestrator.store.require(input.run_id);
    if (run.state !== "READY") throw new Error(`Execution requires READY state; run is ${run.state}.`);
    const binding = this.#bindings.get(run.runId);
    if (!binding) throw new Error("Run is missing its repository/ref binding. Complete any required Semantic Atlas bootstrap and normal planning before execution.");
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
      sandboxRunner: this.options.sandboxRunner ?? new DisabledSandboxRunner()
    });
    return this.result({ run_id: result.run.runId });
  }

  result(input: ResultInput) {
    const run = this.orchestrator.store.require(input.run_id);
    const binding = this.#bindings.get(run.runId);
    return Object.freeze({
      run_id: run.runId,
      repository: run.repository,
      project_profile: binding?.profileId ?? this.profileFor(run.repository).id,
      state: run.state,
      terminal: run.stateRecord.terminal,
      request_fingerprint: run.requestIdentity.fingerprint,
      scope_lock_fingerprint: run.scopeLock.fingerprint,
      base_commit_sha: run.requestCommitSha,
      result_commit_sha: run.resultCommitSha,
      permitted_next_action: run.stateRecord.permitted_next_action,
      architecture_plan: binding?.architecturePlan ?? null,
      semantic_atlas: binding?.semanticOrientation.atlas ?? null,
      semantic_coverage: binding?.semanticOrientation.coverage ?? null,
      artifacts: summarizeRunArtifacts(run.artifacts),
      failure: run.artifacts.failure,
      telemetry: run.telemetry.snapshot()
    });
  }
}
