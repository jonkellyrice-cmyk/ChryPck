/**
 * dev_scripts/domain-decomposer-executor.mjs
 *
 * Frame Conn Domain Decomposer — execution phase.
 *
 * Consumes an explicitly approved domain-decomposer plan. It does not invent a
 * new decomposition. It compiles dependency-closed symbol extractions into the
 * existing GitHub FilePatcher contract, dry-runs that contract, and optionally
 * applies it to the working tree. The authoritative FilePatcher patch file is
 * restored after execution.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_FILE);
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_PLAN = path.join(SCRIPT_DIRECTORY, "domain-decomposer-plan.json");
const DEFAULT_PATCH_OUTPUT = path.join(SCRIPT_DIRECTORY, "domain-decomposer-generated-patch.json");
const AUTHORITATIVE_PATCH = path.join(SCRIPT_DIRECTORY, "github-filepatcher.json");
const FILEPATCHER = path.join(SCRIPT_DIRECTORY, "github-filepatcher.mjs");

function normalizeSlashes(value) { return String(value).replaceAll("\\", "/"); }
function repoRelative(absolute) { return normalizeSlashes(path.relative(REPOSITORY_ROOT, absolute)); }
function sha256(text) { return crypto.createHash("sha256").update(text, "utf8").digest("hex"); }

function parseArgs(argv) {
  const args = { plan: DEFAULT_PLAN, patch: DEFAULT_PATCH_OUTPUT, apply: false, dryRun: true, selfTest: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--plan") args.plan = path.resolve(REPOSITORY_ROOT, argv[++i]);
    else if (token === "--patch-output") args.patch = path.resolve(REPOSITORY_ROOT, argv[++i]);
    else if (token === "--apply") { args.apply = true; args.dryRun = false; }
    else if (token === "--dry-run") { args.apply = false; args.dryRun = true; }
    else if (token === "--self-test") args.selfTest = true;
    else if (token === "--help" || token === "-h") {
      console.log("Usage: node dev_scripts/domain-decomposer-executor.mjs [--plan file] [--patch-output file] [--dry-run|--apply] [--self-test]");
      process.exit(0);
    }
  }
  return args;
}

function stripCommentsAndStrings(text) {
  let out = "";
  let mode = "code";
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];
    if (mode === "line") { if (c === "\n") { mode = "code"; out += "\n"; } else out += " "; continue; }
    if (mode === "block") { if (c === "*" && n === "/") { out += "  "; i += 1; mode = "code"; } else out += c === "\n" ? "\n" : " "; continue; }
    if (mode === "string") { if (c === "\\") { out += "  "; i += 1; continue; } if (c === quote) { mode = "code"; quote = null; out += " "; } else out += c === "\n" ? "\n" : " "; continue; }
    if (c === "/" && n === "/") { out += "  "; i += 1; mode = "line"; continue; }
    if (c === "/" && n === "*") { out += "  "; i += 1; mode = "block"; continue; }
    if (c === '"' || c === "'" || c === "`") { mode = "string"; quote = c; out += " "; continue; }
    out += c;
  }
  return out;
}

function braceDepthAt(text, index) {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") depth -= 1;
  }
  return depth;
}

function findMatchingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

function findStatementEnd(text, start) {
  let brace = 0, paren = 0, bracket = 0;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (c === "{") brace += 1; else if (c === "}") brace -= 1;
    else if (c === "(") paren += 1; else if (c === ")") paren -= 1;
    else if (c === "[") bracket += 1; else if (c === "]") bracket -= 1;
    else if (c === ";" && brace === 0 && paren === 0 && bracket === 0) return i + 1;
  }
  return text.length;
}

function extractTopLevelSymbols(text) {
  const sanitized = stripCommentsAndStrings(text);
  const symbols = [];
  const regex = /(?:^|\n)([ \t]*)(export\s+)?(?:default\s+)?(?:(async)\s+)?(function|class|const|let|var)\s+([A-Za-z_$][\w$]*)\b/g;
  let match;
  while ((match = regex.exec(sanitized))) {
    const start = match.index + (match[0].startsWith("\n") ? 1 : 0);
    if (braceDepthAt(sanitized, start) !== 0) continue;
    const kind = match[4];
    let end;
    if (kind === "function" || kind === "class") {
      const open = sanitized.indexOf("{", regex.lastIndex);
      if (open < 0) continue;
      const close = findMatchingBrace(sanitized, open);
      if (close < 0) continue;
      end = close + 1;
      while (end < sanitized.length && /[ \t]/.test(sanitized[end])) end += 1;
      if (sanitized[end] === ";") end += 1;
    } else end = findStatementEnd(sanitized, regex.lastIndex);
    symbols.push({ name: match[5], kind, exported: Boolean(match[2]), start, end, text: text.slice(start, end) });
  }
  return symbols.sort((a, b) => a.start - b.start);
}

function importedLocalNames(clause) {
  if (!clause) return [];
  const names = new Set();
  const named = clause.match(/\{([\s\S]*?)\}/);
  if (named) {
    for (const raw of named[1].split(",")) {
      const entry = raw.trim();
      if (!entry) continue;
      const alias = entry.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      names.add(alias ? alias[2] : entry);
    }
  }
  const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespace) names.add(namespace[1]);
  const leadingDefault = clause
    .replace(/\{[\s\S]*?\}/, "")
    .replace(/\*\s+as\s+[A-Za-z_$][\w$]*/, "")
    .replace(/,/g, "")
    .trim();
  if (/^[A-Za-z_$][\w$]*$/.test(leadingDefault)) names.add(leadingDefault);
  return [...names];
}

function extractImports(text) {
  const result = [];
  const regex = /^[ \t]*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;?|^[ \t]*import\s+["']([^"']+)["']\s*;?/gm;
  let match;
  while ((match = regex.exec(text))) {
    const clause = match[1] ?? null;
    result.push({
      clause,
      source: match[2] ?? match[3],
      text: match[0],
      sideEffectOnly: clause === null,
      localNames: importedLocalNames(clause)
    });
  }
  return result;
}

function importIsRequiredByBody(importRecord, body) {
  if (importRecord.sideEffectOnly) return false;
  const sanitizedBody = stripCommentsAndStrings(body);
  return importRecord.localNames.some(name => {
    const escaped = name.replace(/[$]/g, "\\$");
    return new RegExp(`\\b${escaped}\\b`).test(sanitizedBody);
  });
}

function references(text, candidateNames) {
  const sanitized = stripCommentsAndStrings(text);
  const refs = new Set();
  for (const name of candidateNames) {
    const escaped = name.replace(/[$]/g, "\\$");
    if (new RegExp(`\\b${escaped}\\b`).test(sanitized)) refs.add(name);
  }
  return refs;
}

function ensureExported(declaration) {
  if (/^\s*export\b/.test(declaration)) return declaration;
  return declaration.replace(/^(\s*)/, "$1export ");
}

function relativeImport(fromFile, toFile) {
  let rel = normalizeSlashes(path.relative(path.dirname(fromFile), toFile));
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

function rewriteImportForNewLocation(importText, originalFile, targetFile) {
  return importText.replace(/from\s+(["'])([^"']+)\1/, (whole, quote, source) => {
    if (!source.startsWith(".")) return whole;
    const absoluteDependency = path.resolve(path.dirname(originalFile), source);
    let rel = normalizeSlashes(path.relative(path.dirname(targetFile), absoluteDependency));
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return `from ${quote}${rel}${quote}`;
  }).replace(/^([ \t]*import\s+)(["'])([^"']+)\2/m, (whole, prefix, quote, source) => {
    if (!source.startsWith(".")) return whole;
    const absoluteDependency = path.resolve(path.dirname(originalFile), source);
    let rel = normalizeSlashes(path.relative(path.dirname(targetFile), absoluteDependency));
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return `${prefix}${quote}${rel}${quote}`;
  });
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error("Decomposition plan must be an object.");
  if (plan.behavior_change_allowed !== false) throw new Error("Executor requires behavior_change_allowed=false.");
  if (plan.approved !== true) throw new Error("Top-level decomposition plan is not approved.");
  if (!Array.isArray(plan.candidates) || !plan.candidates.length) throw new Error("Approved plan contains no decomposition candidates.");
  for (const candidate of plan.candidates) {
    if (candidate.execution?.approved !== true) throw new Error(`Candidate is not approved for execution: ${candidate.source}`);
    if (candidate.execution?.mode !== "symbol_extract") throw new Error(`Unsupported execution mode for ${candidate.source}: ${candidate.execution?.mode}`);
    if (!Array.isArray(candidate.units) || !candidate.units.length) throw new Error(`Candidate has no units: ${candidate.source}`);
  }
}

function compileCandidate(candidate) {
  const sourceFile = path.resolve(REPOSITORY_ROOT, candidate.source);
  if (!fs.existsSync(sourceFile)) throw new Error(`Source file does not exist: ${candidate.source}`);
  const sourceText = fs.readFileSync(sourceFile, "utf8");
  const allSymbols = extractTopLevelSymbols(sourceText);
  const symbolMap = new Map(allSymbols.map(symbol => [symbol.name, symbol]));
  const imports = extractImports(sourceText);
  const assignments = new Map();
  const extractUnits = candidate.units.filter(unit => unit.action === "extract");
  const nonExecutable = candidate.units.filter(unit => !["extract", "retain"].includes(unit.action));
  if (nonExecutable.length) throw new Error(`Executor v1 cannot auto-execute actions ${[...new Set(nonExecutable.map(unit => unit.action))].join(", ")} for ${candidate.source}; resolve those through existing migration tools before approval.`);

  for (const unit of extractUnits) {
    if (!unit.target || !Array.isArray(unit.symbols) || !unit.symbols.length) throw new Error(`Malformed extraction unit ${unit.id ?? "<unnamed>"} in ${candidate.source}`);
    for (const name of unit.symbols) {
      if (!symbolMap.has(name)) throw new Error(`Planned symbol ${name} not found in ${candidate.source}`);
      if (assignments.has(name)) throw new Error(`Symbol ${name} assigned to multiple extraction units in ${candidate.source}`);
      assignments.set(name, unit);
    }
  }

  const allTopLevelNames = new Set(allSymbols.map(symbol => symbol.name));
  const extractedNames = new Set(assignments.keys());
  const retainedNames = new Set([...allTopLevelNames].filter(name => !extractedNames.has(name)));

  for (const unit of extractUnits) {
    const body = unit.symbols.map(name => symbolMap.get(name).text).join("\n");
    const refs = references(body, allTopLevelNames);
    const forbidden = [...refs].filter(name => retainedNames.has(name));
    if (forbidden.length) {
      throw new Error(`Unit ${unit.id} in ${candidate.source} is not dependency-closed; it reaches retained top-level symbol(s): ${forbidden.join(", ")}. Move those dependencies into an extracted/shared unit or revise the seam.`);
    }
  }

  const targetFiles = new Map();
  for (const unit of extractUnits) {
    const targetAbs = path.resolve(REPOSITORY_ROOT, unit.target);
    if (fs.existsSync(targetAbs)) throw new Error(`Extraction target already exists: ${unit.target}`);
    const ownNames = new Set(unit.symbols);
    const body = unit.symbols.map(name => ensureExported(symbolMap.get(name).text.trim())).join("\n\n");
    const crossImports = [];
    const refs = references(body, extractedNames);
    const byTarget = new Map();
    for (const ref of refs) {
      if (ownNames.has(ref)) continue;
      const other = assignments.get(ref);
      if (!other || other.target === unit.target) continue;
      if (!byTarget.has(other.target)) byTarget.set(other.target, []);
      byTarget.get(other.target).push(ref);
    }
    for (const [otherTarget, names] of byTarget.entries()) {
      crossImports.push(`import {\n  ${[...new Set(names)].sort().join(",\n  ")}\n} from ${JSON.stringify(relativeImport(targetAbs, path.resolve(REPOSITORY_ROOT, otherTarget)))};`);
    }

    const copiedImports = imports
      .filter(item => importIsRequiredByBody(item, body))
      .map(item => rewriteImportForNewLocation(item.text, sourceFile, targetAbs));
    const header = `/**\n * Extracted by Frame Conn Domain Decomposer from ${candidate.source}.\n * Structural decomposition only; behavior and public contracts must remain unchanged.\n */`;
    targetFiles.set(unit.target, `${header}\n\n${[...copiedImports, ...crossImports].join("\n")}\n\n${body}\n`);
  }

  const ranges = [...extractedNames].map(name => symbolMap.get(name)).sort((a, b) => b.start - a.start);
  let rewrittenSource = sourceText;
  for (const symbol of ranges) rewrittenSource = `${rewrittenSource.slice(0, symbol.start)}${rewrittenSource.slice(symbol.end)}`;

  const sourceImports = [];
  for (const unit of extractUnits) {
    const names = unit.symbols.slice().sort();
    const targetAbs = path.resolve(REPOSITORY_ROOT, unit.target);
    const rel = relativeImport(sourceFile, targetAbs);
    sourceImports.push(`import {\n  ${names.join(",\n  ")}\n} from ${JSON.stringify(rel)};`);
    const originallyExported = names.filter(name => symbolMap.get(name).exported);
    if (originallyExported.length) sourceImports.push(`export {\n  ${originallyExported.join(",\n  ")}\n} from ${JSON.stringify(rel)};`);
  }

  const insertionPoint = (() => {
    const importMatches = [...rewrittenSource.matchAll(/^[ \t]*import[\s\S]*?;\s*$/gm)];
    return importMatches.length ? importMatches[importMatches.length - 1].index + importMatches[importMatches.length - 1][0].length : 0;
  })();
  const insertion = `${insertionPoint ? "\n" : ""}${sourceImports.join("\n\n")}\n`;
  rewrittenSource = `${rewrittenSource.slice(0, insertionPoint)}${insertion}${rewrittenSource.slice(insertionPoint)}`.replace(/\n{4,}/g, "\n\n\n");

  return { sourceFile: candidate.source, sourceBefore: sourceText, sourceAfter: rewrittenSource, targetFiles };
}

function compilePlan(plan) {
  const compiled = plan.candidates.map(compileCandidate);
  const operations = [];
  const allowedPaths = new Set();
  for (const item of compiled) {
    allowedPaths.add(item.sourceFile);
    operations.push({ type: "replace_file", path: item.sourceFile, expected_sha256: sha256(item.sourceBefore), content: item.sourceAfter });
    for (const [target, content] of item.targetFiles.entries()) {
      allowedPaths.add(target);
      operations.push({ type: "create_file", path: target, content });
    }
  }
  return {
    schema_version: 2,
    id: "domain-decomposer-approved-plan",
    description: "Execute an explicitly approved structural domain decomposition. No behavioral change is permitted.",
    policy: { max_files_changed: allowedPaths.size, allowed_paths: [...allowedPaths].sort() },
    operations
  };
}

function runFilePatcher(patch, apply) {
  const backupExists = fs.existsSync(AUTHORITATIVE_PATCH);
  const backup = backupExists ? fs.readFileSync(AUTHORITATIVE_PATCH, "utf8") : null;
  fs.writeFileSync(AUTHORITATIVE_PATCH, `${JSON.stringify(patch, null, 2)}\n`);
  try {
    const dry = spawnSync(process.execPath, [FILEPATCHER, "--dry-run"], { cwd: REPOSITORY_ROOT, stdio: "inherit" });
    if (dry.status !== 0) throw new Error(`GitHub FilePatcher dry-run failed with exit code ${dry.status}.`);
    if (apply) {
      const real = spawnSync(process.execPath, [FILEPATCHER], { cwd: REPOSITORY_ROOT, stdio: "inherit" });
      if (real.status !== 0) throw new Error(`GitHub FilePatcher apply failed with exit code ${real.status}.`);
    }
  } finally {
    if (backupExists) fs.writeFileSync(AUTHORITATIVE_PATCH, backup);
    else fs.rmSync(AUTHORITATIVE_PATCH, { force: true });
  }
}

function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frame-conn-domain-executor-"));
  const source = `import { thing } from \"./dep.js\";\n\nexport function alpha() { return beta() + thing; }\nfunction beta() { return 1; }\n\nexport function gamma() { return 3; }\n`;
  const symbols = extractTopLevelSymbols(source);
  if (symbols.length !== 3) throw new Error(`self-test expected 3 symbols, got ${symbols.length}`);
  const refs = references(symbols[0].text, new Set(symbols.map(symbol => symbol.name)));
  if (!refs.has("beta")) throw new Error("self-test expected alpha -> beta dependency");
  const exported = ensureExported(symbols[1].text);
  if (!/^export\s+function\s+beta/.test(exported)) throw new Error("self-test expected export insertion");
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("Domain Decomposer executor self-test passed.");
}

const args = parseArgs(process.argv);
if (args.selfTest) { runSelfTest(); process.exit(0); }
if (!fs.existsSync(args.plan)) throw new Error(`Decomposition plan not found: ${repoRelative(args.plan)}`);
const plan = JSON.parse(fs.readFileSync(args.plan, "utf8"));
validatePlan(plan);
const patch = compilePlan(plan);
fs.writeFileSync(args.patch, `${JSON.stringify(patch, null, 2)}\n`);
console.log(`Compiled approved decomposition into ${repoRelative(args.patch)}.`);
console.log(`${patch.operations.length} deterministic FilePatcher operation(s) across ${patch.policy.allowed_paths.length} files.`);
runFilePatcher(patch, args.apply);
console.log(args.apply ? "Approved decomposition applied to the working tree." : "Approved decomposition dry-run passed; working tree unchanged.");
