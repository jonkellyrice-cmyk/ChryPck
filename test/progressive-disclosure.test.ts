import test from "node:test";
import assert from "node:assert/strict";
import { projectCompactResponse, projectContextGrant } from "../src/mcp/response-projection.js";

test("compact response keeps control state and drops heavyweight atlases", () => {
  const full = {
    run_id: "run-1",
    state: "SUCCEEDED",
    repository: "owner/repo",
    project_profile: "default",
    base_commit_sha: "abc123",
    repository_atlas: { huge: "x".repeat(20_000) },
    semantic_atlas: { huge: "y".repeat(20_000) },
    contract_map: { huge: "z".repeat(20_000) },
    effect_runtime_atlas: { huge: "r".repeat(20_000) },
    semantic_coverage: { objective_status: "OBJECTIVE_SUFFICIENT", mapped_regions: 2 },
    context_available: true,
    context_segment_count: 1,
    context_index: [{
      id: "ctx-1",
      path: "src/feature.ts",
      evidence: ["objective-match"],
      symbols: [{ name: "runFeature", kind: "function", lineStart: 10, lineEnd: 30, expandable: true }],
      dependencies: Array.from({ length: 50 }, (_, index) => ({ specifier: `dep-${index}` }))
    }],
    analysis: { kind: "trace", result: { status: "PARTIAL", first_blocker: "runFeature" } },
    permitted_next_action: "expand_context_grant_or_create_normal_plan_with_trace_handoff"
  };

  const compact = projectCompactResponse(full) as any;
  assert.equal(compact.response_mode, "compact");
  assert.equal(compact.run_id, "run-1");
  assert.equal(compact.context_grants[0].segment_id, "ctx-1");
  assert.equal(compact.context_grants[0].path, "src/feature.ts");
  assert.equal(compact.analysis.result.first_blocker, "runFeature");
  assert.equal("repository_atlas" in compact, false);
  assert.equal("semantic_atlas" in compact, false);
  assert.equal("contract_map" in compact, false);
  assert.equal("effect_runtime_atlas" in compact, false);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(full).length / 10);
});

test("semantic bootstrap retains only the active bounded chunk", () => {
  const compact = projectCompactResponse({
    run_id: "run-2",
    state: "READY",
    semantic_bootstrap: {
      status: "required",
      bootstrap_id: "bootstrap-1",
      current_chunk: { chunk_id: "chunk-1", regions: [{ id: "region-1" }] },
      previous_chunks: [{ huge: "x".repeat(10_000) }]
    },
    permitted_next_action: "submit_objective_semantic_expansion_via_chrypck_plan_then_resume_repository_work"
  }) as any;
  assert.equal(compact.semantic_bootstrap.current_chunk.chunk_id, "chunk-1");
  assert.equal("previous_chunks" in compact.semantic_bootstrap, false);
});

test("context grants expose selectors, not relationship payloads", () => {
  const grant = projectContextGrant({
    id: "ctx-3",
    path: "src/runtime.ts",
    evidence: ["trace:blocker"],
    symbols: [{ name: "execute", kind: "function", lineStart: 1, lineEnd: 20, expandable: false }],
    consumers: Array.from({ length: 100 }, (_, index) => `consumer-${index}`)
  }) as any;
  assert.deepEqual(Object.keys(grant), ["segment_id", "path", "symbols", "evidence"]);
  assert.equal(grant.symbols[0].line_start, 1);
});
