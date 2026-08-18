import { createHash } from "node:crypto";
import type { RepositoryAdapter } from "../repository/adapter.js";
import { buildRepositoryModel } from "../repository/model-builder.js";
import { runNativePlanning } from "../planning/planning-runner.js";
import { createStructuralValidator } from "../validation/structural-validator.js";
import { buildValidationCommandPlan } from "../validation/command-plan.js";
import { DisabledSandboxRunner, type SandboxRunner } from "../validation/sandbox-runner.js";
import { executeNativeRepositoryRun } from "../core/run/repository-execution.js";
import { NativeOrchestrator } from "../core/run/orchestrator.js";
import { summarizeRunArtifacts } from "../core/run/run-artifacts.js";
import type { ProjectProfileRegistry } from "../project/registry.js";
import type { ProjectProfile } from "../project/profile.js";
import type { PlanInput, ContextInput, ExecuteInput, ResultInput } from "./schemas.js";

export interface NativeMcpServiceOptions {
  readonly allowedRepositories: ReadonlySet<string>;
  readonly defaultTargetRef: string;
  readonly maxMutationFileBytes: number;
  readonly projectProfiles: ProjectProfileRegistry;
  readonly sandboxRunner?: SandboxRunner;
}

interface RunBinding {
  readonly targetRef: string;
  readonly baseCommitSha: string;
  readonly profileId: string;
}

function repositoryName(value: string): string {
  const normalized = value.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  if (!/^[^/\s]+\/[^/\s]+$/.test(normalized)) throw new Error(`Repository must be owner/name: ${value}`);
  return normalized;
}

function requestId(objective: string): string {
  return `native-${createHash("sha256").update(objective.trim()).digest("hex").slice(0, 12)}`;
}

function requestForObjective(objective: string): Record<string, unknown> {
  const goal = objective.trim();
  if (!goal) throw new Error("Planning objective is required.");
  return {
    schema_version: 2,
    id: requestId(goal),
    planning_goal: goal,
    scope_lock: {
      schema_version: 1,
      lock_id: requestId(goal),
      original_user_instruction: goal,
      authorized_deliverables: [goal],
      authorized_paths: [],
      forbidden_expansions: ["unrelated repository changes", "capability construction not requested by the user"],
      allow_capability_construction: false,
      authorized_capabilities: []
    },
    operations: []
  };
}

function structuralMaxBytes(serviceMaximum: number, profile: ProjectProfile): number {
  const profileMaximum = profile.validation.structural.maxFileBytes;
  return profileMaximum === undefined ? serviceMaximum : Math.min(serviceMaximum, profileMaximum);
}

export class NativeMcpService {
  readonly orchestrator = new NativeOrchestrator();
  readonly #bindings = new Map<string, RunBinding>();

  constructor(private readonly adapter: RepositoryAdapter, private readonly options: NativeMcpServiceOptions) {}

  private allowedRepository(value: string): string {
    const repository = repositoryName(value);
    if (!this.options.allowedRepositories.has(repository)) throw new Error(`Repository is not allowed: ${repository}`);
    return repository;
  }

  private profileFor(repository: string): ProjectProfile {
    return this.options.projectProfiles.resolve(repository);
  }

  async plan(input: PlanInput) {
    const repository = this.allowedRepository(input.repository);
    const profile = this.profileFor(repository);
    const targetRef = input.base_ref?.trim() || this.options.defaultTargetRef;
    if (!targetRef || targetRef === "HEAD") throw new Error("Planning requires an explicit branch/ref, not HEAD.");
    const request = requestForObjective(input.objective);
    const run = this.orchestrator.admitRequest({ repository, request, requestPath: "mcp://chrypck_plan" });
    if (run.artifacts.planning) {
      const binding = this.#bindings.get(run.runId);
      return this.planResult(run.runId, binding?.targetRef ?? targetRef, binding?.baseCommitSha ?? run.requestCommitSha ?? "", binding?.profileId ?? profile.id);
    }
    const snapshot = await this.adapter.snapshot(repository, targetRef);
    this.orchestrator.bindRequestCommit(run.runId, snapshot.commitSha);
    const model = buildRepositoryModel(snapshot, { profile: profile.sourceProfile });
    const planning = runNativePlanning({
      objective: input.objective.trim(),
      model,
      extensions: {
        additionalAnalyzers: profile.additionalAnalyzers,
        runtimeProbePlanner: profile.runtimeProbePlanner,
        nativeContractProvider: profile.nativeContractProvider
      }
    });
    this.orchestrator.recordArtifact(run.runId, "planning", planning, {
      projectProfile: profile.id,
      corridorCertified: planning.corridor.certified,
      contextSegments: planning.context?.segments.length ?? 0,
      diagnostics: planning.diagnostics.length,
      nativeContracts: planning.nativeContracts.length
    });
    this.#bindings.set(run.runId, Object.freeze({ targetRef, baseCommitSha: snapshot.commitSha, profileId: profile.id }));
    if (!planning.corridor.certified || !planning.context) this.orchestrator.transition(run.runId, "CAPABILITY_GAP", "native_plan_gap");
    return this.planResult(run.runId, targetRef, snapshot.commitSha, profile.id);
  }

  private planResult(runId: string, targetRef: string, baseCommitSha: string, profileId: string) {
    const run = this.orchestrator.store.require(runId), planning = run.artifacts.planning;
    return Object.freeze({
      run_id: run.runId,
      state: run.state,
      repository: run.repository,
      project_profile: profileId,
      base_ref: targetRef,
      base_commit_sha: baseCommitSha,
      scope_lock_fingerprint: run.scopeLock.fingerprint,
      corridor: planning?.corridor ?? null,
      diagnostics: planning?.diagnostics ?? [],
      native_contracts: planning?.nativeContracts ?? [],
      context_available: Boolean(planning?.context),
      permitted_next_action: run.state === "READY" ? "chrypck_context_or_execute" : "chrypck_result"
    });
  }

  context(input: ContextInput) {
    const run = this.orchestrator.store.require(input.run_id);
    if (run.state !== "READY") throw new Error(`Context is available only for READY runs; run is ${run.state}.`);
    const context = run.artifacts.planning?.context;
    if (!context) throw new Error("Run has no certified Context Pack.");
    const segments = input.segment_id ? context.segments.filter(segment => segment.id === input.segment_id) : context.segments;
    if (input.segment_id && segments.length === 0) throw new Error(`Unknown Context Pack segment: ${input.segment_id}`);
    return Object.freeze({ run_id: run.runId, repository: run.repository, base_commit_sha: context.commitSha, certified: true, segments: Object.freeze([...segments]), omissions: context.omissions, granted_paths: context.grantedPaths });
  }

  async execute(input: ExecuteInput) {
    const run = this.orchestrator.store.require(input.run_id);
    if (run.state !== "READY") throw new Error(`Execution requires READY state; run is ${run.state}.`);
    const binding = this.#bindings.get(run.runId);
    if (!binding) throw new Error("Run is missing its repository/ref binding.");
    const profile = this.options.projectProfiles.get(binding.profileId);
    if (!profile) throw new Error(`Run references an unavailable project profile: ${binding.profileId}`);
    const maxFileBytes = structuralMaxBytes(this.options.maxMutationFileBytes, profile);
    const result = await executeNativeRepositoryRun(this.orchestrator, {
      runId: run.runId,
      adapter: this.adapter,
      targetRef: binding.targetRef,
      commitMessage: input.commit_message?.trim() || `ChryPck: ${input.authoring_intent.id}`,
      intent: input.authoring_intent,
      sourceProfile: profile.sourceProfile,
      filePatcherPolicy: { maxSingleFileBytes: maxFileBytes },
      structuralValidators: [createStructuralValidator({ maxFileBytes, rejectConflictMarkers: profile.validation.structural.rejectConflictMarkers })],
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
      artifacts: summarizeRunArtifacts(run.artifacts),
      failure: run.artifacts.failure,
      telemetry: run.telemetry.snapshot()
    });
  }
}
