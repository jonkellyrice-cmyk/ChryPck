/**
 * dev_scripts/domain-decomposer.mjs
 *
 * Frame Conn Domain Decomposer — planning phase.
 *
 * LOC is a pressure signal, never the decomposition criterion. The planner
 * combines size, top-level symbol structure, semantic naming, section seams,
 * coupling, side-effect families, and explicit architectural policy to decide
 * whether a file should be decomposed and along which domain boundaries.
 *
 * This tool is static-only. It never imports or executes application code.
 */

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
const DEFAULT_POLICY_FILE = path.join(SCRIPT_DIRECTORY, "domain-decomposer-policy.json");
const DEFAULT_PLAN_FILE = path.join(SCRIPT_DIRECTORY, "domain-decomposer-plan.json");
const DEFAULT_REPORT_FILE = path.join(REPOSITORY_ROOT, "domain-decomposer-report.json");
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const IGNORED_DIRECTORIES = new Set([".git", ".github", "node_modules", "dist", "build", "coverage", "backups", "patch-history", "dev_scripts"]);
const DEFAULT_SCAN_ROOTS = ["scripts", "styles", "action_economy", "actor_owned_feature_registry", "execution_transaction", "lifecycle_service", "native_adapter", "resource_service", "semantic_event_bus", "semantic_execution_context", "system_bridge", "targeting-spatial_service"];

const STOP_TOKENS = new Set([
  "a", "an", "and", "api", "apply", "build", "by", "create", "current", "data", "do", "feature",
  "for", "from", "get", "handle", "handler", "has", "in", "is", "make", "module", "new", "of", "on",
  "or", "read", "resolve", "set", "state", "the", "to", "update", "value", "with", "write", "frame", "conn"
]);

const EFFECT_PATTERNS = [
  ["foundry-hooks", /\bHooks\s*\.\s*(?:on|once|off|call|callAll)\s*\(/g],
  ["foundry-documents", /\.(?:update|setFlag|unsetFlag|createEmbeddedDocuments|updateEmbeddedDocuments|deleteEmbeddedDocuments)\s*\(/g],
  ["chat-output", /\bChatMessage\s*\.\s*create\s*\(/g],
  ["notifications", /\bui\s*\.\s*notifications\s*\./g],
  ["browser-events", /\b(?:window|document)\s*\.\s*addEventListener\s*\(/g],
  ["global-api", /\b(?:game|globalThis)\s*\.\s*[A-Za-z_$][\w$]*\s*=/g],
  ["prototype-patch", /\.prototype\s*\.\s*[A-Za-z_$][\w$]*\s*=/g],
  ["storage", /\b(?:localStorage|sessionStorage)\s*\./g]
];

function normalizeSlashes(value) {
  return String(value).replaceAll("\\", "/");
}

function repoRelative(absolutePath) {
  return normalizeSlashes(path.relative(REPOSITORY_ROOT, absolutePath));
}

function parseArgs(argv) {
  const args = {
    files: [],
    roots: [],
    policy: DEFAULT_POLICY_FILE,
    output: DEFAULT_REPORT_FILE,
    plan: DEFAULT_PLAN_FILE,
    runSuite: true,
    minPressureLines: null,
    selfTest: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file") args.files.push(argv[++i]);
    else if (token === "--root") args.roots.push(argv[++i]);
    else if (token === "--policy") args.policy = path.resolve(REPOSITORY_ROOT, argv[++i]);
    else if (token === "--output") args.output = path.resolve(REPOSITORY_ROOT, argv[++i]);
    else if (token === "--plan") args.plan = path.resolve(REPOSITORY_ROOT, argv[++i]);
    else if (token === "--no-suite") args.runSuite = false;
    else if (token === "--min-lines") args.minPressureLines = Number(argv[++i]);
    else if (token === "--self-test") args.selfTest = true;
    else if (token === "--help" || token === "-h") {
      console.log("Usage: node dev_scripts/domain-decomposer.mjs [--file path ...] [--root path ...] [--policy file] [--output file] [--plan file] [--no-suite] [--min-lines N] [--self-test]");
      process.exit(0);
    }
  }

  return args;
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadPolicy(policyFile) {
  const raw = readJson(policyFile, {}) ?? {};
  return {
    schema_version: raw.schema_version ?? 1,
    loc_pressure: {
      ideal_max: raw.loc_pressure?.ideal_max ?? 500,
      moderate: raw.loc_pressure?.moderate ?? 800,
      high: raw.loc_pressure?.high ?? 1200
    },
    protected: Array.isArray(raw.protected) ? raw.protected : [],
    role_rules: Array.isArray(raw.role_rules) ? raw.role_rules : []
  };
}

function collectJavaScriptFiles(root) {
  if (!fs.existsSync(root)) return [];
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...collectJavaScriptFiles(absolute));
    else if (entry.isFile() && JS_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) output.push(absolute);
  }
  return output;
}

function resolveTargets(args) {
  const explicit = args.files.map(value => path.resolve(REPOSITORY_ROOT, value));
  const roots = (args.roots.length ? args.roots : DEFAULT_SCAN_ROOTS)
    .map(value => path.resolve(REPOSITORY_ROOT, value))
    .flatMap(collectJavaScriptFiles);
  return [...new Set([...explicit, ...roots])]
    .filter(file => fs.existsSync(file) && fs.statSync(file).isFile())
    .sort();
}

function stripCommentsAndStrings(text) {
  let out = "";
  let mode = "code";
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += "\n"; } else out += " ";
      continue;
    }
    if (mode === "block") {
      if (c === "*" && n === "/") { out += "  "; i += 1; mode = "code"; } else out += c === "\n" ? "\n" : " ";
      continue;
    }
    if (mode === "string") {
      if (c === "\\") { out += "  "; i += 1; continue; }
      if (c === quote) { mode = "code"; quote = null; out += " "; } else out += c === "\n" ? "\n" : " ";
      continue;
    }
    if (c === "/" && n === "/") { out += "  "; i += 1; mode = "line"; continue; }
    if (c === "/" && n === "*") { out += "  "; i += 1; mode = "block"; continue; }
    if (c === '"' || c === "'" || c === "`") { mode = "string"; quote = c; out += " "; continue; }
    out += c;
  }
  return out;
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function braceDepthAt(sanitized, index) {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (sanitized[i] === "{") depth += 1;
    else if (sanitized[i] === "}") depth -= 1;
  }
  return depth;
}

function findMatchingBrace(sanitized, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < sanitized.length; i += 1) {
    if (sanitized[i] === "{") depth += 1;
    else if (sanitized[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findStatementEnd(sanitized, startIndex) {
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  for (let i = startIndex; i < sanitized.length; i += 1) {
    const c = sanitized[i];
    if (c === "{") brace += 1;
    else if (c === "}") brace -= 1;
    else if (c === "(") paren += 1;
    else if (c === ")") paren -= 1;
    else if (c === "[") bracket += 1;
    else if (c === "]") bracket -= 1;
    else if (c === ";" && brace === 0 && paren === 0 && bracket === 0) return i + 1;
  }
  return sanitized.length;
}

function extractTopLevelSymbols(text) {
  const sanitized = stripCommentsAndStrings(text);
  const candidates = [];
  const regex = /(?:^|\n)([ \t]*)(export\s+)?(?:default\s+)?(?:(async)\s+)?(function|class|const|let|var)\s+([A-Za-z_$][\w$]*)\b/g;
  let match;
  while ((match = regex.exec(sanitized))) {
    const declarationStart = match.index + (match[0].startsWith("\n") ? 1 : 0);
    if (braceDepthAt(sanitized, declarationStart) !== 0) continue;
    const kind = match[4];
    const name = match[5];
    let end;
    if (kind === "function" || kind === "class") {
      const open = sanitized.indexOf("{", regex.lastIndex);
      if (open < 0) continue;
      const close = findMatchingBrace(sanitized, open);
      if (close < 0) continue;
      end = close + 1;
      while (end < sanitized.length && /[ \t]/.test(sanitized[end])) end += 1;
      if (sanitized[end] === ";") end += 1;
    } else {
      end = findStatementEnd(sanitized, regex.lastIndex);
    }
    candidates.push({
      name,
      kind,
      exported: Boolean(match[2]),
      start: declarationStart,
      end,
      startLine: lineNumber(text, declarationStart),
      endLine: lineNumber(text, end),
      text: text.slice(declarationStart, end)
    });
  }
  return candidates.sort((a, b) => a.start - b.start);
}

function extractImports(text) {
  const imports = [];
  const regex = /^[ \t]*import\s+[\s\S]*?\s+from\s+["']([^"']+)["']\s*;?|^[ \t]*import\s+["']([^"']+)["']\s*;?/gm;
  let match;
  while ((match = regex.exec(text))) {
    imports.push({ source: match[1] ?? match[2], text: match[0], start: match.index, end: regex.lastIndex });
  }
  return imports;
}

function splitTokens(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.\/]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .map(token => token.replace(/[^a-z0-9]/g, ""))
    .filter(token => token.length >= 3 && !STOP_TOKENS.has(token));
}

function extractSectionHeadings(text) {
  const headings = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const next = lines[i + 1]?.trim() ?? "";
    const prev = lines[i - 1]?.trim() ?? "";
    const decorative = /={5,}|-{5,}/;
    if (line.startsWith("//")) {
      const value = line.replace(/^\/\/\s*/, "").trim();
      if (value.length >= 4 && value.length <= 90 && (decorative.test(prev) || decorative.test(next))) headings.push({ line: i + 1, value });
    }
    if (line.startsWith("/*") || line.startsWith("*")) {
      const value = line.replace(/^\/\*+\s*/, "").replace(/^\*\s*/, "").replace(/\*\/$/, "").trim();
      if (value.length >= 4 && value.length <= 90 && !decorative.test(value) && (decorative.test(prev) || decorative.test(next))) headings.push({ line: i + 1, value });
    }
  }
  return headings;
}

function headingForSymbol(symbol, headings) {
  let found = null;
  for (const heading of headings) {
    if (heading.line <= symbol.startLine) found = heading;
    else break;
  }
  return found?.value ?? null;
}

function countEffects(text) {
  const counts = {};
  for (const [id, regex] of EFFECT_PATTERNS) {
    regex.lastIndex = 0;
    counts[id] = [...text.matchAll(regex)].length;
  }
  return counts;
}

function countLines(text) {
  if (!text.length) return 0;
  return text.split("\n").length;
}

function locPressure(lines, policy) {
  const { ideal_max: ideal, moderate, high } = policy.loc_pressure;
  if (lines <= ideal) return { level: 0, label: "minimal" };
  if (lines <= moderate) return { level: 2, label: "moderate" };
  if (lines <= high) return { level: 4, label: "high" };
  return { level: 5, label: "very-high" };
}

function matchGlobish(relativeFile, pattern) {
  const normalized = normalizeSlashes(relativeFile);
  const escaped = normalizeSlashes(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "§§")
    .replaceAll("*", "[^/]*")
    .replaceAll("§§", ".*");
  return new RegExp(`^${escaped}$`).test(normalized);
}

function policyRole(relativeFile, policy) {
  for (const entry of policy.protected) {
    if (entry.path && normalizeSlashes(entry.path) === relativeFile) return { role: entry.role ?? "protected", decompose: entry.decompose !== false, reason: entry.reason ?? null, source: "path-policy" };
    if (entry.pattern && matchGlobish(relativeFile, entry.pattern)) return { role: entry.role ?? "protected", decompose: entry.decompose !== false, reason: entry.reason ?? null, source: "pattern-policy" };
  }
  for (const rule of policy.role_rules) {
    if (rule.pattern && matchGlobish(relativeFile, rule.pattern)) return { role: rule.role ?? "unknown", decompose: rule.decompose !== false, reason: rule.reason ?? null, source: "role-rule" };
  }
  const base = path.basename(relativeFile).toLowerCase();
  if (base.includes("runtime-orchestrator")) return { role: "composition_root", decompose: false, reason: "Application-wide composition roots intentionally converge many domains.", source: "heuristic" };
  if (base.includes("registry")) return { role: "registry", decompose: false, reason: "Registries intentionally aggregate declarations and should be split only by explicit policy.", source: "heuristic" };
  return { role: "implementation", decompose: true, reason: null, source: "default" };
}

function symbolReferenceGraph(symbols) {
  const names = new Set(symbols.map(symbol => symbol.name));
  const graph = new Map(symbols.map(symbol => [symbol.name, new Set()]));
  for (const symbol of symbols) {
    const sanitized = stripCommentsAndStrings(symbol.text);
    for (const name of names) {
      if (name === symbol.name) continue;
      if (new RegExp(`\\b${name.replace(/[$]/g, "\\$")}\\b`).test(sanitized)) graph.get(symbol.name).add(name);
    }
  }
  return graph;
}

function deriveDomainKey(symbol, heading) {
  if (heading) {
    const tokens = splitTokens(heading);
    if (tokens.length) return tokens.slice(0, 3).join("-");
  }
  const tokens = splitTokens(symbol.name);
  return tokens.slice(0, 2).join("-") || "misc";
}

function buildDomainGroups(symbols, headings, graph) {
  const groups = new Map();
  for (const symbol of symbols) {
    const heading = headingForSymbol(symbol, headings);
    const key = deriveDomainKey(symbol, heading);
    if (!groups.has(key)) groups.set(key, { id: key, heading, symbols: [], lines: 0, effects: {}, internalEdges: 0, externalEdges: 0 });
    const group = groups.get(key);
    group.symbols.push(symbol.name);
    group.lines += Math.max(1, symbol.endLine - symbol.startLine + 1);
    const effects = countEffects(symbol.text);
    for (const [effect, count] of Object.entries(effects)) group.effects[effect] = (group.effects[effect] ?? 0) + count;
  }
  const symbolToGroup = new Map();
  for (const group of groups.values()) for (const name of group.symbols) symbolToGroup.set(name, group.id);
  for (const [source, targets] of graph.entries()) {
    const sourceGroup = groups.get(symbolToGroup.get(source));
    for (const target of targets) {
      if (symbolToGroup.get(target) === sourceGroup.id) sourceGroup.internalEdges += 1;
      else sourceGroup.externalEdges += 1;
    }
  }
  return [...groups.values()].filter(group => group.symbols.length > 0).sort((a, b) => b.lines - a.lines || a.id.localeCompare(b.id));
}

function cohesionForGroups(groups) {
  const internal = groups.reduce((sum, group) => sum + group.internalEdges, 0);
  const external = groups.reduce((sum, group) => sum + group.externalEdges, 0);
  const total = internal + external;
  const ratio = total ? internal / total : 1;
  return { ratio: Number(ratio.toFixed(3)), label: ratio >= 0.75 ? "high" : ratio >= 0.5 ? "medium" : "low" };
}

function recommendedTarget(relativeFile, group) {
  const dir = path.posix.dirname(normalizeSlashes(relativeFile));
  const base = path.posix.basename(relativeFile).replace(/\.(?:m?js|cjs)$/i, "").replace(/-(?:feature|tracker|application)$/i, "");
  const safe = group.id.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "domain";
  return `${dir}/${base}-${safe}.js`;
}

function analyzeFile(absoluteFile, policy) {
  const relativeFile = repoRelative(absoluteFile);
  const text = fs.readFileSync(absoluteFile, "utf8");
  const lines = countLines(text);
  const symbols = extractTopLevelSymbols(text);
  const imports = extractImports(text);
  const headings = extractSectionHeadings(text);
  const graph = symbolReferenceGraph(symbols);
  const groups = buildDomainGroups(symbols, headings, graph);
  const cohesion = cohesionForGroups(groups);
  const role = policyRole(relativeFile, policy);
  const pressure = locPressure(lines, policy);
  const effectCounts = countEffects(text);
  const activeEffectFamilies = Object.entries(effectCounts).filter(([, count]) => count > 0).map(([id]) => id);
  const domainMultiplicity = Math.min(5, Math.max(0, groups.length - 1));
  const effectMultiplicity = Math.min(5, Math.max(0, activeEffectFamilies.length - 1));
  const couplingRisk = Math.min(5, groups.reduce((sum, group) => sum + group.externalEdges, 0) > groups.reduce((sum, group) => sum + group.internalEdges, 0) ? 4 : groups.some(group => group.externalEdges > group.internalEdges) ? 3 : 1);
  const desirabilityScore = pressure.level + domainMultiplicity + effectMultiplicity + (cohesion.label === "low" ? 3 : cohesion.label === "medium" ? 1 : 0) - couplingRisk;

  let decision = "retain";
  let recommendation = "LOW";
  let reason = "File remains within a coherent or low-pressure implementation boundary.";
  if (!role.decompose) {
    decision = "retain";
    recommendation = "FORBIDDEN";
    reason = role.reason ?? `Role ${role.role} is decomposition-resistant by policy.`;
  } else if (groups.length >= 2 && pressure.level >= 4 && desirabilityScore >= 5) {
    decision = "decompose";
    recommendation = "HIGH";
    reason = "High size pressure combines with multiple independently identifiable domain groups.";
  } else if (groups.length >= 2 && (pressure.level >= 2 || cohesion.label === "low") && desirabilityScore >= 3) {
    decision = "decompose";
    recommendation = "MEDIUM";
    reason = "Multiple domain groups are present and the file is under meaningful reasoning/coupling pressure.";
  }

  const proposedUnits = decision === "decompose"
    ? groups
        .filter(group => group.symbols.length >= 2 || group.lines >= 120)
        .slice(0, 12)
        .map(group => ({
          id: group.id,
          action: "extract",
          target: recommendedTarget(relativeFile, group),
          symbols: group.symbols,
          estimated_lines: group.lines,
          internal_edges: group.internalEdges,
          external_edges: group.externalEdges,
          effect_families: Object.entries(group.effects).filter(([, count]) => count > 0).map(([id]) => id),
          seam_confidence: group.externalEdges === 0 ? "high" : group.internalEdges >= group.externalEdges ? "medium" : "low",
          recursive_review_required: group.lines > policy.loc_pressure.moderate && group.symbols.length >= 5
        }))
    : [];

  return {
    file: relativeFile,
    role,
    metrics: {
      lines,
      top_level_symbols: symbols.length,
      imports: imports.length,
      section_headings: headings.length,
      domain_groups: groups.length,
      effect_families: activeEffectFamilies.length,
      size_pressure: pressure,
      cohesion,
      domain_multiplicity: domainMultiplicity,
      effect_multiplicity: effectMultiplicity,
      coupling_risk: couplingRisk,
      desirability_score: desirabilityScore
    },
    decision,
    recommendation,
    reason,
    retained_spine: decision === "decompose" ? {
      file: relativeFile,
      responsibility: "Retain feature/public/composition identity and orchestration while extracted domains move behind imports.",
      symbol_candidates: symbols.filter(symbol => !proposedUnits.some(unit => unit.symbols.includes(symbol.name))).map(symbol => symbol.name)
    } : null,
    proposed_units: proposedUnits,
    domain_groups: groups.map(group => ({ ...group })),
    symbols: symbols.map(({ text: _text, start: _start, end: _end, ...symbol }) => symbol)
  };
}

function runDiagnostic(name, args = []) {
  const script = path.join(SCRIPT_DIRECTORY, name);
  if (!fs.existsSync(script)) return { tool: name, status: "missing", exit_code: null, report: null };
  const output = path.join(os.tmpdir(), `frame-conn-decomposer-${path.basename(name, path.extname(name))}-${process.pid}.json`);
  const result = spawnSync(process.execPath, [script, ...args, "--output", output], { cwd: REPOSITORY_ROOT, encoding: "utf8", timeout: 120000 });
  let report = null;
  try { if (fs.existsSync(output)) report = JSON.parse(fs.readFileSync(output, "utf8")); } catch { report = null; }
  try { fs.rmSync(output, { force: true }); } catch {}
  return {
    tool: name,
    status: result.status === 0 ? "passed" : "reported-findings",
    exit_code: result.status,
    summary: report?.summary ?? null,
    stderr: String(result.stderr ?? "").trim().slice(0, 1000)
  };
}

function runSupportingSuite() {
  return [
    runDiagnostic("symbol-family-audit.mjs"),
    runDiagnostic("effect-atlas.mjs"),
    runDiagnostic("runtime-authority-audit.mjs"),
    runDiagnostic("state-namespace-atlas.mjs")
  ];
}

function makePlan(analyses, policyFile, suiteEvidence) {
  const candidates = analyses.filter(item => item.decision === "decompose");
  return {
    schema_version: 1,
    tool: "domain-decomposer",
    tool_version: SCRIPT_VERSION,
    generated_at: new Date().toISOString(),
    approved: false,
    policy_file: repoRelative(policyFile),
    behavior_change_allowed: false,
    invariants: [
      "public contracts remain unchanged unless explicitly marked as an approved compatibility shim",
      "runtime effects remain unchanged",
      "persistent state and namespaces remain unchanged",
      "native/Foundry integration behavior remains unchanged",
      "decomposition changes symbol ownership and call topology only",
      "the original file retains an intelligible public/composition spine when one exists"
    ],
    supporting_suite: suiteEvidence,
    candidates: candidates.map(item => ({
      source: item.file,
      decision: item.decision,
      recommendation: item.recommendation,
      reason: item.reason,
      role: item.role,
      metrics: item.metrics,
      retained_spine: item.retained_spine,
      units: item.proposed_units,
      execution: {
        mode: "symbol_extract",
        require_dependency_closed_units: true,
        preserve_original_exports: true,
        approved: false
      }
    })),
    retained_files: analyses.filter(item => item.decision !== "decompose").map(item => ({ file: item.file, recommendation: item.recommendation, reason: item.reason, role: item.role }))
  };
}

function printSummary(analyses, plan) {
  const high = analyses.filter(item => item.recommendation === "HIGH").length;
  const medium = analyses.filter(item => item.recommendation === "MEDIUM").length;
  const forbidden = analyses.filter(item => item.recommendation === "FORBIDDEN").length;
  console.log("Frame Conn Domain Decomposer — planning phase");
  console.log(`${analyses.length} files analyzed | ${high} high | ${medium} medium | ${forbidden} decomposition-resistant`);
  console.log("");
  for (const item of analyses.filter(item => item.recommendation !== "LOW").sort((a, b) => b.metrics.lines - a.metrics.lines).slice(0, 30)) {
    console.log(`${item.recommendation.padEnd(9)} ${String(item.metrics.lines).padStart(5)} LOC  ${item.file}`);
    console.log(`           role=${item.role.role} domains=${item.metrics.domain_groups} effects=${item.metrics.effect_families} cohesion=${item.metrics.cohesion.label} decision=${item.decision}`);
    if (item.decision === "decompose") {
      for (const unit of item.proposed_units.slice(0, 8)) console.log(`             -> ${unit.id}: ${unit.symbols.length} symbols / ~${unit.estimated_lines} lines / ${unit.seam_confidence} seam`);
    } else console.log(`             ${item.reason}`);
  }
  console.log("");
  console.log(`Plan candidates: ${plan.candidates.length}`);
  console.log("Plan is intentionally unapproved. Review/edit it, then set top-level approved=true and candidate execution.approved=true before execution.");
}

function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frame-conn-domain-decomposer-"));
  const sample = path.join(tmp, "mixed-feature.js");
  const text = `/* =====\n   Alpha scoring\n   ===== */\nfunction calculateAlpha() { return helperAlpha(); }\nfunction helperAlpha() { return 1; }\n/* =====\n   Beta presentation\n   ===== */\nfunction renderBeta() { document.createElement(\"div\"); return betaLabel(); }\nfunction betaLabel() { return \"b\"; }\n` + "\n".repeat(900);
  fs.writeFileSync(sample, text);
  const policy = loadPolicy("/nonexistent");
  const symbols = extractTopLevelSymbols(text);
  const headings = extractSectionHeadings(text);
  const groups = buildDomainGroups(symbols, headings, symbolReferenceGraph(symbols));
  if (symbols.length !== 4) throw new Error(`self-test expected 4 symbols, got ${symbols.length}`);
  if (groups.length < 2) throw new Error(`self-test expected multiple domain groups, got ${groups.length}`);
  if (locPressure(950, policy).level < 4) throw new Error("self-test expected high LOC pressure");
  const protectedRole = policyRole("scripts/runtime-orchestrator.js", policy);
  if (protectedRole.decompose !== false) throw new Error("self-test expected runtime orchestrator to be decomposition-resistant");
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("Domain Decomposer self-test passed.");
}

const args = parseArgs(process.argv);
if (args.selfTest) {
  runSelfTest();
  process.exit(0);
}

const policy = loadPolicy(args.policy);
const targets = resolveTargets(args);
if (!targets.length) throw new Error("Domain Decomposer found no JavaScript files to analyze.");
let analyses = targets.map(file => analyzeFile(file, policy));
if (Number.isFinite(args.minPressureLines)) analyses = analyses.filter(item => item.metrics.lines >= args.minPressureLines);
const suiteEvidence = args.runSuite ? runSupportingSuite() : [];
const report = {
  schema_version: 1,
  tool: "domain-decomposer",
  version: SCRIPT_VERSION,
  generated_at: new Date().toISOString(),
  policy_file: repoRelative(args.policy),
  summary: {
    files_analyzed: analyses.length,
    decomposition_candidates: analyses.filter(item => item.decision === "decompose").length,
    high: analyses.filter(item => item.recommendation === "HIGH").length,
    medium: analyses.filter(item => item.recommendation === "MEDIUM").length,
    resistant: analyses.filter(item => item.recommendation === "FORBIDDEN").length
  },
  supporting_suite: suiteEvidence,
  files: analyses
};
const plan = makePlan(analyses, args.policy, suiteEvidence);
fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(args.plan, `${JSON.stringify(plan, null, 2)}\n`);
printSummary(analyses, plan);
console.log(`Report: ${repoRelative(args.output)}`);
console.log(`Plan:   ${repoRelative(args.plan)}`);
