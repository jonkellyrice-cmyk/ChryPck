import assert from "node:assert/strict";
import test from "node:test";

import { NativeMcpService } from "../src/mcp/service.js";
import { createBuiltinProjectProfileRegistry } from "../src/project/builtin-profiles.js";
import type { RepositoryAdapter, RepositoryPublishRequest } from "../src/repository/adapter.js";
import { createSnapshot, type RepositorySnapshot } from "../src/repository/snapshot.js";

class DataflowRepository implements RepositoryAdapter {
  sha = "a".repeat(40);
  readonly files = [
    { path: "src/provider.ts", text: `export function sanitize(input: string): string { const cleaned = input.trim(); return cleaned; }` },
    { path: "src/consumer.ts", text: `import { sanitize } from "./provider";\nexport function saveBrace(actor: any, payload: any) { const value = sanitize(payload.name); actor.setFlag("frame-conn", "brace", value); return value; }` },
    { path: "src/unrelated.ts", text: `export function unrelated(secret: string) { return "UNRELATED_SOURCE_BODY_" + secret; }` }
  ];
  async snapshot(repository: string, _ref: string): Promise<RepositorySnapshot> {
    return createSnapshot(repository, this.sha, this.files.map((file, index) => ({ path: file.path, sha: `blob-${index}`, size: file.text.length, text: file.text, kind: "source" as const })), "2026-01-01T00:00:00Z");
  }
  async publish(_request: RepositoryPublishRequest): Promise<never> { throw new Error("Dataflow analysis tests are read-only."); }
}

function options() {
  return { allowedRepositories: new Set(["owner/repo"]), defaultTargetRef: "main", maxMutationFileBytes: 4096, semanticMaxRegions: 8, semanticRegionsPerChunk: 2, semanticCacheEntries: 8, projectProfiles: createBuiltinProjectProfileRegistry() };
}

async function completeBootstrap(service: NativeMcpService, input: any): Promise<any> {
  let response: any = await service.plan(input), iterations = 0;
  while (response.semantic_bootstrap?.status === "required") {
    assert.ok(++iterations < 20);
    const chunk = response.semantic_bootstrap.current_chunk;
    response = await service.plan({ ...input, semantic_bootstrap: { bootstrap_id: chunk.bootstrap_id, chunk_id: chunk.chunk_id, interpretations: chunk.regions.map((region: any) => ({ region_id: region.id, name: region.name_hint, purpose: { text: `${region.name_hint} owns the behavior represented by this evidence.`, evidence_refs: [region.evidence[0].id] } })) } });
  }
  return response;
}

async function createSlice(service: NativeMcpService): Promise<any> {
  const response = await completeBootstrap(service, {
    repository: "owner/repo", base_ref: "main", objective: "Save the sanitized Brace value",
    analysis: { kind: "dataflow-slice", criterion: { file: "src/provider.ts", symbol: "sanitize", value: "input" }, direction: "forward" }
  });
  assert.equal(response.analysis.kind, "dataflow-slice");
  assert.equal(response.analysis.result.status, "CERTIFIED");
  assert.ok(response.analysis.result.certificate.certificateId);
  return response;
}

test("Dataflow Slice is persisted as an authoritative bounded analysis run", async () => {
  const service = new NativeMcpService(new DataflowRepository(), options());
  const slice = await createSlice(service);
  assert.equal(slice.context_available, true);
  assert.ok(slice.context_segment_count > 0);
  assert.equal(slice.permitted_next_action, "create_normal_plan_with_analysis_handoff");
  const context: any = service.context({ run_id: slice.run_id });
  assert.equal(context.authority, "read-only-analysis-context");
  assert.equal(context.mode, "index");
  assert.ok(context.segments.length > 0);
  const segment: any = service.context({ run_id: slice.run_id, segment_id: context.segments[0].id });
  assert.equal(segment.authority, "read-only-analysis-context");
  assert.equal(segment.mode, "segment");

  const result: any = service.result({ run_id: slice.run_id });
  assert.equal(result.analysis.kind, "dataflow-slice");
  assert.equal(result.analysis.result.certificate.certificateId, slice.analysis.result.certificate.certificateId);
  assert.equal(result.artifacts.dataflowSliceStatus, "CERTIFIED");
  assert.equal(JSON.stringify(result).includes("UNRELATED_SOURCE_BODY_"), false);
  assert.equal(JSON.stringify(result.analysis.result).includes('const cleaned = input.trim()'), false);
});

test("certified Dataflow Slice lineage informs a distinct normal plan without granting mutation scope", async () => {
  const service = new NativeMcpService(new DataflowRepository(), options());
  const slice = await createSlice(service), artifactId = slice.analysis.result.certificate.certificateId;
  const plan: any = await service.plan({ repository: "owner/repo", base_ref: "main", objective: "Save the sanitized Brace value", analysis_handoff: { run_id: slice.run_id, artifact_id: artifactId } });

  assert.notEqual(plan.run_id, slice.run_id);
  assert.equal(plan.analysis_handoff.kind, "dataflow-slice");
  assert.equal(plan.analysis_handoff.source_run_id, slice.run_id);
  assert.equal(plan.analysis_handoff.artifact_id, artifactId);
  assert.equal(plan.trace_handoff, null);
  assert.equal(plan.corridor.certified, true);
  assert.equal(plan.corridor.files.some((file: any) => file.path === "src/unrelated.ts"), false);
  assert.ok(plan.corridor.files.some((file: any) => file.reasons.some((reason: string) => reason.includes("Dataflow Slice lineage"))));

  const result: any = service.result({ run_id: plan.run_id });
  assert.equal(result.analysis_handoff.artifact_id, artifactId);
  assert.equal(result.analysis, null);
});

test("analysis handoff rejects forged certificates and incompatible repository state", async () => {
  const repository = new DataflowRepository(), service = new NativeMcpService(repository, options());
  const slice = await createSlice(service);
  await assert.rejects(() => service.plan({ repository: "owner/repo", base_ref: "main", objective: "Save the sanitized Brace value", analysis_handoff: { run_id: slice.run_id, artifact_id: "forged" } }), /Analysis handoff rejected/);
  repository.sha = "b".repeat(40);
  await assert.rejects(() => completeBootstrap(service, { repository: "owner/repo", base_ref: "main", objective: "Save the sanitized Brace value", analysis_handoff: { run_id: slice.run_id } }), /different immutable commit/);
});

test("trace_handoff remains compatible while generalized handoff inputs remain mutually exclusive", async () => {
  const service = new NativeMcpService(new DataflowRepository(), options());
  await assert.rejects(() => service.plan({ repository: "owner/repo", base_ref: "main", objective: "Save Brace", trace_handoff: { run_id: "trace" }, analysis_handoff: { run_id: "analysis" } }), /never both/);
  await assert.rejects(() => service.plan({ repository: "owner/repo", base_ref: "main", objective: "Save Brace", analysis: { kind: "dataflow-slice", criterion: { value: "input" }, direction: "forward" }, analysis_handoff: { run_id: "analysis" } }), /cannot be combined/);
});
