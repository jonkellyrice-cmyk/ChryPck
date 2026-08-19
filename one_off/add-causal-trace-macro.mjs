#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const PAYLOAD_DIR = resolve(SCRIPT_DIR, "trace_payload");
const PAYLOAD_PARTS = Object.freeze(Array.from({ length: 7 }, (_, index) => `part${String(index + 1).padStart(2, "0")}.b64`));
const EXPECTED_PAYLOAD_SHA256 = "73832d30f15af3d87d776a3a7f04d477974f50ce2ae085c5e1ea106f56e60754";
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_CHECK = process.argv.includes("--skip-check");

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function loadPayload() {
  const encoded = PAYLOAD_PARTS.map(name => {
    const path = resolve(PAYLOAD_DIR, name);
    if (!existsSync(path)) throw new Error(`Missing trace payload part: ${name}`);
    return readFileSync(path, "utf8").trim();
  }).join("");
  const actual = sha256Text(encoded);
  if (actual !== EXPECTED_PAYLOAD_SHA256) {
    throw new Error(`Trace payload checksum mismatch. Expected ${EXPECTED_PAYLOAD_SHA256}, found ${actual}.`);
  }
  try {
    return JSON.parse(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"));
  } catch (error) {
    throw new Error(`Trace payload decode failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function decode(value) {
  return Buffer.from(value, "base64").toString("utf8");
}

function repoPath(path) {
  return resolve(ROOT, path);
}

function gitBlobSha(content) {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

function replaceExactly(content, before, after, path) {
  const first = content.indexOf(before);
  if (first < 0) throw new Error(`Patch anchor not found in ${path}.`);
  if (content.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Patch anchor is ambiguous in ${path}.`);
  }
  return content.slice(0, first) + after + content.slice(first + before.length);
}

const payload = loadPayload();
const originals = new Map();
const staged = new Map();

for (const [path, expectedSha] of Object.entries(payload.expected)) {
  const absolute = repoPath(path);
  if (!existsSync(absolute)) throw new Error(`Expected file is missing: ${path}`);
  const content = readFileSync(absolute, "utf8");
  const actualSha = gitBlobSha(content);
  if (actualSha !== expectedSha) {
    throw new Error(
      `Snapshot lock failed for ${path}. Expected git blob ${expectedSha}, found ${actualSha}. ` +
      "Regenerate this one-off script against the current repository state."
    );
  }
  originals.set(path, content);
  staged.set(path, content);
}

for (const patch of payload.patches) {
  const current = staged.get(patch.path);
  if (current === undefined) throw new Error(`Patch target was not snapshot-locked: ${patch.path}`);
  staged.set(patch.path, replaceExactly(current, decode(patch.old), decode(patch.new), patch.path));
}

for (const [path, encoded] of Object.entries(payload.whole)) {
  if (!staged.has(path)) throw new Error(`Whole-file target was not snapshot-locked: ${path}`);
  staged.set(path, decode(encoded));
}

for (const [path, encoded] of Object.entries(payload.newfiles)) {
  const absolute = repoPath(path);
  if (existsSync(absolute)) throw new Error(`Refusing to overwrite existing generated path: ${path}`);
  staged.set(path, decode(encoded));
}

const changed = [...staged.entries()].filter(([path, content]) => originals.get(path) !== content);
console.log(`ChryPck causal-trace one-off: ${DRY_RUN ? "dry-run" : "apply"}`);
for (const [path, content] of changed) {
  const before = originals.get(path);
  const beforeBytes = before === undefined ? 0 : Buffer.byteLength(before, "utf8");
  const afterBytes = Buffer.byteLength(content, "utf8");
  console.log(`  ${before === undefined ? "CREATE" : "UPDATE"} ${path} (${beforeBytes} -> ${afterBytes} bytes)`);
}

if (DRY_RUN) {
  console.log("Dry-run passed: payload checksum, snapshot locks, and patch anchors are valid. No files written.");
  process.exit(0);
}

const written = [];
try {
  for (const [path, content] of changed) {
    const absolute = repoPath(path);
    mkdirSync(dirname(absolute), { recursive: true });
    const temp = `${absolute}.chrypck-trace-tmp-${process.pid}`;
    writeFileSync(temp, content, "utf8");
    renameSync(temp, absolute);
    written.push(path);
  }

  if (!SKIP_CHECK) {
    console.log("Running npm run check ...");
    const result = spawnSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["run", "check"],
      { cwd: ROOT, stdio: "inherit", env: process.env }
    );
    if (result.status !== 0) {
      throw new Error(`npm run check failed with exit code ${result.status ?? "unknown"}`);
    }
  }

  console.log("Causal trace feature applied and validated successfully.");
  console.log("This script and trace_payload directory are temporary; delete them after committing the generated source changes.");
} catch (error) {
  console.error(`Apply/validation failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error("Rolling back every source file written by this one-off...");
  for (const path of [...written].reverse()) {
    const absolute = repoPath(path);
    const original = originals.get(path);
    if (original === undefined) rmSync(absolute, { force: true });
    else writeFileSync(absolute, original, "utf8");
  }
  console.error("Rollback complete; repository source restored to the pre-run state.");
  process.exit(1);
}
