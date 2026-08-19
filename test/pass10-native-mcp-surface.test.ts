import test from "node:test";
import assert from "node:assert/strict";
import { NativeMcpService } from "../src/mcp/service.js";
import type { RepositoryAdapter, RepositoryPublishRequest } from "../src/repository/adapter.js";
import { createSnapshot, type RepositorySnapshot } from "../src/repository/snapshot.js";
import { CHRYPCK_TOOL_NAMES, CHRYPCK_TOOLS } from "../src/mcp/tools.js";
import { createBuiltinProjectProfileRegistry } from "../src/project/builtin-profiles.js";

class MemoryRepository implements RepositoryAdapter {
  sha = "a".repeat(40);
  text = "export function provider(){ return 1; }";
  async snapshot(repository: string, _ref: string): Promise<RepositorySnapshot> {
    return createSnapshot(repository, this.sha, [{ path: "src/provider.ts", sha: "blob", size: this.text.length, text: this.text, kind: "source" }], "2026-01-01T00:00:00Z");
  }
  async publish(request: RepositoryPublishRequest) {
    assert.equal(request.baseCommitSha, this.sha);
    const next = request.changes.get("src/provider.ts");
    assert.equal(typeof next, "string");
    this.text = next!;
    const base = this.sha;
    this.sha = "b".repeat(40);
    return { repository: request.repository, targetRef: request.targetRef, baseCommitSha: base, commitSha: this.sha, changedPaths: ["src/provider.ts"] };
  }
}

function serviceOptions() {
  return {
    allowedRepositories: new Set(["owner/repo"]),
    defaultTargetRef: "main",
    maxMutationFileBytes: 4096,
    projectProfiles: createBuiltinProjectProfileRegistry()
  };
}

test("native MCP surface keeps four distinct agent-facing operations", () => {
  assert.deepEqual([...CHRYPCK_TOOL_NAMES], ["chrypck_plan", "chrypck_context", "chrypck_execute", "chrypck_result"]);
  assert.deepEqual(CHRYPCK_TOOLS.map(tool => tool.name), [...CHRYPCK_TOOL_NAMES]);
  assert.deepEqual(CHRYPCK_TOOLS.map(tool => tool.readOnly), [true, true, false, true]);

  const descriptions = CHRYPCK_TOOLS.map(tool => tool.description.trim());
  assert.equal(descriptions.every(description => description.length >= 40), true);
  assert.equal(new Set(descriptions).size, CHRYPCK_TOOLS.length);

  assert.match(CHRYPCK_TOOLS[0]!.description, /Start governed repository work/);
  assert.match(CHRYPCK_TOOLS[1]!.description, /server-certified Context Pack/);
  assert.match(CHRYPCK_TOOLS[1]!.description, /arbitrary paths are never accepted/);
  assert.match(CHRYPCK_TOOLS[2]!.description, /exactly one mode/);
  assert.match(CHRYPCK_TOOLS[3]!.description, /authoritative bounded run state/);
});

test("live native service exposes bounded plan/context/execute/result semantics", async () => {
  assert.deepEqual([...CHRYPCK_TOOL_NAMES], ["chrypck_plan", "chrypck_context", "chrypck_execute", "chrypck_result"]);
  const repository = new MemoryRepository();
  const service = new NativeMcpService(repository, serviceOptions());
  const plan = await service.plan({ repository: "owner/repo", objective: "provider", base_ref: "main" });
  assert.equal(plan.state, "READY");
  assert.equal(plan.context_available, true);
  assert.equal(JSON.stringify(plan).includes(repository.text), false, "plan must never expose exhaustive repository source");

  const contextIndex = service.context({ run_id: plan.run_id });
  assert.equal(contextIndex.mode, "index");
  assert.equal(contextIndex.segments.length, 1);
  assert.equal(JSON.stringify(contextIndex).includes(repository.text), false, "context index must contain metadata only");

  const segmentId = String(contextIndex.segments[0]?.id ?? "");
  const expandedContext = service.context({ run_id: plan.run_id, segment_id: segmentId });
  assert.equal(expandedContext.mode, "segment");
  assert.equal(expandedContext.segments.length, 1);
  assert.match(String(expandedContext.segments[0]?.content ?? ""), /provider/);

  const result = await service.execute({ run_id: plan.run_id, authoring_intent: { id: "provider-edit", objective: "provider", edits: [{ type: "replace_exact", path: "src/provider.ts", search: "return 1", replace: "return 2" }] } });
  assert.equal(result.state, "SUCCEEDED");
  assert.equal(result.result_commit_sha, "b".repeat(40));
  assert.match(repository.text, /return 2/);
  assert.equal(service.result({ run_id: plan.run_id }).state, "SUCCEEDED");
});

test("native service rejects non-allowlisted repositories", async () => {
  const service = new NativeMcpService(new MemoryRepository(), serviceOptions());
  await assert.rejects(() => service.plan({ repository: "other/repo", objective: "provider" }), /not allowed/);
});
