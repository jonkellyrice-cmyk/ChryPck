import assert from "node:assert/strict";
import test from "node:test";

import { extractDataflowFileFacts } from "../src/repository/dataflow-extractor.js";
import { buildIndex } from "../src/repository/index.js";
import { buildRepositoryModel } from "../src/repository/model-builder.js";
import { createSnapshot } from "../src/repository/snapshot.js";

test("Dataflow substrate extracts parameters, transformations, calls, assignments and returns", () => {
  const facts = extractDataflowFileFacts("src/normalize.ts", `
export function normalize(input: string) {
  const trimmed = input.trim();
  const payload = { value: trimmed };
  return persist(payload.value);
}`);

  assert.ok(facts.nodes.some(node => node.kind === "parameter" && node.value === "input"));
  assert.ok(facts.nodes.some(node => node.kind === "call-result" && node.value === "input.trim"));
  assert.ok(facts.nodes.some(node => node.kind === "property-read" && node.value === "value"));
  assert.ok(facts.nodes.some(node => node.kind === "return-value" && node.symbol === "normalize"));
  assert.ok(facts.edges.some(edge => edge.kind === "receives-result"));
  assert.ok(facts.edges.some(edge => edge.kind === "passes-argument"));
  assert.ok(facts.edges.some(edge => edge.kind === "returns"));
});

test("Dataflow substrate records state boundaries, effects and control dependencies", () => {
  const facts = extractDataflowFileFacts("src/brace.ts", `
export async function persistBrace(actor: any, payload: any) {
  const prior = actor.getFlag("frame-conn", "brace");
  if (payload.enabled) {
    await actor.setFlag("frame-conn", "brace", payload.value);
    await actor.update({ name: payload.value });
  }
  return prior;
}`);

  assert.ok(facts.nodes.some(node => node.kind === "state-read" && node.value === "actor.getFlag"));
  assert.ok(facts.nodes.some(node => node.kind === "state-write" && node.value === "actor.setFlag"));
  assert.ok(facts.nodes.some(node => node.kind === "effect-sink" && node.value === "actor.update"));
  const condition = facts.nodes.find(node => node.kind === "control-condition");
  assert.ok(condition);
  assert.ok(facts.edges.some(edge => edge.kind === "control-dependency" && edge.from === condition.id));
});

test("Dataflow substrate reports dynamic and unsupported expressions as explicit gaps", () => {
  const facts = extractDataflowFileFacts("src/dynamic.ts", `
export function read(payload: any, key: string) {
  const value = payload[key];
  return new Map([[key, value]]);
}`);

  assert.equal(facts.coverage.partial, true);
  assert.ok(facts.gaps.some(gap => gap.kind === "dynamic-access"));
  assert.ok(facts.gaps.some(gap => gap.kind === "unsupported-syntax"));
  assert.ok(facts.nodes.some(node => node.kind === "unresolved-value-site"));
});

test("Repository Model aggregates deterministic immutable Dataflow evidence and indexes it", () => {
  const source = `export function produce(value: string) { const output = value.toUpperCase(); return output; }`;
  const snapshot = createSnapshot("owner/repo", "d".repeat(40), [
    { path: "src/produce.ts", sha: "1", size: source.length, text: source, kind: "source" }
  ]);
  const first = buildRepositoryModel(snapshot), second = buildRepositoryModel(snapshot);

  assert.ok((first.dataflowNodes?.length ?? 0) > 0);
  assert.ok((first.dataflowEdges?.length ?? 0) > 0);
  assert.deepEqual(first.dataflowNodes, second.dataflowNodes);
  assert.deepEqual(first.dataflowEdges, second.dataflowEdges);
  assert.ok(Object.isFrozen(first.dataflowNodes));
  assert.ok(Object.isFrozen(first.fileFacts[0]?.dataflow?.nodes));

  const index = buildIndex(first);
  const node = first.dataflowNodes?.[0];
  assert.ok(node);
  assert.equal(index.dataflowNodesById.get(node.id), node);
  assert.ok(index.dataflowNodesByFile.get("src/produce.ts")?.length);
});

test("Malformed source produces parser gaps without preventing Repository Model construction", () => {
  const source = "export function broken(value: string { return value;";
  const model = buildRepositoryModel(createSnapshot("owner/repo", "e".repeat(40), [
    { path: "src/broken.ts", sha: "1", size: source.length, text: source, kind: "source" }
  ]));
  assert.ok(model.dataflowGaps?.some(gap => gap.kind === "parse-error"));
  assert.ok((model.dataflowNodes?.length ?? 0) > 0);
});
