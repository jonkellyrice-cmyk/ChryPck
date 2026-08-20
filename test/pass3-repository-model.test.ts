import assert from "node:assert/strict";
import test from "node:test";

import { buildIndex } from "../src/repository/index.js";
import { buildRepositoryModel } from "../src/repository/model-builder.js";
import { createSnapshot } from "../src/repository/snapshot.js";

function fixture() {
  return createSnapshot("owner/repo", "a".repeat(40), [
    { path: "scripts/b.js", sha: "2", size: 34, text: "export function b() { return 1; }" },
    { path: "scripts/a.js", sha: "1", size: 240, text: [
      "import { b } from './b.js';",
      "export const run = () => b();",
      "Hooks.on('ready', run);",
      "game.settings.set('frame-conn', 'ready', true);",
      "document.setFlag('frame-conn', 'mode', 'x');"
    ].join("\n") }
  ], "2026-01-01T00:00:00.000Z");
}

test("shared Repository Model resolves source facts exactly once per file", () => {
  const model = buildRepositoryModel(fixture());
  const index = buildIndex(model);
  assert.equal(model.fileFacts.length, 2);
  assert.equal(model.dependencies[0]?.from, "scripts/a.js");
  assert.equal(model.dependencies[0]?.to, "scripts/b.js");
  assert.equal(index.incomingDependencies.get("scripts/b.js")?.length, 1);
  assert.ok(model.symbols.some(symbol => symbol.name === "run" && symbol.exported));
  assert.ok(model.effects.some(effect => effect.kind === "hooks"));
  assert.ok(model.states.some(state => state.namespace === "frame-conn" && state.key === "ready"));
  assert.ok(model.states.some(state => state.namespace === "frame-conn" && state.key === "mode"));
});

test("snapshot and model ordering are deterministic", () => {
  const first = buildRepositoryModel(fixture());
  const second = buildRepositoryModel(fixture());
  assert.deepEqual(first.dependencies, second.dependencies);
  assert.deepEqual(first.symbols, second.symbols);
  assert.equal(first.snapshot.files[0]?.path, "scripts/a.js");
});
