#!/usr/bin/env node

/**
 * Frame Conn Runtime Signal Map
 *
 * Static causal-path mapper for Frame Conn and authoritative native Lancer.
 * Maps runtime/event flow rather than module imports:
 * UI event -> handler -> Flow -> Flow step -> hook/chat/effect -> mutation.
 *
 * Safety posture: only statically evidenced edges are emitted as proven.
 * Ambiguous name resolution is skipped rather than guessed.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";

const VERSION = "1.0.0";
const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_FILE);
const DEFAULT_FRAME_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_REPORT = path.join(DEFAULT_FRAME_ROOT, "dev_scripts", "runtime-signal-map-report.json");
const CODE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", "backups", "patch-history"]);
const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "typeof", "new", "await", "super", "constructor"]);

function parseArgs(argv) {
  const args = {
    frameRoot: DEFAULT_FRAME_ROOT,
    nativeRoot: null,
    report: null,
    output: DEFAULT_REPORT,
    query: null,
    from: null,
    to: null,
    maxDepth: 14,
    limit: 20,
    jsonOnly: false,
    selfTest: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--frame-root") args.frameRoot = path.resolve(argv[++i] ?? DEFAULT_FRAME_ROOT);
    else if (arg === "--native-root") args.nativeRoot = path.resolve(argv[++i] ?? "");
    else if (arg === "--report") args.report = path.resolve(argv[++i] ?? DEFAULT_REPORT);
    else if (arg === "--output") args.output = path.resolve(argv[++i] ?? DEFAULT_REPORT);
    else if (arg === "--query") args.query = argv[++i] ?? null;
    else if (arg === "--from") args.from = argv[++i] ?? null;
    else if (arg === "--to") args.to = argv[++i] ?? null;
    else if (arg === "--max-depth") args.maxDepth = Math.max(1, Number(argv[++i] ?? 14) || 14);
    else if (arg === "--limit") args.limit = Math.max(1, Number(argv[++i] ?? 20) || 20);
    else if (arg === "--json-only") args.jsonOnly = true;
    else if (arg === "--self-test") args.selfTest = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Frame Conn Runtime Signal Map\n\n` +
    `Generate from Frame Conn + native Lancer:\n` +
    `  node dev_scripts/runtime-signal-map.mjs --native-root /path/to/foundryvtt-lancer\n\n` +
    `Query a generated report:\n` +
    `  node dev_scripts/runtime-signal-map.mjs --report dev_scripts/runtime-signal-map-report.json --query "attack damage chat"\n` +
    `  node dev_scripts/runtime-signal-map.mjs --report ... --from "click .lancer-damage-apply" --to damageCalc\n\n` +
    `Options:\n` +
    `  --frame-root <path>   Frame Conn root (default current repository)\n` +
    `  --native-root <path>  Authoritative native Lancer source root\n` +
    `  --report <path>       Query an existing report instead of rescanning\n` +
    `  --output <path>       Generated JSON report path\n` +
    `  --query <text>        Rank runtime chains relevant to terms\n` +
    `  --from <text>         Explicit path-search start selector\n` +
    `  --to <text>           Explicit path-search destination selector\n` +
    `  --max-depth <n>       Maximum path depth (default 14)\n` +
    `  --limit <n>           Maximum displayed paths (default 20)\n` +
    `  --self-test           Run synthetic graph extraction test\n`);
}

const slash = value => String(value).replaceAll("\\", "/");
const lineNumber = (text, index) => text.slice(0, index).split("\n").length;

function lineAt(text, index) {
  const start = text.lastIndexOf("\n", index) + 1;
  const next = text.indexOf("\n", index);
  return text.slice(start, next < 0 ? text.length : next).trim().slice(0, 260);
}

function collectFiles(root) {
  if (!root || !fs.existsSync(root)) return [];
  const files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(absolute);
    }
  };
  walk(root);
  return files.sort();
}

function fingerprintFiles(root, files) {
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(slash(path.relative(root, file)));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function extractVersion(root) {
  for (const name of ["system.json", "package.json", "public/system.json"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed.version) return String(parsed.version);
    } catch {}
  }
  return null;
}

function findMatching(text, openIndex, openChar = "{", closeChar = "}") {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) { if (ch === "\n") lineComment = false; continue; }
    if (blockComment) { if (ch === "*" && next === "/") { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") { lineComment = true; i += 1; continue; }
    if (ch === "/" && next === "*") { blockComment = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeGraph() {
  return { nodes: new Map(), edges: [], edgeKeys: new Set() };
}

function addNode(graph, node) {
  const current = graph.nodes.get(node.id);
  if (!current) graph.nodes.set(node.id, node);
  else current.tags = [...new Set([...(current.tags ?? []), ...(node.tags ?? [])])];
  return graph.nodes.get(node.id);
}

function addEdge(graph, edge) {
  if (!edge.from || !edge.to || edge.from === edge.to) return;
  const key = `${edge.from}|${edge.to}|${edge.type}|${edge.file ?? ""}|${edge.line ?? ""}`;
  if (graph.edgeKeys.has(key)) return;
  graph.edgeKeys.add(key);
  graph.edges.push({ confidence: "high", ...edge });
}

function sourceRecord(root, file, text, index) {
  return {
    file: slash(path.relative(root, file)),
    line: lineNumber(text, index),
    evidence: lineAt(text, index)
  };
}

function callableId(source, file, name, line) {
  return `callable:${source}:${file}:${name}:${line}`;
}

function discoverCallables(sourceName, root, file, text) {
  const results = [];
  const patterns = [
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^\n{=]+)?\s*\{/g,
    /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^\n=]+)?=>\s*\{/g
  ];
  for (const regex of patterns) {
    for (const match of text.matchAll(regex)) {
      if (KEYWORDS.has(match[1])) continue;
      const open = text.indexOf("{", match.index + match[0].length - 1);
      const close = open >= 0 ? findMatching(text, open) : -1;
      if (close < 0) continue;
      const record = sourceRecord(root, file, text, match.index);
      results.push({
        id: callableId(sourceName, record.file, match[1], record.line),
        source: sourceName,
        kind: "callable",
        name: match[1],
        start: match.index,
        bodyStart: open + 1,
        end: close,
        ...record
      });
    }
  }

  const classRegex = /(?:^|\n)\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)[^\n{]*\{/g;
  for (const classMatch of text.matchAll(classRegex)) {
    const className = classMatch[1];
    const classOpen = text.indexOf("{", classMatch.index + classMatch[0].length - 1);
    const classClose = classOpen >= 0 ? findMatching(text, classOpen) : -1;
    if (classClose < 0) continue;
    const body = text.slice(classOpen + 1, classClose);
    const methodRegex = /(?:^|\n)\s{2,6}(?:public\s+|private\s+|protected\s+|static\s+|override\s+|abstract\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\(/g;
    for (const methodMatch of body.matchAll(methodRegex)) {
      const name = methodMatch[1];
      if (KEYWORDS.has(name)) continue;
      const absolute = classOpen + 1 + methodMatch.index;
      const parenOpen = text.indexOf("(", absolute + methodMatch[0].length - 1);
      const parenClose = parenOpen >= 0 ? findMatching(text, parenOpen, "(", ")") : -1;
      if (parenClose < 0 || parenClose > classClose) continue;
      const headerTail = text.slice(parenClose + 1, Math.min(classClose, parenClose + 500));
      const braceOffset = headerTail.search(/\{/);
      const semicolonOffset = headerTail.search(/;/);
      if (braceOffset < 0 || (semicolonOffset >= 0 && semicolonOffset < braceOffset)) continue;
      const open = parenClose + 1 + braceOffset;
      const close = findMatching(text, open);
      if (close < 0 || close > classClose) continue;
      const record = sourceRecord(root, file, text, absolute);
      results.push({
        id: callableId(sourceName, record.file, `${className}.${name}`, record.line),
        source: sourceName,
        kind: "callable",
        name,
        qualifiedName: `${className}.${name}`,
        className,
        start: absolute,
        bodyStart: open + 1,
        end: close,
        ...record
      });
    }
  }
  return uniqueBy(results, item => item.id);
}

function enclosingCallable(callables, index) {
  return callables
    .filter(item => item.start <= index && item.end >= index)
    .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0] ?? null;
}

function buildNameIndex(callables) {
  const index = new Map();
  for (const callable of callables) {
    for (const name of [callable.name, callable.qualifiedName].filter(Boolean)) {
      const list = index.get(name) ?? [];
      list.push(callable);
      index.set(name, list);
    }
  }
  return index;
}

function resolveTarget(name, owner, nameIndex) {
  const candidates = nameIndex.get(name) ?? [];
  if (candidates.length === 1) return candidates[0];
  const sameFile = candidates.filter(item => item.source === owner.source && item.file === owner.file);
  return sameFile.length === 1 ? sameFile[0] : null;
}

function effectNode(graph, source, kind, name) {
  const id = `effect:${source}:${kind}:${name}`;
  addNode(graph, { id, kind: "effect", effectKind: kind, source, name, tags: ["effect", kind] });
  return id;
}

function scanEffectsInRange(graph, root, file, text, source, ownerId, start, end) {
  const segment = text.slice(start, end);
  const patterns = [
    ["chat-create", /\bChatMessage(?:\.implementation)?\.create\s*\(/g, "ChatMessage.create"],
    ["damage", /\bdamageCalc\s*\(/g, "damageCalc"],
    ["document-update", /\b(?:this|actor|item|token|document|target)\s*\.\s*update\s*\(/g, "Document.update"],
    ["embedded-create", /\bcreateEmbeddedDocuments\s*\(/g, "createEmbeddedDocuments"],
    ["embedded-update", /\bupdateEmbeddedDocuments\s*\(/g, "updateEmbeddedDocuments"],
    ["embedded-delete", /\bdeleteEmbeddedDocuments\s*\(/g, "deleteEmbeddedDocuments"],
    ["setting-write", /\bgame\.settings\.set\s*\(/g, "game.settings.set"],
    ["notification", /\bui\.notifications\.(?:info|warn|error)\s*\(/g, "ui.notifications"]
  ];
  for (const [kind, regex, name] of patterns) {
    for (const match of segment.matchAll(regex)) {
      const absolute = start + match.index;
      const record = sourceRecord(root, file, text, absolute);
      const target = effectNode(graph, source, kind, name);
      addEdge(graph, { from: ownerId, to: target, type: "produces-effect", source, ...record });
    }
  }
}

function scanDirectCalls(graph, root, file, text, source, callables, nameIndex) {
  const regex = /(?:\b([A-Za-z_$][\w$]*)\s*\.\s*)?\b([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of text.matchAll(regex)) {
    const owner = enclosingCallable(callables, match.index);
    if (!owner) continue;
    const receiver = match[1] ?? null;
    const method = match[2];
    if (KEYWORDS.has(method)) continue;
    let target = null;
    let confidence = "high";
    let basis = "unique-static-name";
    if (!receiver) {
      target = resolveTarget(method, owner, nameIndex);
    } else if (receiver === "this" && owner.className) {
      target = resolveTarget(`${owner.className}.${method}`, owner, nameIndex);
    } else if (/^begin[A-Za-z0-9_$]*Flow$/.test(method) || method === "damageCalc") {
      const candidates = nameIndex.get(method) ?? [];
      if (candidates.length === 1) {
        target = candidates[0];
        confidence = "medium";
        basis = "unique-integration-method-name";
      }
    }
    if (!target || target.id === owner.id) continue;
    addEdge(graph, { from: owner.id, to: target.id, type: "static-call", confidence, basis, source, ...sourceRecord(root, file, text, match.index) });
  }
}

function scanFlows(graph, root, file, text, source, callables, nameIndex) {
  const flowRegex = /class\s+([A-Za-z_$][\w$]*)\s+extends\s+(?:[A-Za-z_$][\w$]*\.)?Flow(?:<[^>{}]*>)?/g;
  for (const match of text.matchAll(flowRegex)) {
    const flowName = match[1];
    const classOpen = text.indexOf("{", match.index);
    const classClose = classOpen >= 0 ? findMatching(text, classOpen) : -1;
    const segment = classClose > classOpen ? text.slice(classOpen + 1, classClose) : "";
    const stepsMatch = /static\s+steps\s*=\s*\[([\s\S]*?)\]/m.exec(segment);
    const steps = stepsMatch ? [...stepsMatch[1].matchAll(/["']([^"']+)["']/g)].map(item => item[1]) : [];
    const record = sourceRecord(root, file, text, match.index);
    const flowId = `flow:${source}:${flowName}`;
    addNode(graph, { id: flowId, kind: "flow", source, name: flowName, steps, ...record, tags: ["flow"] });
    let previous = flowId;
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      const stepId = `flow-step:${source}:${step}`;
      addNode(graph, { id: stepId, kind: "flow-step", source, name: step, tags: ["flow-step"] });
      addEdge(graph, { from: previous, to: stepId, type: i === 0 ? "flow-start-step" : "flow-step-order", source, file: record.file, line: record.line, confidence: "high" });
      previous = stepId;
    }
  }

  for (const match of text.matchAll(/new\s+([A-Za-z_$][\w$]*Flow)\s*\(/g)) {
    const owner = enclosingCallable(callables, match.index);
    if (!owner) continue;
    const flowId = `flow:${source}:${match[1]}`;
    addNode(graph, { id: flowId, kind: "flow", source, name: match[1], tags: ["flow", "constructed"] });
    addEdge(graph, { from: owner.id, to: flowId, type: "constructs-flow", source, ...sourceRecord(root, file, text, match.index) });
  }

  for (const match of text.matchAll(/\bflowSteps\s*\.\s*set\s*\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_$][\w$]*)/g)) {
    const stepId = `flow-step:${source}:${match[1]}`;
    addNode(graph, { id: stepId, kind: "flow-step", source, name: match[1], tags: ["flow-step", "registry"] });
    const target = resolveTarget(match[2], { source, file: slash(path.relative(root, file)) }, nameIndex);
    if (target) addEdge(graph, { from: stepId, to: target.id, type: "flow-step-implementation", source, ...sourceRecord(root, file, text, match.index) });
  }
}

function scanHooks(graph, root, file, text, source, callables, nameIndex) {
  for (const match of text.matchAll(/Hooks\.(callAll|call)\s*\(\s*([`"'])([\s\S]*?)\2/g)) {
    const owner = enclosingCallable(callables, match.index);
    if (!owner || match[3].includes("${")) continue;
    const hookId = `hook:${source}:${match[3]}`;
    addNode(graph, { id: hookId, kind: "hook", source, name: match[3], tags: ["hook", "emitter"] });
    addEdge(graph, { from: owner.id, to: hookId, type: "emits-hook", source, ...sourceRecord(root, file, text, match.index) });
  }

  for (const match of text.matchAll(/Hooks\.(on|once)\s*\(\s*([`"'])([\s\S]*?)\2\s*,\s*([A-Za-z_$][\w$]*)/g)) {
    if (match[3].includes("${")) continue;
    const hookId = `hook:${source}:${match[3]}`;
    addNode(graph, { id: hookId, kind: "hook", source, name: match[3], tags: ["hook", "listener"] });
    const target = resolveTarget(match[4], { source, file: slash(path.relative(root, file)) }, nameIndex);
    if (target) addEdge(graph, { from: hookId, to: target.id, type: "hook-listener", source, ...sourceRecord(root, file, text, match.index) });
  }
}

function scanEvents(graph, root, file, text, source, callables, nameIndex) {
  for (const match of text.matchAll(/\.find\s*\(\s*["']([^"']+)["']\s*\)\s*\.on\s*\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_$][\w$]*)/g)) {
    const selector = match[1];
    const eventName = match[2];
    const eventId = `event:${source}:${eventName}:${selector}`;
    const record = sourceRecord(root, file, text, match.index);
    addNode(graph, { id: eventId, kind: "event", source, name: `${eventName} ${selector}`, eventName, selector, ...record, tags: ["event", eventName, selector] });
    const owner = enclosingCallable(callables, match.index);
    if (owner) addEdge(graph, { from: owner.id, to: eventId, type: "registers-event", source, ...record });
    const target = resolveTarget(match[3], { source, file: slash(path.relative(root, file)) }, nameIndex);
    if (target) addEdge(graph, { from: eventId, to: target.id, type: "event-handler", source, ...record });
  }

  for (const match of text.matchAll(/\.on\s*\(\s*["']([^"']+)["']\s*,\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g)) {
    const open = text.indexOf("{", match.index + match[0].length - 1);
    const close = open >= 0 ? findMatching(text, open) : -1;
    if (close < 0) continue;
    const record = sourceRecord(root, file, text, match.index);
    const eventId = `event:${source}:${record.file}:${match[1]}:${record.line}`;
    const handlerId = `handler:${source}:${record.file}:${match[1]}:${record.line}`;
    addNode(graph, { id: eventId, kind: "event", source, name: match[1], ...record, tags: ["event", match[1]] });
    addNode(graph, { id: handlerId, kind: "event-handler", source, name: `${match[1]} inline handler`, ...record, tags: ["event-handler", "anonymous"] });
    addEdge(graph, { from: eventId, to: handlerId, type: "event-handler", source, ...record });
    const body = text.slice(open + 1, close);
    for (const call of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*(begin[A-Za-z0-9_$]*Flow)\s*\(/g)) {
      const candidates = nameIndex.get(call[2]) ?? [];
      if (candidates.length !== 1) continue;
      addEdge(graph, {
        from: handlerId,
        to: candidates[0].id,
        type: "static-call",
        confidence: "medium",
        basis: "unique-integration-method-name",
        source,
        ...sourceRecord(root, file, text, open + 1 + call.index)
      });
    }
    scanEffectsInRange(graph, root, file, text, source, handlerId, open + 1, close);
  }

  const generic = [
    /addEventListener\s*\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_$][\w$]*)/g,
    /\.on\s*\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_$][\w$]*)/g
  ];
  for (const regex of generic) {
    for (const match of text.matchAll(regex)) {
      const eventId = `event:${source}:${match[1]}`;
      const record = sourceRecord(root, file, text, match.index);
      addNode(graph, { id: eventId, kind: "event", source, name: match[1], ...record, tags: ["event"] });
      const owner = enclosingCallable(callables, match.index);
      if (owner) addEdge(graph, { from: owner.id, to: eventId, type: "registers-event", source, ...record });
      const target = resolveTarget(match[2], { source, file: slash(path.relative(root, file)) }, nameIndex);
      if (target) addEdge(graph, { from: eventId, to: target.id, type: "event-handler", source, ...record });
    }
  }
}

function scanSource(source, root, graph) {
  const files = collectFiles(root);
  const records = files.map(file => ({ file, text: fs.readFileSync(file, "utf8") }));
  const byFile = new Map();
  const callables = [];
  for (const { file, text } of records) {
    const found = discoverCallables(source, root, file, text);
    byFile.set(file, found);
    callables.push(...found);
  }
  for (const callable of callables) addNode(graph, { ...callable, tags: ["callable"] });
  const nameIndex = buildNameIndex(callables);

  for (const { file, text } of records) {
    const local = byFile.get(file) ?? [];
    scanDirectCalls(graph, root, file, text, source, local, nameIndex);
    scanFlows(graph, root, file, text, source, local, nameIndex);
    scanHooks(graph, root, file, text, source, local, nameIndex);
    scanEvents(graph, root, file, text, source, local, nameIndex);
    for (const callable of local) scanEffectsInRange(graph, root, file, text, source, callable.id, callable.bodyStart, callable.end);
  }

  const hasGenericFlowLifecycle = records.some(({ text }) =>
    text.includes("lancer.preFlow.${this.constructor.name}") &&
    text.includes("lancer.postFlow.${this.constructor.name}")
  );
  deriveFlowLifecycleHooks(graph, source, hasGenericFlowLifecycle);

  return {
    root: slash(root),
    version: extractVersion(root),
    files: files.length,
    fingerprint: fingerprintFiles(root, files),
    genericFlowLifecycle: hasGenericFlowLifecycle
  };
}

function deriveFlowLifecycleHooks(graph, source, hasGenericLifecycle) {
  if (!hasGenericLifecycle) return;
  const flows = [...graph.nodes.values()].filter(node => node.kind === "flow" && node.source === source && Array.isArray(node.steps) && node.steps.length);
  for (const flow of flows) {
    const preId = `hook:${source}:lancer.preFlow.${flow.name}`;
    const postId = `hook:${source}:lancer.postFlow.${flow.name}`;
    addNode(graph, { id: preId, kind: "hook", source, name: `lancer.preFlow.${flow.name}`, tags: ["hook", "flow-lifecycle", "derived"] });
    addNode(graph, { id: postId, kind: "hook", source, name: `lancer.postFlow.${flow.name}`, tags: ["hook", "flow-lifecycle", "derived"] });
    const firstStep = `flow-step:${source}:${flow.steps[0]}`;
    const lastStep = `flow-step:${source}:${flow.steps.at(-1)}`;
    addEdge(graph, { from: flow.id, to: preId, type: "flow-pre-hook", confidence: "medium", basis: "generic-Flow.begin constructor-name hook template" });
    if (graph.nodes.has(firstStep)) addEdge(graph, { from: preId, to: firstStep, type: "flow-after-pre-hook", confidence: "medium", basis: "generic-Flow.begin execution order" });
    if (graph.nodes.has(lastStep)) addEdge(graph, { from: lastStep, to: postId, type: "flow-post-hook", confidence: "medium", basis: "generic-Flow.begin execution order" });
  }
}

function bridgeCrossSourceHooks(graph) {
  const byName = new Map();
  for (const node of graph.nodes.values()) {
    if (node.kind !== "hook") continue;
    const list = byName.get(node.name) ?? [];
    list.push(node);
    byName.set(node.name, list);
  }
  for (const nodes of byName.values()) {
    for (const from of nodes) for (const to of nodes) {
      if (from.id === to.id || from.source === to.source) continue;
      addEdge(graph, { from: from.id, to: to.id, type: "cross-source-hook-name", confidence: "high", basis: "same-literal-hook-name" });
    }
  }
}

function serialize(graph, sources) {
  const nodes = [...graph.nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...graph.edges].sort((a, b) => `${a.from}|${a.to}|${a.type}`.localeCompare(`${b.from}|${b.to}|${b.type}`));
  const nodeKinds = {};
  const edgeTypes = {};
  for (const node of nodes) nodeKinds[node.kind] = (nodeKinds[node.kind] ?? 0) + 1;
  for (const edge of edges) edgeTypes[edge.type] = (edgeTypes[edge.type] ?? 0) + 1;
  return {
    schemaVersion: 1,
    tool: "Frame Conn Runtime Signal Map",
    toolVersion: VERSION,
    generatedAt: new Date().toISOString(),
    posture: "Static evidence only. Ambiguous call targets are omitted rather than guessed.",
    sources,
    summary: { nodes: nodes.length, edges: edges.length, nodeKinds, edgeTypes },
    nodes,
    edges
  };
}

function tokenise(value) {
  return String(value ?? "").toLowerCase().split(/[^a-z0-9_$.-]+/).filter(token => token.length > 1);
}

function searchable(node) {
  return [node.name, node.kind, node.effectKind, node.file, node.selector, node.eventName, ...(node.tags ?? []), node.evidence]
    .filter(Boolean).join(" ").toLowerCase();
}

function adjacency(report) {
  const outgoing = new Map();
  for (const edge of report.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }
  return outgoing;
}

function findPaths(report, starts, targetPredicate, maxDepth, limit) {
  const outgoing = adjacency(report);
  const nodeMap = new Map(report.nodes.map(node => [node.id, node]));
  const results = [];
  for (const start of starts) {
    const queue = [{ node: start.id, nodes: [start.id], edges: [] }];
    while (queue.length && results.length < limit * 8) {
      const current = queue.shift();
      const node = nodeMap.get(current.node);
      if (current.edges.length && node && targetPredicate(node)) {
        results.push(current);
        continue;
      }
      if (current.edges.length >= maxDepth) continue;
      for (const edge of outgoing.get(current.node) ?? []) {
        if (current.nodes.includes(edge.to)) continue;
        queue.push({ node: edge.to, nodes: [...current.nodes, edge.to], edges: [...current.edges, edge] });
      }
    }
  }
  return uniqueBy(results, result => result.nodes.join("→")).slice(0, limit);
}

function explicitPaths(report, from, to, maxDepth, limit) {
  const fromTokens = tokenise(from);
  const toTokens = tokenise(to);
  const matches = (node, tokens) => tokens.every(token => searchable(node).includes(token));
  const starts = report.nodes.filter(node => matches(node, fromTokens));
  return findPaths(report, starts, node => matches(node, toTokens), maxDepth, limit);
}

function relevantChains(report, query, maxDepth, limit) {
  const tokens = tokenise(query);
  const scored = report.nodes.map(node => ({
    node,
    score: tokens.reduce((sum, token) => sum + (searchable(node).includes(token) ? 3 : 0) + (String(node.name ?? "").toLowerCase().includes(token) ? 2 : 0), 0)
  })).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  const starts = scored.filter(item => ["event", "callable", "flow", "hook"].includes(item.node.kind)).slice(0, 25).map(item => item.node);
  const targets = new Set(scored.slice(0, 50).map(item => item.node.id));
  const paths = findPaths(report, starts, node => node.kind === "effect" || targets.has(node.id), maxDepth, limit * 3);
  const nodeMap = new Map(report.nodes.map(node => [node.id, node]));
  return paths.map(result => ({
    ...result,
    score: result.nodes.reduce((sum, id) => {
      const text = searchable(nodeMap.get(id) ?? {});
      return sum + tokens.reduce((inner, token) => inner + (text.includes(token) ? 2 : 0), 0);
    }, 0) + ((nodeMap.get(result.nodes.at(-1))?.kind === "effect") ? 4 : 0)
  })).sort((a, b) => b.score - a.score || a.edges.length - b.edges.length).slice(0, limit);
}

function printSummary(report) {
  console.log(`Frame Conn Runtime Signal Map ${report.toolVersion}`);
  console.log(`${report.summary.nodes} nodes | ${report.summary.edges} runtime edges`);
  for (const [name, source] of Object.entries(report.sources ?? {})) {
    console.log(`  ${name}: ${source.files} files${source.version ? ` | version ${source.version}` : ""} | ${source.fingerprint.slice(0, 12)}…`);
  }
  console.log("Edge kinds:");
  for (const [kind, count] of Object.entries(report.summary.edgeTypes).sort((a, b) => b[1] - a[1])) console.log(`  ${kind}: ${count}`);
}

function printPaths(report, paths) {
  const nodeMap = new Map(report.nodes.map(node => [node.id, node]));
  if (!paths.length) {
    console.log("No statically evidenced runtime path matched the request.");
    return;
  }
  paths.forEach((result, index) => {
    console.log(`\n[${index + 1}] ${result.edges.length} edges${result.score !== undefined ? ` | score ${result.score}` : ""}`);
    result.nodes.forEach((id, nodeIndex) => {
      const node = nodeMap.get(id);
      if (!node) return;
      const location = node.file ? ` (${node.source}:${node.file}${node.line ? `:${node.line}` : ""})` : ` (${node.source})`;
      console.log(`  ${nodeIndex ? "↓ " : ""}${node.kind}:${node.name}${location}`);
      if (nodeIndex < result.edges.length) console.log(`    --${result.edges[nodeIndex].type}-->`);
    });
  });
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frame-conn-runtime-map-"));
  try {
    fs.writeFileSync(path.join(root, "system.json"), JSON.stringify({ version: "test" }));
    fs.writeFileSync(path.join(root, "demo.ts"), `
class DemoFlow extends Flow { static steps = ["prepare", "show", "finish"]; }
export async function startDemo() { const flow = new DemoFlow(); await flow.begin(); }
export async function prepare() { return show(); }
export async function show() { await ChatMessage.create({content:"demo"}); return finish(); }
export async function finish() { return actor.damageCalc([], {multiple:0.5}); }
flowSteps.set("prepare", prepare);
flowSteps.set("show", show);
flowSteps.set("finish", finish);
export async function applyDemo() { return finish(); }
export function bind(html) { html.find(".demo-apply").on("click", applyDemo); }
Hooks.on("renderChatMessage", bind);
`);
    const graph = makeGraph();
    const source = scanSource("native", root, graph);
    const report = serialize(graph, { native: source });
    for (const type of ["constructs-flow", "flow-step-order", "flow-step-implementation", "static-call", "hook-listener", "event-handler", "produces-effect"]) {
      if (!report.edges.some(edge => edge.type === type)) throw new Error(`self-test missing edge type ${type}`);
    }
    const clickToDamage = explicitPaths(report, "click .demo-apply", "damageCalc", 8, 5);
    if (!clickToDamage.length) throw new Error("self-test could not prove click -> damageCalc path");
    console.log("[runtime-signal-map] Self-test passed.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (args.selfTest) return runSelfTest();

  let report;
  if (args.report) {
    report = JSON.parse(fs.readFileSync(args.report, "utf8"));
  } else {
    const graph = makeGraph();
    const sources = {};
    if (args.frameRoot && fs.existsSync(args.frameRoot)) sources.frameConn = scanSource("frame-conn", args.frameRoot, graph);
    if (args.nativeRoot) {
      if (!fs.existsSync(args.nativeRoot)) throw new Error(`Native root does not exist: ${args.nativeRoot}`);
      sources.nativeLancer = scanSource("native-lancer", args.nativeRoot, graph);
    }
    bridgeCrossSourceHooks(graph);
    report = serialize(graph, sources);
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, JSON.stringify(report, null, 2) + "\n", "utf8");
  }

  if (!args.jsonOnly) printSummary(report);
  if (args.from && args.to) {
    console.log(`\nRuntime paths: ${args.from} → ${args.to}`);
    printPaths(report, explicitPaths(report, args.from, args.to, args.maxDepth, args.limit));
  } else if (args.query) {
    console.log(`\nRuntime chains relevant to: ${args.query}`);
    printPaths(report, relevantChains(report, args.query, args.maxDepth, args.limit));
  }
}

try { main(); }
catch (error) {
  console.error(`[runtime-signal-map] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
