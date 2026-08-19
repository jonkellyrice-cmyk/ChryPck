import assert from "node:assert/strict";
import test from "node:test";
import type { RepositoryModel } from "../src/repository/model.js";
import { planPatchCorridor } from "../src/planning/patch-corridor.js";
import { buildContextPack } from "../src/planning/context-pack.js";
import {
  projectContextContinuation,
  projectContextSourceSegment
} from "../src/mcp/response-projection.js";

const source = [
  "export function handleDamageMessage(){",
  ...Array.from({ length: 260 }, (_, index) => `  const braceStep${index} = ${index};`),
  "  return 'TAIL_SENTINEL';",
  "}"
].join("\n");

const model: RepositoryModel = {
  snapshot: {
    repository: "owner/repo",
    commitSha: "a".repeat(40),
    createdAt: "2026-01-01T00:00:00Z",
    files: [{ path: "scripts/brace-feature.js", sha: "blob", size: source.length, text: source }]
  },
  fileFacts: [{
    file: "scripts/brace-feature.js",
    dependencies: [],
    symbols: [{
      name: "handleDamageMessage",
      file: "scripts/brace-feature.js",
      kind: "function",
      exported: true,
      line: 1
    }],
    effects: [],
    states: []
  }],
  dependencies: [],
  unresolvedDependencies: [],
  symbols: [{
    name: "handleDamageMessage",
    file: "scripts/brace-feature.js",
    kind: "function",
    exported: true,
    line: 1
  }],
  effects: [],
  states: []
};

test("certified context expands only through bounded server-issued continuation segments", () => {
  const corridor = planPatchCorridor("handleDamageMessage", model, { minOwnerScore: 1 });
  assert.equal(corridor.certified, true);

  const context = buildContextPack(corridor, model);
  assert.equal(context.segments.length, 1);
  assert.ok(context.continuations.length > 0);

  const segment = context.segments[0]!;
  const initial = projectContextSourceSegment(segment) as Record<string, any>;
  assert.equal(JSON.stringify(initial).includes("TAIL_SENTINEL"), false);
  assert.ok(Array.isArray(initial.continuations));
  assert.equal(initial.continuations.length, 1);

  let nextSegmentId: string | null = initial.continuations[0]!.next_segment_id;
  let reachedTail = false;
  let hops = 0;

  while (nextSegmentId) {
    const continuation = context.continuations.find(candidate => candidate.id === nextSegmentId);
    assert.ok(continuation, "every issued continuation id must resolve inside the certified Context Pack");
    const projected = projectContextContinuation(continuation) as Record<string, any>;
    assert.ok(String(projected.content).length <= 4000);
    assert.equal(projected.path, "scripts/brace-feature.js");
    assert.equal(projected.symbol, "handleDamageMessage");
    reachedTail ||= String(projected.content).includes("TAIL_SENTINEL");
    nextSegmentId = projected.next_segment_id as string | null;
    hops += 1;
    assert.ok(hops < 100, "continuation chain must terminate");
  }

  assert.equal(reachedTail, true, "bounded continuation must eventually expose the remainder of the same certified symbol");
});
