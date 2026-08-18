import type { RepositoryModel } from "../../repository/model.js";
import { runNativePlanning, type NativePlanningResult } from "../../planning/planning-runner.js";
import { assessPropagation, type ChangePropagationReport } from "../../planning/change-propagation.js";
import { prepareNativeMutation } from "../../mutation/mutation-runner.js";
import { commitMutationTransaction, validateMutationTransaction, type MutationCommitter, type MutationTransaction } from "../../mutation/transaction.js";
import type { AuthoringIntent } from "../../mutation/authoring-compiler.js";
import type { FilePatcherPolicy } from "../../mutation/file-patcher.js";
import { runNativeValidation, type NativeValidationReport } from "../../validation/validation-runner.js";
import type { ValidationCommandPlan } from "../../validation/command-plan.js";
import type { SandboxRunner, SandboxWorkspaceFile } from "../../validation/sandbox-runner.js";
import type { StructuralValidationContext } from "../../validation/structural-validator.js";
import type { Validator } from "../../validation/validator.js";
import { buildNativeFailureEvidence, type NativeFailureStage } from "./failure-evidence.js";
import { NativeOrchestrator } from "./orchestrator.js";
import { summarizeRunArtifacts } from "./run-artifacts.js";
import type { NativeToolchainRun } from "./run-store.js";

export interface NativeExecutionRequest {
  readonly runId: string;
  readonly model: RepositoryModel;
  readonly intent: AuthoringIntent;
  readonly allowedNewPaths?: readonly string[];
  readonly filePatcherPolicy?: FilePatcherPolicy;
  readonly structuralValidators: readonly Validator<StructuralValidationContext>[];
  readonly commandPlan: ValidationCommandPlan;
  readonly sandboxRunner: SandboxRunner;
  readonly committer: MutationCommitter;
}

export interface NativeExecutionResult {
  readonly run: NativeToolchainRun;
  readonly planning: NativePlanningResult | null;
  readonly propagation: ChangePropagationReport | null;
  readonly validation: NativeValidationReport | null;
  readonly transaction: MutationTransaction | null;
}

function baseFiles(model: RepositoryModel): ReadonlyMap<string, string> {
  return new Map(model.snapshot.files.filter(file => file.text !== undefined).map(file => [file.path, file.text!] as const));
}

function workspaceFor(transaction: MutationTransaction): readonly SandboxWorkspaceFile[] {
  return Object.freeze([...transaction.staged.files].map(([path, content]) => Object.freeze({ path, content })).sort((left, right) => left.path.localeCompare(right.path)));
}

function fail(orchestrator: NativeOrchestrator, runId: string, stage: NativeFailureStage, error: unknown, evidence: readonly unknown[] = []): NativeExecutionResult {
  const failure = buildNativeFailureEvidence(stage, error, evidence);
  const run = orchestrator.failNative(runId, failure);
  return Object.freeze({ run, planning: run.artifacts.planning, propagation: run.artifacts.propagation, validation: run.artifacts.validation, transaction: run.artifacts.mutation });
}

function assertExecutionAuthority(run: NativeToolchainRun, model: RepositoryModel, intent: AuthoringIntent): void {
  const goal = run.envelope.intent.goal?.trim();
  if (!goal) throw new Error("Admitted request has no planning goal.");
  if (intent.objective.trim() !== goal) throw new Error("Authoring intent objective must exactly match the admitted request goal.");
  if (model.snapshot.repository !== run.repository) throw new Error("Repository Model does not belong to the admitted repository.");
  if (run.requestCommitSha && model.snapshot.commitSha !== run.requestCommitSha) throw new Error("Repository Model commit does not match the run's bound request commit.");
}

export async function executeNativeRun(orchestrator: NativeOrchestrator, request: NativeExecutionRequest): Promise<NativeExecutionResult> {
  const run = orchestrator.store.require(request.runId);
  try {
    assertExecutionAuthority(run, request.model, request.intent);
  } catch (error) {
    return fail(orchestrator, request.runId, "execution", error);
  }

  orchestrator.transition(request.runId, "EXECUTING", "native_execution_started");
  let planning: NativePlanningResult;
  try {
    planning = runNativePlanning({ objective: run.envelope.intent.goal!, model: request.model });
    orchestrator.recordArtifact(request.runId, "planning", planning, { corridorCertified: planning.corridor.certified, diagnostics: planning.diagnostics.length, contextSegments: planning.context?.segments.length ?? 0 });
    if (!planning.corridor.certified || !planning.context) return fail(orchestrator, request.runId, "planning", new Error(planning.corridor.gaps.join("; ") || "Patch Corridor did not certify."), planning.corridor.gaps);
  } catch (error) {
    return fail(orchestrator, request.runId, "planning", error);
  }

  let transaction: MutationTransaction;
  try {
    const prepared = prepareNativeMutation(request.intent, { corridor: planning.corridor, context: planning.context, allowedNewPaths: request.allowedNewPaths, maxFilesChanged: request.filePatcherPolicy?.maxFilesChanged ?? planning.corridor.files.length }, baseFiles(request.model), request.filePatcherPolicy);
    transaction = prepared.transaction;
    orchestrator.recordArtifact(request.runId, "mutation", transaction, { patchFingerprint: transaction.staged.patchFingerprint, changedPaths: transaction.staged.changedPaths });
  } catch (error) {
    return fail(orchestrator, request.runId, "mutation", error);
  }

  const propagation = assessPropagation(transaction.staged.changes, request.model, planning.corridor);
  orchestrator.recordArtifact(request.runId, "propagation", propagation, { certified: propagation.certified, outsideCorridorConsumers: propagation.outsideCorridorConsumers, contractDeltas: propagation.contractDeltas.length });
  if (!propagation.certified) return fail(orchestrator, request.runId, "propagation", new Error(propagation.gaps.join("; ") || "Change propagation did not certify."), propagation.gaps);

  orchestrator.transition(request.runId, "VALIDATING", "native_validation_started");
  let validation: NativeValidationReport;
  try {
    validation = await runNativeValidation({ structuralContext: { changes: transaction.staged.changes }, structuralValidators: request.structuralValidators, commandPlan: request.commandPlan, workspace: workspaceFor(transaction), sandboxRunner: request.sandboxRunner });
    orchestrator.recordArtifact(request.runId, "validation", validation, { passed: validation.passed, fingerprint: validation.fingerprint, commandCount: validation.commands.length, findingCount: validation.findings.length });
    transaction = await validateMutationTransaction(transaction, [{ name: "native-validation", validate: () => ({ validator: "native-validation", passed: validation.passed, summary: validation.passed ? "Native validation passed." : "Native validation failed.", details: { validationFingerprint: validation.fingerprint } }) }]);
    orchestrator.recordArtifact(request.runId, "mutation", transaction, { mutationState: transaction.state });
    if (!validation.passed || transaction.state !== "VALIDATED") return fail(orchestrator, request.runId, "validation", new Error("Native validation rejected the staged mutation."), validation.findings);
  } catch (error) {
    return fail(orchestrator, request.runId, "validation", error);
  }

  orchestrator.transition(request.runId, "PROMOTING", "native_promotion_started");
  try {
    transaction = await commitMutationTransaction(transaction, request.committer);
    orchestrator.recordArtifact(request.runId, "mutation", transaction, { mutationState: transaction.state, resultCommitSha: transaction.receipt?.commitSha ?? null });
    const receipt = transaction.receipt;
    if (!receipt) return fail(orchestrator, request.runId, "promotion", new Error("Mutation committer returned no receipt."));
    const succeeded = orchestrator.succeedNative(request.runId, receipt.commitSha, validation.fingerprint);
    succeeded.telemetry.record("SUCCEEDED", "native_artifact_summary", summarizeRunArtifacts(succeeded.artifacts));
    return Object.freeze({ run: succeeded, planning, propagation, validation, transaction });
  } catch (error) {
    return fail(orchestrator, request.runId, "promotion", error);
  }
}
