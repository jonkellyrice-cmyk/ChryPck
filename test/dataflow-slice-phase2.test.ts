import assert from "node:assert/strict";
import test from "node:test";

import { buildDataflowGraph } from "../src/analysis/dataflow-linker.js";
import { analyzeDataflowSlice } from "../src/analysis/dataflow-slice.js";
import { buildRepositoryModel } from "../src/repository/model-builder.js";
import { createSnapshot } from "../src/repository/snapshot.js";

function fixture() {
  const provider = `
export function sanitize(input: string): string {
  const cleaned = input.trim();
  return cleaned;
}`;
  const consumer = `
import { sanitize } from "./provider";
export function saveBrace(actor: any, payload: any): string {
  const value = sanitize(payload.name);
  actor.setFlag("frame-conn", "brace", value);
  return value;
}
export function readBrace(actor: any) {
  return actor.getFlag("frame-conn", "brace");
}`;
  return buildRepositoryModel(createSnapshot("owner/repo", "a".repeat(40), [
    { path: "src/provider.ts", sha: "1", size: provider.length, text: provider, kind: "source" },
    { path: "src/consumer.ts", sha: "2", size: consumer.length, text: consumer, kind: "source" }
  ]));
}

test("Dataflow graph links local aliases, call arguments, parameters and returns across files", () => {
  const graph = buildDataflowGraph(fixture());
  const node = (id: string) => graph.nodes.find(candidate => candidate.id === id);

  assert.ok(graph.edges.some(edge => edge.kind === "aliases"));
  const binding = graph.edges.find(edge => edge.kind === "binds-parameter");
  assert.ok(binding);
  assert.equal(node(binding.from)?.value, "sanitize#0");
  assert.equal(node(binding.to)?.value, "input");
  assert.equal(node(binding.to)?.file, "src/provider.ts");
  assert.ok(graph.edges.some(edge => edge.kind === "receives-result" && node(edge.from)?.symbol === "sanitize" && node(edge.to)?.value === "sanitize"));
});

test("Dataflow graph reconciles matching state writes and reads", () => {
  const graph = buildDataflowGraph(fixture());
  const propagation = graph.edges.find(edge => edge.kind === "state-propagates");
  assert.ok(propagation);
  const from = graph.nodes.find(node => node.id === propagation.from), to = graph.nodes.find(node => node.id === propagation.to);
  assert.equal(from?.kind, "state-write");
  assert.equal(to?.kind, "state-read");
  assert.equal(propagation.reconciliation, "cross-map-confirmed");
  assert.ok(propagation.evidenceRefs.includes("state:frame-conn:brace"));
});

test("backward slice follows a state sink to its cross-file value provenance", () => {
  const model = fixture();
  const result = analyzeDataflowSlice({
    repository: "owner/repo",
    commitSha: model.snapshot.commitSha,
    objective: "where does the Brace value come from",
    criterion: { state: { namespace: "frame-conn", key: "brace" }, value: "actor.setFlag" },
    direction: "backward"
  }, model);

  assert.equal(result.status, "CERTIFIED");
  assert.ok(result.certificate);
  assert.ok(result.nodes.some(node => node.kind === "parameter" && node.value === "input" && node.file === "src/provider.ts"));
  assert.ok(result.nodes.some(node => node.kind === "property-read" && node.value === "name"));
  assert.ok(result.edges.some(edge => edge.kind === "binds-parameter"));
  assert.ok(result.edges.some(edge => edge.kind === "receives-result"));
});

test("forward slice follows a parameter through transformation and downstream state", () => {
  const model = fixture();
  const result = analyzeDataflowSlice({
    repository: "owner/repo",
    objective: "where can sanitize input flow",
    criterion: { file: "src/provider.ts", symbol: "sanitize", value: "input" },
    direction: "forward"
  }, model);

  assert.equal(result.status, "CERTIFIED");
  assert.ok(result.nodes.some(node => node.kind === "call-result" && node.value === "input.trim"));
  assert.ok(result.nodes.some(node => node.kind === "state-write"));
  assert.ok(result.sinks.length > 0);
});

test("bounded traversal reports limit frontiers instead of silently truncating", () => {
  const model = fixture();
  const result = analyzeDataflowSlice({
    repository: "owner/repo",
    objective: "bounded flow",
    criterion: { file: "src/provider.ts", symbol: "sanitize", value: "input" },
    direction: "forward",
    options: { maxNodes: 2, maxHops: 1, maxEdges: 2, maxFiles: 1 }
  }, model);

  assert.equal(result.status, "LIMITS_EXCEEDED");
  assert.equal(result.coverage.truncated, true);
  assert.ok(result.unresolvedFrontier.some(frontier => ["node-limit", "hop-limit", "edge-limit", "file-limit"].includes(frontier.reason)));
  assert.equal(result.certificate, undefined);
});

test("dynamic access produces a valid PARTIAL slice with explicit unresolved frontier", () => {
  const source = `export function dynamic(payload: any, key: string) { const value = payload[key]; return value; }`;
  const model = buildRepositoryModel(createSnapshot("owner/repo", "b".repeat(40), [
    { path: "src/dynamic.ts", sha: "1", size: source.length, text: source, kind: "source" }
  ]));
  const result = analyzeDataflowSlice({ repository: "owner/repo", objective: "dynamic value", criterion: { value: "Dynamic property read" }, direction: "bidirectional" }, model);

  assert.equal(result.status, "PARTIAL");
  assert.ok(result.certificate, "the evidence-complete returned portion remains certifiable");
  assert.ok(result.unresolvedFrontier.some(frontier => frontier.reason === "unresolved"));
});

test("unknown criteria fail closed without selecting an arbitrary graph node", () => {
  const model = fixture();
  const result = analyzeDataflowSlice({ repository: "owner/repo", objective: "unknown", criterion: { symbol: "doesNotExist" }, direction: "bidirectional" }, model);
  assert.equal(result.status, "UNABLE_TO_CERTIFY");
  assert.equal(result.criterion, null);
  assert.equal(result.nodes.length, 0);
  assert.equal(result.certificate, undefined);
});

test("Dataflow graph and slice certificates are deterministic apart from creation time", () => {
  const model = fixture(), firstGraph = buildDataflowGraph(model), secondGraph = buildDataflowGraph(model);
  assert.equal(firstGraph, secondGraph);
  const request = { repository: "owner/repo", objective: "input flow", criterion: { file: "src/provider.ts", value: "input" }, direction: "forward" as const };
  const first = analyzeDataflowSlice(request, model), second = analyzeDataflowSlice(request, model);
  assert.deepEqual(first.nodes.map(node => node.id), second.nodes.map(node => node.id));
  assert.deepEqual(first.edges.map(edge => edge.id), second.edges.map(edge => edge.id));
  assert.equal(first.certificate?.graphHash, second.certificate?.graphHash);
  assert.equal(first.certificate?.requestFingerprint, second.certificate?.requestFingerprint);
});
