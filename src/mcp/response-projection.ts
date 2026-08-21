import { createHash } from "node:crypto";
import type { AnalysisResult, DiagnosticFinding } from "../analysis/analyzer.js";
import type { ContextContinuation, ContextSegment } from "../planning/context-pack.js";
import type { NativeContractRecord } from "../planning/planning-runner.js";
import type { PatchCorridor } from "../planning/patch-corridor.js";

const MAX_DIAGNOSTIC_FINDINGS_PER_MAP = 10;
const MAX_NATIVE_CONTRACTS_PER_CATALOG = 8;
const MAX_EVIDENCE_ARRAY_ITEMS = 8;
const MAX_EVIDENCE_OBJECT_KEYS = 10;
const MAX_EVIDENCE_STRING_CHARS = 240;
const MAX_INDEX_RELATIONSHIPS = 20;

const STOP_WORDS = new Set([
  "the", "and", "for", "from", "into", "with", "that", "this", "make", "change",
  "identify", "main", "architectural", "surface", "surfaces", "involved", "flow", "player", "facing"
]);

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function textTerms(value: string): readonly string[] {
  return Object.freeze([...new Set(
    value.toLowerCase().split(/[^a-z0-9_$./-]+/).map(term => term.trim()).filter(term => term.length >= 3 && !STOP_WORDS.has(term))
  )]);
}

function boundedString(value: string): string {
  return value.length <= MAX_EVIDENCE_STRING_CHARS
    ? value
    : `${value.slice(0, MAX_EVIDENCE_STRING_CHARS)}…`;
}

function compactValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return boundedString(value);
  if (typeof value !== "object") return String(value);
  if (depth >= 3) return Array.isArray(value) ? `[${value.length} items]` : "[object]";
  if (Array.isArray(value)) {
    return Object.freeze(value.slice(0, MAX_EVIDENCE_ARRAY_ITEMS).map(entry => compactValue(entry, depth + 1)));
  }
  const record = value as JsonRecord;
  const output: JsonRecord = {};
  for (const key of Object.keys(record).sort().slice(0, MAX_EVIDENCE_OBJECT_KEYS)) {
    output[key] = compactValue(record[key], depth + 1);
  }
  return Object.freeze(output);
}

function containsCorridorPath(value: unknown, corridorPaths: ReadonlySet<string>): boolean {
  if (typeof value === "string") return [...corridorPaths].some(path => value.includes(path));
  if (Array.isArray(value)) return value.some(entry => containsCorridorPath(entry, corridorPaths));
  const record = asRecord(value);
  return record ? Object.values(record).some(entry => containsCorridorPath(entry, corridorPaths)) : false;
}

function diagnosticScore(finding: DiagnosticFinding, corridorPaths: ReadonlySet<string>): number {
  const severity = finding.severity === "error" ? 30 : finding.severity === "warning" ? 20 : 10;
  return severity + (containsCorridorPath(finding.evidence, corridorPaths) ? 100 : 0);
}

export function projectDiagnosticMaps(
  diagnostics: readonly AnalysisResult[],
  corridor: PatchCorridor
): readonly Readonly<Record<string, unknown>>[] {
  const corridorPaths = new Set(corridor.corridor);
  return Object.freeze(diagnostics.map(result => {
    const ranked = result.findings
      .map((finding, index) => ({ finding, index, score: diagnosticScore(finding, corridorPaths) }))
      .sort((left, right) => right.score - left.score || left.index - right.index);
    const selected = ranked.slice(0, MAX_DIAGNOSTIC_FINDINGS_PER_MAP).map(row => {
      const finding = row.finding;
      return Object.freeze({
        code: finding.code,
        severity: finding.severity,
        summary: boundedString(finding.summary),
        ...(finding.evidence === undefined ? {} : { evidence: compactValue(finding.evidence) })
      });
    });
    return Object.freeze({
      analyzer: result.analyzer,
      summary: Object.freeze({ ...result.summary }),
      finding_count: result.findings.length,
      returned_finding_count: selected.length,
      truncated: selected.length < result.findings.length,
      findings: Object.freeze(selected)
    });
  }));
}

function contractSearchText(contract: JsonRecord): string {
  const boundary = asRecord(contract.boundary);
  const evidence = Array.isArray(contract.evidence) ? contract.evidence : [];
  return [
    contract.id, contract.title, contract.status, contract.contract_kind, contract.summary,
    ...(Array.isArray(contract.keywords) ? contract.keywords : []),
    boundary?.owner_family, boundary?.rule,
    ...(Array.isArray(boundary?.frame_conn_consumers) ? boundary.frame_conn_consumers : []),
    ...evidence.flatMap(entry => {
      const row = asRecord(entry);
      return row ? [row.source_path, row.symbol] : [];
    })
  ].filter(value => typeof value === "string").join(" ").toLowerCase();
}

function contractScore(contract: JsonRecord, objectiveTerms: readonly string[], corridorPaths: ReadonlySet<string>): number {
  const haystack = contractSearchText(contract);
  let score = objectiveTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 2 : 0), 0);
  for (const path of corridorPaths) if (haystack.includes(path.toLowerCase())) score += 20;
  return score;
}

function projectContract(contract: JsonRecord): Readonly<Record<string, unknown>> {
  const boundary = asRecord(contract.boundary);
  const evidence = (Array.isArray(contract.evidence) ? contract.evidence : [])
    .map(asRecord)
    .filter((row): row is JsonRecord => row !== null)
    .slice(0, 4)
    .map(row => Object.freeze({
      source_path: row.source_path,
      symbol: row.symbol,
      line_start: row.line_start,
      line_end: row.line_end
    }));
  return Object.freeze({
    id: contract.id,
    title: contract.title,
    status: contract.status,
    contract_kind: contract.contract_kind,
    summary: typeof contract.summary === "string" ? boundedString(contract.summary) : contract.summary,
    ...(boundary ? {
      boundary: Object.freeze({
        owner_family: boundary.owner_family,
        frame_conn_consumers: Array.isArray(boundary.frame_conn_consumers)
          ? Object.freeze(boundary.frame_conn_consumers.slice(0, MAX_INDEX_RELATIONSHIPS))
          : Object.freeze([]),
        rule: typeof boundary.rule === "string" ? boundedString(boundary.rule) : boundary.rule
      })
    } : {}),
    evidence: Object.freeze(evidence)
  });
}

export function projectNativeContractMaps(
  records: readonly NativeContractRecord[],
  corridor: PatchCorridor
): readonly Readonly<Record<string, unknown>>[] {
  const objectiveTerms = textTerms(corridor.objective);
  const corridorPaths = new Set(corridor.corridor.map(path => path.toLowerCase()));
  return Object.freeze(records.map(record => {
    const data = asRecord(record.data);
    const contracts = Array.isArray(data?.contracts)
      ? data.contracts.map(asRecord).filter((row): row is JsonRecord => row !== null)
      : [];
    if (!contracts.length) {
      return Object.freeze({ id: record.id, source: record.source, data_summary: compactValue(record.data) });
    }
    const selected = contracts
      .map((contract, index) => ({ contract, index, score: contractScore(contract, objectiveTerms, corridorPaths) }))
      .filter(row => row.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, MAX_NATIVE_CONTRACTS_PER_CATALOG)
      .map(row => projectContract(row.contract));
    return Object.freeze({
      id: record.id,
      source: record.source,
      contract_count: contracts.length,
      returned_contract_count: selected.length,
      contracts: Object.freeze(selected)
    });
  }));
}

export function projectContextIndexSegment(segment: ContextSegment): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: segment.id,
    path: segment.path,
    evidence: Object.freeze([...segment.evidence]),
    symbols: Object.freeze(segment.symbols.map(symbol => Object.freeze({
      name: symbol.name,
      kind: symbol.kind,
      lineStart: symbol.lineStart,
      lineEnd: symbol.lineEnd,
      truncated: symbol.truncated,
      expandable: symbol.continuationId !== null
    }))),
    dependencies: Object.freeze(segment.dependencies.slice(0, MAX_INDEX_RELATIONSHIPS).map(dependency => Object.freeze({
      specifier: dependency.specifier,
      kind: dependency.kind,
      line: dependency.line
    }))),
    consumers: Object.freeze(segment.consumers.slice(0, MAX_INDEX_RELATIONSHIPS)),
    contracts: Object.freeze(segment.contracts.slice(0, MAX_INDEX_RELATIONSHIPS).map(contract => Object.freeze({
      id: contract.id,
      name: contract.name,
      kind: contract.kind,
      role: contract.role,
      reconciliation: contract.reconciliation,
      verification: contract.verification,
      native_contract_refs: contract.nativeContractRefs,
      failures: contract.failures
    }))),
    runtime: Object.freeze((segment.runtime ?? []).slice(0, MAX_INDEX_RELATIONSHIPS).map(runtime => Object.freeze({
      region_id: runtime.regionId,
      roles: runtime.roles,
      effect_kinds: runtime.effectKinds,
      reconciliation: runtime.reconciliation,
      verification_target: runtime.verificationTarget
    })))
  });
}

export function projectContextSourceSegment(segment: ContextSegment): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...projectContextIndexSegment(segment),
    content: segment.content,
    continuations: Object.freeze(segment.symbols
      .filter(symbol => symbol.continuationId !== null)
      .map(symbol => Object.freeze({
        symbol: symbol.name,
        next_segment_id: symbol.continuationId
      })))
  });
}

export function projectContextContinuation(continuation: ContextContinuation): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: continuation.id,
    parent_segment_id: continuation.segmentId,
    path: continuation.path,
    symbol: continuation.symbol,
    kind: continuation.kind,
    chunk_index: continuation.chunkIndex,
    chunk_count: continuation.chunkCount,
    lineStart: continuation.lineStart,
    lineEnd: continuation.lineEnd,
    continued_from_previous: continuation.continuedFromPrevious,
    content: continuation.source,
    next_segment_id: continuation.nextContinuationId,
    truncated: continuation.nextContinuationId !== null
  });
}

export function projectTraceHop(hop: any): Readonly<Record<string, unknown>> {
  return Object.freeze({
    hop: hop.hop,
    question: hop.question,
    from: hop.from,
    to: hop.to,
    edge_kind: hop.edge_kind,
    finding: hop.finding,
    evidence: hop.evidence,
    context: hop.context ? { file: hop.context.file, snippet: typeof hop.context.snippet === "string" ? hop.context.snippet.slice(0, 4000) : hop.context.snippet } : null
  });
}

export function projectTraceResult(trace: any): Readonly<Record<string, unknown>> {
  return Object.freeze({
    status: trace.status,
    terminal_reason: trace.terminal_reason,
    root_cause: trace.root_cause ? Object.freeze({ ...trace.root_cause }) : null,
    trace: Object.freeze((trace.trace ?? []).map(projectTraceHop)),
    considered_branches: Object.freeze(trace.considered_branches ?? []),
    unresolved_questions: Object.freeze(trace.unresolved_questions ?? []),
    likely_patch_candidates: Object.freeze(trace.likely_patch_candidates ?? [])
  });
}

export function projectBoundedEventTraceResult(trace: any): Readonly<Record<string, unknown>> {
  return Object.freeze({
    status: trace.status,
    entrypoint: trace.entrypoint ?? null,
    path: Object.freeze((trace.path ?? []).map((hop: any) => Object.freeze({ symbol: hop.symbol, file: hop.file, snippet: hop.snippet }))),
    first_blocker: trace.firstBlocker ?? null,
    terminal_effect: trace.terminalEffect ?? null,
    excluded_branches: Object.freeze(trace.excludedBranches ?? []),
    evidence: Object.freeze(trace.evidence ?? []),
    certificate: trace.certificate ?? null
  });
}


const MAX_CONTEXT_GRANTS = 8;

function contextGrantScore(segment: any, objectiveTerms: readonly string[]): number {
  const symbols = Array.isArray(segment?.symbols) ? segment.symbols : [];
  const evidence = Array.isArray(segment?.evidence) ? segment.evidence : [];
  const contracts = Array.isArray(segment?.contracts) ? segment.contracts : [];
  const runtime = Array.isArray(segment?.runtime) ? segment.runtime : [];
  const consumers = Array.isArray(segment?.consumers) ? segment.consumers : [];
  const haystack = [segment?.path, ...symbols.map((row: any) => row?.name), ...evidence]
    .filter(value => typeof value === "string").join(" ").toLowerCase();
  const lexical = objectiveTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 8 : 0), 0);
  const directEvidence = Math.min(24, evidence.length * 4);
  const causalEvidence = Math.min(28, runtime.length * 7 + contracts.length * 6);
  const connectivity = Math.min(12, consumers.length * 2);
  return lexical + directEvidence + causalEvidence + connectivity;
}

function contextGrantReason(segment: any): string {
  if (Array.isArray(segment?.runtime) && segment.runtime.length) return "runtime/effect evidence intersects the active objective";
  if (Array.isArray(segment?.contracts) && segment.contracts.length) return "contract provider/consumer evidence intersects the active objective";
  if (Array.isArray(segment?.evidence) && segment.evidence.length) return "direct certified repository evidence is available";
  if (Array.isArray(segment?.consumers) && segment.consumers.length) return "dependency consumers make this a plausible propagation surface";
  return "corridor-certified source is available for bounded inspection";
}

export function projectContextGrant(segment: any, score = 0, rank = 1): Readonly<Record<string, unknown>> {
  const symbols = Array.isArray(segment?.symbols) ? segment.symbols : [];
  return Object.freeze({
    segment_id: segment?.id ?? segment?.segment_id ?? null,
    path: segment?.path ?? null,
    symbols: Object.freeze(symbols.slice(0, 6).map((symbol: any) => Object.freeze({
      name: symbol?.name ?? null,
      kind: symbol?.kind ?? null,
      line_start: symbol?.lineStart ?? symbol?.line_start ?? null,
      line_end: symbol?.lineEnd ?? symbol?.line_end ?? null,
      expandable: Boolean(symbol?.expandable ?? symbol?.continuationId)
    }))),
    evidence: Object.freeze((Array.isArray(segment?.evidence) ? segment.evidence : []).slice(0, 4)),
    priority_rank: rank,
    relevance_score: score,
    why_relevant: contextGrantReason(segment),
    expected_information_gain: score >= 50 ? "high" : score >= 24 ? "medium" : "low",
    recommended_next_action: "call_chrypck_context_with_segment_id"
  });
}

function analysisFrontier(analysis: JsonRecord | null): Readonly<Record<string, unknown>> {
  const result = asRecord(analysis?.result);
  if (!result) return Object.freeze({ active: Object.freeze([]), excluded: Object.freeze([]), unresolved: Object.freeze([]) });
  const tracePath = Array.isArray(result.path) ? result.path : [];
  const targets = Array.isArray(result.targets) ? result.targets : [];
  const active = [...tracePath.slice(-3), ...targets.slice(0, 3)].map(compactValue);
  const excluded = (Array.isArray(result.excluded_branches) ? result.excluded_branches
    : Array.isArray(result.excludedEvidence) ? result.excludedEvidence : []).slice(0, 8).map(compactValue);
  const unresolved = (Array.isArray(result.unresolved_frontier) ? result.unresolved_frontier
    : Array.isArray(result.unresolvedFrontier) ? result.unresolvedFrontier : []).slice(0, 8).map(compactValue);
  return Object.freeze({ active: Object.freeze(active), excluded: Object.freeze(excluded), unresolved: Object.freeze(unresolved) });
}

/**
 * Converts a heavyweight persisted response into the small control envelope that
 * should be carried through an agent loop. Full artifacts stay addressable by
 * run_id; exact source is disclosed separately through chrypck_context grants.
 */
export function projectCompactResponse(response: Readonly<Record<string, any>>): Readonly<Record<string, unknown>> {
  const contextIndex = Array.isArray(response.context_index) ? response.context_index : [];
  const corridor = asRecord(response.corridor);
  const semanticBootstrap = asRecord(response.semantic_bootstrap);
  const artifactSummary = asRecord(response.artifacts);
  const objective = typeof corridor?.objective === "string" ? corridor.objective : "";
  const rankedContext = contextIndex
    .map((segment, index) => ({ segment, index, score: contextGrantScore(segment, textTerms(objective)) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_CONTEXT_GRANTS);
  const frontier = analysisFrontier(asRecord(response.analysis));
  const progressFingerprint = createHash("sha256").update(JSON.stringify({
    run_id: response.run_id ?? null,
    state: response.state ?? null,
    semantic_coverage: response.semantic_coverage ?? null,
    analysis: response.analysis ?? null,
    context_grants: rankedContext.map(row => row.segment?.id ?? row.segment?.segment_id ?? null),
    permitted_next_action: response.permitted_next_action ?? null,
    result_commit_sha: response.result_commit_sha ?? null
  })).digest("hex");
  return Object.freeze({
    schema_version: 1,
    response_mode: "compact",
    run_id: response.run_id ?? null,
    state: response.state ?? null,
    terminal: response.terminal ?? null,
    task_satisfied: response.task_satisfied === true,
    evidence_sufficient: response.evidence_sufficient === true,
    completion_reason: response.completion_reason ?? null,
    continuation: response.continuation ? compactValue(response.continuation, 1) : null,
    repository: response.repository ?? null,
    project_profile: response.project_profile ?? null,
    base_ref: response.base_ref ?? null,
    base_commit_sha: response.base_commit_sha ?? null,
    result_commit_sha: response.result_commit_sha ?? null,
    scope_lock_fingerprint: response.scope_lock_fingerprint ?? null,
    semantic_bootstrap: semanticBootstrap
      ? Object.freeze({
        status: semanticBootstrap.status ?? null,
        bootstrap_id: semanticBootstrap.bootstrap_id ?? null,
        current_chunk: semanticBootstrap.status === "required" ? semanticBootstrap.current_chunk ?? null : null
      })
      : null,
    semantic_coverage: response.semantic_coverage
      ? compactValue(response.semantic_coverage, 1)
      : null,
    analysis: response.analysis ?? null,
    analysis_handoff: response.analysis_handoff ?? null,
    trace_handoff: response.trace_handoff ?? null,
    corridor: corridor
      ? Object.freeze({
        id: corridor.id ?? corridor.corridorId ?? null,
        certified: corridor.certified ?? false,
        objective: corridor.objective ?? null,
        authorized_paths: corridor.corridor ?? corridor.authorizedPaths ?? []
      })
      : null,
    context_available: Boolean(response.context_available ?? contextIndex.length > 0),
    context_segment_count: response.context_segment_count ?? contextIndex.length,
    context_grants: Object.freeze(rankedContext.map((row, index) => projectContextGrant(row.segment, row.score, index + 1))),
    evidence_frontier: frontier,
    progress_fingerprint: progressFingerprint,
    artifact_handles: artifactSummary
      ? Object.freeze({ run_id: response.run_id ?? null, summary: compactValue(artifactSummary, 1) })
      : Object.freeze({ run_id: response.run_id ?? null }),
    failure: response.failure ? compactValue(response.failure, 1) : null,
    permitted_next_action: contextIndex.length > 0 && response.analysis
      ? `expand_one_context_grant_then_${response.permitted_next_action ?? "resume"}`
      : response.permitted_next_action ?? null
  });
}
