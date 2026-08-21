import type { DataflowSliceResult } from "../analysis/dataflow-slice.js";

export function projectDataflowSlice(result: DataflowSliceResult): Readonly<Record<string, unknown>> {
  return Object.freeze({
    request_id: result.requestId,
    status: result.status,
    direction: result.direction,
    criterion: result.criterion ? Object.freeze({ id: result.criterion.id, kind: result.criterion.kind, file: result.criterion.file, symbol: result.criterion.symbol, value: result.criterion.value, line: result.criterion.lineStart, reconciliation: result.criterion.reconciliation, evidence_refs: result.criterion.evidenceRefs }) : null,
    targets: Object.freeze(result.targets.map(node => Object.freeze({ id: node.id, kind: node.kind, file: node.file, symbol: node.symbol, value: node.value, line: node.lineStart, reconciliation: node.reconciliation }))),
    nodes: Object.freeze(result.nodes.map(node => Object.freeze({ id: node.id, kind: node.kind, file: node.file, symbol: node.symbol, value: node.value, line_start: node.lineStart, line_end: node.lineEnd, confidence: node.confidence, reconciliation: node.reconciliation, evidence_refs: node.evidenceRefs, unresolved_reason: node.unresolvedReason }))),
    edges: Object.freeze(result.edges.map(edge => Object.freeze({ id: edge.id, kind: edge.kind, from: edge.from, to: edge.to, file: edge.file, line: edge.line, confidence: edge.confidence, reconciliation: edge.reconciliation, evidence_refs: edge.evidenceRefs, unresolved_reason: edge.unresolvedReason }))),
    sources: result.sources,
    transformations: result.transformations,
    sinks: result.sinks,
    unresolved_frontier: result.unresolvedFrontier,
    excluded_evidence: result.excludedEvidence,
    coverage: result.coverage,
    certificate: result.certificate ?? null
  });
}
