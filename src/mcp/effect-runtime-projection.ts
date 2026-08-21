import type { EffectRuntimeAtlas, EffectRuntimeRegion, LinkedEffectRuntimeNode } from "../analysis/effect-runtime-linker.js";

const MAX_REGIONS = 8;
const MAX_NODES_PER_REGION = 12;
const MAX_EDGES_PER_REGION = 12;

function terms(value: string): readonly string[] {
  return Object.freeze([...new Set(value.toLowerCase().split(/[^a-z0-9_$./-]+/).filter(term => term.length >= 3))]);
}

function nodeText(node: LinkedEffectRuntimeNode): string {
  return `${node.file} ${node.symbol} ${node.effectKind} ${node.detail}`.toLowerCase();
}

function regionScore(region: EffectRuntimeRegion, nodes: ReadonlyMap<string, LinkedEffectRuntimeNode>, objectiveTerms: readonly string[], corridor: ReadonlySet<string>): number {
  let score = region.files.reduce((sum, file) => sum + (corridor.has(file) ? 40 : 0), 0);
  const text = [...region.files, ...region.effectKinds, ...region.contractIds, ...region.nodeIds.map(id => nodeText(nodes.get(id)!))].join(" ").toLowerCase();
  for (const term of objectiveTerms) if (text.includes(term)) score += 3;
  if (region.reconciliation === "native-conflict") score += 30;
  if (region.reconciliation === "unresolved") score += 10;
  return score;
}

export function projectEffectRuntimeAtlas(atlas: EffectRuntimeAtlas, objective: string, corridorPaths: readonly string[]): Readonly<Record<string, unknown>> {
  const nodeById = new Map(atlas.nodes.map(node => [node.id, node] as const));
  const edgeById = new Map(atlas.edges.map(edge => [edge.id, edge] as const));
  const objectiveTerms = terms(objective), corridor = new Set(corridorPaths);
  const selected = atlas.regions.map((region, index) => ({ region, index, score: regionScore(region, nodeById, objectiveTerms, corridor) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_REGIONS)
    .map(({ region }) => {
      const nodes = region.nodeIds.map(id => nodeById.get(id)).filter((node): node is LinkedEffectRuntimeNode => Boolean(node));
      const rankedNodes = [...nodes].sort((left, right) => Number(corridor.has(right.file)) - Number(corridor.has(left.file)) || left.file.localeCompare(right.file) || left.lineStart - right.lineStart).slice(0, MAX_NODES_PER_REGION);
      const edges = region.edgeIds.map(id => edgeById.get(id)).filter((edge): edge is NonNullable<typeof edge> => Boolean(edge)).slice(0, MAX_EDGES_PER_REGION);
      return Object.freeze({
        id: region.id,
        files: region.files,
        effect_kinds: region.effectKinds,
        reconciliation: region.reconciliation,
        contract_ids: region.contractIds,
        nodes: Object.freeze(rankedNodes.map(node => Object.freeze({ id: node.id, kind: node.kind, effect_kind: node.effectKind, file: node.file, symbol: node.symbol, line_start: node.lineStart, line_end: node.lineEnd, confidence: node.confidence, reconciliation: node.reconciliation, unresolved_reason: node.unresolvedReason }))),
        edges: Object.freeze(edges.map(edge => Object.freeze({ id: edge.id, kind: edge.kind, from: edge.from, to: edge.to, confidence: edge.confidence, reconciliation: edge.reconciliation, unresolved_reason: edge.unresolvedReason }))),
        node_count: region.nodeIds.length,
        returned_node_count: rankedNodes.length,
        edge_count: region.edgeIds.length,
        returned_edge_count: edges.length,
        truncated: rankedNodes.length < region.nodeIds.length || edges.length < region.edgeIds.length
      });
    });
  return Object.freeze({
    schema_version: atlas.schemaVersion,
    summary: Object.freeze({ region_count: atlas.regions.length, returned_region_count: selected.length, node_count: atlas.nodes.length, edge_count: atlas.edges.length }),
    coverage: Object.freeze({ ...atlas.coverage }),
    regions: Object.freeze(selected),
    truncated: selected.length < atlas.regions.length
  });
}
