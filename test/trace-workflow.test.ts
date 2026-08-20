import test from "node:test";
import assert from "node:assert/strict";
import { createSnapshot } from "../src/repository/snapshot.js";
import { buildRepositoryModel } from "../src/repository/model-builder.js";
import { planPatchCorridor } from "../src/planning/patch-corridor.js";
import { analyzeTrace } from "../src/analysis/trace.js";

function braceModel() {
  const files = [
    { path: "src/brace/feature.js", sha: "a", size: 1, text: `export function promptBraceReaction(message, targetUuid) {\n  if (!message.id || !targetUuid) return;\n  // show popup\n}` },
    { path: "src/brace/target.js", sha: "b", size: 1, text: `export function resolveTargetUuid(message) { return message.targetUuid; }` },
    { path: "src/brace/caller.js", sha: "c", size: 1, text: `import { resolveTargetUuid } from './target.js';\nimport { promptBraceReaction } from './feature.js';\nexport function handleDamage(message) { const t = resolveTargetUuid(message); promptBraceReaction(message, t); }` }
  ];
  const snapshot = createSnapshot("owner/repo", "f".repeat(40), files);
  return buildRepositoryModel(snapshot);
}

test("canonical trace uses the BEFT engine and auto-resolves an evidence-supported Brace entrypoint", () => {
  const model = braceModel();
  const objective = "Brace reaction popup does not appear when damage is applied.";
  const corridor = planPatchCorridor(objective, model);
  const result = analyzeTrace({ repository: "owner/repo", objective, options: { maxHops: 12, maxBranches: 3 } }, model, corridor);
  assert.notEqual(result.status, "UNABLE_TO_CERTIFY");
  assert.ok(result.path.length >= 1, "trace produced an evidence-backed path");
  assert.ok(result.certificate, "trace emits a path certificate when a path is available");
  assert.ok(result.firstBlocker, "trace identifies the guard blocking the Brace popup path");
  assert.match(result.firstBlocker?.condition ?? "", /message\.id|targetUuid/);
});

test("canonical trace accepts an explicit source symbol without a second trace mode", () => {
  const model = braceModel();
  const objective = "Trace the Brace reaction popup path.";
  const corridor = planPatchCorridor(objective, model);
  const result = analyzeTrace({ repository: "owner/repo", objective, sourceSymbol: "handleDamage", options: { maxHops: 12, maxBranches: 3 } }, model, corridor);
  assert.notEqual(result.status, "UNABLE_TO_CERTIFY");
  assert.equal(result.entrypoint?.symbol, "handleDamage");
  assert.ok(result.path.some(hop => hop.symbol === "promptBraceReaction"));
});

test("canonical trace refuses an arbitrary graph fallback when objective and source cannot be resolved", () => {
  const model = braceModel();
  const objective = "Investigate completely unrelated frobnicator behavior.";
  const corridor = planPatchCorridor(objective, model);
  const result = analyzeTrace({ repository: "owner/repo", objective }, model, corridor);
  assert.equal(result.status, "UNABLE_TO_CERTIFY");
  assert.equal(result.path.length, 0);
  assert.equal(result.certificate, undefined);
});
