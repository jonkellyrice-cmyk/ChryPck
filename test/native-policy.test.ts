import assert from "node:assert/strict";
import test from "node:test";

import {
  ABSTRACTION_OUTCOMES,
  createDefaultAbstractionLock,
  createSourceAccessGrant,
  evaluateAbstractionAccess,
  type SourceAccessGrant
} from "../src/core/policy/abstraction-lock.js";
import { buildScopeLock, createScopeLock } from "../src/core/policy/scope-lock.js";

function validRequest() {
  return {
    scope_lock: {
      original_user_instruction: "Change a.js only.",
      authorized_deliverables: ["Change a.js"],
      authorized_paths: ["a.js"],
      forbidden_expansions: ["Do not change b.js"]
    },
    policy: { allowed_paths: ["a.js"] },
    operations: [{ type: "replace_text", path: "a.js" }]
  };
}

test("Scope Lock accepts the authoritative valid request", () => {
  const lock = buildScopeLock(validRequest());
  assert.equal(lock.locked, true);
  assert.equal(lock.state, "LOCKED");
  assert.equal(lock.authority?.assistant_may_expand_scope, false);
});

test("Scope Lock fails closed when missing", () => {
  assert.equal(buildScopeLock({ operations: [] }).state, "SCOPE_VIOLATION");
});

test("Scope Lock rejects path expansion", () => {
  const request = validRequest();
  request.operations.push({ type: "replace_text", path: "b.js" });
  const lock = buildScopeLock(request);
  assert.ok(lock.violations.some(item => item.code === "PATH_SCOPE_EXPANSION"));
});

test("Scope Lock requires explicit capability authorization", () => {
  const request = validRequest();
  Object.assign(request.scope_lock, { allow_capability_construction: true });
  const lock = buildScopeLock(request);
  assert.ok(lock.violations.some(item => item.code === "CAPABILITY_AUTHORIZATION_REQUIRED"));
});

test("Scope Lock fingerprint is deterministic", () => {
  const left = buildScopeLock(validRequest());
  const right = buildScopeLock(validRequest());
  assert.equal(left.fingerprint, right.fingerprint);
  assert.equal(left.objective_fingerprint, right.objective_fingerprint);
});

test("Abstraction Lock requires Scope Lock first", () => {
  const result = createDefaultAbstractionLock();
  assert.equal("outcome" in result ? result.outcome : null, ABSTRACTION_OUTCOMES.GAP);
});

test("Abstraction Lock permits established high-level surfaces", () => {
  const scope = createScopeLock({ originalUserInstruction: "Inspect.", authorizedDeliverables: ["Inspect"] });
  const lock = createDefaultAbstractionLock(scope);
  assert.equal(lock.locked, true);
  const result = evaluateAbstractionAccess({ scopeLock: scope, surface: "patch-corridor" });
  assert.equal(result.outcome, ABSTRACTION_OUTCOMES.ALLOW);
  assert.equal(result.authority, "established-toolchain-abstraction");
});

test("generic source exploration is denied", () => {
  const scope = createScopeLock({ originalUserInstruction: "Inspect a.js.", authorizedDeliverables: ["Inspect a.js"], authorizedPaths: ["a.js"] });
  const result = evaluateAbstractionAccess({ scopeLock: scope, surface: "github-search" });
  assert.equal(result.outcome, ABSTRACTION_OUTCOMES.VIOLATION);
  assert.equal(result.reason, "generic-or-guessed-source-exploration-denied");
});

test("bounded source access requires and honors higher-level grant", () => {
  const scope = createScopeLock({ originalUserInstruction: "Inspect a.js.", authorizedDeliverables: ["Inspect a.js"], authorizedPaths: ["a.js"] });
  const created = createSourceAccessGrant({ paths: ["a.js"], issuedBy: "patch-corridor", evidence: "corridor:123", scopeLock: scope });
  assert.equal(created.outcome, ABSTRACTION_OUTCOMES.ALLOW);
  const grant = created.grant as SourceAccessGrant;
  const allowed = evaluateAbstractionAccess({ scopeLock: scope, surface: "direct-source-read", path: "a.js", grant });
  assert.equal(allowed.outcome, ABSTRACTION_OUTCOMES.ALLOW);
  assert.equal(allowed.authority, "bounded-source-access-grant");
});

test("source grant cannot broaden Scope Lock", () => {
  const scope = createScopeLock({ originalUserInstruction: "Inspect a.js.", authorizedDeliverables: ["Inspect a.js"], authorizedPaths: ["a.js"] });
  const result = createSourceAccessGrant({ paths: ["b.js"], issuedBy: "patch-corridor", evidence: "corridor:123", scopeLock: scope });
  assert.equal(result.outcome, ABSTRACTION_OUTCOMES.VIOLATION);
  assert.deepEqual(result.denied_paths, ["b.js"]);
});
