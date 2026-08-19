import type { RepositoryModel, SymbolRecord } from "../repository/model.js";

export type EdgeKind =
  | "calls"
  | "called-by"
  | "dependency"
  | "state-read"
  | "state-write"
  | "effect"
  | "native-boundary";

export interface TraceNode {
  readonly id: string; // symbol@file
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

export interface TraceEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
  readonly evidence: string[];
}

export interface TraceGraph {
  readonly nodes: readonly TraceNode[];
  readonly edges: readonly TraceEdge[];
}

function nodeId(symbol: SymbolRecord) {
  return `${symbol.name}@${symbol.file}`;
}

export function buildTraceGraph(model: RepositoryModel): TraceGraph {
  const nodes: TraceNode[] = model.symbols.map(s => ({ id: nodeId(s), name: s.name, file: s.file, line: s.line }));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const edges: TraceEdge[] = [];

  // dependency edges based on import/resolution
  for (const dep of model.dependencies) {
    // link symbols declared in from -> symbols declared in to as dependency
    const fromSymbols = model.symbols.filter(s => s.file === dep.from);
    const toSymbols = model.symbols.filter(s => s.file === dep.to);
    for (const fs of fromSymbols) {
      for (const ts of toSymbols) {
        edges.push({ from: nodeId(fs), to: nodeId(ts), kind: "dependency", evidence: [`import ${dep.specifier} at ${dep.file}:${dep.line}`] });
      }
    }
  }

  // effects / state edges
  for (const eff of model.effects) {
    const owner = model.symbols.find(s => s.file === eff.file && s.name === eff.symbol);
    if (owner) {
      edges.push({ from: nodeId(owner), to: nodeId(owner), kind: "effect", evidence: [`effect ${eff.kind} at ${eff.file}:${eff.line}`] });
    }
  }

  // simple call inference: search for symbol name occurrences in fileFacts
  for (const facts of model.fileFacts) {
    const text = model.snapshot.files.find(f => f.path === facts.file)?.text ?? "";
    for (const target of model.symbols) {
      const pattern = new RegExp(`\\b${target.name}\\s*\\(`, "g");
      while (true) {
        const m = pattern.exec(text);
        if (!m) break;
        // find nearest symbol in same file that likely performs the call
        const line = text.slice(0, m.index ?? 0).split("\n").length;
        const caller = facts.symbols.find(s => s.line <= line);
        const callerId = caller ? `${caller.name}@${facts.file}` : `<module>@${facts.file}`;
        const targetId = `${target.name}@${target.file}`;
        edges.push({ from: callerId, to: targetId, kind: "calls", evidence: [`call ${target.name}() in ${facts.file}`] });
      }
    }
  }

  return Object.freeze({ nodes: Object.freeze(nodes), edges: Object.freeze(edges) });
}

export function findNodeBySymbol(name: string, model: RepositoryModel): TraceNode | null {
  const sym = model.symbols.find(s => s.name === name);
  if (!sym) return null;
  return { id: `${sym.name}@${sym.file}`, name: sym.name, file: sym.file, line: sym.line };
}
