import assert from "node:assert/strict";
import test from "node:test";

import {
  CHRYPCK_GOVERNED_CONNECTOR_MANIFEST,
  GOVERNED_CONNECTOR_MANIFEST_SCHEMA,
  GOVERNED_CONNECTOR_MANIFEST_VERSION,
} from "../src/mcp/connector-manifest.js";
import { CHRYPCK_TOOL_NAMES } from "../src/mcp/tools.js";

test("governed connector manifest exactly matches the public MCP tool surface", () => {
  assert.equal(CHRYPCK_GOVERNED_CONNECTOR_MANIFEST.schema, GOVERNED_CONNECTOR_MANIFEST_SCHEMA);
  assert.equal(CHRYPCK_GOVERNED_CONNECTOR_MANIFEST.schemaVersion, GOVERNED_CONNECTOR_MANIFEST_VERSION);
  assert.equal(GOVERNED_CONNECTOR_MANIFEST_VERSION, 5);
  assert.equal(CHRYPCK_GOVERNED_CONNECTOR_MANIFEST.connector.id, "chrypck");
  assert.equal(CHRYPCK_GOVERNED_CONNECTOR_MANIFEST.connector.selectionMode, "workflow-bundle");
  assert.equal(CHRYPCK_GOVERNED_CONNECTOR_MANIFEST.transport.path, "/mcp");
  assert.equal(CHRYPCK_GOVERNED_CONNECTOR_MANIFEST.transport.authentication, "bearer");
  assert.deepEqual(
    CHRYPCK_GOVERNED_CONNECTOR_MANIFEST.capabilities.map(capability => capability.toolName).sort(),
    [...CHRYPCK_TOOL_NAMES].sort(),
  );
});

test("governed connector manifest publishes semantic orientation, canonical Trace, and certified analysis lineage", () => {
  const manifest = CHRYPCK_GOVERNED_CONNECTOR_MANIFEST;
  assert.ok(manifest.connector.aliases.includes("ChryPck"));
  assert.ok(manifest.connector.aliases.includes("CherryPick"));
  assert.ok(manifest.connector.aliases.includes("Cherry Pick"));

  assert.deepEqual(manifest.workflow.analysisModes.map(mode => mode.kind), ["trace"]);
  assert.match(manifest.workflow.analysisModes[0]?.when ?? "", /bounded/i);
  assert.match(manifest.workflow.analysisModes[0]?.when ?? "", /evidence/i);
  assert.doesNotMatch(JSON.stringify(manifest.workflow.analysisModes), /bounded-event-trace/);

  for (const diagnosticId of [
    "repository-atlas", "coverage-ledger", "semantic-atlas", "semantic-coverage-ledger",
    "dependency-graph", "dependency-watershed", "symbol-families", "effect-atlas",
    "integration-surfaces", "runtime-signals", "state-namespaces", "native-contracts",
    "runtime-probes", "analysis-lineage", "patch-corridor", "context-pack", "change-propagation",
  ]) {
    assert.ok(manifest.workflow.diagnosticSurfaces.some(surface => surface.id === diagnosticId), `missing diagnostic surface ${diagnosticId}`);
  }

  assert.deepEqual(
    manifest.workflow.phases.map(phase => phase.id),
    ["semantic-bootstrap", "repository-orientation", "general-analysis", "focused-analysis", "trace-handoff", "certified-context", "cross-cutting-patch", "execute", "verify"],
  );
  assert.match(manifest.workflow.patchStrategy, /one coherent cross-cutting patch/i);
  assert.match(manifest.workflow.failurePolicy, /do not claim ChryPck is unavailable/i);
  assert.match(manifest.workflow.phases[0]?.guidance ?? "", /semantic_bootstrap/i);
  assert.match(manifest.workflow.phases[1]?.guidance ?? "", /semantic_atlas/i);
  assert.match(manifest.workflow.phases[3]?.guidance ?? "", /only trace mode/i);
  assert.match(manifest.workflow.phases[4]?.guidance ?? "", /trace_handoff/i);
  assert.match(manifest.workflow.phases[4]?.guidance ?? "", /independently certify mutation scope/i);
  assert.match(manifest.capabilities[0]?.returns ?? "", /Semantic Atlas/i);
  assert.match(manifest.capabilities[0]?.description ?? "", /Trace/i);
  assert.match(manifest.capabilities[0]?.description ?? "", /trace_handoff/i);
});

test("governed connector manifest keeps writes explicit and reads automatic", () => {
  for (const capability of CHRYPCK_GOVERNED_CONNECTOR_MANIFEST.capabilities) {
    assert.ok(capability.description.trim());
    assert.ok(capability.returns.trim());
    assert.ok(capability.errorBehavior.trim());
    if (capability.toolName === "chrypck_execute") {
      assert.equal(capability.effect, "write");
      assert.equal(capability.approval, "explicit-intent");
      assert.equal(capability.programmaticEligible, false);
      continue;
    }
    assert.equal(capability.effect, "read");
    assert.equal(capability.approval, "automatic");
  }
});
