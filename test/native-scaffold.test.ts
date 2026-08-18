import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultAbstractionLock } from "../src/core/policy/abstraction-lock.js";
import { createScopeLock } from "../src/core/policy/scope-lock.js";
import { RunController } from "../src/core/run/orchestrator.js";
import { RunTelemetry } from "../src/core/run/telemetry.js";
import { stagePatch } from "../src/mutation/file-patcher.js";

test("state transition", () => {
  const scopeLock = createScopeLock({ originalUserInstruction: "x", authorizedDeliverables: ["x"] });
  const run = {
    runId: "r",
    repository: "o/r",
    objective: "x",
    scopeLock,
    abstractionLock: createDefaultAbstractionLock(scopeLock),
    state: "CREATED" as const,
    telemetry: new RunTelemetry("r")
  };
  new RunController(run).transition("SCOPE_LOCKED");
  assert.equal(run.state, "SCOPE_LOCKED");
});

test("patch staging", () => {
  const out = stagePatch({
    id: "p",
    objective: "x",
    operations: [{ type: "replace_exact", path: "a", search: "x", replace: "y" }]
  }, new Map([["a", "x"]]));
  assert.equal(out.files.get("a"), "y");
});
