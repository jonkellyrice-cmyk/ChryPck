import assert from "node:assert/strict";
import test from "node:test";

import { effectRuntimeAtlasAnalyzer } from "../src/analysis/effect-runtime-atlas.js";
import { buildEffectRuntimeAtlas } from "../src/analysis/effect-runtime-linker.js";
import { projectEffectRuntimeAtlas } from "../src/mcp/effect-runtime-projection.js";
import { buildRepositoryModel } from "../src/repository/model-builder.js";
import { createSnapshot } from "../src/repository/snapshot.js";
import { reconcileContractMap } from "../src/analysis/contract-reconciliation.js";

function repositoryModel() {
  const provider = [
    "export function persistBrace(value: string): boolean {",
    "  game.settings.set('frame-conn', 'brace', value);",
    "  ChatMessage.create({ content: value });",
    "  return true;",
    "}"
  ].join("\n");
  const consumer = "import { persistBrace } from './provider.js';\nexport function useBrace(){ Hooks.on('ready', () => persistBrace('on')); }";
  return buildRepositoryModel(createSnapshot("owner/repo", "b".repeat(40), [
    { path: "src/provider.ts", sha: "1", size: provider.length, text: provider, kind: "source" },
    { path: "src/ui.ts", sha: "2", size: consumer.length, text: consumer, kind: "source" }
  ]));
}

test("Phase 2 builds relational runtime regions with cross-map contract and state evidence", () => {
  const atlas = buildEffectRuntimeAtlas(repositoryModel());
  assert.ok(atlas.regions.length > 0);
  assert.ok(atlas.nodes.some(node => node.effectKind === "state-write" && node.reconciliation === "cross-map-confirmed"));
  assert.ok(atlas.edges.some(edge => edge.kind === "calls" && edge.evidenceRefs.some(ref => ref.startsWith("contract:"))));
  assert.ok(atlas.regions.some(region => region.contractIds.length > 0));
  assert.ok(atlas.coverage.candidateSites >= 4);
});

test("Phase 2 reports explicit partial coverage for unresolved runtime evidence", () => {
  const text = "Hooks.callAll('ready');\nimport('./dynamic.js');";
  const model = buildRepositoryModel(createSnapshot("owner/repo", "c".repeat(40), [{ path: "src/unresolved.ts", sha: "1", size: text.length, text, kind: "source" }]));
  const atlas = buildEffectRuntimeAtlas(model);
  assert.equal(atlas.coverage.partial, true);
  assert.ok(atlas.coverage.unresolvedSites > 0);
  assert.ok(effectRuntimeAtlasAnalyzer.analyze(model).findings.some(finding => finding.code === "PARTIAL_EFFECT_RUNTIME_COVERAGE"));
});

test("Phase 2 retains native-supplemented runtime obligations without inventing repository providers", () => {
  const model = repositoryModel();
  const contractMap = reconcileContractMap(model.contractMap, [{
    id: "native",
    source: "native-contracts.json",
    data: { contracts: [{ id: "native.runtime", title: "Native runtime", contract_kind: "native-flow", boundary: { frame_conn_consumers: ["src/ui.ts"] }, evidence: [{ source_path: "native/runtime.ts", symbol: "Native.run" }] }] }
  }]);
  const atlas = buildEffectRuntimeAtlas(Object.freeze({ ...model, contractMap }));
  const obligation = atlas.nodes.find(node => node.effectKind === "native-contract-obligation");
  assert.equal(obligation?.reconciliation, "native-supplemented");
  assert.equal(obligation?.extractionSource, "native-contract");
  assert.equal(atlas.nodes.some(node => node.symbol === "Native.run"), false, "Native evidence must not become an invented repository provider.");
});

test("Phase 2 projection is objective-aware, bounded, deterministic and source-body free", () => {
  const model = repositoryModel(), atlas = buildEffectRuntimeAtlas(model);
  const first = projectEffectRuntimeAtlas(atlas, "persist brace", ["src/provider.ts"]) as any;
  const second = projectEffectRuntimeAtlas(atlas, "persist brace", ["src/provider.ts"]) as any;
  assert.deepEqual(first, second);
  assert.equal(first.schema_version, 1);
  assert.ok(first.regions.length <= 8);
  assert.ok(first.regions.every((region: any) => region.nodes.length <= 12 && region.edges.length <= 12));
  assert.equal(JSON.stringify(first).includes("return true"), false);
});

test("legacy effect and runtime-signal analyzers remain declared compatibility projections", async () => {
  const model = repositoryModel();
  const { effectAtlasAnalyzer } = await import("../src/analysis/effect-atlas.js");
  const { runtimeSignalsAnalyzer } = await import("../src/analysis/runtime-signals.js");
  assert.equal(effectAtlasAnalyzer.analyze(model).summary.compatibility_projection, true);
  assert.equal(runtimeSignalsAnalyzer.analyze(model).summary.compatibility_projection, true);
});
