import assert from "node:assert/strict";
import test from "node:test";

import { objectiveSemanticFrontier, pendingSemanticExpansion, mergeSemanticOrientation } from "../src/semantic/expansion.js";
import type { SemanticOrientation, SemanticRegion, SemanticRegionEvidence } from "../src/semantic/types.js";

function packet(id: string, scope: string, symbol: string): SemanticRegionEvidence {
  return Object.freeze({
    id, kind: "subsystem", name_hint: scope, path_scopes: Object.freeze([`src/${scope}/**`]),
    file_count: 1, modeled_file_count: 1, representative_files: Object.freeze([`src/${scope}/index.ts`]),
    representative_symbols: Object.freeze([symbol]), incoming_regions: Object.freeze([]), outgoing_regions: Object.freeze([]),
    observed_effects: Object.freeze([]), observed_state_namespaces: Object.freeze([]), manifest_facts: Object.freeze([]),
    documentation_hints: Object.freeze([]), evidence: Object.freeze([{ id: `e:${id}`, kind: "symbol" as const, summary: `${symbol} is declared here`, paths: Object.freeze([`src/${scope}/index.ts`]) }]),
    fingerprint: id.padEnd(64, "0").slice(0, 64)
  });
}

function orientation(region: SemanticRegion): SemanticOrientation {
  return Object.freeze({
    atlas: Object.freeze({ schema_version: 1, repository: "owner/repo", commit_sha: "abc", project_profile: "default", complete: true, status: "COMPLETE", region_count: 1, regions: Object.freeze([region]) }),
    coverage: Object.freeze({ schema_version: 1, candidate_regions: 1, returned_regions: 1, synthesized_regions: 1, deterministic_only_regions: 0, partial_regions: 0, rejected_claims: 0, bootstrap_required: true, bootstrap_complete: true, bootstrap_chunk_count: 1, cache_hit: false, global_mapped_regions: 1, global_unmapped_regions: 0, objective_region_count: 1, objective_mapped_regions: 1, objective_sufficient: true, active_frontier_region_ids: Object.freeze([]) })
  });
}

function region(packet: SemanticRegionEvidence): SemanticRegion {
  return Object.freeze({ id: packet.id, kind: packet.kind, name: packet.name_hint, path_scopes: packet.path_scopes, representative_files: packet.representative_files, representative_symbols: packet.representative_symbols, purpose: null, responsibilities: Object.freeze([]), does_not_own: Object.freeze([]), key_flows: Object.freeze([]), upstream_region_ids: Object.freeze([]), downstream_region_ids: Object.freeze([]), observed_effects: Object.freeze([]), observed_state_namespaces: Object.freeze([]), evidence_refs: Object.freeze(packet.evidence.map(row => row.id)), confidence: 0.7, synthesis_status: "synthesized", evidence_fingerprint: packet.fingerprint });
}

test("objective frontier selects one specific relevant region instead of the whole repository", () => {
  const packets = [packet("ui", "ui", "renderBracePrompt"), packet("runtime", "runtime", "dispatchAttack")];
  const frontier = objectiveSemanticFrontier(packets, "Fix the Brace prompt rendering");
  assert.equal(frontier.length, 1);
  assert.equal(frontier[0]?.id, "ui");
});

test("incremental Atlas retains prior regions and requests only a newly navigated frontier", () => {
  const ui = packet("ui", "ui", "renderBracePrompt"), runtime = packet("runtime", "runtime", "dispatchAttack");
  const first = mergeSemanticOrientation({ repository: "owner/repo", commitSha: "abc", projectProfile: "default", packets: [ui, runtime], objective: "Fix Brace prompt", existing: null, expansion: orientation(region(ui)) });
  assert.equal(first.atlas.status, "OBJECTIVE_SUFFICIENT");
  assert.equal(first.atlas.complete, false);
  assert.equal(first.coverage.global_mapped_regions, 1);
  assert.deepEqual(pendingSemanticExpansion([ui, runtime], "Fix Brace prompt", first), []);
  assert.deepEqual(pendingSemanticExpansion([ui, runtime], "Trace attack dispatch", first).map(row => row.id), ["runtime"]);
  const second = mergeSemanticOrientation({ repository: "owner/repo", commitSha: "abc", projectProfile: "default", packets: [ui, runtime], objective: "Trace attack dispatch", existing: first, expansion: orientation(region(runtime)) });
  assert.equal(second.atlas.complete, true);
  assert.equal(second.atlas.region_count, 2);
});
