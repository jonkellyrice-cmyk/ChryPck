import type { NativeFailureEvidence } from "./failure-evidence.js";
import type { RequestIdentity } from "./request-envelope.js";
import { assistantCapabilityPolicy, type RunState } from "./run-state.js";

export const TOOLCHAIN_ORCHESTRATOR_SCHEMA_VERSION = 2;
export const ORCHESTRATOR_STATUS_CONTEXT = "frame-conn/orchestrator"; // legacy compatibility only
export const NATIVE_MUTATION_AUTHORITY = "chrypck-native-filepatcher";

export interface RunEvent {
  readonly runId: string;
  readonly sequence: number;
  readonly at: string;
  readonly state: RunState;
  readonly event: string;
  readonly source: "native";
  readonly data?: Readonly<Record<string, unknown>>;
}

export class RunTelemetry {
  readonly #events: RunEvent[] = [];
  constructor(readonly runId: string) {}

  record(state: RunState, event: string, data?: Readonly<Record<string, unknown>>): RunEvent {
    const entry = Object.freeze({ runId: this.runId, sequence: this.#events.length + 1, at: new Date().toISOString(), state, event, source: "native" as const, ...(data ? { data } : {}) });
    this.#events.push(entry);
    return entry;
  }

  snapshot(): readonly RunEvent[] {
    return Object.freeze([...this.#events]);
  }
}

export interface FailureRecord {
  readonly request_id: string;
  readonly request_fingerprint: string;
  readonly state: "FAILED" | "BLOCKED_IDENTICAL_FAILURE";
  readonly failed_stage: string;
  readonly failure_class: string;
  readonly summary: string;
  readonly repository_changed: boolean;
  readonly promotion_completed: false;
  readonly relevant_evidence: readonly unknown[];
  readonly permitted_next_action: "modify_request";
}

export interface OrchestratorStateRecord {
  readonly schema_version: number;
  readonly request: Readonly<{ id: string | null; fingerprint: string | null }>;
  readonly state: RunState;
  readonly toolchain_authority: "canonical";
  readonly mutation_authority: string | null;
  readonly assistant_action_required: boolean;
  readonly permitted_next_action: string;
  readonly terminal: boolean;
  readonly validation_closed: boolean;
  readonly promotion_completed: boolean;
  readonly direct_github_mutation_permitted: false;
  readonly assistant_capabilities: ReturnType<typeof assistantCapabilityPolicy>;
  readonly failure: FailureRecord | null;
  readonly [key: string]: unknown;
}

export function stateRecord(identity: Pick<RequestIdentity, "id" | "fingerprint"> | null, state: RunState, overrides: Readonly<Record<string, unknown>> = {}): OrchestratorStateRecord {
  const terminal = ["SUCCEEDED", "FAILED", "BLOCKED_IDENTICAL_FAILURE", "CAPABILITY_GAP", "CONFLICT", "SCOPE_VIOLATION", "SUPERSEDED"].includes(state);
  return {
    schema_version: TOOLCHAIN_ORCHESTRATOR_SCHEMA_VERSION,
    request: { id: identity?.id ?? null, fingerprint: identity?.fingerprint ?? null },
    state,
    toolchain_authority: "canonical",
    mutation_authority: NATIVE_MUTATION_AUTHORITY,
    assistant_action_required: false,
    permitted_next_action: terminal ? "none" : "canonical_execute",
    terminal,
    validation_closed: state === "SUCCEEDED",
    promotion_completed: state === "SUCCEEDED",
    direct_github_mutation_permitted: false,
    assistant_capabilities: assistantCapabilityPolicy(state),
    failure: null,
    ...overrides
  } as OrchestratorStateRecord;
}

export function nativeSuccessRecord(identity: Pick<RequestIdentity, "id" | "fingerprint">, resultCommitSha: string, validationFingerprint: string): OrchestratorStateRecord {
  return stateRecord(identity, "SUCCEEDED", {
    mutation_authority: NATIVE_MUTATION_AUTHORITY,
    repository_changed: true,
    result_commit_sha: resultCommitSha,
    validation_fingerprint: validationFingerprint,
    validation_closed: true,
    promotion_completed: true,
    assistant_action_required: false,
    permitted_next_action: "none"
  });
}

export function nativeFailureRecord(identity: Pick<RequestIdentity, "id" | "fingerprint">, evidence: NativeFailureEvidence): OrchestratorStateRecord {
  const failure: FailureRecord = {
    request_id: identity.id,
    request_fingerprint: identity.fingerprint,
    state: "FAILED",
    failed_stage: evidence.failed_stage,
    failure_class: evidence.failure_class,
    summary: evidence.summary,
    repository_changed: false,
    promotion_completed: false,
    relevant_evidence: evidence.relevant_evidence,
    permitted_next_action: "modify_request"
  };
  return stateRecord(identity, "FAILED", {
    mutation_authority: NATIVE_MUTATION_AUTHORITY,
    assistant_action_required: true,
    permitted_next_action: "modify_request",
    validation_closed: false,
    promotion_completed: false,
    failure
  });
}

// Compatibility helper for the workflow-backed v0.1 MCP surface. Native execution does not use it.
export function buildTerminalCompletionRecord(telemetry: Readonly<{ conclusion?: string; triggeringSha?: string; resultCommitSha?: string; workflow?: string; mutationAuthority?: string; orchestratorRequest?: Pick<RequestIdentity, "id" | "fingerprint"> | null }>, failureEvidence: Readonly<{ failed_stage?: string; failure_class?: string; summary?: string; relevant_evidence?: readonly unknown[] }> | null = null): OrchestratorStateRecord | null {
  const identity = telemetry.orchestratorRequest ?? null;
  if (!identity) return null;
  const succeeded = String(telemetry.conclusion || "").toLowerCase() === "success";
  if (succeeded) return stateRecord(identity, "SUCCEEDED", { mutation_authority: telemetry.mutationAuthority ?? "filepatcher", repository_changed: Boolean(telemetry.resultCommitSha && telemetry.triggeringSha && telemetry.resultCommitSha !== telemetry.triggeringSha), validation_closed: true, promotion_completed: true, assistant_action_required: false, permitted_next_action: "none" });
  const failure: FailureRecord = { request_id: identity.id, request_fingerprint: identity.fingerprint, state: "FAILED", failed_stage: failureEvidence?.failed_stage ?? "workflow", failure_class: failureEvidence?.failure_class ?? "canonical_workflow_failure", summary: failureEvidence?.summary ?? `${telemetry.workflow || "Canonical workflow"} ended ${telemetry.conclusion || "unsuccessfully"}.`, repository_changed: Boolean(telemetry.resultCommitSha && telemetry.triggeringSha && telemetry.resultCommitSha !== telemetry.triggeringSha), promotion_completed: false, relevant_evidence: failureEvidence?.relevant_evidence ?? [], permitted_next_action: "modify_request" };
  return stateRecord(identity, "FAILED", { mutation_authority: telemetry.mutationAuthority ?? "filepatcher", assistant_action_required: true, permitted_next_action: "modify_request", validation_closed: false, promotion_completed: false, failure });
}
