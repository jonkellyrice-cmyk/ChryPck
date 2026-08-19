import test from "node:test";
import assert from "node:assert/strict";
import { createSnapshot } from "../src/repository/snapshot.js";
import { buildRepositoryModel } from "../src/repository/model-builder.js";
import { runTrace } from "../src/analysis/trace-runner.js";

test("Trace follows multi-hop brace scenario", () => {
  const files = [
    { path: "src/brace/feature.js", sha: "a", size: 1, text: `export function promptBraceReaction(message, targetUuid) {\n  if (!message.id || !targetUuid) return;\n  // show popup\n}` },
    { path: "src/brace/target.js", sha: "b", size: 1, text: `export function resolveTargetUuid(message) { return message.targetUuid; }` },
    { path: "src/brace/caller.js", sha: "c", size: 1, text: `import { resolveTargetUuid } from './target.js';\nimport { promptBraceReaction } from './feature.js';\nexport function handleDamage(message) { const t = resolveTargetUuid(message); promptBraceReaction(message, t); }` }
  ];
  const snapshot = createSnapshot("owner/repo", "f".repeat(40), files);
  const model = buildRepositoryModel(snapshot);
  const result = runTrace({ objective: "Brace reaction popup does not appear when damage is applied.", model, max_hops: 12, max_branches: 3 });
  assert(result.trace.length >= 1, "trace produced at least one hop");
  // ensure the trace includes the feature symbol or caller
  const hasFeature = result.trace.some(h => String(h.to).includes("promptBraceReaction") || String(h.from).includes("promptBraceReaction") );
  assert(hasFeature, "trace reached promptBraceReaction or its caller");
});
