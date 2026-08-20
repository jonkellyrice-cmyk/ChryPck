import { createHash } from "node:crypto";
import type {
  SemanticAtlas,
  SemanticBootstrapChunk,
  SemanticBootstrapSubmissionInput,
  SemanticClaim,
  SemanticCoverageLedger,
  SemanticOrientation,
  SemanticRegion,
  SemanticRegionEvidence,
  SemanticRegionInterpretationInput,
  SemanticSubmittedClaim
} from "./types.js";

export const DEFAULT_SEMANTIC_BOOTSTRAP_REGIONS_PER_CHUNK = 4;

interface SemanticBootstrapSession {
  readonly id: string;
  readonly repository: string;
  readonly commitSha: string;
  readonly projectProfile: string;
  readonly packets: readonly SemanticRegionEvidence[];
  readonly chunks: readonly SemanticBootstrapChunk[];
  readonly submissions: Map<string, SemanticRegionInterpretationInput>;
  rejectedClaims: number;
  nextChunkIndex: number;
}

export interface SemanticBootstrapStart {
  readonly bootstrapId: string;
  readonly currentChunk: SemanticBootstrapChunk;
  readonly chunkCount: number;
}

export type SemanticBootstrapAdvance =
  | {
      readonly complete: false;
      readonly currentChunk: SemanticBootstrapChunk;
    }
  | {
      readonly complete: true;
      readonly orientation: SemanticOrientation;
    };

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bootstrapId(repository: string, commitSha: string, projectProfile: string, packets: readonly SemanticRegionEvidence[]): string {
  return `semantic-bootstrap-${hash(`${repository}:${commitSha}:${projectProfile}:${packets.map(packet => packet.fingerprint).join(":")}`).slice(0, 16)}`;
}

function chunkId(id: string, index: number, packets: readonly SemanticRegionEvidence[]): string {
  return `semantic-chunk-${index + 1}-${hash(`${id}:${index}:${packets.map(packet => packet.id).join(":")}`).slice(0, 10)}`;
}

function buildChunks(id: string, packets: readonly SemanticRegionEvidence[], regionsPerChunk: number): readonly SemanticBootstrapChunk[] {
  const chunks: SemanticBootstrapChunk[] = [];
  const count = Math.ceil(packets.length / regionsPerChunk);
  for (let index = 0; index < count; index += 1) {
    const regions = Object.freeze(packets.slice(index * regionsPerChunk, (index + 1) * regionsPerChunk));
    chunks.push(Object.freeze({
      bootstrap_id: id,
      chunk_id: chunkId(id, index, regions),
      chunk_index: index,
      chunk_count: count,
      regions,
      instructions: Object.freeze([
        "Semantic bootstrap is mandatory before ordinary repository work on this uncached repository state.",
        "Interpret every region in this chunk from the supplied bounded metadata only; do not request or infer arbitrary source code.",
        "For purpose, responsibilities, does_not_own, and key_flows, cite one or more evidence_refs from that same region. Unsupported claims will be rejected or confidence-capped.",
        "Keep claims concise and architectural. Describe what the region is for, what it owns, what it does not own when evidence supports that distinction, and its important flows/boundaries.",
        "Submit exactly one interpretation object for every region_id in this chunk by calling chrypck_plan again with semantic_bootstrap. Do not continue to the user's repository task until ChryPck reports semantic bootstrap complete."
      ]),
      response_contract: Object.freeze({
        submit_via: "chrypck_plan.semantic_bootstrap" as const,
        required_fields: Object.freeze([
          "bootstrap_id",
          "chunk_id",
          "interpretations[].region_id",
          "each semantic claim: text + evidence_refs"
        ])
      })
    }));
  }
  return Object.freeze(chunks);
}

function normalizedText(value: string | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function validateSubmittedClaim(
  claim: SemanticSubmittedClaim | undefined,
  packet: SemanticRegionEvidence,
  claimKind: "purpose" | "responsibility" | "does-not-own" | "key-flow"
): SemanticClaim | null {
  if (!claim) return null;
  const text = normalizedText(claim.text);
  if (!text || text.length > 600) return null;
  const validEvidence = new Set(packet.evidence.map(reference => reference.id));
  const evidenceRefs = [...new Set(claim.evidence_refs.map(value => value.trim()).filter(value => validEvidence.has(value)))];
  if (evidenceRefs.length === 0) return null;
  const evidenceKinds = new Set(
    packet.evidence.filter(reference => evidenceRefs.includes(reference.id)).map(reference => reference.kind)
  );
  const base = claimKind === "does-not-own" ? 0.52 : 0.58;
  const ceiling = claimKind === "does-not-own" ? 0.78 : 0.95;
  const confidence = Math.min(ceiling, base + evidenceKinds.size * 0.07 + Math.min(evidenceRefs.length, 4) * 0.035);
  return Object.freeze({
    text,
    basis: "synthesized" as const,
    confidence: Number(confidence.toFixed(2)),
    evidence_refs: Object.freeze(evidenceRefs)
  });
}

function validateClaimList(
  claims: readonly SemanticSubmittedClaim[] | undefined,
  packet: SemanticRegionEvidence,
  kind: "responsibility" | "does-not-own" | "key-flow",
  maxItems: number
): { readonly claims: readonly SemanticClaim[]; readonly rejected: number } {
  const accepted: SemanticClaim[] = [];
  let rejected = 0;
  for (const submitted of claims ?? []) {
    if (accepted.length >= maxItems) {
      rejected += 1;
      continue;
    }
    const validated = validateSubmittedClaim(submitted, packet, kind);
    if (validated) accepted.push(validated);
    else rejected += 1;
  }
  return { claims: Object.freeze(accepted), rejected };
}

function buildRegion(packet: SemanticRegionEvidence, input: SemanticRegionInterpretationInput | undefined): { readonly region: SemanticRegion; readonly rejected: number } {
  if (!input) {
    return {
      rejected: 0,
      region: Object.freeze({
        id: packet.id,
        kind: packet.kind,
        name: packet.name_hint,
        path_scopes: packet.path_scopes,
        representative_files: packet.representative_files,
        representative_symbols: packet.representative_symbols,
        purpose: null,
        responsibilities: Object.freeze([]),
        does_not_own: Object.freeze([]),
        key_flows: Object.freeze([]),
        upstream_region_ids: Object.freeze(packet.incoming_regions.map(row => row.region_id)),
        downstream_region_ids: Object.freeze(packet.outgoing_regions.map(row => row.region_id)),
        observed_effects: packet.observed_effects,
        observed_state_namespaces: packet.observed_state_namespaces,
        evidence_refs: Object.freeze(packet.evidence.map(reference => reference.id)),
        confidence: 0.35,
        synthesis_status: "deterministic" as const,
        evidence_fingerprint: packet.fingerprint
      })
    };
  }

  let rejected = 0;
  const purpose = validateSubmittedClaim(input.purpose, packet, "purpose");
  if (input.purpose && !purpose) rejected += 1;
  const responsibilities = validateClaimList(input.responsibilities, packet, "responsibility", 5);
  const doesNotOwn = validateClaimList(input.does_not_own, packet, "does-not-own", 4);
  const keyFlows = validateClaimList(input.key_flows, packet, "key-flow", 5);
  rejected += responsibilities.rejected + doesNotOwn.rejected + keyFlows.rejected;

  const claims = [
    ...(purpose ? [purpose] : []),
    ...responsibilities.claims,
    ...doesNotOwn.claims,
    ...keyFlows.claims
  ];
  const confidence = claims.length
    ? Number((claims.reduce((sum, claim) => sum + claim.confidence, 0) / claims.length).toFixed(2))
    : 0.35;
  const synthesized = claims.length > 0;
  const expectedCore = Boolean(purpose) && responsibilities.claims.length > 0;
  const name = normalizedText(input.name) || packet.name_hint;

  return {
    rejected,
    region: Object.freeze({
      id: packet.id,
      kind: packet.kind,
      name: name.slice(0, 120),
      path_scopes: packet.path_scopes,
      representative_files: packet.representative_files,
      representative_symbols: packet.representative_symbols,
      purpose,
      responsibilities: responsibilities.claims,
      does_not_own: doesNotOwn.claims,
      key_flows: keyFlows.claims,
      upstream_region_ids: Object.freeze(packet.incoming_regions.map(row => row.region_id)),
      downstream_region_ids: Object.freeze(packet.outgoing_regions.map(row => row.region_id)),
      observed_effects: packet.observed_effects,
      observed_state_namespaces: packet.observed_state_namespaces,
      evidence_refs: Object.freeze(packet.evidence.map(reference => reference.id)),
      confidence,
      synthesis_status: synthesized ? (expectedCore ? "synthesized" as const : "partial" as const) : "deterministic" as const,
      evidence_fingerprint: packet.fingerprint
    })
  };
}

function composeOrientation(session: SemanticBootstrapSession): SemanticOrientation {
  const regions: SemanticRegion[] = [];
  let rejectedClaims = session.rejectedClaims;
  for (const packet of session.packets) {
    const built = buildRegion(packet, session.submissions.get(packet.id));
    regions.push(built.region);
    rejectedClaims += built.rejected;
  }
  const synthesizedRegions = regions.filter(region => region.synthesis_status === "synthesized").length;
  const partialRegions = regions.filter(region => region.synthesis_status === "partial").length;
  const deterministicRegions = regions.filter(region => region.synthesis_status === "deterministic").length;
  const atlas: SemanticAtlas = Object.freeze({
    schema_version: 1,
    repository: session.repository,
    commit_sha: session.commitSha,
    project_profile: session.projectProfile,
    complete: true,
    region_count: regions.length,
    regions: Object.freeze(regions)
  });
  const coverage: SemanticCoverageLedger = Object.freeze({
    schema_version: 1,
    candidate_regions: session.packets.length,
    returned_regions: regions.length,
    synthesized_regions: synthesizedRegions,
    deterministic_only_regions: deterministicRegions,
    partial_regions: partialRegions,
    rejected_claims: rejectedClaims,
    bootstrap_required: true,
    bootstrap_complete: true,
    bootstrap_chunk_count: session.chunks.length,
    cache_hit: false
  });
  return Object.freeze({ atlas, coverage });
}

export class SemanticBootstrapCoordinator {
  readonly #sessions = new Map<string, SemanticBootstrapSession>();

  constructor(private readonly regionsPerChunk = DEFAULT_SEMANTIC_BOOTSTRAP_REGIONS_PER_CHUNK) {
    if (!Number.isInteger(regionsPerChunk) || regionsPerChunk < 1) throw new Error("Semantic bootstrap chunk size must be a positive integer.");
  }

  begin(args: {
    readonly repository: string;
    readonly commitSha: string;
    readonly projectProfile: string;
    readonly packets: readonly SemanticRegionEvidence[];
  }): SemanticBootstrapStart {
    if (args.packets.length === 0) throw new Error("Semantic bootstrap requires at least one region evidence packet.");
    const id = bootstrapId(args.repository, args.commitSha, args.projectProfile, args.packets);
    let session = this.#sessions.get(id);
    if (!session) {
      const chunks = buildChunks(id, args.packets, this.regionsPerChunk);
      session = {
        id,
        repository: args.repository,
        commitSha: args.commitSha,
        projectProfile: args.projectProfile,
        packets: Object.freeze([...args.packets]),
        chunks,
        submissions: new Map(),
        rejectedClaims: 0,
        nextChunkIndex: 0
      };
      this.#sessions.set(id, session);
    }
    const currentChunk = session.chunks[session.nextChunkIndex];
    if (!currentChunk) throw new Error("Semantic bootstrap session has no pending chunk.");
    return Object.freeze({ bootstrapId: id, currentChunk, chunkCount: session.chunks.length });
  }

  advance(
    input: SemanticBootstrapSubmissionInput,
    expected: { readonly repository: string; readonly commitSha: string; readonly projectProfile: string }
  ): SemanticBootstrapAdvance {
    const session = this.#sessions.get(input.bootstrap_id);
    if (!session) throw new Error(`Unknown or expired semantic bootstrap: ${input.bootstrap_id}`);
    if (
      session.repository !== expected.repository ||
      session.commitSha !== expected.commitSha ||
      session.projectProfile !== expected.projectProfile
    ) {
      throw new Error("Semantic bootstrap submission does not match the current repository, immutable commit, or project profile.");
    }
    const currentChunk = session.chunks[session.nextChunkIndex];
    if (!currentChunk || currentChunk.chunk_id !== input.chunk_id) {
      throw new Error("Semantic bootstrap submission does not match the current server-issued chunk.");
    }
    const expectedIds = currentChunk.regions.map(region => region.id).sort();
    const submittedIds = input.interpretations.map(row => row.region_id).sort();
    if (expectedIds.length !== submittedIds.length || expectedIds.some((id, index) => id !== submittedIds[index])) {
      throw new Error("Semantic bootstrap must submit exactly one interpretation for every region in the current chunk.");
    }
    if (new Set(submittedIds).size !== submittedIds.length) throw new Error("Semantic bootstrap contains duplicate region interpretations.");
    for (const interpretation of input.interpretations) {
      session.submissions.set(interpretation.region_id, Object.freeze({ ...interpretation }));
    }
    session.nextChunkIndex += 1;
    const next = session.chunks[session.nextChunkIndex];
    if (next) return Object.freeze({ complete: false as const, currentChunk: next });
    const orientation = composeOrientation(session);
    this.#sessions.delete(session.id);
    return Object.freeze({ complete: true as const, orientation });
  }
}

export function cachedSemanticCoverage(args: {
  readonly regionCount: number;
  readonly synthesizedRegions: number;
  readonly deterministicRegions: number;
  readonly partialRegions: number;
  readonly rejectedClaims: number;
  readonly chunkCount: number;
}): SemanticCoverageLedger {
  return Object.freeze({
    schema_version: 1,
    candidate_regions: args.regionCount,
    returned_regions: args.regionCount,
    synthesized_regions: args.synthesizedRegions,
    deterministic_only_regions: args.deterministicRegions,
    partial_regions: args.partialRegions,
    rejected_claims: args.rejectedClaims,
    bootstrap_required: false,
    bootstrap_complete: true,
    bootstrap_chunk_count: args.chunkCount,
    cache_hit: true
  });
}
