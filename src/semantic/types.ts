export type SemanticClaimBasis = "observed" | "derived" | "synthesized" | "confirmed";
export type SemanticRegionKind = "repository" | "subsystem" | "module-group";
export type SemanticEvidenceKind =
  | "path-topology"
  | "dependency"
  | "symbol"
  | "effect"
  | "state"
  | "manifest"
  | "documentation"
  | "native-contract";

export interface SemanticEvidenceReference {
  readonly id: string;
  readonly kind: SemanticEvidenceKind;
  readonly summary: string;
  readonly paths: readonly string[];
}

export interface SemanticRelationshipEvidence {
  readonly region_id: string;
  readonly file_count: number;
  readonly edge_count: number;
  readonly representative_paths: readonly string[];
}

export interface SemanticRegionEvidence {
  readonly id: string;
  readonly kind: SemanticRegionKind;
  readonly name_hint: string;
  readonly path_scopes: readonly string[];
  readonly file_count: number;
  readonly modeled_file_count: number;
  readonly representative_files: readonly string[];
  readonly representative_symbols: readonly string[];
  readonly incoming_regions: readonly SemanticRelationshipEvidence[];
  readonly outgoing_regions: readonly SemanticRelationshipEvidence[];
  readonly observed_effects: readonly string[];
  readonly observed_state_namespaces: readonly string[];
  readonly manifest_facts: readonly string[];
  readonly documentation_hints: readonly string[];
  readonly evidence: readonly SemanticEvidenceReference[];
  readonly fingerprint: string;
}

export interface SemanticSubmittedClaim {
  readonly text: string;
  readonly evidence_refs: readonly string[];
}

export interface SemanticRegionInterpretationInput {
  readonly region_id: string;
  readonly name?: string;
  readonly purpose?: SemanticSubmittedClaim;
  readonly responsibilities?: readonly SemanticSubmittedClaim[];
  readonly does_not_own?: readonly SemanticSubmittedClaim[];
  readonly key_flows?: readonly SemanticSubmittedClaim[];
}

export interface SemanticClaim {
  readonly text: string;
  readonly basis: SemanticClaimBasis;
  readonly confidence: number;
  readonly evidence_refs: readonly string[];
}

export interface SemanticRegion {
  readonly id: string;
  readonly kind: SemanticRegionKind;
  readonly name: string;
  readonly path_scopes: readonly string[];
  readonly representative_files: readonly string[];
  readonly representative_symbols: readonly string[];
  readonly purpose: SemanticClaim | null;
  readonly responsibilities: readonly SemanticClaim[];
  readonly does_not_own: readonly SemanticClaim[];
  readonly key_flows: readonly SemanticClaim[];
  readonly upstream_region_ids: readonly string[];
  readonly downstream_region_ids: readonly string[];
  readonly observed_effects: readonly string[];
  readonly observed_state_namespaces: readonly string[];
  readonly evidence_refs: readonly string[];
  readonly confidence: number;
  readonly synthesis_status: "deterministic" | "synthesized" | "partial";
  readonly evidence_fingerprint: string;
}

export interface SemanticAtlas {
  readonly schema_version: 1;
  readonly repository: string;
  readonly commit_sha: string;
  readonly project_profile: string;
  readonly complete: boolean;
  readonly status: "EMPTY" | "PARTIAL" | "OBJECTIVE_SUFFICIENT" | "COMPLETE";
  readonly region_count: number;
  readonly regions: readonly SemanticRegion[];
}

export interface SemanticCoverageLedger {
  readonly schema_version: 1;
  readonly candidate_regions: number;
  readonly returned_regions: number;
  readonly synthesized_regions: number;
  readonly deterministic_only_regions: number;
  readonly partial_regions: number;
  readonly rejected_claims: number;
  readonly bootstrap_required: boolean;
  readonly bootstrap_complete: boolean;
  readonly bootstrap_chunk_count: number;
  readonly cache_hit: boolean;
  readonly global_mapped_regions: number;
  readonly global_unmapped_regions: number;
  readonly objective_region_count: number;
  readonly objective_mapped_regions: number;
  readonly objective_sufficient: boolean;
  readonly active_frontier_region_ids: readonly string[];
}

export interface SemanticBootstrapChunk {
  readonly bootstrap_id: string;
  readonly chunk_id: string;
  readonly chunk_index: number;
  readonly chunk_count: number;
  readonly regions: readonly SemanticRegionEvidence[];
  readonly instructions: readonly string[];
  readonly response_contract: {
    readonly submit_via: "chrypck_plan.semantic_bootstrap";
    readonly required_fields: readonly string[];
  };
}

export interface SemanticBootstrapSubmissionInput {
  readonly bootstrap_id: string;
  readonly chunk_id: string;
  readonly interpretations: readonly SemanticRegionInterpretationInput[];
}

export interface SemanticBootstrapState {
  readonly status: "required" | "complete";
  readonly mode?: "lazy-objective-expansion";
  readonly bootstrap_id: string | null;
  readonly current_chunk: SemanticBootstrapChunk | null;
}

export interface SemanticOrientation {
  readonly atlas: SemanticAtlas;
  readonly coverage: SemanticCoverageLedger;
}
