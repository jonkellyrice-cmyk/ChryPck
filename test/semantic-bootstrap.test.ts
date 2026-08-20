import assert from "node:assert/strict";
import test from "node:test";

import { SemanticBootstrapCoordinator } from "../src/semantic/bootstrap.js";
import type { SemanticRegionEvidence } from "../src/semantic/types.js";

function packet(id: string, name: string): SemanticRegionEvidence {
  const evidenceId = `evidence-${id}`;
  return Object.freeze({
    id,
    kind: id === "repo" ? "repository" : "subsystem",
    name_hint: name,
    path_scopes: Object.freeze([id === "repo" ? "**" : `src/${id}/**`]),
    file_count: 2,
    modeled_file_count: 2,
    representative_files: Object.freeze([id === "repo" ? "src/index.ts" : `src/${id}/index.ts`]),
    representative_symbols: Object.freeze([`${name}Handler`]),
    incoming_regions: Object.freeze([]),
    outgoing_regions: Object.freeze([]),
    observed_effects: Object.freeze([]),
    observed_state_namespaces: Object.freeze([]),
    manifest_facts: Object.freeze([]),
    documentation_hints: Object.freeze([]),
    evidence: Object.freeze([Object.freeze({
      id: evidenceId,
      kind: "path-topology" as const,
      summary: `${name} contains the representative implementation files.`,
      paths: Object.freeze([id === "repo" ? "src/index.ts" : `src/${id}/index.ts`])
    })]),
    fingerprint: `${id}`.padEnd(64, "0").slice(0, 64)
  });
}

function interpretation(region: SemanticRegionEvidence) {
  const evidenceId = region.evidence[0]!.id;
  return {
    region_id: region.id,
    name: region.name_hint,
    purpose: { text: `${region.name_hint} provides its evidenced repository role.`, evidence_refs: [evidenceId] },
    responsibilities: [{ text: `${region.name_hint} owns the behavior represented by this region.`, evidence_refs: [evidenceId] }]
  };
}

test("semantic bootstrap requires sequential bounded chunks and completes only after every region is interpreted", () => {
  const coordinator = new SemanticBootstrapCoordinator(1);
  const packets = [packet("repo", "Repository"), packet("bridge", "System Bridge")];
  const started = coordinator.begin({ repository: "owner/repo", commitSha: "abc", projectProfile: "default", packets });

  assert.equal(started.chunkCount, 2);
  assert.equal(started.currentChunk.chunk_index, 0);
  assert.match(started.currentChunk.instructions.join(" "), /Do not continue|Do not continue/i);

  const first = coordinator.advance({
    bootstrap_id: started.bootstrapId,
    chunk_id: started.currentChunk.chunk_id,
    interpretations: [interpretation(started.currentChunk.regions[0]!)]
  }, { repository: "owner/repo", commitSha: "abc", projectProfile: "default" });

  assert.equal(first.complete, false);
  if (first.complete) return;
  assert.equal(first.currentChunk.chunk_index, 1);

  const second = coordinator.advance({
    bootstrap_id: started.bootstrapId,
    chunk_id: first.currentChunk.chunk_id,
    interpretations: [interpretation(first.currentChunk.regions[0]!)]
  }, { repository: "owner/repo", commitSha: "abc", projectProfile: "default" });

  assert.equal(second.complete, true);
  if (!second.complete) return;
  assert.equal(second.orientation.atlas.complete, true);
  assert.equal(second.orientation.atlas.region_count, 2);
  assert.equal(second.orientation.coverage.bootstrap_complete, true);
  assert.equal(second.orientation.coverage.synthesized_regions, 2);
});

test("semantic bootstrap rejects submissions for the wrong repository state", () => {
  const coordinator = new SemanticBootstrapCoordinator(2);
  const packets = [packet("repo", "Repository")];
  const started = coordinator.begin({ repository: "owner/repo", commitSha: "abc", projectProfile: "default", packets });

  assert.throws(() => coordinator.advance({
    bootstrap_id: started.bootstrapId,
    chunk_id: started.currentChunk.chunk_id,
    interpretations: [interpretation(started.currentChunk.regions[0]!)]
  }, { repository: "owner/repo", commitSha: "changed", projectProfile: "default" }), /does not match/);
});

test("unsupported semantic claims are rejected instead of becoming architectural truth", () => {
  const coordinator = new SemanticBootstrapCoordinator(2);
  const packets = [packet("repo", "Repository")];
  const started = coordinator.begin({ repository: "owner/repo", commitSha: "abc", projectProfile: "default", packets });
  const finished = coordinator.advance({
    bootstrap_id: started.bootstrapId,
    chunk_id: started.currentChunk.chunk_id,
    interpretations: [{
      region_id: "repo",
      purpose: { text: "Fabricated unsupported purpose", evidence_refs: ["not-a-real-evidence-id"] }
    }]
  }, { repository: "owner/repo", commitSha: "abc", projectProfile: "default" });

  assert.equal(finished.complete, true);
  if (!finished.complete) return;
  assert.equal(finished.orientation.coverage.rejected_claims, 1);
  assert.equal(finished.orientation.atlas.regions[0]?.purpose, null);
  assert.equal(finished.orientation.atlas.regions[0]?.synthesis_status, "deterministic");
});
