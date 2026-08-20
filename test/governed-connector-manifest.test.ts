import assert from "node:assert/strict";
import test from "node:test";

import {
  CHRYPCK_GOVERNED_CONNECTOR_MANIFEST,
  GOVERNED_CONNECTOR_MANIFEST_SCHEMA,
  GOVERNED_CONNECTOR_MANIFEST_VERSION,
} from "../src/mcp/connector-manifest.js";
import { CHRYPCK_TOOL_NAMES } from "../src/mcp/tools.js";

test("governed connector manifest exactly matches the public MCP tool surface", () => {
  assert.equal(
    CHRYPCK_GOVERNED_CONNECTOR_MANIFEST.schema,
    GOVERNED_CONNECTOR_MANIFEST_SCHEMA,
  );
  assert.equal(
    CHRYPCK_GOVERNED_CONNECTOR_MANIFEST.schemaVersion,
    GOVERNED_CONNECTOR_MANIFEST_VERSION,
  );
  assert.equal(CHRYPCK_GOVERNED_CONNECTOR_MANIFEST.connector.id, "chrypck");
  assert.equal(
    CHRYPCK_GOVERNED_CONNECTOR_MANIFEST.connector.selectionMode,
    "workflow-bundle",
  );
  assert.equal(CHRYPCK_GOVERNED_CONNECTOR_MANIFEST.transport.path, "/mcp");
  assert.equal(
    CHRYPCK_GOVERNED_CONNECTOR_MANIFEST.transport.authentication,
    "bearer",
  );

  assert.deepEqual(
    CHRYPCK_GOVERNED_CONNECTOR_MANIFEST.capabilities
      .map((capability) => capability.toolName)
      .sort(),
    [...CHRYPCK_TOOL_NAMES].sort(),
  );
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
