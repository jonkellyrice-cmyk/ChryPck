import type { SemanticOrientation, SemanticRegionEvidence } from "./types.js";

const STOP_WORDS = new Set(["the", "and", "for", "from", "with", "this", "that", "into", "repo", "repository", "look", "take"]);

function terms(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9_$-]+/).filter(term => term.length >= 3 && !STOP_WORDS.has(term)))];
}

function packetScore(packet: SemanticRegionEvidence, objectiveTerms: readonly string[]): number {
  const pathAndName = `${packet.name_hint} ${packet.path_scopes.join(" ")} ${packet.representative_files.join(" ")}`.toLowerCase();
  const symbols = packet.representative_symbols.join(" ").toLowerCase();
  const evidence = packet.evidence.map(reference => reference.summary).join(" ").toLowerCase();
  let score = packet.kind === "repository" ? 1 : 2;
  for (const term of objectiveTerms) {
    if (pathAndName.includes(term)) score += 8;
    if (symbols.includes(term)) score += 6;
    if (evidence.includes(term)) score += 3;
  }
  return score;
}

export function objectiveSemanticFrontier(
  packets: readonly SemanticRegionEvidence[],
  objective: string
): readonly SemanticRegionEvidence[] {
  const objectiveTerms = terms(objective);
  const ranked = packets
    .map(packet => ({ packet, score: packetScore(packet, objectiveTerms) }))
    .sort((left, right) => right.score - left.score
      || (left.packet.kind === "repository" ? 1 : 0) - (right.packet.kind === "repository" ? 1 : 0)
      || left.packet.id.localeCompare(right.packet.id));
  return Object.freeze(ranked.slice(0, 1).map(row => row.packet));
}

export function pendingSemanticExpansion(
  packets: readonly SemanticRegionEvidence[],
  objective: string,
  orientation: SemanticOrientation | null
): readonly SemanticRegionEvidence[] {
  const mapped = new Map((orientation?.atlas.regions ?? []).map(region => [region.id, region.evidence_fingerprint]));
  return Object.freeze(objectiveSemanticFrontier(packets, objective).filter(packet => mapped.get(packet.id) !== packet.fingerprint));
}

export function mergeSemanticOrientation(args: {
  readonly repository: string;
  readonly commitSha: string;
  readonly projectProfile: string;
  readonly packets: readonly SemanticRegionEvidence[];
  readonly objective: string;
  readonly existing: SemanticOrientation | null;
  readonly expansion: SemanticOrientation;
}): SemanticOrientation {
  const regions = new Map((args.existing?.atlas.regions ?? []).map(region => [region.id, region]));
  for (const region of args.expansion.atlas.regions) regions.set(region.id, region);
  const ordered = [...regions.values()].sort((left, right) => left.id.localeCompare(right.id));
  const frontierIds = new Set(objectiveSemanticFrontier(args.packets, args.objective).map(packet => packet.id));
  const mappedFrontier = ordered.filter(region => frontierIds.has(region.id)).length;
  const mappedIds = new Set(ordered.map(region => region.id));
  const unmapped = args.packets.filter(packet => !mappedIds.has(packet.id));
  const globalComplete = unmapped.length === 0;
  const objectiveComplete = frontierIds.size > 0 && mappedFrontier === frontierIds.size;
  const synthesized = ordered.filter(region => region.synthesis_status === "synthesized").length;
  const partial = ordered.filter(region => region.synthesis_status === "partial").length;
  const deterministic = ordered.filter(region => region.synthesis_status === "deterministic").length;
  return Object.freeze({
    atlas: Object.freeze({
      schema_version: 1 as const,
      repository: args.repository,
      commit_sha: args.commitSha,
      project_profile: args.projectProfile,
      complete: globalComplete,
      status: globalComplete ? "COMPLETE" as const : objectiveComplete ? "OBJECTIVE_SUFFICIENT" as const : "PARTIAL" as const,
      region_count: ordered.length,
      regions: Object.freeze(ordered)
    }),
    coverage: Object.freeze({
      schema_version: 1 as const,
      candidate_regions: args.packets.length,
      returned_regions: ordered.length,
      synthesized_regions: synthesized,
      deterministic_only_regions: deterministic,
      partial_regions: partial,
      rejected_claims: (args.existing?.coverage.rejected_claims ?? 0) + args.expansion.coverage.rejected_claims,
      bootstrap_required: false,
      bootstrap_complete: globalComplete,
      bootstrap_chunk_count: (args.existing?.coverage.bootstrap_chunk_count ?? 0) + args.expansion.coverage.bootstrap_chunk_count,
      cache_hit: false,
      global_mapped_regions: ordered.length,
      global_unmapped_regions: unmapped.length,
      objective_region_count: frontierIds.size,
      objective_mapped_regions: mappedFrontier,
      objective_sufficient: objectiveComplete,
      active_frontier_region_ids: Object.freeze([...frontierIds].filter(id => !mappedIds.has(id)).sort())
    })
  });
}

export function scopeSemanticOrientation(args: {
  readonly repository: string;
  readonly commitSha: string;
  readonly projectProfile: string;
  readonly packets: readonly SemanticRegionEvidence[];
  readonly objective: string;
  readonly orientation: SemanticOrientation;
}): SemanticOrientation {
  const emptyExpansion: SemanticOrientation = Object.freeze({
    atlas: Object.freeze({
      schema_version: 1, repository: args.repository, commit_sha: args.commitSha,
      project_profile: args.projectProfile, complete: false, status: "EMPTY", region_count: 0,
      regions: Object.freeze([])
    }),
    coverage: Object.freeze({
      schema_version: 1, candidate_regions: 0, returned_regions: 0, synthesized_regions: 0,
      deterministic_only_regions: 0, partial_regions: 0, rejected_claims: 0,
      bootstrap_required: false, bootstrap_complete: false, bootstrap_chunk_count: 0, cache_hit: false,
      global_mapped_regions: 0, global_unmapped_regions: 0, objective_region_count: 0,
      objective_mapped_regions: 0, objective_sufficient: false, active_frontier_region_ids: Object.freeze([])
    })
  });
  return mergeSemanticOrientation({ ...args, existing: args.orientation, expansion: emptyExpansion });
}
