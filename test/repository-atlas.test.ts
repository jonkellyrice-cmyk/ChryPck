import assert from "node:assert/strict";
import test from "node:test";

import { buildRepositoryModel } from "../src/repository/model-builder.js";
import { buildRepositoryOrientation } from "../src/repository/repository-atlas.js";
import { createSnapshot, type RepositoryFile } from "../src/repository/snapshot.js";

function flattenPaths(entries: readonly any[]): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    paths.push(entry.path);
    if (entry.kind === "directory") paths.push(...flattenPaths(entry.children));
  }
  return paths;
}

test("repository atlas exposes a complete compact whole-repository orientation for a small repo", () => {
  const files: RepositoryFile[] = [
    { path: "package.json", sha: "a", size: 18, text: "{}", kind: "source" },
    { path: "src/app/main.ts", sha: "b", size: 42, text: "export function main() { return 1; }", kind: "source" },
    { path: "src/app/runtime/handler.ts", sha: "c", size: 46, text: "export function handle() { return mainValue; }", kind: "source" },
    { path: "test/main.test.ts", sha: "d", size: 32, text: "export const testValue = 1;", kind: "source" },
    { path: "assets/logo.png", sha: "e", size: 2048, kind: "asset" }
  ];
  const snapshot = createSnapshot("owner/repo", "abc123", files, "2026-08-20T00:00:00.000Z");
  const model = buildRepositoryModel(snapshot);
  const orientation = buildRepositoryOrientation(model, { maxAtlasNodes: 64 });

  assert.equal(orientation.atlas.complete, true);
  assert.equal(orientation.atlas.omitted_node_count, 0);
  assert.equal(orientation.coverage.repository_files.total, 5);
  assert.equal(orientation.coverage.repository_files.text_backed, 4);
  assert.equal(orientation.coverage.repository_files.modeled, 4);
  assert.equal(orientation.coverage.repository_files.by_kind.asset, 1);
  assert.equal(orientation.coverage.repository_model.file_fact_records, 4);

  const paths = flattenPaths(orientation.atlas.entries);
  assert.ok(paths.includes("package.json"));
  assert.ok(paths.includes("src/app"));
  assert.ok(paths.includes("src/app/runtime"));
  assert.ok(paths.includes("src/app/runtime/handler.ts"));
  assert.ok(paths.includes("assets/logo.png"));
});

test("repository atlas remains bounded and advertises omitted structure for large repos", () => {
  const files: RepositoryFile[] = Array.from({ length: 300 }, (_, index) => ({
    path: `assets/generated/file-${String(index).padStart(3, "0")}.png`,
    sha: `sha-${index}`,
    size: 100 + index,
    kind: "asset" as const
  }));
  const snapshot = createSnapshot("owner/repo", "def456", files, "2026-08-20T00:00:00.000Z");
  const model = buildRepositoryModel(snapshot);
  const orientation = buildRepositoryOrientation(model, { maxAtlasNodes: 40 });

  assert.equal(orientation.coverage.repository_files.total, 300);
  assert.equal(orientation.coverage.repository_files.modeled, 0);
  assert.equal(orientation.coverage.repository_files.by_kind.asset, 300);
  assert.equal(orientation.atlas.complete, false);
  assert.equal(orientation.atlas.returned_node_count, 40);
  assert.ok(orientation.atlas.total_node_count > orientation.atlas.returned_node_count);
  assert.equal(
    orientation.atlas.omitted_node_count,
    orientation.atlas.total_node_count - orientation.atlas.returned_node_count
  );
  assert.equal(orientation.coverage.atlas_projection.omitted_node_count, orientation.atlas.omitted_node_count);
});
