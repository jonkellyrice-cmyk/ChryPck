/**
 * dev_scripts/runtime-authority-audit.mjs
 *
 * Detects competing startup/runtime authorities, public globals, direct hook
 * ownership, window/document listeners, and platform monkey patches.
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

const AUTHORITY = Object.freeze({
  AUTHORITATIVE: "AUTHORITATIVE",
  REGISTERED_FEATURE_EFFECT: "REGISTERED_FEATURE_EFFECT",
  DIRECT_FEATURE_EFFECT: "DIRECT_FEATURE_EFFECT",
  COMPETING_RUNTIME_AUTHORITY: "COMPETING_RUNTIME_AUTHORITY",
  GLOBAL_PATCH: "GLOBAL_PATCH",
  PUBLIC_GLOBAL_API: "PUBLIC_GLOBAL_API"
});

function normalizeSlashes(value) {
  return String(value).replaceAll("\\", "/");
}

function parseArgs(argv) {
  const args = { root: ".", output: "runtime-authority-report.json", strict: false, selfTest: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--root") args.root = argv[++i];
    else if (token === "--output") args.output = argv[++i];
    else if (token === "--strict") args.strict = true;
    else if (token === "--self-test") args.selfTest = true;
    else if (token === "--help" || token === "-h") {
      console.log("Usage: node dev_scripts/runtime-authority-audit.mjs [--root path] [--output file] [--strict] [--self-test]");
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

function authorityFor(relativeFile, kind, eventName = null) {
  const normalized = normalizeSlashes(relativeFile);
  const runtimeOwner = normalized === "scripts/runtime-orchestrator.js";
  const foundryIntegration = normalized === "scripts/foundry-integration-feature.js";
  const foundryFeature = normalized.startsWith("scripts/foundry_features/");
  const featureFamily = normalized.startsWith("scripts/player_features/") || normalized.startsWith("scripts/rules_features/") || normalized.startsWith("scripts/dm_features/");

  if (kind === "startup-hook") {
    if (runtimeOwner) return { authority: AUTHORITY.AUTHORITATIVE, severity: null, reason: "Authoritative application startup owner." };
    if (foundryIntegration) return { authority: AUTHORITY.REGISTERED_FEATURE_EFFECT, severity: "warning", reason: "Startup hook is outside the runtime orchestrator; verify it is intentionally delegated." };
    return { authority: AUTHORITY.COMPETING_RUNTIME_AUTHORITY, severity: "error", reason: `Direct ${eventName ?? "startup"} ownership competes with the authoritative runtime orchestrator.` };
  }

  if (kind === "hook") {
    if (runtimeOwner || foundryIntegration) return { authority: AUTHORITY.REGISTERED_FEATURE_EFFECT, severity: null, reason: "Hook occurs at an explicit runtime/Foundry integration boundary." };
    if (featureFamily || foundryFeature) return { authority: AUTHORITY.DIRECT_FEATURE_EFFECT, severity: "warning", reason: "Feature installs a Foundry hook directly; prefer registered lifecycle/runtime binding." };
    return { authority: AUTHORITY.DIRECT_FEATURE_EFFECT, severity: "warning", reason: "Direct Foundry hook has no recognized lifecycle owner." };
  }

  if (kind === "global-api") {
    if (runtimeOwner) return { authority: AUTHORITY.PUBLIC_GLOBAL_API, severity: null, reason: "Public game API is composed by the authoritative runtime." };
    return { authority: AUTHORITY.PUBLIC_GLOBAL_API, severity: "warning", reason: "Public game/global API is assigned outside authoritative runtime composition." };
  }

  if (kind === "prototype-patch") {
    if (foundryFeature) return { authority: AUTHORITY.GLOBAL_PATCH, severity: "warning", reason: "Platform patch is in the designated Foundry feature family; verify wrapper safety and reversibility." };
    return { authority: AUTHORITY.GLOBAL_PATCH, severity: "error", reason: "Prototype/platform patch exists outside scripts/foundry_features/." };
  }

  if (kind === "event-listener") {
    if (runtimeOwner || foundryIntegration || foundryFeature) return { authority: AUTHORITY.REGISTERED_FEATURE_EFFECT, severity: "warning", reason: "Browser listener exists at a plausible platform/runtime boundary; verify cleanup ownership." };
    return { authority: AUTHORITY.DIRECT_FEATURE_EFFECT, severity: "warning", reason: "Browser event listener is installed directly by feature code without explicit lifecycle ownership." };
  }

  if (kind === "application-construction") {
    return { authority: AUTHORITY.DIRECT_FEATURE_EFFECT, severity: null, reason: "Application/Dialog construction is informational; ownership depends on surrounding composition." };
  }

  return { authority: AUTHORITY.DIRECT_FEATURE_EFFECT, severity: null, reason: null };
}

const PATTERNS = [
  { kind: "startup-hook", regex: /\bHooks\s*\.\s*(?:once|on)\s*\(\s*["'`](init|ready|setup)["'`]/g, eventGroup: 1 },
  { kind: "hook", regex: /\bHooks\s*\.\s*on\s*\(\s*["'`]([^"'`]+)["'`]/g, eventGroup: 1 },
  { kind: "global-api", regex: /\b(?:game|globalThis)\s*\.\s*([A-Za-z_$][\w$]*)\s*=/g },
  { kind: "prototype-patch", regex: /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.prototype\.([A-Za-z_$][\w$]*)\s*=/g },
  { kind: "event-listener", regex: /\b(?:window|document)\s*\.\s*addEventListener\s*\(\s*["'`]([^"'`]+)["'`]/g, eventGroup: 1 },
  { kind: "application-construction", regex: /\bnew\s+(?:Application|ApplicationV2|Dialog|DialogV2)\s*\(/g }
];

function scanFile(relativeFile, text) {
  const findings = [];
  const seen = new Set();
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(text))) {
      if (pattern.kind === "hook" && ["init", "ready", "setup"].includes(match[1])) continue;
      const eventName = pattern.eventGroup ? match[pattern.eventGroup] : null;
      const key = `${pattern.kind}:${match.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const classification = authorityFor(relativeFile, pattern.kind, eventName);
      findings.push({
        kind: pattern.kind,
        authority: classification.authority,
        severity: classification.severity,
        reason: classification.reason,
        file: relativeFile,
        line: lineNumber(text, match.index),
        event: eventName,
        expression: match[0].replace(/\s+/g, " ").trim().slice(0, 180)
      });
      if (match[0].length === 0) pattern.regex.lastIndex += 1;
    }
  }
  return findings;
}

function runAudit(repositoryRoot, rootRelative) {
  const scanRoot = path.resolve(repositoryRoot, rootRelative);
  const files = collectFiles(scanRoot);
  const findings = [];
  for (const absolute of files) {
    const relative = normalizeSlashes(path.relative(repositoryRoot, absolute));
    findings.push(...scanFile(relative, fs.readFileSync(absolute, "utf8")));
  }
  const errors = findings.filter(item => item.severity === "error").length;
  const warnings = findings.filter(item => item.severity === "warning").length;
  const authorityCounts = {};
  for (const finding of findings) authorityCounts[finding.authority] = (authorityCounts[finding.authority] ?? 0) + 1;
  return {
    schema_version: 1,
    tool: "runtime-authority-audit",
    version: SCRIPT_VERSION,
    root: normalizeSlashes(rootRelative),
    summary: { files: files.length, findings: findings.length, errors, warnings, authorityCounts },
    findings
  };
}

function printReport(report) {
  console.log("Frame Conn Runtime Authority Audit");
  console.log(`Root: ${report.root}`);
  console.log(`${report.summary.files} files | ${report.summary.findings} authority sites | ${report.summary.errors} errors | ${report.summary.warnings} warnings`);
  const expanded = report.findings.filter(item => item.severity);
  if (expanded.length) {
    console.log("\nAuthority diagnostics:");
    for (const finding of expanded) {
      console.log(`  ${(finding.severity ?? "info").toUpperCase()} ${finding.authority} ${finding.file}:${finding.line}`);
      console.log(`    ${finding.reason}`);
      console.log(`    ${finding.expression}`);
    }
  }
}

function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-conn-runtime-authority-"));
  fs.mkdirSync(path.join(root, "scripts", "dm_features", "legacy"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "runtime-orchestrator.js"), 'Hooks.once("ready", () => { game.frameConn = {}; });\n');
  fs.writeFileSync(path.join(root, "scripts", "dm_features", "legacy", "program.js"), 'Hooks.once("ready", () => { game.legacy = {}; });\n');
  const report = runAudit(root, ".");
  if (!report.findings.some(item => item.authority === AUTHORITY.AUTHORITATIVE) || !report.findings.some(item => item.authority === AUTHORITY.COMPETING_RUNTIME_AUTHORITY && item.severity === "error")) {
    throw new Error("Self-test failed: runtime authority distinction was not detected.");
  }
  fs.rmSync(root, { recursive: true, force: true });
  console.log("Runtime Authority Audit self-test PASSED");
}

const args = parseArgs(process.argv);
if (args.selfTest) {
  selfTest();
} else {
  const report = runAudit(REPOSITORY_ROOT, args.root);
  const outputPath = path.resolve(REPOSITORY_ROOT, args.output);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  printReport(report);
  console.log(`\nReport: ${normalizeSlashes(path.relative(REPOSITORY_ROOT, outputPath))}`);
  if (args.strict && report.summary.errors > 0) process.exitCode = 1;
}
