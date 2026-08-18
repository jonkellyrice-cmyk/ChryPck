import { createHash } from "node:crypto";
import { createDefaultAbstractionLock } from "../policy/abstraction-lock.js";
import { assertScopeLock } from "../policy/scope-lock.js";
import { buildRequestEnvelope, type RequestIdentity } from "./request-envelope.js";
import { createNativeRunArtifacts, type NativeRunArtifacts } from "./run-artifacts.js";
import { RunStore, type NativeToolchainRun } from "./run-store.js";
import { assertTransition, isTerminal, mapWorkflowState, type RunState } from "./run-state.js";
import { buildTerminalCompletionRecord, nativeFailureRecord, nativeSuccessRecord, RunTelemetry, stateRecord } from "./telemetry.js";
import type { NativeFailureEvidence } from "./failure-evidence.js";

export interface AdmitRequestInput { readonly repository: string; readonly request: Record<string, any>; readonly requestPath: string; }

function runIdFor(repository: string, identity: RequestIdentity): string {
  return `chrypck-${createHash("sha256").update(`${repository}:${identity.fingerprint}`).digest("hex").slice(0, 16)}`;
}

export class NativeOrchestrator {
  constructor(readonly store = new RunStore()) {}

  admitRequest(input: AdmitRequestInput): NativeToolchainRun {
    const envelope = buildRequestEnvelope(input.request, input.requestPath), existing = this.store.find(input.repository, envelope.request.fingerprint);
    if (existing) return existing;
    const scopeLock = assertScopeLock(input.request), abstractionLock = createDefaultAbstractionLock(scopeLock), runId = runIdFor(input.repository, envelope.request), telemetry = new RunTelemetry(runId);
    const run: NativeToolchainRun = {
      runId,
      repository: input.repository,
      requestPath: input.requestPath,
      requestIdentity: envelope.request,
      envelope,
      scopeLock,
      abstractionLock,
      state: "READY",
      stateRecord: stateRecord(envelope.request, "READY", { scope_lock: scopeLock }),
      telemetry,
      artifacts: createNativeRunArtifacts(),
      requestCommitSha: null,
      resultCommitSha: null
    };
    telemetry.record("READY", "request_admitted", { requestFingerprint: envelope.request.fingerprint });
    return this.store.put(run);
  }

  bindRequestCommit(runId: string, commitSha: string | null): NativeToolchainRun {
    const run = this.store.require(runId);
    run.requestCommitSha = commitSha;
    run.telemetry.record(run.state, "request_commit_bound", { commitSha });
    return run;
  }

  transition(runId: string, next: RunState, event: string = next): NativeToolchainRun {
    const run = this.store.require(runId);
    if (run.state === next) return run;
    if (isTerminal(run.state)) throw new Error(`Run ${runId} is terminal.`);
    assertTransition(run.state, next);
    run.state = next;
    run.stateRecord = stateRecord(run.requestIdentity, next, { scope_lock: run.scopeLock });
    run.telemetry.record(next, event);
    return run;
  }

  recordArtifact<K extends keyof NativeRunArtifacts>(runId: string, name: K, value: NativeRunArtifacts[K], summary: Readonly<Record<string, unknown>> = {}): NativeToolchainRun {
    const run = this.store.require(runId);
    if (isTerminal(run.state)) throw new Error(`Run ${runId} is terminal; artifacts are closed.`);
    run.artifacts[name] = value;
    run.telemetry.record(run.state, `artifact_${String(name)}`, summary);
    return run;
  }

  failNative(runId: string, evidence: NativeFailureEvidence): NativeToolchainRun {
    const run = this.store.require(runId);
    if (isTerminal(run.state)) return run;
    assertTransition(run.state, "FAILED");
    run.artifacts.failure = evidence;
    run.state = "FAILED";
    run.stateRecord = nativeFailureRecord(run.requestIdentity, evidence);
    run.telemetry.record("FAILED", "native_failure", { stage: evidence.failed_stage, failureClass: evidence.failure_class });
    return run;
  }

  succeedNative(runId: string, resultCommitSha: string, validationFingerprint: string): NativeToolchainRun {
    const run = this.store.require(runId);
    if (isTerminal(run.state)) throw new Error(`Run ${runId} is terminal.`);
    assertTransition(run.state, "SUCCEEDED");
    run.resultCommitSha = resultCommitSha;
    run.state = "SUCCEEDED";
    run.stateRecord = nativeSuccessRecord(run.requestIdentity, resultCommitSha, validationFingerprint);
    run.telemetry.record("SUCCEEDED", "native_success", { resultCommitSha, validationFingerprint });
    return run;
  }

  // Legacy workflow observation remains only until the v0.1 MCP surface is retired.
  observeWorkflow(runId: string, status: string, stepName = ""): NativeToolchainRun {
    const run = this.store.require(runId);
    if (isTerminal(run.state)) return run;
    const next = mapWorkflowState(status, stepName);
    if (next === "SUCCEEDED" || run.state === next) return run;
    const rank: Readonly<Record<RunState, number>> = { IDLE: 0, READY: 1, EXECUTING: 2, VALIDATING: 3, PROMOTING: 4, SUCCEEDED: 5, FAILED: 5, BLOCKED_IDENTICAL_FAILURE: 5, CAPABILITY_GAP: 5, CONFLICT: 5, SCOPE_VIOLATION: 5, SUPERSEDED: 5 };
    if (rank[next] <= rank[run.state]) return run;
    return this.transition(runId, next, `workflow_${next.toLowerCase()}`);
  }

  complete(runId: string, input: Readonly<{ conclusion: string; triggeringSha?: string | null; resultCommitSha?: string | null; workflow?: string; mutationAuthority?: string; failureEvidence?: Readonly<{ failed_stage?: string; failure_class?: string; summary?: string; relevant_evidence?: readonly unknown[] }> | null }>): NativeToolchainRun {
    const run = this.store.require(runId), record = buildTerminalCompletionRecord({ conclusion: input.conclusion, triggeringSha: input.triggeringSha ?? run.requestCommitSha ?? undefined, resultCommitSha: input.resultCommitSha ?? undefined, workflow: input.workflow, mutationAuthority: input.mutationAuthority, orchestratorRequest: run.requestIdentity }, input.failureEvidence ?? null);
    if (!record) throw new Error(`Unable to build terminal record for ${runId}.`);
    run.state = record.state;
    run.stateRecord = record;
    run.resultCommitSha = input.resultCommitSha ?? null;
    run.telemetry.record(record.state, "terminal_completion", { conclusion: input.conclusion });
    return run;
  }
}

export class RunController {
  constructor(readonly run: NativeToolchainRun) {}
  transition(next: RunState, event: string = next): NativeToolchainRun {
    if (this.run.state === next) return this.run;
    if (isTerminal(this.run.state)) throw new Error(`Run ${this.run.runId} is terminal.`);
    assertTransition(this.run.state, next);
    this.run.state = next;
    this.run.stateRecord = stateRecord(this.run.requestIdentity, next, { scope_lock: this.run.scopeLock });
    this.run.telemetry.record(next, event);
    return this.run;
  }
}
