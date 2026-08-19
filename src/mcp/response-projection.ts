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
    consumers: Object.freeze(segment.consumers.slice(0, MAX_INDEX_RELATIONSHIPS))
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
