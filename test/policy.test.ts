import assert from "node:assert/strict";
import test from "node:test";

import {
  ABSTRACTION_VIOLATION,
  GuardError,
  SourceGrantStore,
  extractGrantedPathsFromLog,
  validateToolchainRequest
} from "../src/policy.js";

function validRequest() {
  return {
    schema_version: 2,
    id: "brace-repair-v1",
    planning_goal: "Fix the Brace presentation defect through the canonical toolchain.",
    scope_lock: {
      schema_version: 1,
      lock_id: "brace-repair",
      original_user_instruction: "Fix Brace using the toolchain.",
      authorized_deliverables: ["Repair Brace presentation only."],
      authorized_paths: [],
      forbidden_expansions: ["Do not change unrelated reactions."],
      allow_capability_construction: false,
      authorized_capabilities: []
    },
    operations: []
  };
}

test("accepts a Scope Lock-bearing planning-only request", () => {
  const parsed = validateToolchainRequest(validRequest());
  assert.equal(parsed.id, "brace-repair-v1");
  assert.deepEqual(parsed.operations, []);
});

test("rejects a request that attempts to smuggle direct operations", () => {
  const request = validRequest();
  request.operations = [{ type: "write", path: "scripts/anything.js" }] as never[];

  assert.throws(
    () => validateToolchainRequest(request),
    (error: unknown) => error instanceof GuardError && error.code === ABSTRACTION_VIOLATION
  );
});

test("derives source authority from the certified targeted patch surface", () => {
  const log = [
    "2026-08-18T16:50:02.2293437Z Targeted patch surface:",
    "2026-08-18T16:50:02.2295209Z   scripts/player_features/feature_brace/brace-feature.js [brace]",
    "2026-08-18T16:50:02.2295732Z     L17 binding runtime",
    "2026-08-18T16:50:02.2299716Z   scripts/runtime-orchestrator.js [runtime-composition]",
    "2026-08-18T16:50:02.2312814Z Runtime convergence:"
  ].join("\n");

  assert.deepEqual(extractGrantedPathsFromLog(log), [
    "scripts/player_features/feature_brace/brace-feature.js",
    "scripts/runtime-orchestrator.js"
  ]);
});

test("accepts an explicit machine-readable grant marker", () => {
  const log = '[abstraction-lock] SOURCE_ACCESS_GRANT {"paths":["scripts/foo.js","styles/bar.css"]}';
  assert.deepEqual(extractGrantedPathsFromLog(log), ["scripts/foo.js", "styles/bar.css"]);
});

test("grant store permits only exact toolchain-granted paths", () => {
  const grants = new SourceGrantStore(60_000);
  grants.issue("owner/repo", "a".repeat(40), ["scripts/allowed.js"], "workflow-run:1");

  assert.equal(
    grants.require("owner/repo", "a".repeat(40), "scripts/allowed.js").evidence,
    "workflow-run:1"
  );

  assert.throws(
    () => grants.require("owner/repo", "a".repeat(40), "scripts/not-allowed.js"),
    (error: unknown) => error instanceof GuardError && error.code === ABSTRACTION_VIOLATION
  );
});
