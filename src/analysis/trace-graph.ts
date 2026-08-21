import type { RepositoryModel, SymbolRecord } from "../repository/model.js";
import type { EffectRuntimeAtlas } from "./effect-runtime-linker.js";

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

export function buildTraceGraph(model: RepositoryModel, effectRuntimeAtlas?: EffectRuntimeAtlas): TraceGraph {
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

  if (effectRuntimeAtlas) {
    const runtimeNodes = new Map(effectRuntimeAtlas.nodes.map(node => [node.id, node] as const));
    const runtimeKind = (kind: string): EdgeKind => {
      if (kind === "calls" || kind === "invokes-callback" || kind === "registers") return "calls";
      if (kind === "reads-state") return "state-read";
      if (kind === "writes-state") return "state-write";
      if (kind === "delegates-native" || kind === "crosses-integration-boundary") return "native-boundary";
      return "effect";
    };
    for (const edge of effectRuntimeAtlas.edges.filter(edge => edge.reconciliation !== "unresolved" && edge.reconciliation !== "native-conflict")) {
      const from = runtimeNodes.get(edge.from), to = runtimeNodes.get(edge.to);
      if (!from || !to || from.symbol.startsWith("<") || to.symbol.startsWith("<")) continue;
      const fromId = `${from.symbol}@${from.file}`, toId = `${to.symbol}@${to.file}`;
      if (!nodeMap.has(fromId) || !nodeMap.has(toId)) continue;
      edges.push({ from: fromId, to: toId, kind: runtimeKind(edge.kind), evidence: [`Effect / Runtime Atlas ${edge.reconciliation}: ${edge.id}`] });
    }
  }

  const uniqueEdges = [...new Map(edges.map(edge => [`${edge.from}|${edge.to}|${edge.kind}`, edge] as const)).values()];
  return Object.freeze({ nodes: Object.freeze(nodes), edges: Object.freeze(uniqueEdges) });
}

export function findNodeBySymbol(name: string, model: RepositoryModel): TraceNode | null {
  const sym = model.symbols.find(s => s.name === name);
  if (!sym) return null;
  return { id: `${sym.name}@${sym.file}`, name: sym.name, file: sym.file, line: sym.line };
}
