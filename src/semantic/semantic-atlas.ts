import type { NativeContractRecord } from "../planning/planning-runner.js";
import type { RepositoryModel } from "../repository/model.js";
import { buildSemanticEvidencePackets } from "./evidence-builder.js";
import { buildSemanticRegionCandidates, DEFAULT_SEMANTIC_MAX_REGIONS } from "./region-builder.js";
import type { SemanticOrientation, SemanticRegionEvidence } from "./types.js";

export interface SemanticAtlasPreparationOptions {
  readonly maxRegions?: number;
  readonly nativeContracts?: readonly NativeContractRecord[];
}

export interface SemanticAtlasPreparation {
  readonly packets: readonly SemanticRegionEvidence[];
  readonly maxRegions: number;
}

export function prepareSemanticAtlas(
  model: RepositoryModel,
  options: SemanticAtlasPreparationOptions = {}
): SemanticAtlasPreparation {
  const maxRegions = options.maxRegions ?? DEFAULT_SEMANTIC_MAX_REGIONS;
  const regions = buildSemanticRegionCandidates(model, maxRegions);
  const packets = buildSemanticEvidencePackets(model, regions, options.nativeContracts ?? []);
  return Object.freeze({ packets, maxRegions });
}

export function semanticOrientationSummary(orientation: SemanticOrientation): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schema_version: orientation.atlas.schema_version,
    repository: orientation.atlas.repository,
    commit_sha: orientation.atlas.commit_sha,
    complete: orientation.atlas.complete,
    region_count: orientation.atlas.region_count,
    synthesized_regions: orientation.coverage.synthesized_regions,
    partial_regions: orientation.coverage.partial_regions,
    deterministic_only_regions: orientation.coverage.deterministic_only_regions,
    rejected_claims: orientation.coverage.rejected_claims,
    cache_hit: orientation.coverage.cache_hit
  });
}
