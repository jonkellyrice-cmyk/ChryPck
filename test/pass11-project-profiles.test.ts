import test from "node:test";
import assert from "node:assert/strict";
import { createBuiltinProjectProfileRegistry } from "../src/project/builtin-profiles.js";
import { runNativePlanning } from "../src/planning/planning-runner.js";
import type { RepositoryModel } from "../src/repository/model.js";

const model = {
  snapshot: {
    repository: "jonkellyrice-cmyk/Lancer-Frame-Conn",
    commitSha: "a".repeat(40),
    createdAt: "2026-01-01T00:00:00Z",
    files: [
      { path: "scripts/provider.ts", sha: "x", size: 30, text: "export function provider(){}", kind: "source" },
      { path: "dev_scripts/native-contract-catalog.json", sha: "y", size: 24, text: "{\"contracts\":[\"native\"]}", kind: "source" }
    ]
  },
  fileFacts: [{ file: "scripts/provider.ts", dependencies: [], symbols: [{ name: "provider", file: "scripts/provider.ts", kind: "function", exported: true, line: 1 }], effects: [], states: [] }],
  dependencies: [], unresolvedDependencies: [], symbols: [{ name: "provider", file: "scripts/provider.ts", kind: "function", exported: true, line: 1 }], effects: [], states: []
} as RepositoryModel;

test("built-in registry isolates Frame Conn from generic core", () => {
  const registry = createBuiltinProjectProfileRegistry();
  assert.equal(registry.resolve("jonkellyrice-cmyk/Lancer-Frame-Conn").id, "frame-conn");
  assert.equal(registry.resolve("example/other-repository").id, "generic");
});

test("Frame Conn profile contributes native-contract data through generic planning extension", () => {
  const profile = createBuiltinProjectProfileRegistry().resolve("jonkellyrice-cmyk/Lancer-Frame-Conn");
  const result = runNativePlanning({ objective: "provider", model, extensions: { additionalAnalyzers: profile.additionalAnalyzers, runtimeProbePlanner: profile.runtimeProbePlanner, nativeContractProvider: profile.nativeContractProvider } });
  assert.equal(result.nativeContracts.length, 1);
  assert.equal(result.nativeContracts[0]?.source, "dev_scripts/native-contract-catalog.json");
});
