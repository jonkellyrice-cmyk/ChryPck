import type { RepositoryModel } from "../repository/model.js";
import { buildTraceGraph, type TraceGraph, type TraceEdge, findNodeBySymbol } from "./trace-graph.js";

export type TraceHop = {
  readonly hop: number;
  readonly question: string;
  readonly from: string | null;
  readonly to: string;
  readonly edge_kind: string;
  readonly finding: string;
  readonly evidence: readonly string[];
  readonly context: { snippet: string; file: string } | null;
};

export type TraceResult = {
  readonly status: "complete" | "bounded" | "capability_gap";
  readonly terminal_reason: string;
  readonly root_cause: { summary: string; file?: string; symbol?: string; line?: number; confidence?: string } | null;
  readonly trace: readonly TraceHop[];
  readonly considered_branches: readonly string[];
  readonly unresolved_questions: readonly string[];
  readonly likely_patch_candidates: readonly string[];
};

export interface RunTraceOptions {
  readonly objective: string;
  readonly model: RepositoryModel;
  readonly diagnostics?: readonly unknown[];
  readonly max_hops?: number;
  readonly max_branches?: number;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

export function runTrace(options: RunTraceOptions): TraceResult {
  const maxHops = options.max_hops ?? 12;
  const maxBranches = options.max_branches ?? 3;
  const graph: TraceGraph = buildTraceGraph(options.model);
  const objective = options.objective.toLowerCase();

  // Seed resolution: pick symbol names that match objective terms
  const seeds = graph.nodes.filter(n => objective.includes(n.name.toLowerCase()) || objective.includes(n.file.toLowerCase()));
  const seedNodes = seeds.length ? seeds.slice(0, maxBranches) : (graph.nodes.length ? [graph.nodes[0]!] : []);

  const trace: TraceHop[] = [];
  const visited = new Set<string>();
  let hop = 0;
  const branches: string[] = [];
  const unresolved: string[] = [];

  function snippetFor(nodeId: string) {
    const parts = nodeId.split("@");
    const name = parts[0] ?? "";
    const file = parts[1] ?? "";
    const fileEntry = options.model.snapshot.files.find(f => f.path === file);
    if (!fileEntry || fileEntry.text === undefined) return null;
    const text = fileEntry.text;
    const idx = name ? text.indexOf(name) : -1;
    const start = Math.max(0, idx - 200);
    const end = Math.min(text.length, idx + 200);
    return { snippet: text.slice(start, end), file: fileEntry.path };
  }

  // simple breadth-first deterministic traversal from seeds
  const queue: string[] = seedNodes.map(n => n!.id);
  while (queue.length && hop < maxHops) {
    const current = queue.shift() as string;
    if (visited.has(current)) continue;
    visited.add(current);
    hop += 1;

    // find outgoing edges
    const outgoing = graph.edges.filter(e => e.from === current).slice(0, maxBranches);
    if (outgoing.length === 0) {
      // attempt to find incoming edges (called-by)
      const incoming = graph.edges.filter(e => e.to === current).slice(0, maxBranches);
      if (incoming.length === 0) {
        unresolved.push(`no further certified causal edge from ${current}`);
        continue;
      }
      for (const e of incoming) {
        const toId = e.from;
        trace.push({ hop, question: `follow caller for ${current}`, from: current, to: toId, edge_kind: e.kind, finding: `found caller ${toId}`, evidence: Object.freeze(e.evidence), context: snippetFor(toId) });
        if (!visited.has(toId)) queue.push(toId);
      }
      continue;
    }

    for (const e of outgoing) {
      const toId = e.to;
      trace.push({ hop, question: `follow ${e.kind}`, from: current, to: toId, edge_kind: e.kind, finding: `edge to ${toId}`, evidence: Object.freeze(e.evidence), context: snippetFor(toId) });
      branches.push(e.kind);
      if (!visited.has(toId)) queue.push(toId);
    }
  }

  // determine terminal reason simplistically
  const terminal = trace.length === 0 ? "capability_gap" : (trace.length >= maxHops ? "hop_limit" : "root_cause");
  const status = terminal === "capability_gap" ? "capability_gap" : (terminal === "hop_limit" ? "bounded" : "complete");

  // root cause heuristics: prefer last hop's to
  const last = trace[trace.length - 1];
  const root = last ? { summary: last.finding, file: last.context?.file, symbol: last.to.split("@")[0], line: undefined, confidence: "tentative" } : null;

  return Object.freeze({ status, terminal_reason: terminal, root_cause: root, trace: Object.freeze(trace), considered_branches: Object.freeze(branches), unresolved_questions: Object.freeze(unresolved), likely_patch_candidates: Object.freeze(last ? [last.to] : []) });
}

export function seedFromObjective(objective: string, model: RepositoryModel) {
  const token = (objective.split(/\s+/)[0] ?? "");
  const found = token ? findNodeBySymbol(token, model) : null;
  return found;
}
