import { createHash } from "node:crypto";

import { buildEffectRuntimeAtlas, type EffectRuntimeAtlas, type EffectRuntimeReconciliation } from "./effect-runtime-linker.js";
import type { DataflowEdge, DataflowEdgeKind, DataflowGap, DataflowNode } from "../repository/dataflow-types.js";
import type { ContractRecord } from "../repository/contract-types.js";
import type { RepositoryModel, StateRecord } from "../repository/model.js";

export type DataflowReconciliation = EffectRuntimeReconciliation;

export interface LinkedDataflowNode extends DataflowNode {
  readonly reconciliation: DataflowReconciliation;
  readonly evidenceRefs: readonly string[];
}

export interface LinkedDataflowEdge extends DataflowEdge {
  readonly reconciliation: DataflowReconciliation;
  readonly evidenceRefs: readonly string[];
}

export interface DataflowGraphCoverage {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly linkedNodeCount: number;
  readonly unresolvedNodeCount: number;
  readonly unresolvedEdgeCount: number;
  readonly gapCount: number;
  readonly partial: boolean;
}

export interface DataflowGraph {
  readonly schemaVersion: 1;
  readonly nodes: readonly LinkedDataflowNode[];
  readonly edges: readonly LinkedDataflowEdge[];
  readonly gaps: readonly DataflowGap[];
  readonly coverage: DataflowGraphCoverage;
}

const cache = new WeakMap<RepositoryModel, DataflowGraph>();
function id(prefix: string, parts: readonly (string | number)[]): string { return `${prefix}-${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 20)}`; }
function simpleName(value: string | null): string { return (value ?? "").split(".").at(-1) ?? ""; }
function contractReconciliation(contract: ContractRecord): DataflowReconciliation { return contract.reconciliation === "repository-only" ? "cross-map-confirmed" : contract.reconciliation; }

function strongest(values: readonly DataflowReconciliation[]): DataflowReconciliation {
  const rank: Record<DataflowReconciliation, number> = { "native-conflict": 6, "native-confirmed": 5, "native-supplemented": 4, "cross-map-confirmed": 3, "repository-confirmed": 2, unresolved: 1 };
  return [...values].sort((a, b) => rank[b] - rank[a])[0] ?? "unresolved";
}

function relevantContracts(node: DataflowNode, contracts: readonly ContractRecord[]): readonly ContractRecord[] {
  return contracts.filter(contract => [contract.provider, ...contract.consumers].some(endpoint => endpoint?.file === node.file && (endpoint.symbol === node.symbol || endpoint.line === node.lineStart)));
}

function runtimeReconciliation(node: DataflowNode, atlas: EffectRuntimeAtlas): DataflowReconciliation | null {
  const runtime = atlas.nodes.find(candidate => candidate.file === node.file && (candidate.lineStart === node.lineStart || candidate.symbol === node.symbol) && (
    node.kind === "effect-sink" || node.kind === "state-read" || node.kind === "state-write"
  ));
  return runtime?.reconciliation ?? null;
}

function stateAt(node: DataflowNode, states: readonly StateRecord[]): StateRecord | null {
  if (node.kind !== "state-read" && node.kind !== "state-write") return null;
  return states.find(state => state.file === node.file && state.line === node.lineStart) ?? null;
}

export function buildDataflowGraph(model: RepositoryModel, effectRuntimeAtlas: EffectRuntimeAtlas = buildEffectRuntimeAtlas(model)): DataflowGraph {
  const cached = cache.get(model);
  if (cached) return cached;
  const contracts = model.contractMap?.contracts ?? [];
  const nodes: LinkedDataflowNode[] = (model.dataflowNodes ?? []).map(node => {
    const nodeContracts = relevantContracts(node, contracts), runtime = runtimeReconciliation(node, effectRuntimeAtlas);
    const reconciliations: DataflowReconciliation[] = [node.confidence === "unresolved" ? "unresolved" : "repository-confirmed"];
    if (runtime) reconciliations.push(runtime);
    reconciliations.push(...nodeContracts.map(contractReconciliation));
    return Object.freeze({ ...node, reconciliation: node.confidence === "unresolved" ? "unresolved" : strongest(reconciliations), evidenceRefs: Object.freeze([
      ...nodeContracts.map(contract => `contract:${contract.id}`),
      ...(runtime ? effectRuntimeAtlas.nodes.filter(candidate => candidate.file === node.file && candidate.lineStart === node.lineStart).map(candidate => `effect-runtime:${candidate.id}`) : [])
    ].sort()) });
  });
  const nodeById = new Map(nodes.map(node => [node.id, node] as const));
  const edges: LinkedDataflowEdge[] = (model.dataflowEdges ?? []).map(edge => Object.freeze({
    ...edge, reconciliation: edge.confidence === "unresolved" ? "unresolved" : "repository-confirmed", evidenceRefs: Object.freeze([])
  }));
  const gaps: DataflowGap[] = [...(model.dataflowGaps ?? [])];

  const addEdge = (from: LinkedDataflowNode, to: LinkedDataflowNode, kind: DataflowEdgeKind, evidenceRefs: readonly string[] = [], reconciliation: DataflowReconciliation = "cross-map-confirmed"): void => {
    if (from.id === to.id) return;
    edges.push(Object.freeze({ id: id("dataflow-link", [from.id, kind, to.id]), kind, from: from.id, to: to.id, file: from.file, line: from.lineStart, confidence: reconciliation === "unresolved" ? "unresolved" : "syntax-confirmed", extractionSource: "typescript-ast", unresolvedReason: reconciliation === "unresolved" ? "Interprocedural target is ambiguous or unresolved." : null, reconciliation, evidenceRefs: Object.freeze([...evidenceRefs].sort()) }));
  };
  const addGap = (node: LinkedDataflowNode, kind: DataflowGap["kind"], summary: string): void => {
    gaps.push(Object.freeze({ id: id("dataflow-gap", [node.file, node.lineStart, kind, summary]), file: node.file, line: node.lineStart, kind, summary }));
  };

  // Link identifier references to the nearest preceding definition in the same file and lexical owner.
  for (const reference of nodes.filter(node => node.kind === "declaration" && node.detail.startsWith("Reference ") && node.value)) {
    const candidates = nodes.filter(candidate => candidate.id !== reference.id && candidate.file === reference.file && candidate.value === reference.value && candidate.lineStart <= reference.lineStart && ["parameter", "declaration", "assignment", "property-write"].includes(candidate.kind));
    const sameOwner = candidates.filter(candidate => candidate.symbol === reference.symbol);
    const chosen = [...(sameOwner.length ? sameOwner : candidates)].sort((a, b) => b.lineStart - a.lineStart || b.id.localeCompare(a.id))[0];
    if (chosen) addEdge(chosen, reference, "aliases");
    else addGap(reference, "unresolved-expression", `No local definition was resolved for ${reference.value}.`);
  }

  // Bind call arguments to parameters and function returns to call results across resolved dependencies.
  for (const result of nodes.filter(node => node.kind === "call-result" && node.value)) {
    const name = simpleName(result.value);
    const allowedTargetFiles = new Set([result.file, ...model.dependencies.filter(dependency => dependency.from === result.file).map(dependency => dependency.to)]);
    const parameters = nodes.filter(node => node.kind === "parameter" && node.symbol === name && allowedTargetFiles.has(node.file)).sort((a, b) => a.lineStart - b.lineStart || a.id.localeCompare(b.id));
    const returns = nodes.filter(node => node.kind === "return-value" && node.symbol === name && allowedTargetFiles.has(node.file));
    const argumentsForCall = nodes.filter(node => node.kind === "call-argument" && node.value?.startsWith(`${result.value}#`) && node.file === result.file && node.lineStart >= result.lineStart && node.lineStart <= result.lineEnd);
    for (const argument of argumentsForCall) {
      const index = Number(argument.value?.split("#").at(-1));
      const parameter = Number.isInteger(index) ? parameters[index] : undefined;
      if (parameter) addEdge(argument, parameter, "binds-parameter", [`call:${result.value}`]);
      else addGap(argument, "unresolved-expression", `No unique parameter binding was resolved for ${argument.value}.`);
    }
    for (const returned of returns) addEdge(returned, result, "receives-result", [`call:${result.value}`]);
  }

  // Reconcile matching repository state writes and reads.
  const stateNodes = nodes.map(node => ({ node, state: stateAt(node, model.states) })).filter((row): row is { node: LinkedDataflowNode; state: StateRecord } => Boolean(row.state));
  for (const write of stateNodes.filter(row => row.state.access === "write" || row.state.access === "delete")) {
    for (const read of stateNodes.filter(row => row.state.access === "read" && row.state.namespace === write.state.namespace && row.state.key === write.state.key)) {
      const resolved = write.state.namespaceResolved && write.state.keyResolved && read.state.namespaceResolved && read.state.keyResolved;
      addEdge(write.node, read.node, "state-propagates", [`state:${write.state.namespace}:${write.state.key}`], resolved ? "cross-map-confirmed" : "unresolved");
    }
  }

  // Mark provider/consumer crossings and runtime sinks without inventing value edges.
  for (const contract of contracts.filter(contract => contract.provider && contract.reconciliation !== "native-conflict")) {
    const providerNodes = nodes.filter(node => node.file === contract.provider?.file && node.symbol === contract.provider.symbol);
    const consumerNodes = nodes.filter(node => contract.consumers.some(consumer => consumer.file === node.file && consumer.symbol === node.symbol));
    for (const consumer of consumerNodes) for (const provider of providerNodes) addEdge(consumer, provider, "crosses-contract", [`contract:${contract.id}`], contractReconciliation(contract));
  }
  for (const sink of nodes.filter(node => node.kind === "effect-sink")) {
    const inbound = edges.filter(edge => edge.to === sink.id).map(edge => nodeById.get(edge.from)).filter((node): node is LinkedDataflowNode => Boolean(node));
    for (const source of inbound) addEdge(source, sink, "reaches-effect", sink.evidenceRefs, sink.reconciliation);
  }

  const uniqueEdges = [...new Map(edges.map(edge => [edge.id, edge] as const)).values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const uniqueGaps = [...new Map(gaps.map(gap => [gap.id, gap] as const)).values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.id.localeCompare(b.id));
  const linked = new Set(uniqueEdges.filter(edge => edge.reconciliation !== "unresolved").flatMap(edge => [edge.from, edge.to]));
  const coverage = Object.freeze({ nodeCount: nodes.length, edgeCount: uniqueEdges.length, linkedNodeCount: linked.size, unresolvedNodeCount: nodes.filter(node => node.reconciliation === "unresolved").length, unresolvedEdgeCount: uniqueEdges.filter(edge => edge.reconciliation === "unresolved").length, gapCount: uniqueGaps.length, partial: uniqueGaps.length > 0 || nodes.some(node => node.reconciliation === "unresolved") || uniqueEdges.some(edge => edge.reconciliation === "unresolved") });
  const graph = Object.freeze({ schemaVersion: 1 as const, nodes: Object.freeze(nodes), edges: Object.freeze(uniqueEdges), gaps: Object.freeze(uniqueGaps), coverage });
  cache.set(model, graph);
  return graph;
}
