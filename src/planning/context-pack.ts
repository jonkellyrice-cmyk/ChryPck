import type { DependencyReference, RepositoryModel, SymbolRecord } from "../repository/model.js";
import type { PatchCorridor } from "./patch-corridor.js";

export interface ContextSymbol {
  readonly name: string;
  readonly kind: SymbolRecord["kind"];
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly source: string;
}

export interface ContextSegment {
  readonly id: string;
  readonly path: string;
  readonly content: string;
  readonly evidence: readonly string[];
  readonly symbols: readonly ContextSymbol[];
  readonly dependencies: readonly DependencyReference[];
  readonly consumers: readonly string[];
}

export interface CorridorContextPack {
  readonly objective: string;
  readonly certified: true;
  readonly commitSha: string;
  readonly segments: readonly ContextSegment[];
  readonly omissions: readonly { path: string; reason: string }[];
  readonly grantedPaths: readonly string[];
}

function symbolSlices(text: string, symbols: readonly SymbolRecord[], requested: ReadonlySet<string>): ContextSymbol[] {
  const lines = text.split("\n");
  const ordered = [...symbols].sort((left, right) => left.line - right.line);
  const output: ContextSymbol[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const symbol = ordered[index];
    if (!symbol || (requested.size > 0 && !requested.has(symbol.name))) continue;
    const next = ordered[index + 1];
    const start = Math.max(1, symbol.line);
    const end = Math.max(start, Math.min(lines.length, (next?.line ?? lines.length + 1) - 1));
    output.push(Object.freeze({
      name: symbol.name,
      kind: symbol.kind,
      lineStart: start,
      lineEnd: end,
      source: lines.slice(start - 1, end).join("\n")
    }));
  }
  return output;
}

export function buildContextPack(corridor: PatchCorridor, model: RepositoryModel, maxSegments = 24): CorridorContextPack {
  if (!corridor.certified) throw new Error("Context Pack requires a certified Patch Corridor.");
  const segments: ContextSegment[] = [];
  const omissions: { path: string; reason: string }[] = [];
  for (const row of corridor.files.slice(0, Math.max(1, maxSegments))) {
    const file = model.snapshot.files.find(candidate => candidate.path === row.path);
    const facts = model.fileFacts.find(candidate => candidate.file === row.path);
    if (!file || file.text === undefined || !facts) {
      omissions.push({ path: row.path, reason: "certified file has no text-backed Repository Model facts" });
      continue;
    }
    const requested = new Set(row.symbols.map(symbol => symbol.name));
    const symbols = symbolSlices(file.text, facts.symbols, requested);
    const consumers = [...new Set(model.dependencies.filter(edge => edge.to === row.path).map(edge => edge.from))].sort();
    segments.push(Object.freeze({
      id: `file:${row.path}`,
      path: row.path,
      content: file.text,
      evidence: Object.freeze([...row.reasons]),
      symbols: Object.freeze(symbols),
      dependencies: Object.freeze([...facts.dependencies]),
      consumers: Object.freeze(consumers)
    }));
  }
  return Object.freeze({
    objective: corridor.objective,
    certified: true,
    commitSha: model.snapshot.commitSha,
    segments: Object.freeze(segments),
    omissions: Object.freeze(omissions),
    grantedPaths: Object.freeze(segments.map(segment => segment.path).sort())
  });
}
