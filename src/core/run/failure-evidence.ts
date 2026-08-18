export const FAILURE_EVIDENCE_EXTRACTOR_SCHEMA_VERSION = 1;

export type NativeFailureStage = "planning" | "mutation" | "propagation" | "validation" | "promotion" | "execution";

export interface NativeFailureEvidence {
  readonly schema_version: 1;
  readonly kind: "chrypck_native_failure_evidence";
  readonly failed_stage: NativeFailureStage;
  readonly failure_class: string;
  readonly summary: string;
  readonly relevant_evidence: readonly unknown[];
  readonly permitted_next_action: "modify_request";
}

const NATIVE_FAILURE_CLASSES: Readonly<Record<NativeFailureStage, string>> = Object.freeze({
  planning: "planning_failure",
  mutation: "mutation_failure",
  propagation: "propagation_failure",
  validation: "validation_failure",
  promotion: "promotion_failure",
  execution: "native_execution_failure"
});

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildNativeFailureEvidence(
  stage: NativeFailureStage,
  error: unknown,
  relevantEvidence: readonly unknown[] = []
): NativeFailureEvidence {
  return Object.freeze({
    schema_version: 1,
    kind: "chrypck_native_failure_evidence" as const,
    failed_stage: stage,
    failure_class: NATIVE_FAILURE_CLASSES[stage],
    summary: errorSummary(error),
    relevant_evidence: Object.freeze([...relevantEvidence]),
    permitted_next_action: "modify_request" as const
  });
}

// Legacy log helpers remain temporarily for the v0.1 workflow-backed MCP surface.
// Native execution does not call them and PASS 10 can remove them with that surface.
const ERROR_LINE_PATTERN = /\b(error|failed|failure|fatal|exception|assert(?:ion)?|mismatch|not found|cannot|unable|rejected|denied|enoent|eacces|syntaxerror|typeerror|referenceerror|exit code\s+[1-9]|exited with code\s+[1-9])\b/i;
const PATH_PATTERN = /(?:^|[\s("'`])((?:dev_scripts|scripts|styles|Docs|\.github)\/[A-Za-z0-9_.\/-]+|(?:package|module)\.json)\b/g;
const normalizeRepoPath = (value: unknown) => String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
const unique = <T>(values: readonly T[]) => [...new Set(values.filter(Boolean))];

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

function clean(value: unknown): string {
  return String(value ?? "").replace(/\u001b\[[0-9;]*m/g, "").replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s*/, "").trimEnd().slice(0, 420);
}

export function extractLogEvidence(logText: string, options: Readonly<{ scopePaths?: readonly string[] }> = {}) {
  const lines = String(logText ?? "").split(/\r?\n/).map(clean), anchors: number[] = [];
  for (let i = 0; i < lines.length && anchors.length < 8; i += 1) if (ERROR_LINE_PATTERN.test(lines[i] ?? "")) anchors.push(i);
  const selected = new Set<number>();
  for (const anchor of anchors) for (let i = Math.max(0, anchor - 2); i <= Math.min(lines.length - 1, anchor + 2); i += 1) selected.add(i);
  const excerpt = [...selected].sort((a, b) => a - b).slice(0, 24).map(i => ({ line: i + 1, text: lines[i] ?? "" })).filter(entry => entry.text);
  const paths = extractRepositoryPaths(excerpt.map(entry => entry.text).join("\n"));
  const scope = unique((options.scopePaths ?? []).map(normalizeRepoPath)), scopeSet = new Set(scope);
  return { anchor_count: anchors.length, excerpt, evidence_paths: paths, in_scope_paths: paths.filter(path => scopeSet.has(path)), outside_scope_paths: paths.filter(path => scope.length > 0 && !scopeSet.has(path)) };
}

export function buildFailureEvidence(input: Readonly<{ workflow: string; conclusion?: string; stage?: string; logText?: string; scopePaths?: readonly string[]; job?: Readonly<{ name?: string; id?: number; conclusion?: string }> | null }>) {
  const stage = input.stage || input.job?.name || "workflow", log = extractLogEvidence(input.logText ?? "", { scopePaths: input.scopePaths ?? [] });
  return { schema_version: 1, kind: "frame_conn_terminal_failure_evidence" as const, failed_stage: stage, failure_class: classifyFailureStage(stage), summary: `${input.workflow || "Canonical workflow"} failed at ${stage}.`, request_scope_paths: input.scopePaths ?? [], relevant_evidence: [{ job: input.job?.name ?? null, job_id: input.job?.id ?? null, step: input.stage ?? null, conclusion: input.job?.conclusion ?? input.conclusion ?? "failure", evidence_paths: log.evidence_paths, log_excerpt: log.excerpt }], permitted_next_action: "modify_request" as const };
}
