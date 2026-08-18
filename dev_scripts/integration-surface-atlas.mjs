#!/usr/bin/env node

/**
 * dev_scripts/integration-surface-atlas.mjs
 *
 * Frame Conn Integration Surface Atlas
 *
 * Static discovery tool for authoritative native Lancer integration surfaces.
 * It indexes extension points and effect boundaries instead of general imports.
 * The atlas does not execute native system code and never invents missing APIs.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_FILE);
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const TEMPLATE_EXTENSIONS = new Set([".hbs", ".html"]);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "coverage", "public", "static"]);
const DEFAULT_REPORT = path.join(REPOSITORY_ROOT, "dev_scripts", "native-integration-surface-atlas.json");

function parseArgs(argv) {
  const result = {
    nativeRoot: null,
    report: null,
    output: DEFAULT_REPORT,
    query: null,
    limit: 40,
    selfTest: false,
    jsonOnly: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--native-root") result.nativeRoot = argv[++index] ?? null;
    else if (arg === "--report") result.report = argv[++index] ?? null;
    else if (arg === "--output") result.output = path.resolve(REPOSITORY_ROOT, argv[++index] ?? "integration-surface-atlas-report.json");
    else if (arg === "--query") result.query = argv[++index] ?? null;
    else if (arg === "--limit") result.limit = Math.max(1, Number(argv[++index] ?? 40) || 40);
    else if (arg === "--self-test") result.selfTest = true;
    else if (arg === "--json-only") result.jsonOnly = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return result;
}

function printHelp() {
  console.log(`Frame Conn Integration Surface Atlas\n\n` +
    `Usage:\n` +
    `  node dev_scripts/integration-surface-atlas.mjs --native-root <foundry-lancer-root>\n` +
    `  node dev_scripts/integration-surface-atlas.mjs --query "damage attack"\n` +
    `  node dev_scripts/integration-surface-atlas.mjs --native-root <root> --query "damage attack"\n` +
    `  node dev_scripts/integration-surface-atlas.mjs --self-test\n\n` +
    `Options:\n` +
    `  --native-root <path>  Authoritative native Lancer source root; regenerates atlas\n` +
    `  --report <path>       Read/query an existing atlas JSON (defaults to checked-in snapshot)\n` +
    `  --output <path>       JSON report path\n` +
    `  --query <text>        Rank/print surfaces relevant to a behavior\n` +
    `  --limit <n>           Maximum query results (default 40)\n` +
    `  --json-only           Write JSON without console summary\n` +
    `  --self-test           Run synthetic extraction tests\n`);
}

function normalizeSlashes(value) {
  return String(value).replaceAll("\\", "/");
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function lineTextAt(text, index) {
  const start = text.lastIndexOf("\n", index) + 1;
  const endIndex = text.indexOf("\n", index);
  const end = endIndex === -1 ? text.length : endIndex;
  return text.slice(start, end).trim();
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function collectFiles(root) {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext) || TEMPLATE_EXTENSIONS.has(ext)) files.push(absolute);
      }
    }
  }
  walk(root);
  return files.sort();
}

function sourceRecord(root, file, text, index, extra = {}) {
  return {
    file: normalizeSlashes(path.relative(root, file)),
    line: lineNumber(text, index),
    evidence: lineTextAt(text, index).slice(0, 260),
    ...extra
  };
}

function findMatchingBracket(text, openIndex, openChar = "[", closeChar = "]") {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractStringArray(text, startIndex) {
  const open = text.indexOf("[", startIndex);
  if (open === -1) return [];
  const close = findMatchingBracket(text, open);
  if (close === -1) return [];
  const body = text.slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\n)\s*\/\/.*$/gm, "$1")
    .replace(/\s+\/\/.*$/gm, "");
  return [...body.matchAll(/["']([^"']+)["']/g)].map(match => match[1]);
}

function addSurface(surfaces, surface) {
  surfaces.push({
    id: `${surface.kind}:${surface.name}:${surface.file}:${surface.line}`,
    confidence: surface.confidence ?? "high",
    tags: [...new Set(surface.tags ?? [])],
    ...surface
  });
}

function scanFlowDefinitions(root, file, text, surfaces) {
  const regex = /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\s+extends\s+(?:[A-Za-z_$][\w$]*\.)?Flow(?:<[^>{}]*>)?/g;
  for (const match of text.matchAll(regex)) {
    const className = match[1];
    const classStart = match.index;
    const nextClass = text.indexOf("\nexport class ", classStart + match[0].length);
    const searchEnd = nextClass === -1 ? Math.min(text.length, classStart + 12000) : nextClass;
    const segment = text.slice(classStart, searchEnd);
    const staticStepsIndex = segment.search(/static\s+steps\s*=\s*\[/);
    const steps = staticStepsIndex >= 0 ? extractStringArray(segment, staticStepsIndex) : [];
    const record = sourceRecord(root, file, text, classStart);
    addSurface(surfaces, {
      kind: "flow",
      name: className,
      ...record,
      detail: steps.length ? `ordered steps: ${steps.join(" -> ")}` : "Flow subclass; ordered step array not statically resolved",
      steps,
      tags: ["flow", "execution", ...steps.map(step => `step:${step}`)]
    });
  }
}

function scanFlowRegistrations(root, file, text, surfaces) {
  for (const match of text.matchAll(/\bflows\s*\.\s*set\s*\(\s*([A-Za-z_$][\w$]*)\.name\s*,\s*\1\s*\)/g)) {
    const name = match[1];
    addSurface(surfaces, {
      kind: "flow-registration",
      name,
      ...sourceRecord(root, file, text, match.index),
      detail: `registered in native Flow registry as ${name}`,
      tags: ["flow", "registry", "extension-point"]
    });
  }

  for (const match of text.matchAll(/\bflowSteps\s*\.\s*set\s*\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_$][\w$]*)/g)) {
    addSurface(surfaces, {
      kind: "flow-step",
      name: match[1],
      implementation: match[2],
      ...sourceRecord(root, file, text, match.index),
      detail: `Flow step registry key ${match[1]} -> ${match[2]}`,
      tags: ["flow", "flow-step", "registry", "extension-point"]
    });
  }

  for (const match of text.matchAll(/Hooks\.callAll\(\s*["']lancer\.registerFlows["']/g)) {
    addSurface(surfaces, {
      kind: "flow-extension-hook",
      name: "lancer.registerFlows",
      ...sourceRecord(root, file, text, match.index),
      detail: "native hook exposes mutable flowSteps and flows registries",
      tags: ["flow", "hook", "registry", "extension-point", "public-extension"]
    });
  }
}

function scanHooks(root, file, text, surfaces) {
  const regex = /Hooks\.(callAll|call|on|once)\s*\(\s*([`"'])([\s\S]*?)\2/g;
  for (const match of text.matchAll(regex)) {
    const method = match[1];
    const name = match[3];
    const direction = method === "on" || method === "once" ? "listener" : "emitter";
    addSurface(surfaces, {
      kind: "hook",
      name,
      direction,
      method,
      ...sourceRecord(root, file, text, match.index),
      detail: `${direction} via Hooks.${method}`,
      tags: ["hook", direction, name.startsWith("lancer.") ? "lancer-hook" : "foundry-hook"]
    });
  }
}

function scanGameLancer(root, file, text, surfaces) {
  const regex = /\bgame\.lancer(?:\?\.)?\.([A-Za-z_$][\w$]*)/g;
  for (const match of text.matchAll(regex)) {
    const member = match[1];
    addSurface(surfaces, {
      kind: "game-lancer-surface",
      name: `game.lancer.${member}`,
      ...sourceRecord(root, file, text, match.index),
      detail: `native public runtime surface member ${member}`,
      tags: ["game.lancer", "runtime-api", member]
    });
  }
}

function scanMutationBoundaries(root, file, text, surfaces) {
  const patterns = [
    ["document-update", /\b(?:actor|item|token|document|this)\s*\.\s*update\s*\(/g],
    ["embedded-document-mutation", /\b(?:createEmbeddedDocuments|updateEmbeddedDocuments|deleteEmbeddedDocuments)\s*\(/g],
    ["actor-damage", /\b(?:actor\s*\.)?damageCalc\s*\(/g]
  ];
  for (const [kind, regex] of patterns) {
    for (const match of text.matchAll(regex)) {
      addSurface(surfaces, {
        kind,
        name: lineTextAt(text, match.index).slice(0, 120),
        ...sourceRecord(root, file, text, match.index),
        detail: kind === "actor-damage" ? "authoritative actor damage calculation/application boundary" : "Foundry document mutation boundary",
        tags: ["mutation", kind.includes("damage") ? "damage" : "document"]
      });
    }
  }
}

function scanNamedEntrypoints(root, file, text, surfaces) {
  const regex = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  const highValue = /(?:apply|damage|attack|roll|target|flow|chat|activate|execute|use|repair|structure|overheat|burn|status|token|item|actor)/i;
  for (const match of text.matchAll(regex)) {
    const name = match[1];
    if (!highValue.test(name)) continue;
    addSurface(surfaces, {
      kind: "exported-entrypoint",
      name,
      ...sourceRecord(root, file, text, match.index),
      detail: "exported native function with integration-relevant behavior name",
      tags: ["entrypoint", ...name.toLowerCase().split(/(?=[A-Z])|[_-]/).filter(Boolean)]
    });
  }

  const classMethodRegex = /^\s{2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^\n]*\)\s*(?::[^\{\n]+)?\{/gm;
  if (/class\s+Lancer(?:Actor|Item|Token)/.test(text)) {
    for (const match of text.matchAll(classMethodRegex)) {
      const name = match[1];
      if (!highValue.test(name)) continue;
      addSurface(surfaces, {
        kind: "document-entrypoint",
        name,
        ...sourceRecord(root, file, text, match.index),
        detail: "integration-relevant method on native Lancer document class",
        tags: ["entrypoint", "document", name.toLowerCase()]
      });
    }
  }
}

function scanChatControls(root, file, text, surfaces) {
  const handlerRegex = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(\s*(?:event|ev|e)\b[^)]*\)/g;
  for (const match of text.matchAll(handlerRegex)) {
    const segment = text.slice(match.index, Math.min(text.length, match.index + 5000));
    if (!/(?:chat-message|ChatMessage|currentTarget|closest\(|dataset\.)/.test(segment)) continue;
    addSurface(surfaces, {
      kind: "chat-control",
      name: match[1],
      ...sourceRecord(root, file, text, match.index),
      detail: "event handler interacting with chat message/control DOM or message data",
      tags: ["chat", "ui-control", "event-handler"]
    });
  }

  if (TEMPLATE_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    for (const match of text.matchAll(/<(?:button|select|input)\b[^>]*(?:data-[\w-]+|class=["'][^"']*(?:damage|attack|roll|apply)[^"']*)[^>]*>/gi)) {
      addSurface(surfaces, {
        kind: "chat-template-control",
        name: match[0].replace(/\s+/g, " ").slice(0, 120),
        ...sourceRecord(root, file, text, match.index),
        detail: "template control likely participating in native combat/chat interaction",
        tags: ["chat", "template", "ui-control"]
      });
    }
  }
}

function scanExplicitRegistries(root, file, text, surfaces) {
  for (const match of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*(?:Registry|Map|Steps|flows|flowSteps))\s*=\s*new\s+Map\b/g)) {
    addSurface(surfaces, {
      kind: "registry",
      name: match[1],
      ...sourceRecord(root, file, text, match.index),
      detail: "explicit native Map-based registry",
      tags: ["registry", "map"]
    });
  }
}

function scanFile(root, file, surfaces) {
  const text = fs.readFileSync(file, "utf8");
  const ext = path.extname(file).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) {
    scanFlowDefinitions(root, file, text, surfaces);
    scanFlowRegistrations(root, file, text, surfaces);
    scanHooks(root, file, text, surfaces);
    scanGameLancer(root, file, text, surfaces);
    scanMutationBoundaries(root, file, text, surfaces);
    scanNamedEntrypoints(root, file, text, surfaces);
    scanChatControls(root, file, text, surfaces);
    scanExplicitRegistries(root, file, text, surfaces);
  } else {
    scanChatControls(root, file, text, surfaces);
  }
}

function readNativeVersion(root) {
  for (const candidate of ["package.json", "system.json", "public/system.json", "src/system.json"]) {
    const file = path.join(root, candidate);
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return parsed.version ?? parsed.name ?? null;
    } catch {
      // Source metadata is advisory only.
    }
  }
  return null;
}

function fingerprintFiles(root, files) {
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(normalizeSlashes(path.relative(root, file)));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function groupSummary(surfaces) {
  const groups = new Map();
  for (const surface of surfaces) {
    const group = groups.get(surface.kind) ?? { kind: surface.kind, count: 0, files: new Set() };
    group.count += 1;
    group.files.add(surface.file);
    groups.set(surface.kind, group);
  }
  return [...groups.values()]
    .map(group => ({ kind: group.kind, count: group.count, fileCount: group.files.size }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

function tokenizeQuery(query) {
  return String(query ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .filter(token => token.length >= 2);
}

function rankSurfaces(surfaces, query) {
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return [];
  return surfaces
    .map(surface => {
      const name = String(surface.name ?? "").toLowerCase();
      const kind = String(surface.kind ?? "").toLowerCase();
      const detail = String(surface.detail ?? "").toLowerCase();
      const tags = (surface.tags ?? []).join(" ").toLowerCase();
      const file = String(surface.file ?? "").toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (name.includes(token)) score += 8;
        if (kind.includes(token)) score += 5;
        if (tags.includes(token)) score += 4;
        if (detail.includes(token)) score += 2;
        if (file.includes(token)) score += 1;
      }
      if (surface.kind === "flow" || surface.kind === "flow-extension-hook") score += 1;
      return { ...surface, score };
    })
    .filter(surface => surface.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
}

function buildAtlas(nativeRoot) {
  const root = path.resolve(nativeRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Native source root does not exist or is not a directory: ${root}`);
  }
  const files = collectFiles(root);
  if (!files.length) throw new Error(`No supported native source files found under: ${root}`);
  const surfaces = [];
  for (const file of files) scanFile(root, file, surfaces);
  const deduped = uniqueBy(surfaces, surface => `${surface.kind}\0${surface.name}\0${surface.file}\0${surface.line}`)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.file.localeCompare(b.file) || a.line - b.line);
  return {
    schemaVersion: 1,
    tool: "Frame Conn Integration Surface Atlas",
    toolVersion: SCRIPT_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      rootName: path.basename(root),
      version: readNativeVersion(root),
      fileCount: files.length,
      fingerprintSha256: fingerprintFiles(root, files)
    },
    summary: {
      surfaceCount: deduped.length,
      kinds: groupSummary(deduped)
    },
    surfaces: deduped
  };
}

function printSummary(atlas, query, limit) {
  console.log("Frame Conn Integration Surface Atlas");
  console.log(`source: ${atlas.source.rootName ?? "native-lancer"}`);
  if (atlas.source.version) console.log(`native version: ${atlas.source.version}`);
  console.log(`${atlas.source.fileCount} source files | ${atlas.summary.surfaceCount} integration surfaces`);
  console.log("");
  for (const group of atlas.summary.kinds.slice(0, 14)) {
    console.log(`  ${group.kind}: ${group.count} sites | ${group.fileCount} files`);
  }

  if (query) {
    const ranked = rankSurfaces(atlas.surfaces, query).slice(0, limit);
    console.log(`\nQuery: ${query}`);
    if (!ranked.length) console.log("  no matching integration surfaces");
    for (const surface of ranked) {
      console.log(`  [${surface.kind}] ${surface.name}`);
      console.log(`    ${surface.file}:${surface.line}`);
      if (surface.detail) console.log(`    ${surface.detail}`);
    }
  }
}

function runSelfTest() {
  const temp = fs.mkdtempSync(path.join(process.cwd(), ".integration-atlas-test-"));
  try {
    fs.mkdirSync(path.join(temp, "src", "module", "flows"), { recursive: true });
    fs.writeFileSync(path.join(temp, "package.json"), JSON.stringify({ version: "test-1" }));
    fs.writeFileSync(path.join(temp, "src", "module", "flows", "demo.ts"), `
export class DemoFlow extends Flow<DemoData> {
  static steps = ["initDemo", "showDemoHUD", "finishDemo"];
}
export async function applyDemo(event: JQuery.ClickEvent) {
  const message = event.currentTarget.closest(".chat-message.message");
  return message;
}
export function registerDemoSteps(flowSteps) {
  flowSteps.set("initDemo", initDemo);
}
Hooks.callAll("lancer.demoReady", true);
game.lancer.flowSteps.get("initDemo");
actor.damageCalc(damage, { multiple: 0.5 });
`);
    fs.writeFileSync(path.join(temp, "src", "module", "flows", "register-flows.ts"), `
export function registerFlows() {
 const flows = new Map();
 const flowSteps = new Map();
 flows.set(DemoFlow.name, DemoFlow);
 Hooks.callAll("lancer.registerFlows", flowSteps, flows);
 return {flows, flowSteps};
}
`);
    const atlas = buildAtlas(temp);
    const requireSurface = (kind, name) => {
      if (!atlas.surfaces.some(surface => surface.kind === kind && surface.name === name)) {
        throw new Error(`Self-test missing ${kind}:${name}`);
      }
    };
    requireSurface("flow", "DemoFlow");
    requireSurface("flow-registration", "DemoFlow");
    requireSurface("flow-step", "initDemo");
    requireSurface("flow-extension-hook", "lancer.registerFlows");
    requireSurface("hook", "lancer.demoReady");
    requireSurface("game-lancer-surface", "game.lancer.flowSteps");
    if (!atlas.surfaces.some(surface => surface.kind === "actor-damage")) throw new Error("Self-test missing actor damage boundary");
    requireSurface("chat-control", "applyDemo");
    console.log("[integration-surface-atlas] Self-test passed.");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv);
if (args.selfTest) {
  runSelfTest();
  process.exit(0);
}
let atlas;
let reportPath = null;
if (args.nativeRoot) {
  atlas = buildAtlas(args.nativeRoot);
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, `${JSON.stringify(atlas, null, 2)}\n`);
  reportPath = args.output;
} else {
  reportPath = path.resolve(REPOSITORY_ROOT, args.report ?? DEFAULT_REPORT);
  if (!fs.existsSync(reportPath)) {
    throw new Error(`No checked-in atlas report found at ${reportPath}. Supply --native-root to generate one.`);
  }
  atlas = JSON.parse(fs.readFileSync(reportPath, "utf8"));
}
if (!args.jsonOnly) {
  printSummary(atlas, args.query, args.limit);
  console.log(`\nReport: ${reportPath}`);
}
