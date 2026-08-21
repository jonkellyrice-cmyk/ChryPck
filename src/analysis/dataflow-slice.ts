import { createHash } from "node:crypto";

import { buildDataflowGraph, type DataflowGraph, type LinkedDataflowEdge, type LinkedDataflowNode } from "./dataflow-linker.js";
import type { RepositoryModel } from "../repository/model.js";

export type DataflowSliceDirection = "forward" | "backward" | "bidirectional";
export type DataflowSliceStatus = "CERTIFIED" | "PARTIAL" | "UNABLE_TO_CERTIFY" | "LIMITS_EXCEEDED";

export interface DataflowSliceCriterion {
  readonly symbol?: string;
  readonly file?: string;
  readonly value?: string;
  readonly state?: Readonly<{ namespace: string; key: string }>;
  readonly contractId?: string;
  readonly effectKind?: string;
}

export interface DataflowSliceOptions {
  readonly maxNodes?: number;
  readonly maxEdges?: number;
  readonly maxHops?: number;
  readonly maxFiles?: number;
  readonly fileGlobAllow?: readonly string[];
  readonly fileGlobDeny?: readonly string[];
  readonly symbolAllow?: readonly string[];
  readonly symbolDeny?: readonly string[];
  readonly includeControlDependencies?: boolean;
}

export interface DataflowSliceRequest {
  readonly requestId?: string;
  readonly repository: string;
  readonly commitSha?: string;
  readonly objective: string;
  readonly criterion: DataflowSliceCriterion;
  readonly direction: DataflowSliceDirection;
  readonly target?: DataflowSliceCriterion;
  readonly options?: DataflowSliceOptions;
}

export interface DataflowSliceFrontier {
  readonly nodeId: string;
  readonly reason: "unresolved" | "policy-filter" | "hop-limit" | "node-limit" | "edge-limit" | "file-limit";
  readonly detail: string;
}

export interface DataflowSliceExclusion {
  readonly selector: string;
  readonly reason: string;
}

export interface DataflowSliceCoverage {
  readonly graphNodes: number;
  readonly returnedNodes: number;
  readonly graphEdges: number;
  readonly returnedEdges: number;
  readonly returnedFiles: number;
  readonly unresolvedFrontier: number;
  readonly truncated: boolean;
}

export interface DataflowSliceCertificate {
  readonly certificateId: string;
  readonly requestFingerprint: string;
  readonly graphHash: string;
  readonly createdAt: string;
}

export interface DataflowSliceResult {
  readonly requestId: string;
  readonly status: DataflowSliceStatus;
  readonly direction: DataflowSliceDirection;
  readonly criterion: LinkedDataflowNode | null;
  readonly targets: readonly LinkedDataflowNode[];
  readonly nodes: readonly LinkedDataflowNode[];
  readonly edges: readonly LinkedDataflowEdge[];
  readonly sources: readonly string[];
  readonly transformations: readonly string[];
  readonly sinks: readonly string[];
  readonly unresolvedFrontier: readonly DataflowSliceFrontier[];
  readonly excludedEvidence: readonly DataflowSliceExclusion[];
  readonly coverage: DataflowSliceCoverage;
  readonly certificate?: DataflowSliceCertificate;
}

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function normalize(value: string): string { return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[^a-z0-9_$]+/gi, " ").trim().toLowerCase(); }
function matchesGlob(pattern: string, value: string): boolean { const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&"); return new RegExp(`^${escaped.replace(/\\\*/g, ".*").replace(/\\\?/g, ".")}$`, "i").test(value); }

function matchesCriterion(node: LinkedDataflowNode, criterion: DataflowSliceCriterion, model: RepositoryModel): boolean {
  if (criterion.file && node.file !== criterion.file) return false;
  if (criterion.symbol && node.symbol !== criterion.symbol && node.value !== criterion.symbol) return false;
  if (criterion.value && normalize(`${node.value ?? ""} ${node.detail}`).includes(normalize(criterion.value)) === false) return false;
  if (criterion.effectKind) {
    const effect = model.effects.find(candidate => candidate.file === node.file && candidate.line === node.lineStart && (candidate.kind === criterion.effectKind || candidate.symbol === criterion.effectKind));
    if (!effect) return false;
  }
  if (criterion.state) {
    const state = model.states.find(candidate => candidate.file === node.file && candidate.line === node.lineStart && candidate.namespace === criterion.state?.namespace && candidate.key === criterion.state.key);
    if (!state) return false;
  }
  if (criterion.contractId && !node.evidenceRefs.includes(`contract:${criterion.contractId}`)) return false;
  return Boolean(criterion.file || criterion.symbol || criterion.value || criterion.state || criterion.contractId || criterion.effectKind);
}

function resolveCriterion(criterion: DataflowSliceCriterion, graph: DataflowGraph, model: RepositoryModel): LinkedDataflowNode | null {
  const matches = graph.nodes.filter(node => matchesCriterion(node, criterion, model));
  return [...matches].sort((a, b) => {
    const rank = (node: LinkedDataflowNode) => node.reconciliation === "unresolved" ? 0 : node.kind === "parameter" || node.kind === "literal-source" || node.kind === "state-read" || node.kind === "state-write" || node.kind === "effect-sink" ? 3 : 2;
    return rank(b) - rank(a) || a.file.localeCompare(b.file) || a.lineStart - b.lineStart || a.id.localeCompare(b.id);
  })[0] ?? null;
}

export function analyzeDataflowSlice(request: DataflowSliceRequest, model: RepositoryModel, graph: DataflowGraph = buildDataflowGraph(model)): DataflowSliceResult {
  const requestId = request.requestId ?? hash(request).slice(0, 24), criterion = resolveCriterion(request.criterion, graph, model);
  const empty = (): DataflowSliceResult => Object.freeze({ requestId, status: "UNABLE_TO_CERTIFY", direction: request.direction, criterion: null, targets: Object.freeze([]), nodes: Object.freeze([]), edges: Object.freeze([]), sources: Object.freeze([]), transformations: Object.freeze([]), sinks: Object.freeze([]), unresolvedFrontier: Object.freeze([]), excludedEvidence: Object.freeze([]), coverage: Object.freeze({ graphNodes: graph.nodes.length, returnedNodes: 0, graphEdges: graph.edges.length, returnedEdges: 0, returnedFiles: 0, unresolvedFrontier: 0, truncated: false }) });
  if (!criterion) return empty();

  const options = request.options ?? {}, maxNodes = Math.max(1, options.maxNodes ?? 80), maxEdges = Math.max(1, options.maxEdges ?? 120), maxHops = Math.max(1, options.maxHops ?? 24), maxFiles = Math.max(1, options.maxFiles ?? 16);
  const includeControl = options.includeControlDependencies === true;
  const nodeById = new Map(graph.nodes.map(node => [node.id, node] as const));
  const outgoing = new Map<string, LinkedDataflowEdge[]>(), incoming = new Map<string, LinkedDataflowEdge[]>();
  for (const edge of graph.edges) {
    if (!includeControl && edge.kind === "control-dependency") continue;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]); incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
  }
  const frontier: DataflowSliceFrontier[] = [], exclusions: DataflowSliceExclusion[] = [], visited = new Set<string>(), selectedEdges = new Map<string, LinkedDataflowEdge>(), files = new Set<string>();
  const queue: { id: string; hops: number }[] = [{ id: criterion.id, hops: 0 }];
  let limitExceeded = false;
  const allowed = (node: LinkedDataflowNode): boolean => {
    const denied = options.fileGlobDeny?.some(pattern => matchesGlob(pattern, node.file)) || options.symbolDeny?.includes(node.symbol);
    const absent = (options.fileGlobAllow?.length && !options.fileGlobAllow.some(pattern => matchesGlob(pattern, node.file))) || (options.symbolAllow?.length && !options.symbolAllow.includes(node.symbol));
    if (denied || absent) { exclusions.push(Object.freeze({ selector: `${node.symbol}@${node.file}`, reason: denied ? "deny filter" : "not in allow filter" })); return false; }
    return true;
  };
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    const node = nodeById.get(current.id); if (!node || !allowed(node)) continue;
    if (visited.size >= maxNodes) { frontier.push(Object.freeze({ nodeId: current.id, reason: "node-limit", detail: `Node limit ${maxNodes} reached.` })); limitExceeded = true; continue; }
    if (!files.has(node.file) && files.size >= maxFiles) { frontier.push(Object.freeze({ nodeId: current.id, reason: "file-limit", detail: `File limit ${maxFiles} reached.` })); limitExceeded = true; continue; }
    visited.add(node.id); files.add(node.file);
    if (node.reconciliation === "unresolved") frontier.push(Object.freeze({ nodeId: node.id, reason: "unresolved", detail: node.unresolvedReason ?? "Dataflow evidence is unresolved." }));
    if (current.hops >= maxHops) { frontier.push(Object.freeze({ nodeId: node.id, reason: "hop-limit", detail: `Hop limit ${maxHops} reached.` })); limitExceeded = true; continue; }
    const nextEdges = request.direction === "forward" ? (outgoing.get(node.id) ?? []) : request.direction === "backward" ? (incoming.get(node.id) ?? []) : [...(outgoing.get(node.id) ?? []), ...(incoming.get(node.id) ?? [])];
    for (const edge of nextEdges.sort((a, b) => a.id.localeCompare(b.id))) {
      if (selectedEdges.size >= maxEdges) { frontier.push(Object.freeze({ nodeId: node.id, reason: "edge-limit", detail: `Edge limit ${maxEdges} reached.` })); limitExceeded = true; break; }
      selectedEdges.set(edge.id, edge);
      queue.push({ id: edge.from === node.id ? edge.to : edge.from, hops: current.hops + 1 });
    }
  }
  const nodes = graph.nodes.filter(node => visited.has(node.id));
  const edges = [...selectedEdges.values()].filter(edge => visited.has(edge.from) && visited.has(edge.to));
  const targets = request.target ? nodes.filter(node => matchesCriterion(node, request.target!, model)) : nodes.filter(node => ["state-write", "effect-sink"].includes(node.kind) || (outgoing.get(node.id)?.length ?? 0) === 0);
  const unresolved = frontier.length > 0 || edges.some(edge => edge.reconciliation === "unresolved") || graph.gaps.some(gap => files.has(gap.file));
  const targetRequiredButMissing = Boolean(request.target && targets.length === 0);
  const status: DataflowSliceStatus = limitExceeded ? "LIMITS_EXCEEDED" : targetRequiredButMissing ? "UNABLE_TO_CERTIFY" : unresolved ? "PARTIAL" : "CERTIFIED";
  const graphHash = hash({ nodes: nodes.map(node => node.id), edges: edges.map(edge => edge.id), frontier });
  const certificate = status === "CERTIFIED" || status === "PARTIAL" ? Object.freeze({ certificateId: `dataflow-certificate-${graphHash.slice(0, 20)}`, requestFingerprint: hash(request), graphHash, createdAt: new Date().toISOString() }) : undefined;
  const coverage = Object.freeze({ graphNodes: graph.nodes.length, returnedNodes: nodes.length, graphEdges: graph.edges.length, returnedEdges: edges.length, returnedFiles: files.size, unresolvedFrontier: frontier.length, truncated: limitExceeded });
  return Object.freeze({ requestId, status, direction: request.direction, criterion, targets: Object.freeze(targets), nodes: Object.freeze(nodes), edges: Object.freeze(edges), sources: Object.freeze(nodes.filter(node => ["literal-source", "parameter", "state-read"].includes(node.kind)).map(node => node.id)), transformations: Object.freeze(nodes.filter(node => ["transformation", "assignment", "property-read", "property-write", "call-result"].includes(node.kind)).map(node => node.id)), sinks: Object.freeze(nodes.filter(node => ["state-write", "effect-sink"].includes(node.kind)).map(node => node.id)), unresolvedFrontier: Object.freeze(frontier), excludedEvidence: Object.freeze(exclusions), coverage, ...(certificate ? { certificate } : {}) });
}
