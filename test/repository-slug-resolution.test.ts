import assert from "node:assert/strict";
import test from "node:test";

import { resolveRepositorySlug } from "../src/mcp/user-identity.js";

test("bare repository slugs resolve under the configured ChryPck owner", () => {
  assert.equal(
    resolveRepositorySlug("LEMONADE_ORC", "jonkellyrice-cmyk/"),
    "jonkellyrice-cmyk/LEMONADE_ORC",
  );
  assert.equal(
    resolveRepositorySlug("Lancer-Frame-Conn", "jonkellyrice-cmyk/"),
    "jonkellyrice-cmyk/Lancer-Frame-Conn",
  );
});

test("fully qualified repositories and GitHub URLs remain accepted", () => {
  assert.equal(
    resolveRepositorySlug("other-owner/example"),
    "other-owner/example",
  );
  assert.equal(
    resolveRepositorySlug("https://github.com/other-owner/example.git"),
    "other-owner/example",
  );
});

test("invalid repository identifiers fail closed", () => {
  assert.throws(() => resolveRepositorySlug("owner/repo/extra"));
  assert.throws(() => resolveRepositorySlug("repo name"));
});
