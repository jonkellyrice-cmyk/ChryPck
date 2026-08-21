import { createHash } from "node:crypto";

import type { ContractRecord } from "../repository/contract-types.js";
import type { EffectRuntimeEdge, EffectRuntimeNode } from "../repository/effect-runtime-types.js";
import type { RepositoryModel, StateRecord } from "../repository/model.js";

export type EffectRuntimeReconciliation =
  | "repository-confirmed"
  | "cross-map-confirmed"
  | "native-confirmed"
  | "native-supplemented"
  | "native-conflict"
  | "unresolved";

export interface LinkedEffectRuntimeNode extends EffectRuntimeNode {
  readonly reconciliation: EffectRuntimeReconciliation;
  readonly evidenceRefs: readonly string[];
}

export interface LinkedEffectRuntimeEdge extends EffectRuntimeEdge {
  readonly reconciliation: EffectRuntimeReconciliation;
  readonly evidenceRefs: readonly string[];
}

export interface EffectRuntimeRegion {
  readonly id: string;
  readonly files: readonly string[];
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly entryPointIds: readonly string[];
  readonly terminalEffectIds: readonly string[];
  readonly observationPointIds: readonly string[];
  readonly effectKinds: readonly string[];
  readonly contractIds: readonly string[];
  readonly reconciliation: EffectRuntimeReconciliation;
}

export interface EffectRuntimeCoverage {
  readonly candidateSites: number;
  readonly classifiedSites: number;
  readonly linkedSites: number;
  readonly terminalEffects: number;
  readonly observableEffects: number;
  readonly unresolvedSites: number;
  readonly ambiguousLinks: number;
  readonly parserGaps: number;
  readonly excludedFiles: number;
  readonly coveragePercent: number;
  readonly partial: boolean;
}

export interface EffectRuntimeAtlas {
  readonly schemaVersion: 1;
  readonly nodes: readonly LinkedEffectRuntimeNode[];
  readonly edges: readonly LinkedEffectRuntimeEdge[];
  readonly regions: readonly EffectRuntimeRegion[];
  readonly coverage: EffectRuntimeCoverage;
}

const atlasCache = new WeakMap<RepositoryModel, EffectRuntimeAtlas>();

function stableId(prefix: string, parts: readonly (string | number)[]): string {
  return `${prefix}-${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 20)}`;
}

function contractReconciliation(contract: ContractRecord): EffectRuntimeReconciliation {
  return contract.reconciliation === "repository-only" ? "cross-map-confirmed" : contract.reconciliation;
}

function strongest(values: readonly EffectRuntimeReconciliation[]): EffectRuntimeReconciliation {
  const rank: Record<EffectRuntimeReconciliation, number> = {
    "native-conflict": 6,
    "native-confirmed": 5,
    "native-supplemented": 4,
    "cross-map-confirmed": 3,
    "repository-confirmed": 2,
    unresolved: 1
  };
  return [...values].sort((left, right) => rank[right] - rank[left])[0] ?? "unresolved";
}

function stateNode(state: StateRecord): LinkedEffectRuntimeNode {
  const resolved = state.namespaceResolved && state.keyResolved;
  return Object.freeze({
    id: stableId("runtime-state", [state.file, state.kind, state.namespace, state.key, state.access, state.line]),
    kind: state.access === "read" ? "runtime-operation" : "effect-sink",
    effectKind: `state-${state.access}`,
    file: state.file,
    symbol: "<state-site>",
    lineStart: state.line,
    lineEnd: state.line,
    detail: `${state.access} ${state.namespace}.${state.key}`,
    confidence: resolved ? "syntax-confirmed" : "unresolved",
    extractionSource: "source-syntax",
    unresolvedReason: resolved ? null : "State namespace or key is unresolved.",
    reconciliation: resolved ? "cross-map-confirmed" : "unresolved",
    evidenceRefs: Object.freeze([`state:${state.kind}:${state.namespace}:${state.key}:${state.line}`])
  });
}

function operationFor(nodes: readonly LinkedEffectRuntimeNode[], file: string, symbol: string, line: number): LinkedEffectRuntimeNode | undefined {
  const candidates = nodes.filter(node => node.file === file && node.kind === "runtime-operation" && (symbol === "<state-site>" || node.symbol === symbol) && node.lineStart <= line);
  return [...candidates].sort((left, right) => right.lineStart - left.lineStart || left.id.localeCompare(right.id))[0];
}

function connectedRegions(nodes: readonly LinkedEffectRuntimeNode[], edges: readonly LinkedEffectRuntimeEdge[], contracts: readonly ContractRecord[]): readonly EffectRuntimeRegion[] {
  const nodeById = new Map(nodes.map(node => [node.id, node] as const));
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) adjacency.set(node.id, new Set());
  for (const edge of edges) {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }
  const nodesByFile = new Map<string, string[]>();
  for (const node of nodes) nodesByFile.set(node.file, [...(nodesByFile.get(node.file) ?? []), node.id]);
  for (const ids of nodesByFile.values()) for (const left of ids) for (const right of ids) if (left !== right) adjacency.get(left)?.add(right);

  const visited = new Set<string>(), regions: EffectRuntimeRegion[] = [];
  for (const start of [...nodeById.keys()].sort()) {
    if (visited.has(start)) continue;
    const pending = [start], component: string[] = [];
    while (pending.length) {
      const current = pending.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      component.push(current);
      for (const next of [...(adjacency.get(current) ?? [])].sort()) if (!visited.has(next)) pending.push(next);
    }
    const componentSet = new Set(component), componentNodes = component.map(id => nodeById.get(id)).filter((node): node is LinkedEffectRuntimeNode => Boolean(node));
    const componentEdges = edges.filter(edge => componentSet.has(edge.from) && componentSet.has(edge.to));
    const files = [...new Set(componentNodes.map(node => node.file))].sort();
    const regionContracts = contracts.filter(contract => {
      const endpointFiles = [contract.provider?.file, ...contract.consumers.map(consumer => consumer.file)].filter((file): file is string => Boolean(file));
      return endpointFiles.some(file => files.includes(file));
    });
    const reconciliations = [...componentNodes.map(node => node.reconciliation), ...componentEdges.map(edge => edge.reconciliation), ...regionContracts.map(contractReconciliation)];
    regions.push(Object.freeze({
      id: stableId("runtime-region", component.sort()),
      files: Object.freeze(files),
      nodeIds: Object.freeze(component.sort()),
      edgeIds: Object.freeze(componentEdges.map(edge => edge.id).sort()),
      entryPointIds: Object.freeze(componentNodes.filter(node => node.kind === "entry-point").map(node => node.id).sort()),
      terminalEffectIds: Object.freeze(componentNodes.filter(node => node.kind === "effect-sink" || node.kind === "integration-boundary").map(node => node.id).sort()),
      observationPointIds: Object.freeze(componentNodes.filter(node => node.kind === "observation-point").map(node => node.id).sort()),
      effectKinds: Object.freeze([...new Set(componentNodes.map(node => node.effectKind).filter(kind => kind !== "symbol-operation"))].sort()),
      contractIds: Object.freeze(regionContracts.map(contract => contract.id).sort()),
      reconciliation: strongest(reconciliations)
    }));
  }
  return Object.freeze(regions.sort((left, right) => left.files[0]?.localeCompare(right.files[0] ?? "") || left.id.localeCompare(right.id)));
}

export function buildEffectRuntimeAtlas(model: RepositoryModel): EffectRuntimeAtlas {
  const cached = atlasCache.get(model);
  if (cached) return cached;
  const contracts = model.contractMap?.contracts ?? [];
  const rawNodes = model.runtimeNodes ?? [];
  const nodes: LinkedEffectRuntimeNode[] = rawNodes.map(node => {
    const relevantContracts = contracts.filter(contract => [contract.provider, ...contract.consumers].some(endpoint => endpoint?.file === node.file && (endpoint.symbol === node.symbol || node.symbol === "<module>")));
    const reconciliation = node.confidence === "unresolved"
      ? "unresolved"
      : strongest(["repository-confirmed", ...relevantContracts.map(contractReconciliation)]);
    return Object.freeze({ ...node, reconciliation, evidenceRefs: Object.freeze(relevantContracts.map(contract => `contract:${contract.id}`).sort()) });
  });
  for (const state of model.states) nodes.push(stateNode(state));
  for (const contract of contracts.filter(record => record.reconciliation === "native-supplemented")) {
    const endpoints = contract.consumers.length ? contract.consumers : [{ file: contract.evidence[0]?.file ?? "<native-contract>", symbol: "<native-contract-consumer>", line: 1, role: "consumer" as const }];
    for (const endpoint of endpoints) nodes.push(Object.freeze({
      id: stableId("runtime-native-obligation", [contract.id, endpoint.file, endpoint.symbol]),
      kind: "integration-boundary",
      effectKind: "native-contract-obligation",
      file: endpoint.file,
      symbol: endpoint.symbol,
      lineStart: endpoint.line,
      lineEnd: endpoint.line,
      detail: `Native runtime obligation ${contract.name}`,
      confidence: "syntax-confirmed",
      extractionSource: "native-contract",
      unresolvedReason: null,
      reconciliation: "native-supplemented",
      evidenceRefs: Object.freeze([`contract:${contract.id}`, ...contract.nativeContractRefs.map(ref => `native-contract:${ref}`)])
    }));
  }

  const edges: LinkedEffectRuntimeEdge[] = (model.runtimeEdges ?? []).map(edge => Object.freeze({
    ...edge,
    reconciliation: edge.confidence === "unresolved" ? "unresolved" : "repository-confirmed",
    evidenceRefs: Object.freeze([])
  }));
  for (const state of model.states) {
    const stateEvidenceNode = stateNode(state);
    const target = nodes.find(node => node.id === stateEvidenceNode.id);
    if (!target) continue;
    const owner = operationFor(nodes, state.file, target.symbol, state.line);
    if (!owner) continue;
    const kind = state.access === "read" ? "reads-state" : "writes-state";
    edges.push(Object.freeze({ id: stableId("runtime-edge", [owner.id, kind, target.id]), kind, from: owner.id, to: target.id, file: state.file, line: state.line, confidence: "lexically-associated", extractionSource: "symbol-association", unresolvedReason: null, reconciliation: "cross-map-confirmed", evidenceRefs: target.evidenceRefs }));
  }
  for (const contract of contracts) {
    if (!contract.provider || contract.reconciliation === "native-conflict") continue;
    const provider = operationFor(nodes, contract.provider.file, contract.provider.symbol, contract.provider.line);
    if (!provider) continue;
    for (const consumerEndpoint of contract.consumers) {
      const consumer = operationFor(nodes, consumerEndpoint.file, consumerEndpoint.symbol, consumerEndpoint.line);
      if (!consumer || consumer.id === provider.id) continue;
      edges.push(Object.freeze({ id: stableId("runtime-edge", [consumer.id, "calls", provider.id, contract.id]), kind: "calls", from: consumer.id, to: provider.id, file: consumerEndpoint.file, line: consumerEndpoint.line, confidence: contract.verification === "resolved" || contract.verification === "native-authoritative" ? "syntax-confirmed" : "pattern-detected", extractionSource: "source-syntax", unresolvedReason: null, reconciliation: contractReconciliation(contract), evidenceRefs: Object.freeze([`contract:${contract.id}`]) }));
    }
  }

  const uniqueNodes = [...new Map(nodes.map(node => [node.id, node] as const)).values()].sort((a, b) => a.file.localeCompare(b.file) || a.lineStart - b.lineStart || a.id.localeCompare(b.id));
  const uniqueEdges = [...new Map(edges.map(edge => [edge.id, edge] as const)).values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.id.localeCompare(b.id));
  const regions = connectedRegions(uniqueNodes, uniqueEdges, contracts);
  const candidateSites = model.effects.length + model.states.length;
  const classifiedSites = uniqueNodes.filter(node => node.effectKind !== "symbol-operation" && node.kind !== "unresolved-runtime-site").length;
  const linkedIds = new Set(uniqueEdges.filter(edge => edge.kind !== "unresolved-runtime-link").flatMap(edge => [edge.from, edge.to]));
  const unresolvedSites = uniqueNodes.filter(node => node.reconciliation === "unresolved").length;
  const parserGaps = (model.contractMap?.gaps.length ?? 0) + model.unresolvedDependencies.filter(reference => !reference.external).length;
  const coverage: EffectRuntimeCoverage = Object.freeze({
    candidateSites,
    classifiedSites,
    linkedSites: uniqueNodes.filter(node => linkedIds.has(node.id)).length,
    terminalEffects: uniqueNodes.filter(node => node.kind === "effect-sink" || node.kind === "integration-boundary").length,
    observableEffects: uniqueNodes.filter(node => node.kind === "observation-point").length,
    unresolvedSites,
    ambiguousLinks: uniqueEdges.filter(edge => edge.reconciliation === "unresolved").length,
    parserGaps,
    excludedFiles: Math.max(0, model.snapshot.files.length - model.fileFacts.length),
    coveragePercent: candidateSites === 0 ? 100 : Math.round(classifiedSites / candidateSites * 100),
    partial: unresolvedSites > 0 || parserGaps > 0 || classifiedSites < candidateSites
  });
  const atlas = Object.freeze({ schemaVersion: 1 as const, nodes: Object.freeze(uniqueNodes), edges: Object.freeze(uniqueEdges), regions, coverage });
  atlasCache.set(model, atlas);
  return atlas;
}
