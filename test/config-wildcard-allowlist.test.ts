import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

function env(allowedRepositories: string): NodeJS.ProcessEnv {
  return {
    GITHUB_TOKEN: "github_pat_test",
    ALLOWED_REPOSITORIES: allowedRepositories
  };
}

test("exact repository allowlists remain restrictive", () => {
  const config = loadConfig(env("owner/repo"));
  assert.equal(config.allowedRepositories.has("owner/repo"), true);
  assert.equal(config.allowedRepositories.has("other/repo"), false);
});

test("wildcard repository allowlist delegates repository scope to the GitHub token", () => {
  const config = loadConfig(env("*"));
  assert.equal(config.allowedRepositories.has("owner/repo"), true);
  assert.equal(config.allowedRepositories.has("other/repo"), true);
});
