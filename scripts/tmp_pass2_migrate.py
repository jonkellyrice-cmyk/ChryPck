from pathlib import Path
from textwrap import dedent

ROOT = Path(__file__).resolve().parents[1]


def write(rel: str, content: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dedent(content).lstrip(), encoding="utf-8")
    print(f"[pass2:migrate] wrote {rel}")


def replace_once(rel: str, old: str, new: str) -> None:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise RuntimeError(f"Expected exactly one anchor in {rel}: {old[:80]!r}; found {text.count(old)}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"[pass2:migrate] patched {rel}")


write("src/core/run/request-envelope.ts", r'''
import { createHash } from "node:crypto";

import { buildScopeLock, type ScopeLockResult } from "../policy/scope-lock.js";

export const REQUEST_ENVELOPE_SCHEMA_VERSION = 1;
export const DEFAULT_REQUEST_PATH = "dev_scripts/github-filepatcher.json";

export interface RequestIdentity {
  readonly id: string;
  readonly fingerprint: string;
  readonly fingerprint_short: string;
  readonly request_path: string;
}

export interface RequestEnvelope {
  readonly schema_version: number;
  readonly kind: "frame_conn_request_envelope";
  readonly request: RequestIdentity;
  readonly scope_lock: Readonly<{
    state: ScopeLockResult["state"];
    fingerprint: string | null;
    objective_fingerprint: string | null;
    original_user_instruction: string | null;
    authorized_deliverables: readonly string[];
    authority: ScopeLockResult["authority"] | null;
    violations: ScopeLockResult["violations"];
  }>;
  readonly intent: Readonly<{
    goal: string | null;
    acceptance_criteria: readonly string[];
    non_goals: readonly string[];
  }>;
  readonly scope: Readonly<{
    explicit: readonly string[];
    allowed_paths: readonly string[];
    operation_paths: readonly string[];
  }>;
  readonly evidence: readonly unknown[];
  readonly manifest: Readonly<{ artifacts: unknown; result: unknown }>;
  readonly source: Readonly<{
    request_path: string;
    authored_id: string | null;
    description: string | null;
    schema_version: unknown;
    operation_count: number;
  }>;
  readonly authority: Readonly<{
    authoritative_for: readonly string[];
    not_authoritative_for: readonly string[];
  }>;
  readonly envelope_fingerprint: string;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, stable(record[key])]));
  }
  return value;
}

function hash(value: unknown): string {
  const serialized = JSON.stringify(stable(value));
  if (serialized === undefined) throw new TypeError("Request Envelope fingerprint input must be JSON-serializable.");
  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

function strings(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(entry => String(entry).trim()).filter(Boolean))];
}

function repoPath(value: unknown): string {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
}

export function semanticRequestProjection(request: Record<string, any>): unknown {
  const value: Record<string, any> = { ...(request ?? {}) };
  for (const key of [
    "id", "description", "orchestrator", "telemetry", "execution_metadata",
    "runtime_metadata", "request_id", "request_fingerprint", "request_envelope",
    "toolchain_artifacts", "result", "raw_operations_reason", "native_run",
    "last_applied_at", "last_applied_by"
  ]) delete value[key];
  return stable(value);
}

export function fingerprintRequest(request: Record<string, any>): string {
  return hash(semanticRequestProjection(request));
}

export function buildRequestIdentity(request: Record<string, any>, requestPath = DEFAULT_REQUEST_PATH): RequestIdentity {
  const fingerprint = fingerprintRequest(request);
  const label = String(request?.id || "request").trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "request";
  return {
    id: `${label}-${fingerprint.slice(0, 12)}`,
    fingerprint,
    fingerprint_short: fingerprint.slice(0, 12),
    request_path: repoPath(requestPath)
  };
}

export function operationPaths(request: Record<string, any>): string[] {
  const output: string[] = [];
  for (const operation of request?.operations ?? []) {
    for (const key of ["path", "from", "to"] as const) if (operation?.[key]) output.push(repoPath(operation[key]));
    for (const root of operation?.roots ?? []) output.push(repoPath(root));
  }
  for (const edit of request?.authoring_intent?.edits ?? []) if (edit?.path) output.push(repoPath(edit.path));
  for (const move of request?.moves ?? []) {
    if (move?.from) output.push(repoPath(move.from));
    if (move?.to) output.push(repoPath(move.to));
  }
  for (const candidate of request?.candidates ?? []) {
    if (candidate?.source) output.push(repoPath(candidate.source));
    for (const unit of candidate?.units ?? []) if (unit?.target) output.push(repoPath(unit.target));
  }
  return [...new Set(output.filter(Boolean))].sort();
}

function artifacts(value: unknown): unknown {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return stable(Object.fromEntries(Object.entries(source).map(([name, item]) => [
    name,
    typeof item === "string" ? { ref: item } : item
  ])));
}

export function buildRequestEnvelope(
  request: Record<string, any>,
  requestPath = DEFAULT_REQUEST_PATH,
  options: Readonly<{ artifacts?: unknown; result?: unknown }> = {}
): RequestEnvelope {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("Request Envelope requires an object.");
  }
  const identity = buildRequestIdentity(request, requestPath);
  const scopeLock = buildScopeLock(request);
  const envelopeWithoutFingerprint = {
    schema_version: REQUEST_ENVELOPE_SCHEMA_VERSION,
    kind: "frame_conn_request_envelope" as const,
    request: identity,
    scope_lock: {
      state: scopeLock.state,
      fingerprint: scopeLock.fingerprint,
      objective_fingerprint: scopeLock.objective_fingerprint ?? null,
      original_user_instruction: scopeLock.original_user_instruction ?? null,
      authorized_deliverables: scopeLock.authorized_deliverables ?? [],
      authority: scopeLock.authority ?? null,
      violations: scopeLock.violations ?? []
    },
    intent: {
      goal: String(request.planning_goal ?? request.goal ?? "").trim() || null,
      acceptance_criteria: strings(request.acceptance_criteria ?? request.acceptanceCriteria),
      non_goals: strings(request.non_goals ?? request.nonGoals)
    },
    scope: {
      explicit: strings(request.scope).map(repoPath).sort(),
      allowed_paths: strings(request?.policy?.allowed_paths).map(repoPath).sort(),
      operation_paths: operationPaths(request)
    },
    evidence: Array.isArray(request.evidence) ? stable(request.evidence) as readonly unknown[] : [],
    manifest: {
      artifacts: artifacts(options.artifacts ?? request.toolchain_artifacts),
      result: options.result ?? request.result ?? null
    },
    source: {
      request_path: repoPath(requestPath),
      authored_id: typeof request.id === "string" ? request.id : null,
      description: typeof request.description === "string" ? request.description : null,
      schema_version: request.schema_version ?? null,
      operation_count: request.operations?.length ?? 0
    },
    authority: {
      authoritative_for: [
        "semantic_request_identity", "scope_lock", "original_user_instruction", "request_goal",
        "acceptance_criteria", "non_goals", "declared_scope", "request_artifact_index"
      ],
      not_authoritative_for: [
        "architectural_ownership", "patch_corridor_certification", "mutation_operations", "validation", "promotion"
      ]
    }
  };
  return Object.freeze({
    ...envelopeWithoutFingerprint,
    envelope_fingerprint: hash(envelopeWithoutFingerprint)
  });
}
''')

write("src/core/run/run-state.ts", r'''
import { PolicyError } from "../policy/errors.js";

export const ORCHESTRATOR_STATES = [
  "IDLE", "READY", "EXECUTING", "VALIDATING", "PROMOTING",
  "SUCCEEDED", "FAILED", "BLOCKED_IDENTICAL_FAILURE", "CAPABILITY_GAP",
  "CONFLICT", "SCOPE_VIOLATION", "SUPERSEDED"
] as const;

export type RunState = typeof ORCHESTRATOR_STATES[number];

export const TERMINAL_RUN_STATES: ReadonlySet<RunState> = new Set([
  "SUCCEEDED", "FAILED", "BLOCKED_IDENTICAL_FAILURE", "CAPABILITY_GAP",
  "CONFLICT", "SCOPE_VIOLATION", "SUPERSEDED"
]);

export const isTerminal = (state: RunState): boolean => TERMINAL_RUN_STATES.has(state);

const ALLOWED_TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  IDLE: ["READY", "SCOPE_VIOLATION", "CONFLICT", "CAPABILITY_GAP"],
  READY: ["EXECUTING", "SUCCEEDED", "FAILED", "CONFLICT", "CAPABILITY_GAP", "BLOCKED_IDENTICAL_FAILURE", "SUPERSEDED"],
  EXECUTING: ["VALIDATING", "PROMOTING", "SUCCEEDED", "FAILED", "CAPABILITY_GAP", "CONFLICT"],
  VALIDATING: ["PROMOTING", "SUCCEEDED", "FAILED", "CAPABILITY_GAP", "CONFLICT"],
  PROMOTING: ["SUCCEEDED", "FAILED", "CAPABILITY_GAP", "CONFLICT"],
  SUCCEEDED: [],
  FAILED: [],
  BLOCKED_IDENTICAL_FAILURE: [],
  CAPABILITY_GAP: [],
  CONFLICT: [],
  SCOPE_VIOLATION: [],
  SUPERSEDED: []
};

export function assertTransition(from: RunState, to: RunState): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new PolicyError("INVALID_RUN_TRANSITION", `Invalid run transition ${from} -> ${to}.`, { from, to });
  }
}

export interface AssistantCapabilityPolicy {
  readonly repository_read_mode: string;
  readonly direct_source_reconstruction_permitted: boolean;
  readonly targeted_source_expansion_policy: string;
  readonly github_workflow_reads_permitted: false;
  readonly raw_job_log_reads_permitted: false;
  readonly generic_direct_github_write_permitted: false;
  readonly protected_path_publication: string;
  readonly permitted_actions: readonly string[];
}

export function assistantCapabilityPolicy(state: RunState): AssistantCapabilityPolicy {
  const permittedActionsByState: Readonly<Record<RunState, readonly string[]>> = {
    IDLE: ["author_bounded_request"],
    READY: ["canonical_execute"],
    EXECUTING: [],
    VALIDATING: [],
    PROMOTING: [],
    SUCCEEDED: [],
    FAILED: ["consume_failure_evidence", "modify_canonical_request"],
    BLOCKED_IDENTICAL_FAILURE: ["modify_canonical_request"],
    CAPABILITY_GAP: ["request_explicit_user_authorization"],
    SCOPE_VIOLATION: ["request_explicit_user_authorization_or_narrow_request"],
    CONFLICT: ["await_current_owner_or_modify_request"],
    SUPERSEDED: []
  };
  const active = ["READY", "EXECUTING", "VALIDATING", "PROMOTING"].includes(state);
  const failed = ["FAILED", "BLOCKED_IDENTICAL_FAILURE"].includes(state);
  const closed = ["SUCCEEDED", "SUPERSEDED"].includes(state);
  return {
    repository_read_mode: state === "IDLE"
      ? "open_discovery"
      : active ? "curated_context_only"
      : failed ? "failure_evidence_only"
      : state === "CAPABILITY_GAP" ? "capability_gap_only"
      : state === "SCOPE_VIOLATION" ? "scope_lock_only"
      : state === "CONFLICT" ? "ownership_resolution_only"
      : closed ? "closed"
      : "curated_context_only",
    direct_source_reconstruction_permitted: state === "IDLE",
    targeted_source_expansion_policy: state === "IDLE"
      ? "open"
      : active ? "canonical_context_insufficiency_only"
      : failed ? "failure_evidence_extractor_only"
      : "forbidden",
    github_workflow_reads_permitted: false,
    raw_job_log_reads_permitted: false,
    generic_direct_github_write_permitted: false,
    protected_path_publication: state === "CAPABILITY_GAP"
      ? "infrastructure_publisher_after_explicit_authorization_only"
      : "forbidden",
    permitted_actions: permittedActionsByState[state]
  };
}

export function mapWorkflowState(status: string, stepName = ""): RunState {
  const normalizedStatus = String(status || "").toLowerCase();
  const step = String(stepName || "").toLowerCase();
  if (normalizedStatus === "completed") return "SUCCEEDED";
  if (step.includes("commit") || step.includes("push") || step.includes("promot")) return "PROMOTING";
  if (step.includes("validate") || step.includes("audit") || step.includes("diff") || step.includes("propagation") || step.includes("test")) return "VALIDATING";
  return "EXECUTING";
}
''')

write("src/core/run/telemetry.ts", r'''
import type { RequestIdentity } from "./request-envelope.js";
import { assistantCapabilityPolicy, type RunState } from "./run-state.js";

export const TOOLCHAIN_ORCHESTRATOR_SCHEMA_VERSION = 1;
export const ORCHESTRATOR_STATUS_CONTEXT = "frame-conn/orchestrator";

export interface RunEvent {
  readonly runId: string;
  readonly sequence: number;
  readonly at: string;
  readonly state: RunState;
  readonly event: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export class RunTelemetry {
  readonly #events: RunEvent[] = [];
  constructor(readonly runId: string) {}
  record(state: RunState, event: string, data?: Readonly<Record<string, unknown>>): RunEvent {
    const entry = Object.freeze({
      runId: this.runId,
      sequence: this.#events.length + 1,
      at: new Date().toISOString(),
      state,
      event,
      ...(data ? { data } : {})
    });
    this.#events.push(entry);
    return entry;
  }
  snapshot(): readonly RunEvent[] { return Object.freeze([...this.#events]); }
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

export function stateRecord(
  identity: Pick<RequestIdentity, "id" | "fingerprint"> | null,
  state: RunState,
  overrides: Readonly<Record<string, unknown>> = {}
): OrchestratorStateRecord {
  const terminal = ["SUCCEEDED", "FAILED", "BLOCKED_IDENTICAL_FAILURE", "CAPABILITY_GAP", "CONFLICT", "SCOPE_VIOLATION", "SUPERSEDED"].includes(state);
  return {
    schema_version: TOOLCHAIN_ORCHESTRATOR_SCHEMA_VERSION,
    request: { id: identity?.id ?? null, fingerprint: identity?.fingerprint ?? null },
    state,
    toolchain_authority: "canonical",
    mutation_authority: "filepatcher",
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

export function buildCapabilityGapRecord(input: Readonly<{
  identity: Pick<RequestIdentity, "id" | "fingerprint">;
  requestedOperation: string;
  canonicalPath: string;
  missingCapability: string;
  blockingReason: string;
  directAction: string;
  affected?: readonly string[];
  resumeAuthority?: string;
  mutationAuthority?: string;
}>): OrchestratorStateRecord {
  return stateRecord(input.identity, "CAPABILITY_GAP", {
    mutation_authority: input.mutationAuthority ?? "filepatcher",
    assistant_action_required: true,
    permitted_next_action: "request_explicit_user_authorization",
    capability_gap: {
      requested_operation: input.requestedOperation,
      canonical_toolchain_path: input.canonicalPath,
      missing_capability: input.missingCapability,
      blocking_reason: input.blockingReason,
      smallest_direct_github_action: input.directAction,
      affected_paths_or_refs: input.affected ?? [],
      normal_authority_after_exception: input.resumeAuthority ?? "FilePatcher / canonical workflow",
      explicit_user_authorization_required: true,
      exception_publisher: "native_chrypck_policy_boundary",
      exception_publisher_mode: "single_explicitly_authorized_protected_file"
    }
  });
}

export function buildTerminalCompletionRecord(
  telemetry: Readonly<{
    conclusion?: string;
    triggeringSha?: string;
    resultCommitSha?: string;
    workflow?: string;
    mutationAuthority?: string;
    orchestratorRequest?: Pick<RequestIdentity, "id" | "fingerprint"> | null;
  }>,
  failureEvidence: Readonly<{
    failed_stage?: string;
    failure_class?: string;
    summary?: string;
    relevant_evidence?: readonly unknown[];
  }> | null = null
): OrchestratorStateRecord | null {
  const identity = telemetry.orchestratorRequest ?? null;
  if (!identity) return null;
  const succeeded = String(telemetry.conclusion || "").toLowerCase() === "success";
  if (succeeded) {
    return stateRecord(identity, "SUCCEEDED", {
      mutation_authority: telemetry.mutationAuthority ?? "filepatcher",
      repository_changed: Boolean(telemetry.resultCommitSha && telemetry.triggeringSha && telemetry.resultCommitSha !== telemetry.triggeringSha),
      validation_closed: true,
      promotion_completed: true,
      assistant_action_required: false,
      permitted_next_action: "none"
    });
  }
  const failure: FailureRecord = {
    request_id: identity.id,
    request_fingerprint: identity.fingerprint,
    state: "FAILED",
    failed_stage: failureEvidence?.failed_stage ?? "workflow",
    failure_class: failureEvidence?.failure_class ?? "canonical_workflow_failure",
    summary: failureEvidence?.summary ?? `${telemetry.workflow || "Canonical workflow"} ended ${telemetry.conclusion || "unsuccessfully"}.`,
    repository_changed: Boolean(telemetry.resultCommitSha && telemetry.triggeringSha && telemetry.resultCommitSha !== telemetry.triggeringSha),
    promotion_completed: false,
    relevant_evidence: failureEvidence?.relevant_evidence ?? [],
    permitted_next_action: "modify_request"
  };
  return stateRecord(identity, "FAILED", {
    mutation_authority: telemetry.mutationAuthority ?? "filepatcher",
    assistant_action_required: true,
    permitted_next_action: "modify_request",
    validation_closed: false,
    promotion_completed: false,
    failure
  });
}
''')

write("src/core/run/failure-evidence.ts", r'''
export const FAILURE_EVIDENCE_EXTRACTOR_SCHEMA_VERSION = 1;
const ERROR_LINE_PATTERN = /\b(error|failed|failure|fatal|exception|assert(?:ion)?|mismatch|not found|cannot|unable|rejected|denied|enoent|eacces|syntaxerror|typeerror|referenceerror|exit code\s+[1-9]|exited with code\s+[1-9])\b/i;
const PATH_PATTERN = /(?:^|[\s("'`])((?:dev_scripts|scripts|styles|Docs|\.github)\/[A-Za-z0-9_.\/-]+|(?:package|module)\.json)\b/g;
const MAX_ANCHORS = 8;
const CONTEXT_RADIUS = 2;
const MAX_EXCERPT_LINES = 24;
const MAX_LINE_LENGTH = 420;

const normalizeRepoPath = (value: unknown) => String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
const unique = <T>(values: readonly T[]) => [...new Set(values.filter(Boolean))];

function redactSecrets(value: unknown): string {
  return String(value)
    .replace(/(authorization:\s*bearer\s+)[^\s]+/ig, "$1[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/([?&](?:token|access_token|signature|sig)=)[^&\s]+/ig, "$1[REDACTED]");
}

function cleanLogLine(value: unknown): string {
  return redactSecrets(String(value ?? "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s*/, "")
    .trimEnd()).slice(0, MAX_LINE_LENGTH);
}

export function classifyFailureStage(stageName = ""): string {
  const stage = String(stageName).toLowerCase();
  if (stage.includes("commit") || stage.includes("push") || stage.includes("promot")) return "promotion_failure";
  if (stage.includes("publish") || stage.includes("permission") || stage.includes("protected")) return "publication_failure";
  if (["validate", "audit", "diff", "test", "propagation", "compatibility", "syntax"].some(token => stage.includes(token))) return "validation_failure";
  if (["corridor", "context", "plan"].some(token => stage.includes(token))) return "planning_failure";
  return "canonical_workflow_failure";
}

export function extractRepositoryPaths(text: string): string[] {
  const output: string[] = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    PATH_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PATH_PATTERN.exec(line))) output.push(normalizeRepoPath(match[1]).replace(/[),:;]+$/, ""));
  }
  return unique(output).sort();
}

export function extractLogEvidence(logText: string, options: Readonly<{ scopePaths?: readonly string[] }> = {}) {
  const cleaned = String(logText ?? "").split(/\r?\n/).map(cleanLogLine);
  const anchorIndexes: number[] = [];
  for (let index = 0; index < cleaned.length && anchorIndexes.length < MAX_ANCHORS; index += 1) {
    if (ERROR_LINE_PATTERN.test(cleaned[index] ?? "")) anchorIndexes.push(index);
  }
  const selectedIndexes = new Set<number>();
  for (const anchor of anchorIndexes) {
    for (let index = Math.max(0, anchor - CONTEXT_RADIUS); index <= Math.min(cleaned.length - 1, anchor + CONTEXT_RADIUS); index += 1) selectedIndexes.add(index);
  }
  const excerpt = [...selectedIndexes].sort((a, b) => a - b).slice(0, MAX_EXCERPT_LINES)
    .map(index => ({ line: index + 1, text: cleaned[index] ?? "" })).filter(entry => entry.text);
  const paths = extractRepositoryPaths(excerpt.map(entry => entry.text).join("\n"));
  const scopePaths = unique((options.scopePaths ?? []).map(normalizeRepoPath));
  const scopeSet = new Set(scopePaths);
  return {
    anchor_count: anchorIndexes.length,
    excerpt,
    evidence_paths: paths,
    in_scope_paths: paths.filter(item => scopeSet.has(item)),
    outside_scope_paths: paths.filter(item => scopePaths.length > 0 && !scopeSet.has(item))
  };
}

function collectFindingSignatures(value: unknown, output = new Set<string>()): Set<string> {
  if (value == null) return output;
  if (Array.isArray(value)) { for (const item of value) collectFindingSignatures(item, output); return output; }
  if (typeof value !== "object") return output;
  const record = value as Record<string, unknown>;
  const signature: Record<string, unknown> = {};
  for (const key of ["code", "path", "file", "message", "summary", "rule", "type"]) {
    if (record[key] !== undefined && record[key] !== null) signature[key] = record[key];
  }
  if (Object.keys(signature).length >= 2 || signature.message || signature.summary) output.add(JSON.stringify(signature));
  for (const [key, item] of Object.entries(record)) {
    if (["findings", "errors", "warnings", "issues", "violations", "results", "diagnostics"].includes(key)) collectFindingSignatures(item, output);
  }
  return output;
}

export function classifyRegression(input: Readonly<{ baseline?: unknown; current?: unknown; scopePaths?: readonly string[]; evidencePaths?: readonly string[] }> = {}) {
  const normalizedScope = unique((input.scopePaths ?? []).map(normalizeRepoPath));
  if (input.baseline && input.current) {
    const before = collectFindingSignatures(input.baseline);
    const after = collectFindingSignatures(input.current);
    const introduced = [...after].filter(signature => !before.has(signature));
    const resolved = [...before].filter(signature => !after.has(signature));
    if (introduced.length === 0) return { classification: "pre_existing_only", basis: "canonical_baseline_delta", introduced_count: 0, resolved_count: resolved.length };
    const introducedInScope = introduced.filter(signature => normalizedScope.some(scopePath => signature.includes(scopePath)));
    return {
      classification: introducedInScope.length ? "request_regression" : "introduced_outside_request_scope",
      basis: "canonical_baseline_delta",
      introduced_count: introduced.length,
      introduced_in_scope_count: introducedInScope.length,
      resolved_count: resolved.length
    };
  }
  const normalizedEvidence = unique((input.evidencePaths ?? []).map(normalizeRepoPath));
  const scopeSet = new Set(normalizedScope);
  const inScope = normalizedEvidence.filter(item => scopeSet.has(item));
  if (normalizedScope.length && inScope.length) return { classification: "request_scope_failure", basis: "terminal_log_path_overlap", in_scope_path_count: inScope.length };
  if (normalizedScope.length && normalizedEvidence.length) return { classification: "outside_request_scope_unproven", basis: "terminal_log_paths_outside_scope", outside_scope_path_count: normalizedEvidence.length };
  return { classification: "undetermined", basis: "insufficient_baseline_or_path_evidence" };
}

export function buildFailureEvidence(input: Readonly<{
  workflow: string;
  conclusion?: string;
  stage?: string;
  logText?: string;
  scopePaths?: readonly string[];
  baseline?: unknown;
  current?: unknown;
  job?: Readonly<{ name?: string; id?: number; conclusion?: string }> | null;
}>) {
  const stage = input.stage || input.job?.name || "workflow";
  const logEvidence = extractLogEvidence(input.logText ?? "", { scopePaths: input.scopePaths ?? [] });
  const regression = classifyRegression({ baseline: input.baseline, current: input.current, scopePaths: input.scopePaths ?? [], evidencePaths: logEvidence.evidence_paths });
  const summarySuffix = regression.classification === "pre_existing_only"
    ? " Canonical baseline evidence shows no newly introduced finding."
    : regression.classification === "outside_request_scope_unproven"
      ? " Terminal evidence points outside the bounded request scope, but no baseline proves it was pre-existing."
      : regression.classification === "request_regression"
        ? " Canonical baseline evidence identifies a newly introduced in-scope regression."
        : "";
  return {
    schema_version: FAILURE_EVIDENCE_EXTRACTOR_SCHEMA_VERSION,
    kind: "frame_conn_terminal_failure_evidence" as const,
    failed_stage: stage,
    failure_class: classifyFailureStage(stage),
    summary: `${input.workflow || "Canonical workflow"} failed at ${stage}.${summarySuffix}`.trim(),
    regression_classification: regression,
    request_scope_paths: input.scopePaths ?? [],
    relevant_evidence: [{
      job: input.job?.name ?? null,
      job_id: input.job?.id ?? null,
      step: input.stage ?? null,
      conclusion: input.job?.conclusion ?? input.conclusion ?? "failure",
      evidence_paths: logEvidence.evidence_paths,
      log_excerpt: logEvidence.excerpt
    }],
    permitted_next_action: "modify_request" as const
  };
}
''')

write("src/core/run/run-store.ts", r'''
import type { AbstractionLock } from "../policy/abstraction-lock.js";
import type { ScopeLock } from "../policy/scope-lock.js";
import type { RequestEnvelope, RequestIdentity } from "./request-envelope.js";
import type { OrchestratorStateRecord, RunTelemetry } from "./telemetry.js";
import type { RunState } from "./run-state.js";

export interface NativeToolchainRun {
  readonly runId: string;
  readonly repository: string;
  readonly requestPath: string;
  readonly requestIdentity: RequestIdentity;
  readonly envelope: RequestEnvelope;
  readonly scopeLock: ScopeLock;
  readonly abstractionLock: AbstractionLock;
  state: RunState;
  stateRecord: OrchestratorStateRecord;
  readonly telemetry: RunTelemetry;
  requestCommitSha: string | null;
  resultCommitSha: string | null;
}

export class RunStore {
  readonly #runs = new Map<string, NativeToolchainRun>();
  readonly #byRequest = new Map<string, string>();

  private requestKey(repository: string, fingerprint: string): string { return `${repository}@${fingerprint}`; }

  put(run: NativeToolchainRun): NativeToolchainRun {
    this.#runs.set(run.runId, run);
    this.#byRequest.set(this.requestKey(run.repository, run.requestIdentity.fingerprint), run.runId);
    return run;
  }

  get(runId: string): NativeToolchainRun | null { return this.#runs.get(runId) ?? null; }

  find(repository: string, fingerprint: string): NativeToolchainRun | null {
    const runId = this.#byRequest.get(this.requestKey(repository, fingerprint));
    return runId ? this.get(runId) : null;
  }

  require(runId: string): NativeToolchainRun {
    const run = this.get(runId);
    if (!run) throw new Error(`Unknown ChryPck run: ${runId}`);
    return run;
  }

  snapshot(): readonly NativeToolchainRun[] { return Object.freeze([...this.#runs.values()]); }
}
''')

write("src/core/run/orchestrator.ts", r'''
import { createHash } from "node:crypto";

import { createDefaultAbstractionLock } from "../policy/abstraction-lock.js";
import { assertScopeLock } from "../policy/scope-lock.js";
import { buildRequestEnvelope, type RequestIdentity } from "./request-envelope.js";
import { RunStore, type NativeToolchainRun } from "./run-store.js";
import { assertTransition, isTerminal, mapWorkflowState, type RunState } from "./run-state.js";
import { buildTerminalCompletionRecord, RunTelemetry, stateRecord } from "./telemetry.js";

export interface AdmitRequestInput {
  readonly repository: string;
  readonly request: Record<string, any>;
  readonly requestPath: string;
}

function runIdFor(repository: string, identity: RequestIdentity): string {
  return `chrypck-${createHash("sha256").update(`${repository}:${identity.fingerprint}`).digest("hex").slice(0, 16)}`;
}

export class NativeOrchestrator {
  constructor(readonly store = new RunStore()) {}

  admitRequest(input: AdmitRequestInput): NativeToolchainRun {
    const envelope = buildRequestEnvelope(input.request, input.requestPath);
    const existing = this.store.find(input.repository, envelope.request.fingerprint);
    if (existing) return existing;
    const scopeLock = assertScopeLock(input.request);
    const abstractionLock = createDefaultAbstractionLock(scopeLock);
    const runId = runIdFor(input.repository, envelope.request);
    const telemetry = new RunTelemetry(runId);
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

  transition(runId: string, next: RunState, event = next): NativeToolchainRun {
    const run = this.store.require(runId);
    if (run.state === next) return run;
    if (isTerminal(run.state)) throw new Error(`Run ${runId} is terminal.`);
    assertTransition(run.state, next);
    run.state = next;
    run.stateRecord = stateRecord(run.requestIdentity, next, { scope_lock: run.scopeLock });
    run.telemetry.record(next, event);
    return run;
  }

  observeWorkflow(runId: string, status: string, stepName = ""): NativeToolchainRun {
    const run = this.store.require(runId);
    if (isTerminal(run.state)) return run;
    const next = mapWorkflowState(status, stepName);
    if (next === "SUCCEEDED") return run;
    if (run.state === next) return run;
    const rank: Readonly<Record<RunState, number>> = {
      IDLE: 0, READY: 1, EXECUTING: 2, VALIDATING: 3, PROMOTING: 4,
      SUCCEEDED: 5, FAILED: 5, BLOCKED_IDENTICAL_FAILURE: 5, CAPABILITY_GAP: 5,
      CONFLICT: 5, SCOPE_VIOLATION: 5, SUPERSEDED: 5
    };
    if (rank[next] <= rank[run.state]) return run;
    return this.transition(runId, next, `workflow_${next.toLowerCase()}`);
  }

  complete(runId: string, input: Readonly<{
    conclusion: string;
    triggeringSha?: string | null;
    resultCommitSha?: string | null;
    workflow?: string;
    mutationAuthority?: string;
    failureEvidence?: Readonly<{ failed_stage?: string; failure_class?: string; summary?: string; relevant_evidence?: readonly unknown[] }> | null;
  }>): NativeToolchainRun {
    const run = this.store.require(runId);
    const record = buildTerminalCompletionRecord({
      conclusion: input.conclusion,
      triggeringSha: input.triggeringSha ?? run.requestCommitSha ?? undefined,
      resultCommitSha: input.resultCommitSha ?? undefined,
      workflow: input.workflow,
      mutationAuthority: input.mutationAuthority,
      orchestratorRequest: run.requestIdentity
    }, input.failureEvidence ?? null);
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
  transition(next: RunState, event = next): NativeToolchainRun {
    if (this.run.state === next) return this.run;
    if (isTerminal(this.run.state)) throw new Error(`Run ${this.run.runId} is terminal.`);
    assertTransition(this.run.state, next);
    this.run.state = next;
    this.run.stateRecord = stateRecord(this.run.requestIdentity, next, { scope_lock: this.run.scopeLock });
    this.run.telemetry.record(next, event);
    return this.run;
  }
}
''')

write("test/pass2-run-core.test.ts", r'''
import assert from "node:assert/strict";
import test from "node:test";

import { buildFailureEvidence, classifyFailureStage } from "../src/core/run/failure-evidence.js";
import { NativeOrchestrator } from "../src/core/run/orchestrator.js";
import { buildRequestEnvelope } from "../src/core/run/request-envelope.js";

function request() {
  return {
    schema_version: 2,
    id: "scan-a",
    scope_lock: {
      original_user_instruction: "Route Scan through native execution.",
      authorized_deliverables: ["Route Scan"],
      authorized_paths: ["scripts/a.js", "scripts/b.js"],
      forbidden_expansions: ["No menu redesign"]
    },
    description: "label a",
    planning_goal: "Route Scan through native execution.",
    acceptance_criteria: ["Native Scan executes", "Targeting preserved"],
    non_goals: ["No menu redesign"],
    policy: { allowed_paths: ["scripts/a.js", "scripts/b.js"] },
    operations: [{ type: "replace_text", path: "scripts/a.js", search: "old", replace: "new" }]
  };
}

test("Request Envelope preserves semantic identity across relabeling", () => {
  const base = request();
  const relabeled = { ...base, id: "scan-b", description: "label b" };
  const changed = { ...base, planning_goal: "Route Scan through alternate execution." };
  const a = buildRequestEnvelope(base);
  const b = buildRequestEnvelope(relabeled);
  const c = buildRequestEnvelope(changed);
  assert.equal(a.request.fingerprint, b.request.fingerprint);
  assert.notEqual(a.request.fingerprint, c.request.fingerprint);
  assert.equal(a.intent.acceptance_criteria.length, 2);
  assert.ok(a.scope.operation_paths.includes("scripts/a.js"));
  assert.match(a.envelope_fingerprint, /^[a-f0-9]{64}$/);
});

test("Native orchestrator admits, advances, and closes a run", () => {
  const orchestrator = new NativeOrchestrator();
  const run = orchestrator.admitRequest({ repository: "owner/repo", request: request(), requestPath: "dev_scripts/github-filepatcher.json" });
  assert.equal(run.state, "READY");
  orchestrator.bindRequestCommit(run.runId, "1".repeat(40));
  orchestrator.observeWorkflow(run.runId, "in_progress", "Apply FilePatcher");
  assert.equal(run.state, "EXECUTING");
  orchestrator.observeWorkflow(run.runId, "in_progress", "Validate diff");
  assert.equal(run.state, "VALIDATING");
  orchestrator.observeWorkflow(run.runId, "in_progress", "Commit verified patch");
  assert.equal(run.state, "PROMOTING");
  orchestrator.complete(run.runId, { conclusion: "success", triggeringSha: "1".repeat(40), resultCommitSha: "2".repeat(40) });
  assert.equal(run.state, "SUCCEEDED");
  assert.equal(run.stateRecord.permitted_next_action, "none");
  assert.equal(run.stateRecord.validation_closed, true);
  assert.equal(run.stateRecord.assistant_capabilities.permitted_actions.length, 0);
});

test("Native orchestrator records bounded terminal failure evidence", () => {
  const orchestrator = new NativeOrchestrator();
  const run = orchestrator.admitRequest({ repository: "owner/repo", request: request(), requestPath: "dev_scripts/github-filepatcher.json" });
  const evidence = buildFailureEvidence({
    workflow: "GitHub FilePatcher",
    stage: "Validate diff",
    scopePaths: ["scripts/a.js"],
    logText: "Error: mismatch\n at scripts/a.js:12\nProcess exited with code 1"
  });
  orchestrator.complete(run.runId, {
    conclusion: "failure",
    triggeringSha: "1".repeat(40),
    resultCommitSha: "1".repeat(40),
    workflow: "GitHub FilePatcher",
    failureEvidence: evidence
  });
  assert.equal(run.state, "FAILED");
  assert.equal(run.stateRecord.failure?.failure_class, "validation_failure");
  assert.equal(run.stateRecord.permitted_next_action, "modify_request");
});

test("failure stage classifier preserves authoritative categories", () => {
  assert.equal(classifyFailureStage("Commit verified patch"), "promotion_failure");
  assert.equal(classifyFailureStage("Repository audit"), "validation_failure");
  assert.equal(classifyFailureStage("Patch corridor"), "planning_failure");
});
''')

write("test/native-scaffold.test.ts", r'''
import assert from "node:assert/strict";
import test from "node:test";

import { NativeOrchestrator } from "../src/core/run/orchestrator.js";
import { stagePatch } from "../src/mutation/file-patcher.js";

test("native orchestrator begins at READY after policy admission", () => {
  const request = {
    schema_version: 2,
    id: "r",
    planning_goal: "x",
    scope_lock: {
      original_user_instruction: "x",
      authorized_deliverables: ["x"],
      authorized_paths: [],
      forbidden_expansions: []
    },
    operations: []
  };
  const run = new NativeOrchestrator().admitRequest({ repository: "o/r", request, requestPath: "dev_scripts/github-filepatcher.json" });
  assert.equal(run.state, "READY");
});

test("patch staging", () => {
  const out = stagePatch({ id: "p", objective: "x", operations: [{ type: "replace_exact", path: "a", search: "x", replace: "y" }] }, new Map([["a", "x"]]));
  assert.equal(out.files.get("a"), "y");
});
''')

# Wire the live MCP submission boundary into the native orchestrator without removing the
# legacy repository workflow execution path yet. PASS 2 owns admission/run state; later passes
# will move execution itself into ChryPck.
replace_once(
    "src/server.ts",
    'import { loadConfig } from "./config.js";\n',
    'import { loadConfig } from "./config.js";\nimport { NativeOrchestrator } from "./core/run/orchestrator.js";\n'
)
replace_once(
    "src/server.ts",
    'const sourceGrants = new SourceGrantStore(config.grantTtlMs);\n',
    'const sourceGrants = new SourceGrantStore(config.grantTtlMs);\nconst nativeOrchestrator = new NativeOrchestrator();\n'
)
replace_once(
    "src/server.ts",
    '      const scopeLock = assertScopeLock(validated as Record<string, any>);\n      const serialized = `${JSON.stringify(validated, null, 2)}\\n`;\n',
    '      const scopeLock = assertScopeLock(validated as Record<string, any>);\n      const nativeRun = nativeOrchestrator.admitRequest({ repository: allowedRepository, request: validated as Record<string, any>, requestPath: config.requestPath });\n      const serialized = `${JSON.stringify(validated, null, 2)}\\n`;\n'
)
replace_once(
    "src/server.ts",
    '      sourceGrants.invalidateRepository(allowedRepository);\n      return {\n',
    '      sourceGrants.invalidateRepository(allowedRepository);\n      nativeOrchestrator.bindRequestCommit(nativeRun.runId, result.commitSha);\n      return {\n'
)
replace_once(
    "src/server.ts",
    '        scope_lock_fingerprint: scopeLock.fingerprint,\n        mutation_authority: "repository-toolchain",\n',
    '        scope_lock_fingerprint: scopeLock.fingerprint,\n        native_run_id: nativeRun.runId,\n        request_fingerprint: nativeRun.requestIdentity.fingerprint,\n        envelope_fingerprint: nativeRun.envelope.envelope_fingerprint,\n        native_state: nativeRun.state,\n        mutation_authority: "repository-toolchain",\n'
)

print("[pass2:migrate] PASS 2 migration complete")
