import assert from "node:assert/strict";
import test from "node:test";

import { buildRepositoryModel } from "../src/repository/model-builder.js";
import { createSnapshot, type RepositoryFile } from "../src/repository/snapshot.js";
import { buildSemanticRegionCandidates } from "../src/semantic/region-builder.js";
import { buildSemanticEvidencePackets } from "../src/semantic/evidence-builder.js";
import { prepareSemanticAtlas } from "../src/semantic/semantic-atlas.js";

const files: RepositoryFile[] = [
  {
    path: "package.json",
    sha: "pkg",
    size: 120,
    kind: "source",
    text: JSON.stringify({ name: "frame-con", description: "Player-facing Lancer combat automation", scripts: { test: "node --test", build: "tsc" } })
  },
  {
    path: "README.md",
    sha: "readme",
    size: 180,
    kind: "asset",
    text: "# FrameCon\nFrameCon exposes player-facing Lancer mech combat actions while delegating native execution to the Foundry Lancer system."
  },
  {
    path: "src/system-bridge/action-adapter.ts",
    sha: "bridge-a",
    size: 180,
    kind: "source",
    text: "import { executeNative } from '../native/runtime'; export function bridgeAction(){ return executeNative(); }"
  },
  {
    path: "src/system-bridge/state-adapter.ts",
    sha: "bridge-b",
    size: 180,
    kind: "source",
    text: "export function writeState(actor:any){ return actor.setFlag('frame-con','turn','done'); }"
  },
  {
    path: "src/native/runtime.ts",
    sha: "native",
    size: 120,
    kind: "source",
    text: "export function executeNative(){ return 1; }"
  },
  {
    path: "src/ui/action-panel.ts",
    sha: "ui",
    size: 180,
    kind: "source",
    text: "import { bridgeAction } from '../system-bridge/action-adapter'; export function onAction(){ return bridgeAction(); }"
  },
  {
    path: "test/action-panel.test.ts",
    sha: "test",
    size: 100,
    kind: "source",
    text: "import { onAction } from '../src/ui/action-panel'; export const result = onAction();"
  }
];

test("semantic region discovery identifies meaningful repository subsystems without source projection", () => {
  const snapshot = createSnapshot("owner/frame-con", "abc123", files, "2026-08-20T00:00:00.000Z");
  const model = buildRepositoryModel(snapshot);
  const regions = buildSemanticRegionCandidates(model, 10);

  assert.equal(regions[0]?.kind, "repository");
  assert.ok(regions.some(region => region.pathScopes.includes("src/system-bridge/**")));
  assert.ok(regions.length <= 10);
  assert.ok(regions.every(region => region.paths.every(path => !path.includes("node_modules"))));
});

test("semantic evidence packets combine bounded topology, dependencies, symbols, effects, state, manifests and docs", () => {
  const snapshot = createSnapshot("owner/frame-con", "abc123", files, "2026-08-20T00:00:00.000Z");
  const model = buildRepositoryModel(snapshot);
  const regions = buildSemanticRegionCandidates(model, 10);
  const packets = buildSemanticEvidencePackets(model, regions);

  const repository = packets.find(packet => packet.kind === "repository");
  assert.ok(repository);
  assert.ok(repository.manifest_facts.some(fact => /Player-facing Lancer combat automation/.test(fact)));
  assert.ok(repository.documentation_hints.some(hint => /delegating native execution/.test(hint)));
  assert.ok(repository.evidence.some(reference => reference.kind === "documentation"));

  const bridge = packets.find(packet => packet.path_scopes.includes("src/system-bridge/**"));
  assert.ok(bridge);
  assert.ok(bridge.representative_symbols.some(symbol => /bridgeAction|writeState/.test(symbol)));
  assert.ok(bridge.observed_state_namespaces.some(namespace => namespace.includes("frame-con")));
  assert.ok(bridge.evidence.length > 0);
  assert.equal(JSON.stringify(bridge).includes("return executeNative"), false, "semantic evidence must not expose source bodies");
});

test("semantic atlas preparation stays bounded", () => {
  const snapshot = createSnapshot("owner/frame-con", "abc123", files, "2026-08-20T00:00:00.000Z");
  const model = buildRepositoryModel(snapshot);
  const preparation = prepareSemanticAtlas(model, { maxRegions: 4 });
  assert.ok(preparation.packets.length <= 4);
  assert.equal(preparation.maxRegions, 4);
  assert.ok(preparation.packets.every(packet => packet.fingerprint.length === 64));
});
