/**
 * dev_scripts/state-namespace-atlas.mjs
 *
 * Builds a persistence/public-namespace ledger over Frame Conn source.
 * Static-only: target code is never imported or executed.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import os from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_FILE);
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const IGNORED_DIRECTORIES = new Set([".git", ".github", "node_modules", "dist", "build", "coverage", "backups", "patch-history", "dev_scripts"]);

function normalizeSlashes(value) {
  return String(value).replaceAll("\\", "/");
}

function parseArgs(argv) {
  const args = { root: ".", output: "state-namespace-report.json", selfTest: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--root") args.root = argv[++i];
    else if (token === "--output") args.output = argv[++i];
    else if (token === "--self-test") args.selfTest = true;
    else if (token === "--help" || token === "-h") {
      console.log("Usage: node dev_scripts/state-namespace-atlas.mjs [--root path] [--output file] [--self-test]");
      process.exit(0);
    }
  }
  return args;
}

function collectFiles(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...collectFiles(absolute));
    else if (entry.isFile() && JS_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) result.push(absolute);
  }
  return result.sort();
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function resolveLiteralOrIdentifier(token, constants) {
  const trimmed = String(token ?? "").trim();
  const literal = trimmed.match(/^["'`]([^"'`]*)["'`]$/);
  if (literal) return { value: literal[1], resolved: true, source: "literal" };
  if (/^[A-Za-z_$][\w$]*$/.test(trimmed) && constants.has(trimmed)) {
    return { value: constants.get(trimmed), resolved: true, source: `constant:${trimmed}` };
  }
  return { value: trimmed || "<unknown>", resolved: false, source: "expression" };
}

function collectStringConstants(text) {
  const constants = new Map();
  const regex = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*["'`]([^"'`]*)["'`]\s*;/g;
  let match;
  while ((match = regex.exec(text))) constants.set(match[1], match[2]);
  return constants;
}

function scanFile(relativeFile, text) {
  const constants = collectStringConstants(text);
  const entries = [];

  const flagRegex = /\.\s*(getFlag|setFlag|unsetFlag)\s*\(\s*([^,\n)]+)\s*,\s*([^,\n)]+)(?:\s*,|\s*\))/g;
  let match;
  while ((match = flagRegex.exec(text))) {
    const operation = match[1];
    const namespace = resolveLiteralOrIdentifier(match[2], constants);
    const key = resolveLiteralOrIdentifier(match[3], constants);
    entries.push({
      kind: "foundry-flag",
      owner: "Foundry Document",
      operation,
      access: operation === "getFlag" ? "read" : operation === "setFlag" ? "write" : "delete",
      namespace: namespace.value,
      key: key.value,
      namespaceResolved: namespace.resolved,
      keyResolved: key.resolved,
      file: relativeFile,
      line: lineNumber(text, match.index),
      expression: match[0].replace(/\s+/g, " ").trim().slice(0, 200)
    });
  }

  const settingsRegex = /\bgame\s*\.\s*settings\s*\.\s*(register|get|set)\s*\(\s*([^,\n)]+)\s*,\s*([^,\n)]+)(?:\s*,|\s*\))/g;
  while ((match = settingsRegex.exec(text))) {
    const operation = match[1];
    const namespace = resolveLiteralOrIdentifier(match[2], constants);
    const key = resolveLiteralOrIdentifier(match[3], constants);
    entries.push({
      kind: "foundry-setting",
      owner: "game.settings",
      operation,
      access: operation === "get" ? "read" : "write",
      namespace: namespace.value,
      key: key.value,
      namespaceResolved: namespace.resolved,
      keyResolved: key.resolved,
      file: relativeFile,
      line: lineNumber(text, match.index),
      expression: match[0].replace(/\s+/g, " ").trim().slice(0, 200)
    });
  }

  const storageRegex = /\b(localStorage|sessionStorage)\s*\.\s*(getItem|setItem|removeItem)\s*\(\s*([^,\n)]+)(?:\s*,|\s*\))/g;
  while ((match = storageRegex.exec(text))) {
    const key = resolveLiteralOrIdentifier(match[3], constants);
    entries.push({
      kind: "web-storage",
      owner: match[1],
      operation: match[2],
      access: match[2] === "getItem" ? "read" : match[2] === "setItem" ? "write" : "delete",
      namespace: match[1],
      key: key.value,
      namespaceResolved: true,
      keyResolved: key.resolved,
      file: relativeFile,
      line: lineNumber(text, match.index),
      expression: match[0].replace(/\s+/g, " ").trim().slice(0, 200)
    });
  }

  const globalWriteRegex = /\b(game|globalThis)\s*\.\s*([A-Za-z_$][\w$]*)\s*=/g;
  while ((match = globalWriteRegex.exec(text))) {
    entries.push({
      kind: "public-global",
      owner: match[1],
      operation: "assign",
      access: "write",
      namespace: match[1],
      key: match[2],
      namespaceResolved: true,
      keyResolved: true,
      file: relativeFile,
      line: lineNumber(text, match.index),
      expression: match[0].replace(/\s+/g, " ").trim()
    });
  }

  const flagPathRegex = /flags\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_.-]+)/g;
  while ((match = flagPathRegex.exec(text))) {
    entries.push({
      kind: "flag-path",
      owner: "Foundry flags path",
      operation: "path-reference",
      access: "unknown",
      namespace: match[1],
      key: match[2],
      namespaceResolved: true,
      keyResolved: true,
      file: relativeFile,
      line: lineNumber(text, match.index),
      expression: match[0]
    });
  }

  return entries;
}

function classifyLegacy(namespace, file) {
  if (namespace === "lancer-sitrep-tracker") return true;
  return normalizeSlashes(file).includes("legacy-sitrep-module");
}

function buildLedger(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const id = `${entry.kind}|${entry.namespace}|${entry.key}`;
    if (!grouped.has(id)) {
      grouped.set(id, {
        kind: entry.kind,
        owner: entry.owner,
        namespace: entry.namespace,
        key: entry.key,
        readers: [],
        writers: [],
        deleters: [],
        references: [],
        legacy: false,
        unresolved: false,
        migrationRequired: false
      });
    }
    const item = grouped.get(id);
    const site = { file: entry.file, line: entry.line, operation: entry.operation };
    if (entry.access === "read") item.readers.push(site);
    else if (entry.access === "write") item.writers.push(site);
    else if (entry.access === "delete") item.deleters.push(site);
    else item.references.push(site);
    item.legacy ||= classifyLegacy(entry.namespace, entry.file);
    item.unresolved ||= !entry.namespaceResolved || !entry.keyResolved;
  }

  for (const item of grouped.values()) {
    item.migrationRequired = item.legacy && (item.writers.length > 0 || item.deleters.length > 0 || item.kind === "public-global");
  }

  return [...grouped.values()].sort((a, b) => `${a.namespace}.${a.key}`.localeCompare(`${b.namespace}.${b.key}`));
}

function runAtlas(repositoryRoot, rootRelative) {
  const scanRoot = path.resolve(repositoryRoot, rootRelative);
  const files = collectFiles(scanRoot);
  const entries = [];
  for (const absolute of files) {
    const relative = normalizeSlashes(path.relative(repositoryRoot, absolute));
    entries.push(...scanFile(relative, fs.readFileSync(absolute, "utf8")));
  }
  const ledger = buildLedger(entries);
  return {
    schema_version: 1,
    tool: "state-namespace-atlas",
    version: SCRIPT_VERSION,
    root: normalizeSlashes(rootRelative),
    summary: {
      files: files.length,
      accessSites: entries.length,
      stateSurfaces: ledger.length,
      legacySurfaces: ledger.filter(item => item.legacy).length,
      migrationRequired: ledger.filter(item => item.migrationRequired).length,
      unresolved: ledger.filter(item => item.unresolved).length
    },
    ledger,
    accessSites: entries
  };
}

function printReport(report) {
  console.log("Frame Conn State / Namespace Atlas");
  console.log(`Root: ${report.root}`);
  console.log(`${report.summary.files} files | ${report.summary.stateSurfaces} state surfaces | ${report.summary.legacySurfaces} legacy | ${report.summary.migrationRequired} migration candidates`);
  if (report.ledger.length) {
    console.log("\nPersistence/public namespace ledger:");
    for (const item of report.ledger) {
      const marker = item.migrationRequired ? "MIGRATE" : item.legacy ? "LEGACY" : "CURRENT";
      console.log(`  ${marker.padEnd(8)} ${item.kind.padEnd(15)} ${item.namespace}.${item.key}`);
      console.log(`    readers ${item.readers.length} | writers ${item.writers.length} | deletes ${item.deleters.length} | refs ${item.references.length}`);
    }
  }
}

function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-conn-state-atlas-"));
  fs.mkdirSync(path.join(root, "scripts", "legacy-sitrep-module"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "scripts", "legacy-sitrep-module", "state.js"),
    'const MODULE_ID = "lancer-sitrep-tracker"; const FLAG_KEY = "sitrep"; export function x(c){ c.getFlag(MODULE_ID, FLAG_KEY); c.setFlag(MODULE_ID, FLAG_KEY, {}); game.lancerSitrep = {}; }\n'
  );
  const report = runAtlas(root, ".");
  if (!report.ledger.some(item => item.namespace === "lancer-sitrep-tracker" && item.key === "sitrep" && item.migrationRequired)) {
    throw new Error("Self-test failed: legacy flag migration surface was not detected.");
  }
  if (!report.ledger.some(item => item.kind === "public-global" && item.key === "lancerSitrep")) {
    throw new Error("Self-test failed: public global API was not detected.");
  }
  fs.rmSync(root, { recursive: true, force: true });
  console.log("State / Namespace Atlas self-test PASSED");
}

const args = parseArgs(process.argv);
if (args.selfTest) {
  selfTest();
} else {
  const report = runAtlas(REPOSITORY_ROOT, args.root);
  const outputPath = path.resolve(REPOSITORY_ROOT, args.output);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  printReport(report);
  console.log(`\nReport: ${normalizeSlashes(path.relative(REPOSITORY_ROOT, outputPath))}`);
}
