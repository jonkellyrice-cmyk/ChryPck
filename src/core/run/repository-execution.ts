import type { RepositoryAdapter } from "../../repository/adapter.js";
import { buildRepositoryModel } from "../../repository/model-builder.js";
import type { RepositorySourceProfile } from "../../repository/source-profile.js";
import type { AuthoringIntent } from "../../mutation/authoring-compiler.js";
import type { FilePatcherPolicy } from "../../mutation/file-patcher.js";
import type { MutationCommitter, StagedPatch } from "../../mutation/transaction.js";
import type { ValidationCommandPlan } from "../../validation/command-plan.js";
import type { SandboxRunner } from "../../validation/sandbox-runner.js";
import type { StructuralValidationContext } from "../../validation/structural-validator.js";
import type { Validator } from "../../validation/validator.js";
import { buildNativeFailureEvidence } from "./failure-evidence.js";
import { executeNativeRun, type NativeExecutionResult } from "./native-execution.js";
import type { NativeOrchestrator } from "./orchestrator.js";

export interface NativeRepositoryExecutionRequest {
  readonly runId: string;
  readonly adapter: RepositoryAdapter;
  readonly targetRef: string;
  readonly commitMessage: string;
  readonly intent: AuthoringIntent;
  readonly sourceProfile?: RepositorySourceProfile;
  readonly allowedNewPaths?: readonly string[];
  readonly filePatcherPolicy?: FilePatcherPolicy;
  readonly structuralValidators: readonly Validator<StructuralValidationContext>[];
  readonly commandPlan: ValidationCommandPlan;
  readonly sandboxRunner: SandboxRunner;
}

export async function executeNativeRepositoryRun(orchestrator: NativeOrchestrator, request: NativeRepositoryExecutionRequest): Promise<NativeExecutionResult> {
  const run = orchestrator.store.require(request.runId);
  let snapshot;
  try {
    snapshot = await request.adapter.snapshot(run.repository, request.targetRef);
    if (run.requestCommitSha === null) orchestrator.bindRequestCommit(run.runId, snapshot.commitSha);
  } catch (error) {
    const failure = buildNativeFailureEvidence("execution", error, [{ repository: run.repository, targetRef: request.targetRef }]);
    const failed = orchestrator.failNative(run.runId, failure);
    return Object.freeze({ run: failed, planning: null, propagation: null, validation: null, transaction: null });
  }

  const model = buildRepositoryModel(snapshot, { profile: request.sourceProfile });
  const committer: MutationCommitter = Object.freeze({
    commit: async (staged: StagedPatch) => {
      const changes = new Map(staged.changes.map(change => [change.path, change.after] as const));
      const published = await request.adapter.publish({
        repository: run.repository,
        targetRef: request.targetRef,
        baseCommitSha: staged.baseCommitSha,
        message: request.commitMessage,
        changes
      });
      return Object.freeze({
        commitSha: published.commitSha,
        changedPaths: published.changedPaths,
        patchFingerprint: staged.patchFingerprint
      });
    }
  });

  return await executeNativeRun(orchestrator, {
    runId: request.runId,
    model,
    intent: request.intent,
    allowedNewPaths: request.allowedNewPaths,
    filePatcherPolicy: request.filePatcherPolicy,
    structuralValidators: request.structuralValidators,
    commandPlan: request.commandPlan,
    sandboxRunner: request.sandboxRunner,
    committer
  });
}
