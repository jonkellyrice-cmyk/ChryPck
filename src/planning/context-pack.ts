import { createHash } from "node:crypto";
import type { DependencyReference, RepositoryModel, SymbolRecord } from "../repository/model.js";
import type { PatchCorridor } from "./patch-corridor.js";
import type { ContractRecord } from "../repository/contract-types.js";

const MAX_CONTEXT_SYMBOLS_PER_SEGMENT = 6;
const MAX_SYMBOL_SOURCE_LINES = 120;
const MAX_SYMBOL_SOURCE_CHARS = 4000;

export interface ContextSymbol {
  readonly name: string;
  readonly kind: SymbolRecord["kind"];
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly source: string;
  readonly truncated: boolean;
  readonly continuationId: string | null;
}

export interface ContextContinuation {
  readonly id: string;
  readonly segmentId: string;
  readonly path: string;
  readonly symbol: string;
  readonly kind: SymbolRecord["kind"];
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly source: string;
  readonly continuedFromPrevious: boolean;
  readonly nextContinuationId: string | null;
}

export interface ContextSegment {
  readonly id: string;
  readonly path: string;
  readonly content: string;
  readonly evidence: readonly string[];
  readonly symbols: readonly ContextSymbol[];
  readonly dependencies: readonly DependencyReference[];
  readonly consumers: readonly string[];
  readonly contracts: readonly ContextContractEvidence[];
}

export interface ContextContractEvidence {
  readonly id: string;
  readonly name: string;
  readonly kind: ContractRecord["kind"];
  readonly role: "provider" | "consumer";
  readonly reconciliation: ContractRecord["reconciliation"];
  readonly verification: ContractRecord["verification"];
  readonly nativeContractRefs: readonly string[];
  readonly failures: readonly string[];
}

export interface CorridorContextPack {
  readonly objective: string;
  readonly certified: true;
  readonly commitSha: string;
  readonly segments: readonly ContextSegment[];
  readonly continuations: readonly ContextContinuation[];
  readonly omissions: readonly { path: string; reason: string }[];
  readonly grantedPaths: readonly string[];
}

interface SourceChunk {
  readonly source: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly continuedFromPrevious: boolean;
}

function countLineBreaks(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) if (value.charCodeAt(index) === 10) count += 1;
  return count;
}

function sourceChunks(value: string, startLine: number): SourceChunk[] {
  if (!value.length) return [{ source: "", lineStart: startLine, lineEnd: startLine, continuedFromPrevious: false }];
  const output: SourceChunk[] = [];
  let offset = 0;
  let lineStart = startLine;
  let continuedFromPrevious = false;

  while (offset < value.length) {
    let end = Math.min(value.length, offset + MAX_SYMBOL_SOURCE_CHARS);
    let lineBreaks = 0;
    for (let index = offset; index < end; index += 1) {
      if (value.charCodeAt(index) !== 10) continue;
      lineBreaks += 1;
      if (lineBreaks >= MAX_SYMBOL_SOURCE_LINES) {
        end = index + 1;
        break;
      }
    }
    if (end <= offset) end = Math.min(value.length, offset + 1);
    const source = value.slice(offset, end);
    const actualBreaks = countLineBreaks(source);
    const lineEnd = Math.max(
      lineStart,
      lineStart + actualBreaks - (source.endsWith("\n") ? 1 : 0)
    );
    output.push(Object.freeze({ source, lineStart, lineEnd, continuedFromPrevious }));
    continuedFromPrevious = end < value.length && value.charCodeAt(end - 1) !== 10;
    lineStart += actualBreaks;
    offset = end;
  }

  return output;
}

function continuationId(segmentId: string, symbol: string, chunkIndex: number): string {
  return `ctx-${createHash("sha256")
    .update(`${segmentId}\n${symbol}\n${chunkIndex}`)
    .digest("hex")
    .slice(0, 20)}`;
}

function symbolSlices(
  text: string,
  symbols: readonly SymbolRecord[],
  requested: ReadonlySet<string>,
  segmentId: string
): { symbols: ContextSymbol[]; continuations: ContextContinuation[] } {
  if (requested.size === 0) return { symbols: [], continuations: [] };
  const lines = text.split("\n");
  const ordered = [...symbols].sort((left, right) => left.line - right.line);
  const output: ContextSymbol[] = [];
  const continuations: ContextContinuation[] = [];

  for (let index = 0; index < ordered.length && output.length < MAX_CONTEXT_SYMBOLS_PER_SEGMENT; index += 1) {
    const symbol = ordered[index];
    if (!symbol || !requested.has(symbol.name)) continue;
    const next = ordered[index + 1];
    const start = Math.max(1, symbol.line);
    const naturalEnd = Math.max(start, Math.min(lines.length, (next?.line ?? lines.length + 1) - 1));
    const rawSource = lines.slice(start - 1, naturalEnd).join("\n");
    const chunks = sourceChunks(rawSource, start);
    const first = chunks[0];
    if (!first) continue;
    const continuationIds = chunks.map((_, chunkIndex) =>
      chunkIndex === 0 ? null : continuationId(segmentId, symbol.name, chunkIndex + 1)
    );

    output.push(Object.freeze({
      name: symbol.name,
      kind: symbol.kind,
      lineStart: first.lineStart,
      lineEnd: first.lineEnd,
      source: first.source,
      truncated: chunks.length > 1,
      continuationId: continuationIds[1] ?? null
    }));

    for (let chunkIndex = 1; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      const id = continuationIds[chunkIndex];
      if (!chunk || !id) continue;
      continuations.push(Object.freeze({
        id,
        segmentId,
        path: symbol.file,
        symbol: symbol.name,
        kind: symbol.kind,
        chunkIndex: chunkIndex + 1,
        chunkCount: chunks.length,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        source: chunk.source,
        continuedFromPrevious: chunk.continuedFromPrevious,
        nextContinuationId: continuationIds[chunkIndex + 1] ?? null
      }));
    }
  }

  return { symbols: output, continuations };
}

function segmentContent(symbols: readonly ContextSymbol[]): string {
  return symbols.map(symbol => [
    `/* ${symbol.name} (${symbol.kind}) lines ${symbol.lineStart}-${symbol.lineEnd}${symbol.truncated ? ", truncated; continuation available" : ""} */`,
    symbol.source
  ].join("\n")).join("\n\n");
}

function contractEvidence(path: string, contractIds: readonly string[], model: RepositoryModel): readonly ContextContractEvidence[] {
  const ids = new Set(contractIds);
  return Object.freeze((model.contractMap?.contracts ?? [])
    .filter(contract => ids.has(contract.id) && (contract.provider?.file === path || contract.consumers.some(endpoint => endpoint.file === path)))
    .map(contract => Object.freeze({
      id: contract.id,
      name: contract.name,
      kind: contract.kind,
      role: contract.provider?.file === path ? "provider" as const : "consumer" as const,
      reconciliation: contract.reconciliation,
      verification: contract.verification,
      nativeContractRefs: Object.freeze([...contract.nativeContractRefs]),
      failures: Object.freeze(contract.failures.map(failure => failure.summary))
    }))
    .sort((left, right) => left.id.localeCompare(right.id)));
}

export function buildContextPack(corridor: PatchCorridor, model: RepositoryModel, maxSegments = 24): CorridorContextPack {
  if (!corridor.certified) throw new Error("Context Pack requires a certified Patch Corridor.");
  const segments: ContextSegment[] = [];
  const continuations: ContextContinuation[] = [];
  const omissions: { path: string; reason: string }[] = [];
  for (const row of corridor.files.slice(0, Math.max(1, maxSegments))) {
    const file = model.snapshot.files.find(candidate => candidate.path === row.path);
    const facts = model.fileFacts.find(candidate => candidate.file === row.path);
    if (!file || file.text === undefined || !facts) {
      omissions.push({ path: row.path, reason: "certified file has no text-backed Repository Model facts" });
      continue;
    }
    const requested = new Set(row.symbols.map(symbol => symbol.name));
    const segmentId = `file:${row.path}`;
    const built = symbolSlices(file.text, facts.symbols, requested, segmentId);
    if (!built.symbols.length) {
      omissions.push({ path: row.path, reason: "certified file has no objective-local symbol anchor; exhaustive file source remains hidden" });
      continue;
    }
    const consumers = [...new Set(model.dependencies.filter(edge => edge.to === row.path).map(edge => edge.from))].sort();
    segments.push(Object.freeze({
      id: segmentId,
      path: row.path,
      content: segmentContent(built.symbols),
      evidence: Object.freeze([...row.reasons]),
      symbols: Object.freeze(built.symbols),
      dependencies: Object.freeze([...facts.dependencies]),
      consumers: Object.freeze(consumers),
      contracts: contractEvidence(row.path, row.contractIds, model)
    }));
    continuations.push(...built.continuations);
  }
  return Object.freeze({
    objective: corridor.objective,
    certified: true,
    commitSha: model.snapshot.commitSha,
    segments: Object.freeze(segments),
    continuations: Object.freeze(continuations),
    omissions: Object.freeze(omissions),
    grantedPaths: Object.freeze(segments.map(segment => segment.path).sort())
  });
}
