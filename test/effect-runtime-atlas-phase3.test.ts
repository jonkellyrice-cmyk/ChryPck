import assert from "node:assert/strict";
import test from "node:test";

import { analyzeTrace } from "../src/analysis/trace.js";
import { buildEffectRuntimeAtlas } from "../src/analysis/effect-runtime-linker.js";
import { assessPropagation } from "../src/planning/change-propagation.js";
import { buildContextPack } from "../src/planning/context-pack.js";
import { planPatchCorridor } from "../src/planning/patch-corridor.js";
import { planRuntimeProbes } from "../src/planning/runtime-probes.js";
import { buildRepositoryModel } from "../src/repository/model-builder.js";
import { createSnapshot } from "../src/repository/snapshot.js";
import { validateEffectRuntimeImpact } from "../src/validation/effect-runtime-validator.js";

function runtimeModel() {
  const provider = [
    "export function persistBrace(value: string) {",
    "  game.settings.set('frame-conn', 'brace', value);",
    "  actor.update({ brace: value });",
    "}"
  ].join("\n");
  const consumer = [
    "import { persistBrace } from './provider.js';",
    "export function renderBrace() {",
    "  persistBrace('ready');",
    "  ChatMessage.create({ content: 'Brace ready' });",
    "}"
  ].join("\n");
  return buildRepositoryModel(createSnapshot("owner/repo", "d".repeat(40), [
    { path: "src/provider.ts", sha: "1", size: provider.length, text: provider, kind: "source" },
    { path: "src/ui.ts", sha: "2", size: consumer.length, text: consumer, kind: "source" }
  ]));
}

test("Phase 3 strengthens already-supported corridor files and carries bounded runtime roles into Context Pack", () => {
  const model = runtimeModel(), atlas = buildEffectRuntimeAtlas(model);
  const corridor = planPatchCorridor("persist Brace", model, { minOwnerScore: 3, effectRuntimeAtlas: atlas, contractMap: model.contractMap });
  assert.equal(corridor.certified, true);
  assert.ok(corridor.summary.runtimeRegionCount > 0);
  assert.ok(corridor.files.some(file => file.runtimeRegionIds.length > 0 && file.reasons.some(reason => reason.startsWith("Effect / Runtime Atlas"))));
  const context = buildContextPack(corridor, model, 24, atlas);
  assert.ok(context.segments.some(segment => segment.runtime.some(runtime => runtime.effectKinds.includes("foundry-document"))));
});

test("Phase 3 Atlas evidence cannot independently authorize a mutation corridor", () => {
  const snapshot = createSnapshot("owner/repo", "e".repeat(40), [{ path: "src/hidden.ts", sha: "1", size: 12, text: "const x = 1;", kind: "source" }]);
  const model: any = {
    snapshot,
    fileFacts: [{ file: "src/hidden.ts", dependencies: [], symbols: [], effects: [], states: [], runtimeNodes: [], runtimeEdges: [] }],
    dependencies: [], unresolvedDependencies: [], symbols: [], effects: [], states: [],
    runtimeNodes: [{ id: "atlas-only", kind: "effect-sink", effectKind: "secret-brace", file: "src/hidden.ts", symbol: "<module>", lineStart: 1, lineEnd: 1, detail: "persist Brace", confidence: "pattern-detected", extractionSource: "source-pattern", unresolvedReason: null }],
    runtimeEdges: []
  };
  const atlas = buildEffectRuntimeAtlas(model);
  const corridor = planPatchCorridor("persist Brace", model, { minOwnerScore: 1, effectRuntimeAtlas: atlas });
  assert.equal(corridor.certified, false);
  assert.deepEqual(corridor.corridor, []);
});

test("Phase 3 Trace uses Atlas entrypoint ranking and terminal-effect evidence", () => {
  const source = [
    "export function braceEntry() { setTimeout(braceEffect, 1); }",
    "export function braceEffect() { actor.update({ brace: true }); }"
  ].join("\n");
  const model = buildRepositoryModel(createSnapshot("owner/repo", "f".repeat(40), [{ path: "src/runtime.ts", sha: "1", size: source.length, text: source, kind: "source" }]));
  const atlas = buildEffectRuntimeAtlas(model);
  const corridor = planPatchCorridor("brace entry", model, { minOwnerScore: 2, effectRuntimeAtlas: atlas });
  const seeded = analyzeTrace({ repository: "owner/repo", objective: "brace entry" }, model, corridor, atlas);
  assert.equal(seeded.entrypoint?.symbol, "braceEntry");
  const terminal = analyzeTrace({ repository: "owner/repo", objective: "brace effect", sourceSymbol: "braceEffect", targetEffect: "foundry-document" }, model, corridor, atlas);
  assert.equal(terminal.status, "CERTIFIED");
  assert.equal(terminal.terminalEffect?.kind, "foundry-document");
});

test("Phase 3 probes, propagation and validation retain runtime obligations", () => {
  const model = runtimeModel(), atlas = buildEffectRuntimeAtlas(model);
  const corridor = planPatchCorridor("persist Brace", model, { minOwnerScore: 3, effectRuntimeAtlas: atlas, contractMap: model.contractMap });
  const probes = planRuntimeProbes(corridor, model, atlas);
  assert.ok(probes.probes.some(probe => typeof probe.evidence.runtimeNodeId === "string"));
  const provider = model.snapshot.files.find(file => file.path === "src/provider.ts")!;
  const propagation = assessPropagation([{ path: provider.path, before: provider.text ?? null, after: `${provider.text}\n// preserve runtime behavior` }], model, corridor, atlas);
  assert.ok(propagation.impactedRuntimeRegionIds.length > 0);
  assert.ok(propagation.runtimeEffectSinks.includes("src/provider.ts"));
  assert.ok(propagation.runtimeObservationTargets.includes("src/ui.ts"));
  assert.ok(propagation.verificationTargets.includes("src/ui.ts"));
  const validation = validateEffectRuntimeImpact({ atlas, propagation });
  assert.equal(validation.passed, true);
  assert.ok(validation.findings.some(finding => finding.code === "RUNTIME_IMPACT_VERIFIED"));
});
