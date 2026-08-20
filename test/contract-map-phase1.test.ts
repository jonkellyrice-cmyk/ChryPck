import assert from "node:assert/strict";
import test from "node:test";

import { contractMapAnalyzer } from "../src/analysis/contract-map.js";
import { buildRepositoryModel } from "../src/repository/model-builder.js";
import { createSnapshot } from "../src/repository/snapshot.js";

function fixture() {
  const provider = [
    "export async function persistBrace(value: string, mode?: number): Promise<boolean> {",
    "  await actor.setFlag('frame-conn', 'brace', value);",
    "  return true;",
    "}",
    "export function readBrace(): unknown {",
    "  return actor.getFlag('frame-conn', 'brace');",
    "}"
  ].join("\n");
  const ui = [
    "import { persistBrace as saveBrace } from './provider.js';",
    "export function renderBracePrompt(): void {",
    "  Hooks.on('renderBrace', value => saveBrace(value));",
    "}",
    "export function emitBrace(value: string): void {",
    "  Hooks.callAll('renderBrace', value);",
    "}"
  ].join("\n");
  return createSnapshot("owner/repo", "a".repeat(40), [
    { path: "src/provider.ts", sha: "1", size: provider.length, text: provider, kind: "source" },
    { path: "src/ui.ts", sha: "2", size: ui.length, text: ui, kind: "source" }
  ], "2026-08-20T00:00:00.000Z");
}

test("Contract Map extracts typed declarations, imports, calls, events, and state surfaces", () => {
  const model = buildRepositoryModel(fixture());
  const map = model.contractMap!;
  const persisted = map.contracts.find(contract => contract.name === "persistBrace");
  assert.ok(persisted);
  assert.equal(persisted.kind, "exported-api");
  assert.deepEqual(persisted.inputs.map(input => [input.name, input.type, input.optional]), [
    ["value", "string", false],
    ["mode", "number", true]
  ]);
  assert.equal(persisted.outputs[0]?.type, "Promise<boolean>");
  assert.ok(persisted.consumers.some(consumer => consumer.file === "src/ui.ts" && consumer.symbol === "renderBracePrompt"));

  const event = map.contracts.find(contract => contract.name === "renderBrace" && contract.kind === "lifecycle");
  assert.ok(event);
  assert.equal(event.provider?.file, "src/ui.ts");
  assert.ok(event.consumers.some(consumer => consumer.role === "listener"));

  const state = map.contracts.find(contract => contract.kind === "state" && contract.name.includes("frame-conn:brace"));
  assert.ok(state);
  assert.equal(state.provider?.role, "writer");
  assert.ok(state.consumers.some(consumer => consumer.role === "reader"));
  assert.equal(map.coverage.ambiguousSites, 0);
});

test("Contract Map records ambiguous providers instead of guessing", () => {
  const duplicate = "export function shared(value: string): void {}\nexport function shared(value: number): void {}";
  const consumer = "import { shared } from './duplicate.js';\nexport function useShared(){ shared(1); }";
  const snapshot = createSnapshot("owner/repo", "b".repeat(40), [
    { path: "src/duplicate.ts", sha: "1", size: duplicate.length, text: duplicate, kind: "source" },
    { path: "src/consumer.ts", sha: "2", size: consumer.length, text: consumer, kind: "source" }
  ]);
  const map = buildRepositoryModel(snapshot).contractMap!;
  const unresolved = map.contracts.find(contract => contract.name === "shared" && contract.provider === null);
  assert.ok(unresolved);
  assert.equal(unresolved.candidateProviders.length, 2);
  assert.equal(unresolved.confidence, "low");
  assert.equal(map.coverage.ambiguousSites, 1);
});

test("Contract Map preserves parser gaps without blocking the repository model", () => {
  const malformed = "export function broken(value: string { return value;";
  const snapshot = createSnapshot("owner/repo", "c".repeat(40), [
    { path: "src/broken.ts", sha: "1", size: malformed.length, text: malformed, kind: "source" }
  ]);
  const model = buildRepositoryModel(snapshot);
  assert.ok(model.contractMap!.gaps.length > 0);
  const diagnostics = contractMapAnalyzer.analyze(model);
  assert.ok(diagnostics.findings.some(finding => finding.code === "CONTRACT_PARSE_GAP"));
});

test("Contract Map IDs and ordering are deterministic", () => {
  const first = buildRepositoryModel(fixture()).contractMap!;
  const second = buildRepositoryModel(fixture()).contractMap!;
  assert.deepEqual(first, second);
  assert.equal(new Set(first.contracts.map(contract => contract.id)).size, first.contracts.length);
  const diagnostics = contractMapAnalyzer.analyze(buildRepositoryModel(fixture()));
  assert.equal(diagnostics.analyzer, "contract-map");
  assert.equal(diagnostics.summary.contracts, first.contracts.length);
});
