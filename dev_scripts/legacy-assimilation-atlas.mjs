/**
 * dev_scripts/legacy-assimilation-atlas.mjs
 *
 * Classifies a legacy subtree for assimilation into Frame Conn.
 * This tool is static-only: it never imports or executes target code.
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
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".css", ".json", ".md"]);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "coverage", "backups", "patch-history"]);

const DISPOSITIONS = Object.freeze({
  PRESERVE: "PRESERVE",
  REUSE_EXISTING: "REUSE_EXISTING",
  MOVE_DOMAIN: "MOVE_DOMAIN",
  REWRITE_ADAPTER: "REWRITE_ADAPTER",
  REPLACE_UI: "REPLACE_UI",
  DELETE_SHELL: "DELETE_SHELL",
  COMPATIBILITY: "COMPATIBILITY",
  UNKNOWN: "UNKNOWN"
});

function normalizeSlashes(value) {
  return String(value).replaceAll("\\", "/");
}

function parseArgs(argv) {
  const args = {
    legacyRoot: "scripts/dm_features/sitreps/legacy-sitrep-module",
    targetRoot: "scripts/dm_features/sitreps",
    output: "legacy-assimilation-report.json",
    parityOutput: "legacy-parity.json",
    selfTest: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--legacy-root") args.legacyRoot = argv[++index];
    else if (token === "--target-root") args.targetRoot = argv[++index];
    else if (token === "--output") args.output = argv[++index];
    else if (token === "--parity-output") args.parityOutput = argv[++index];
    else if (token === "--no-parity") args.parityOutput = null;
    else if (token === "--self-test") args.selfTest = true;
    else if (token === "--help" || token === "-h") {
      console.log("Usage: node dev_scripts/legacy-assimilation-atlas.mjs [--legacy-root path] [--target-root path] [--output file] [--parity-output file|--no-parity] [--self-test]");
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
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) result.push(absolute);
  }

  return result.sort();
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function addFinding(findings, file, text, matchIndex, kind, disposition, reason, target = null, evidence = null) {
  findings.push({
    kind,
    disposition,
    file,
    line: lineNumber(text, matchIndex),
    reason,
    target,
    evidence
  });
}

function scanFile(relativeFile, text) {
  const findings = [];
  const isCss = relativeFile.endsWith(".css");
  const basename = path.basename(relativeFile).toLowerCase();

  const rules = [
    {
      kind: "runtime-hook",
      disposition: DISPOSITIONS.DELETE_SHELL,
      regex: /\bHooks\s*\.\s*(?:once|on)\s*\(\s*["'`](init|ready)["'`]/g,
      reason: "Legacy startup/lifecycle authority must be absorbed by Frame Conn runtime composition.",
      target: "scripts/runtime-orchestrator.js + registered feature lifecycle"
    },
    {
      kind: "hook-registration",
      disposition: DISPOSITIONS.REWRITE_ADAPTER,
      regex: /\bHooks\s*\.\s*on\s*\(\s*["'`]([^"'`]+)["'`]/g,
      reason: "Direct Foundry hook ownership should be expressed through the host feature/lifecycle boundary.",
      target: "registered feature lifecycle / foundry integration"
    },
    {
      kind: "global-api",
      disposition: DISPOSITIONS.COMPATIBILITY,
      regex: /\bgame\s*\.\s*([A-Za-z_$][\w$]*)\s*=/g,
      reason: "Legacy public globals require an explicit compatibility or public-API composition decision.",
      target: "runtime-orchestrator public API composition"
    },
    {
      kind: "prototype-patch",
      disposition: DISPOSITIONS.MOVE_DOMAIN,
      regex: /\.prototype\s*\.\s*([A-Za-z_$][\w$]*)\s*=/g,
      reason: "Prototype patching is Foundry-platform behavior and should not remain owned by a SITREP feature.",
      target: "scripts/foundry_features/"
    },
    {
      kind: "persistent-flag",
      disposition: DISPOSITIONS.COMPATIBILITY,
      regex: /\.(getFlag|setFlag|unsetFlag)\s*\(/g,
      reason: "Persisted Foundry flags require namespace/data-shape migration review before ownership changes.",
      target: "state namespace migration plan"
    },
    {
      kind: "settings",
      disposition: DISPOSITIONS.COMPATIBILITY,
      regex: /\bgame\s*\.\s*settings\s*\.\s*(register|get|set)\s*\(/g,
      reason: "Legacy settings are persisted API surface and require an explicit migration decision.",
      target: "state namespace migration plan"
    },
    {
      kind: "chat-output",
      disposition: DISPOSITIONS.REWRITE_ADAPTER,
      regex: /\bChatMessage\s*\.\s*create\s*\(/g,
      reason: "Chat semantics may survive, but direct Foundry output should pass through the host integration boundary.",
      target: "shared Foundry integration/output service"
    },
    {
      kind: "dialog-ui",
      disposition: DISPOSITIONS.REPLACE_UI,
      regex: /\bnew\s+Dialog\s*\(/g,
      reason: "Legacy interaction intent can survive, but presentation should move into the DM application architecture.",
      target: "DM UI / SITREP presentation components"
    },
    {
      kind: "dom-ui",
      disposition: DISPOSITIONS.REPLACE_UI,
      regex: /\bdocument\s*\.\s*(?:createElement|getElementById|querySelector)\s*\(/g,
      reason: "Standalone DOM/HUD composition should be replaced by the host DM UI surface.",
      target: "DM UI / SITREP presentation components"
    },
    {
      kind: "window-listener",
      disposition: DISPOSITIONS.DELETE_SHELL,
      regex: /\bwindow\s*\.\s*addEventListener\s*\(/g,
      reason: "Application-shell event wiring should be owned by the host lifecycle/runtime.",
      target: "registered feature lifecycle"
    },
    {
      kind: "spatial-adjacency",
      disposition: DISPOSITIONS.REUSE_EXISTING,
      regex: /\b(?:tokensAreAdjacent|tokenBoundsInGridSpaces|testAdjacency)\b/g,
      reason: "Frame Conn already has shared targeting/spatial ownership; legacy spatial rules should delegate there.",
      target: "scripts/player_features/feature_targeting_spatial/ or shared targeting-spatial service"
    },
    {
      kind: "region-spatial",
      disposition: DISPOSITIONS.REWRITE_ADAPTER,
      regex: /\b(?:testInsideRegion|regions\?\.has|scene\?\.regions)\b/g,
      reason: "Region queries are useful but should be isolated behind a shared Foundry/spatial boundary.",
      target: "targeting/spatial or Foundry integration service"
    },
    {
      kind: "sitrep-domain",
      disposition: DISPOSITIONS.PRESERVE,
      regex: /\b(?:evaluateSitrep|calculateState|gauntletControlWeight|recordReconScan|resolveExtractionObjective|resolveEscortObjective|holdout|recon|escort|extraction|gauntlet)\b/gi,
      reason: "This appears to encode SITREP-specific domain behavior that should survive decomposition.",
      target: "scripts/dm_features/sitreps/"
    }
  ];

  for (const rule of rules) {
    rule.regex.lastIndex = 0;
    let match;
    while ((match = rule.regex.exec(text))) {
      addFinding(findings, relativeFile, text, match.index, rule.kind, rule.disposition, rule.reason, rule.target, match[0].replace(/\s+/g, " ").trim());
      if (match[0].length === 0) rule.regex.lastIndex += 1;
    }
  }

  if (isCss || basename.includes("ui-boilerplate") || basename.includes("tracker.css")) {
    findings.push({
      kind: "presentation-file",
      disposition: DISPOSITIONS.REPLACE_UI,
      file: relativeFile,
      line: 1,
      reason: "Legacy standalone presentation should be re-expressed in the DM UI architecture.",
      target: "styles/ui_dm/ or future SITREP DM UI components",
      evidence: basename
    });
  }

  if (basename.endsWith(".bak")) {
    findings.push({
      kind: "backup-artifact",
      disposition: DISPOSITIONS.DELETE_SHELL,
      file: relativeFile,
      line: 1,
      reason: "Legacy backup artifacts should not participate in the integrated source tree.",
      target: null,
      evidence: basename
    });
  }

  return findings;
}

function summarizeFile(file, findings) {
  const priority = [
    DISPOSITIONS.DELETE_SHELL,
    DISPOSITIONS.MOVE_DOMAIN,
    DISPOSITIONS.REUSE_EXISTING,
    DISPOSITIONS.COMPATIBILITY,
    DISPOSITIONS.REPLACE_UI,
    DISPOSITIONS.REWRITE_ADAPTER,
    DISPOSITIONS.PRESERVE,
    DISPOSITIONS.UNKNOWN
  ];
  const counts = Object.fromEntries(Object.values(DISPOSITIONS).map(value => [value, 0]));
  for (const finding of findings) counts[finding.disposition] += 1;
  const primaryDisposition = priority.find(value => counts[value] > 0) ?? DISPOSITIONS.UNKNOWN;
  return { file, primaryDisposition, counts, findingCount: findings.length };
}

function buildParityLedger(report) {
  const behaviors = [];
  const seen = new Set();
  for (const finding of report.findings) {
    if (finding.disposition !== DISPOSITIONS.PRESERVE) continue;
    const key = `${finding.file}:${finding.kind}:${finding.evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    behaviors.push({
      legacy_behavior: finding.evidence,
      legacy_source: `${finding.file}:${finding.line}`,
      new_owner: finding.target,
      status: "NOT_MIGRATED",
      verification: []
    });
  }
  return {
    schema_version: 1,
    generated_by: `legacy-assimilation-atlas ${SCRIPT_VERSION}`,
    legacy_root: report.legacyRoot,
    target_root: report.targetRoot,
    statuses: ["NOT_MIGRATED", "PARTIALLY_MIGRATED", "MIGRATED_UNVERIFIED", "VERIFIED", "INTENTIONALLY_DROPPED"],
    behaviors
  };
}

function runAnalysis(repositoryRoot, legacyRootRelative, targetRootRelative) {
  const legacyRoot = path.resolve(repositoryRoot, legacyRootRelative);
  const files = collectFiles(legacyRoot);
  if (files.length === 0) throw new Error(`No analyzable files found under ${legacyRootRelative}`);

  const findings = [];
  const fileSummaries = [];
  for (const absolute of files) {
    const relative = normalizeSlashes(path.relative(repositoryRoot, absolute));
    const text = fs.readFileSync(absolute, "utf8");
    const fileFindings = scanFile(relative, text);
    findings.push(...fileFindings);
    fileSummaries.push(summarizeFile(relative, fileFindings));
  }

  const dispositionCounts = Object.fromEntries(Object.values(DISPOSITIONS).map(value => [value, 0]));
  for (const finding of findings) dispositionCounts[finding.disposition] += 1;

  return {
    schema_version: 1,
    tool: "legacy-assimilation-atlas",
    version: SCRIPT_VERSION,
    legacyRoot: normalizeSlashes(legacyRootRelative),
    targetRoot: normalizeSlashes(targetRootRelative),
    summary: {
      files: files.length,
      findings: findings.length,
      dispositionCounts,
      unknownFiles: fileSummaries.filter(item => item.primaryDisposition === DISPOSITIONS.UNKNOWN).length
    },
    files: fileSummaries,
    findings
  };
}

function printReport(report) {
  console.log("Frame Conn Legacy Assimilation Atlas");
  console.log(`Legacy root: ${report.legacyRoot}`);
  console.log(`Target root: ${report.targetRoot}`);
  console.log(`${report.summary.files} files | ${report.summary.findings} findings`);
  console.log("");
  console.log("Disposition counts:");
  for (const [name, count] of Object.entries(report.summary.dispositionCounts)) {
    if (count > 0) console.log(`  ${name}: ${count}`);
  }
  console.log("");
  console.log("File dispositions:");
  for (const file of report.files) console.log(`  ${file.primaryDisposition.padEnd(16)} ${file.file}`);
}

function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-conn-assimilation-"));
  const legacy = path.join(root, "legacy");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "program.js"), 'Hooks.once("ready", () => { game.oldApi = {}; });\n');
  fs.writeFileSync(path.join(legacy, "domain.js"), 'export function evaluateSitrep(){ return combat.getFlag("old", "sitrep"); }\n');
  const report = runAnalysis(root, "legacy", "target");
  const dispositions = new Set(report.findings.map(item => item.disposition));
  if (!dispositions.has(DISPOSITIONS.DELETE_SHELL) || !dispositions.has(DISPOSITIONS.COMPATIBILITY) || !dispositions.has(DISPOSITIONS.PRESERVE)) {
    throw new Error("Self-test failed: expected assimilation dispositions were not detected.");
  }
  fs.rmSync(root, { recursive: true, force: true });
  console.log("Legacy Assimilation Atlas self-test PASSED");
}

const args = parseArgs(process.argv);
if (args.selfTest) {
  selfTest();
} else {
  const report = runAnalysis(REPOSITORY_ROOT, args.legacyRoot, args.targetRoot);
  const outputPath = path.resolve(REPOSITORY_ROOT, args.output);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  if (args.parityOutput) {
    const parityPath = path.resolve(REPOSITORY_ROOT, args.parityOutput);
    fs.writeFileSync(parityPath, `${JSON.stringify(buildParityLedger(report), null, 2)}\n`);
  }
  printReport(report);
  console.log(`\nReport: ${normalizeSlashes(path.relative(REPOSITORY_ROOT, outputPath))}`);
  if (args.parityOutput) console.log(`Parity ledger: ${normalizeSlashes(args.parityOutput)}`);
}
