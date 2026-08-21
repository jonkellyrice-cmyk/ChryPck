import assert from "node:assert/strict";
import test from "node:test";

import { buildIndex } from "../src/repository/index.js";
import { buildRepositoryModel } from "../src/repository/model-builder.js";
import { createSnapshot } from "../src/repository/snapshot.js";

function modelFor(text: string) {
  return buildRepositoryModel(createSnapshot("owner/repo", "a".repeat(40), [
    { path: "src/runtime.ts", sha: "1", size: text.length, text }
  ], "2026-08-20T00:00:00.000Z"));
}

test("Phase 1 extracts typed entry points, sinks, observations and integration boundaries", () => {
  const model = modelFor([
    "export function install() { Hooks.on('ready', execute); }",
    "export function execute() {",
    "  actor.update({ hp: 1 });",
    "  ChatMessage.create({ content: 'done' });",
    "  executeNativeAction();",
    "}"
  ].join("\n"));
  const nodes = model.runtimeNodes ?? [];
  assert.ok(nodes.some(node => node.kind === "entry-point" && node.effectKind === "hooks"));
  assert.ok(nodes.some(node => node.kind === "effect-sink" && node.effectKind === "foundry-document"));
  assert.ok(nodes.some(node => node.kind === "observation-point" && node.effectKind === "chat-output"));
  assert.ok(nodes.some(node => node.kind === "integration-boundary" && node.effectKind === "native-execution"));
  assert.ok((model.runtimeEdges ?? []).some(edge => edge.kind === "mutates-document"));
  assert.ok((model.runtimeEdges ?? []).some(edge => edge.kind === "delegates-native"));
});

test("Phase 1 preserves lexical uncertainty instead of claiming confirmed containment", () => {
  const model = modelFor("Hooks.callAll('frame-ready');");
  const unresolved = (model.runtimeNodes ?? []).find(node => node.kind === "unresolved-runtime-site");
  assert.equal(unresolved?.confidence, "unresolved");
  assert.match(unresolved?.unresolvedReason ?? "", /enclosing symbol/i);
  assert.ok((model.runtimeEdges ?? []).some(edge => edge.kind === "unresolved-runtime-link"));
});

test("Phase 1 runtime evidence IDs, ordering and indexes are deterministic", () => {
  const text = "export function run() { setTimeout(run, 10); fetch('/status'); }";
  const first = modelFor(text), second = modelFor(text);
  assert.deepEqual(first.runtimeNodes, second.runtimeNodes);
  assert.deepEqual(first.runtimeEdges, second.runtimeEdges);
  const index = buildIndex(first);
  const network = index.runtimeNodesByEffectKind.get("network-request")?.[0];
  assert.ok(network);
  assert.equal(index.runtimeNodesById.get(network.id), network);
  assert.ok(index.runtimeNodesByFile.get("src/runtime.ts")?.length);
});

test("Phase 1 retains the legacy effect inventory during migration", () => {
  const model = modelFor("export function install() { Hooks.once('ready', install); }");
  assert.ok(model.effects.some(effect => effect.kind === "hooks"));
});
