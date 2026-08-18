import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

function argValue(flag, fallback) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : fallback;
}

const inputPath = path.resolve(ROOT, argValue("--input", "dev-scripts/filepatcher.dsl"));
const outputPath = path.resolve(ROOT, argValue("--output", "dev-scripts/filepatcher.json"));
const checkOnly = argv.includes("--check");
const selfTest = argv.includes("--self-test");

const fail = (message, line = null) => {
  const where = line == null ? "" : ` at DSL line ${line}`;
  throw new Error(`[patch-dsl] ${message}${where}`);
};

const countOccurrences = (text, search) => text.split(search).length - 1;
const normalizeRepoPath = value => value.replaceAll("\\", "/").replace(/^\.\//, "");

function parseQuotedOrBare(value, line) {
  const trimmed = value.trim();
  if (!trimmed) fail("Expected a value.", line);
  if (trimmed.startsWith('"')) {
    try { return JSON.parse(trimmed); }
    catch { fail("Invalid quoted string.", line); }
  }
  return trimmed;
}

function readBlock(lines, state, line) {
  if (lines[state.index]?.trim() !== "<<<") fail('Expected "<<<" to start a block.', line);
  state.index += 1;
  const out = [];
  while (state.index < lines.length && lines[state.index].trim() !== ">>>") {
    out.push(lines[state.index]);
    state.index += 1;
  }
  if (state.index >= lines.length) fail('Unterminated block; expected ">>>".', line);
  state.index += 1;
  return out.join("\n");
}

function nextMeaningful(lines, state) {
  while (state.index < lines.length) {
    const raw = lines[state.index];
    const trimmed = raw.trim();
    const line = state.index + 1;
    state.index += 1;
    if (!trimmed || trimmed.startsWith("#")) continue;
    return { raw, trimmed, line };
  }
  return null;
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let templateExpressionDepth = 0;

  for (let i = openIndex; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];

    if (lineComment) {
      if (c === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === "*" && n === "/") { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (quote === "`" && c === "$" && n === "{") {
        templateExpressionDepth += 1;
        depth += 1;
        i += 1;
        continue;
      }
      if (quote === "`" && c === "}" && templateExpressionDepth > 0) {
        templateExpressionDepth -= 1;
        depth -= 1;
        continue;
      }
      if (c === quote && templateExpressionDepth === 0) quote = null;
      continue;
    }

    if (c === "/" && n === "/") { lineComment = true; i += 1; continue; }
    if (c === "/" && n === "*") { blockComment = true; i += 1; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function locateSymbol(text, symbol, line) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`(?:^|\\n)([ \\t]*(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\s*\\([^)]*\\)\\s*\\{)`, "g"),
    new RegExp(`(?:^|\\n)([ \\t]*(?:export\\s+)?class\\s+${escaped}(?:\\s+extends\\s+[^\\{]+)?\\s*\\{)`, "g"),
    new RegExp(`(?:^|\\n)([ \\t]*(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*=)`, "g")
  ];

  const matches = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) matches.push({ index: match.index + (match[0].startsWith("\n") ? 1 : 0), prefix: match[1] });
  }
  if (matches.length !== 1) fail(`within ${symbol} expected exactly one top-level declaration, found ${matches.length}.`, line);

  const start = matches[0].index;
  const headEnd = start + matches[0].prefix.length;
  const brace = text.indexOf("{", start);
  if (brace >= start && brace < headEnd + 8) {
    const close = findMatchingBrace(text, brace);
    if (close < 0) fail(`Unable to find closing brace for symbol ${symbol}.`, line);
    let end = close + 1;
    if (text[end] === ";") end += 1;
    return { start, end, source: text.slice(start, end) };
  }

  let end = text.indexOf(";", headEnd);
  if (end < 0) end = text.indexOf("\n", headEnd);
  if (end < 0) end = text.length;
  else end += 1;
  return { start, end, source: text.slice(start, end) };
}

function readRepoFile(relativePath, virtualFiles, line) {
  const normalized = normalizeRepoPath(relativePath);
  if (virtualFiles.has(normalized)) return virtualFiles.get(normalized);
  const absolute = path.resolve(ROOT, normalized);
  const relative = path.relative(ROOT, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail(`Path escapes repository root: ${relativePath}`, line);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) fail(`File does not exist: ${normalized}`, line);
  const content = fs.readFileSync(absolute, "utf8");
  virtualFiles.set(normalized, content);
  return content;
}

function applyTextEdit(text, kind, search, replacement, cardinality, line) {
  const occurrences = countOccurrences(text, search);
  if (cardinality === "optional" && occurrences === 0) return { text, occurrences: 0, skipped: true };
  if (occurrences === 0) fail(`${kind} search text was not found.`, line);
  if (cardinality === "once" && occurrences !== 1) fail(`${kind} once expected 1 occurrence, found ${occurrences}.`, line);
  const expected = cardinality === "once" ? 1 : occurrences;

  let replace = replacement;
  if (kind === "before") replace = `${replacement}${search}`;
  if (kind === "after") replace = `${search}${replacement}`;
  if (kind === "delete") replace = "";

  return {
    text: text.split(search).join(replace),
    occurrences: expected,
    replace,
    skipped: false
  };
}

function findMatchingParen(text, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];

    if (lineComment) {
      if (c === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === '*' && n === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i += 1; continue; }
    if (c === '/' && n === '*') { blockComment = true; i += 1; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function scanFeatureRegistrationEntries(text, kind) {
  const candidates = [];
  const pattern = /^([ \t]*)([A-Za-z_$][\w$]*Feature)(,?)[ \t]*$/gm;
  let match;
  while ((match = pattern.exec(text))) {
    const source = match[0].replace(/[ \t]+$/, '');
    candidates.push({
      start: match.index,
      end: match.index + source.length,
      source,
      kind,
      hasComma: match[3] === ','
    });
  }
  return candidates;
}

function scanNamedObjectEntries(text, propertyName, kind, line) {
  const escaped = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}\\s*:\\s*\\{`, 'g');
  const candidates = [];
  let match;

  while ((match = pattern.exec(text))) {
    const open = text.indexOf('{', match.index);
    const close = findMatchingBrace(text, open);
    if (close < 0) fail(`${kind} could not resolve ${propertyName} object boundary.`, line);
    const wrapper = `{${text.slice(open + 1, close)}}`;
    const entries = scanStructuralRegions(wrapper, 'object-entry', line);
    for (const entry of entries) {
      candidates.push({
        ...entry,
        start: open + entry.start,
        end: open + entry.end,
        source: entry.source,
        kind
      });
    }
  }

  return candidates;
}

function scanCallStatements(text, pattern, kind, line) {
  const candidates = [];
  let match;
  while ((match = pattern.exec(text))) {
    const prefix = text.slice(Math.max(0, match.index - 32), match.index);
    if (/function\s*$/.test(prefix)) continue;

    const open = text.indexOf('(', match.index);
    const close = findMatchingParen(text, open);
    if (close < 0) fail(`${kind} could not resolve call boundary.`, line);

    const start = text.lastIndexOf('\n', match.index) + 1;
    let end = close + 1;
    while (end < text.length && /[ \t]/.test(text[end])) end += 1;
    if (text[end] === ';') end += 1;
    const source = text.slice(start, end).replace(/[ \t]+$/, '');
    candidates.push({ start, end: start + source.length, source, kind });
  }
  return candidates;
}

function scanStructuralRegions(text, kind, line) {
  if (kind === "ui-control") {
    const candidates = [];
    const pattern = /(^[ \t]*<button\b[\s\S]*?<\/button>)/gm;
    let match;
    while ((match = pattern.exec(text))) {
      candidates.push({
        start: match.index,
        end: match.index + match[0].length,
        source: match[0],
        kind
      });
    }
    return candidates;
  }

  if (kind === "switch-case") {
    const candidates = [];
    const pattern = /(^[ \t]*(?:case\s+[^:\n]+|default)\s*:[\s\S]*?)(?=^[ \t]*(?:case\s+[^:\n]+|default)\s*:|^[ \t]*\})/gm;
    let match;
    while ((match = pattern.exec(text))) {
      const source = match[1].replace(/\s+$/, "");
      candidates.push({
        start: match.index,
        end: match.index + source.length,
        source,
        kind
      });
    }
    return candidates;
  }

  if (kind === "object-entry") {
    const open = text.indexOf("{");
    if (open < 0) fail("object-entry pattern requires a symbol containing an object literal.", line);
    const close = findMatchingBrace(text, open);
    if (close < 0) fail("object-entry pattern could not resolve the object literal boundary.", line);

    const bodyStart = open + 1;
    const bodyEnd = close;
    const candidates = [];
    let entryStart = bodyStart;
    let brace = 0;
    let bracket = 0;
    let paren = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    const pushEntry = (end, hasComma) => {
      let start = entryStart;
      while (start < end && /\s/.test(text[start])) start += 1;
      let trimmedEnd = end;
      while (trimmedEnd > start && /\s/.test(text[trimmedEnd - 1])) trimmedEnd -= 1;
      if (trimmedEnd <= start) return;
      const source = text.slice(start, trimmedEnd) + (hasComma ? "," : "");
      const firstLine = source.split("\n", 1)[0];
      if (!/^(?:[A-Za-z_$][\w$]*|["'][^"']+["'])\s*:/.test(firstLine.trim())) return;
      candidates.push({
        start,
        end: trimmedEnd + (hasComma ? 1 : 0),
        source,
        kind,
        hasComma
      });
    };

    for (let i = bodyStart; i < bodyEnd; i += 1) {
      const c = text[i];
      const n = text[i + 1];

      if (lineComment) {
        if (c === "\n") lineComment = false;
        continue;
      }
      if (blockComment) {
        if (c === "*" && n === "/") { blockComment = false; i += 1; }
        continue;
      }
      if (quote) {
        if (escaped) { escaped = false; continue; }
        if (c === "\\") { escaped = true; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "/" && n === "/") { lineComment = true; i += 1; continue; }
      if (c === "/" && n === "*") { blockComment = true; i += 1; continue; }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "{") brace += 1;
      else if (c === "}") brace -= 1;
      else if (c === "[") bracket += 1;
      else if (c === "]") bracket -= 1;
      else if (c === "(") paren += 1;
      else if (c === ")") paren -= 1;
      else if (c === "," && brace === 0 && bracket === 0 && paren === 0) {
        pushEntry(i, true);
        entryStart = i + 1;
      }
    }
    pushEntry(bodyEnd, false);
    return candidates;
  }

  if (kind === 'feature-registration') {
    return scanFeatureRegistrationEntries(text, kind);
  }

  if (kind === 'runtime-binding') {
    return scanStructuralRegions(text, 'object-entry', line).map(candidate => ({ ...candidate, kind }));
  }

  if (kind === 'feature-api-member') {
    return scanNamedObjectEntries(text, 'api', kind, line);
  }

  if (kind === 'hook-handler') {
    return [
      ...scanNamedObjectEntries(text, 'hooks', kind, line),
      ...scanCallStatements(text, /\bHooks\.(?:on|once)\s*\(/g, kind, line)
    ];
  }

  if (kind === 'flow-step') {
    return scanCallStatements(
      text,
      /\b(?:installNativeFlowStepBefore|installNativeFlowStepAfter|insertNativeFlowStep|appendNativeFlowStep)\s*\(/g,
      kind,
      line
    );
  }

  if (kind === 'actor-flag') {
    return scanCallStatements(
      text,
      /\b[A-Za-z_$][\w$]*\.(?:getFlag|setFlag|unsetFlag)\s*\(/g,
      kind,
      line
    );
  }

  fail(
    `Unsupported pattern kind: ${kind}. Supported: ui-control, object-entry, switch-case, feature-registration, runtime-binding, feature-api-member, hook-handler, flow-step, actor-flag.`,
    line
  );
}

function parseClonePatternStatement(trimmed, line) {
  const match = /^clone-pattern\s+(ui-control|object-entry|switch-case|feature-registration|runtime-binding|feature-api-member|hook-handler|flow-step|actor-flag)(?:\s+(before|after))?(?:\s+containing\s+(.+))?$/.exec(trimmed.replace(/:$/, ""));
  if (!match) return null;
  return {
    kind: match[1],
    placement: match[2] ?? "after",
    containing: match[3] ? parseQuotedOrBare(match[3], line) : null
  };
}

function applyPatternMappings(source, mappings, line) {
  if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) {
    fail("pattern map must be a JSON object of exact source-to-replacement strings.", line);
  }
  const entries = Object.entries(mappings);
  if (entries.length === 0) fail("pattern map must contain at least one replacement.", line);

  let next = source;
  for (const [search, replacement] of entries) {
    if (!search) fail("pattern map keys must be non-empty strings.", line);
    if (typeof replacement !== "string") fail(`pattern map replacement for ${search} must be a string.`, line);
    const occurrences = countOccurrences(next, search);
    if (occurrences === 0) fail(`pattern exemplar does not contain mapped token: ${search}`, line);
    next = next.split(search).join(replacement);
  }
  if (next === source) fail("pattern map produced no change.", line);
  return next;
}

function clonePatternInRegion(regionSource, statement, mappings, line) {
  let candidates = scanStructuralRegions(regionSource, statement.kind, line);
  if (statement.containing) {
    candidates = candidates.filter(candidate => candidate.source.includes(statement.containing));
  }
  if (candidates.length !== 1) {
    const qualifier = statement.containing ? ` containing ${JSON.stringify(statement.containing)}` : "";
    fail(`clone-pattern ${statement.kind}${qualifier} expected exactly one exemplar, found ${candidates.length}.`, line);
  }

  const exemplar = candidates[0];
  let clone = applyPatternMappings(exemplar.source, mappings, line);
  let replacement;

  if (typeof exemplar.hasComma === "boolean") {
    const exemplarBare = exemplar.hasComma ? exemplar.source.slice(0, -1) : exemplar.source;
    const cloneBare = clone.endsWith(",") ? clone.slice(0, -1) : clone;
    if (statement.placement === "before") {
      replacement = `${cloneBare},\n${exemplar.source}`;
    } else if (exemplar.hasComma) {
      replacement = `${exemplar.source}\n${cloneBare},`;
    } else {
      replacement = `${exemplarBare},\n${cloneBare}`;
    }
  } else {
    replacement = statement.placement === "before"
      ? `${clone}\n${exemplar.source}`
      : `${exemplar.source}\n${clone}`;
  }

  return {
    text: regionSource.slice(0, exemplar.start) + replacement + regionSource.slice(exemplar.end),
    exemplar: exemplar.source,
    clone
  };
}

function parseDsl(source, seededFiles = new Map()) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const state = { index: 0 };
  const patch = {
    schema_version: 2,
    id: null,
    description: null,
    planning_goal: null,
    policy: { max_files_changed: 1 },
    operations: []
  };
  const virtualFiles = new Map(seededFiles);
  let currentFile = null;
  let currentSymbol = null;
  const stats = new Map();
  const bump = name => stats.set(name, (stats.get(name) ?? 0) + 1);

  for (let entry = nextMeaningful(lines, state); entry; entry = nextMeaningful(lines, state)) {
    const { trimmed, line } = entry;

    if (trimmed.startsWith("patch ")) { patch.id = parseQuotedOrBare(trimmed.slice(6), line); continue; }
    if (trimmed.startsWith("description ")) { patch.description = parseQuotedOrBare(trimmed.slice(12), line); continue; }
    if (trimmed.startsWith("goal ")) { patch.planning_goal = parseQuotedOrBare(trimmed.slice(5), line); continue; }
    if (trimmed.startsWith("max-files ")) {
      const value = Number(trimmed.slice(10).trim());
      if (!Number.isInteger(value) || value < 1) fail("max-files must be a positive integer.", line);
      patch.policy.max_files_changed = value;
      continue;
    }
    if (trimmed.startsWith("file ")) {
      currentFile = normalizeRepoPath(parseQuotedOrBare(trimmed.slice(5), line));
      currentSymbol = null;
      continue;
    }
    if (trimmed.startsWith("within ")) {
      if (!currentFile) fail("within requires a preceding file directive.", line);
      currentSymbol = parseQuotedOrBare(trimmed.slice(7).replace(/:$/, ""), line);
      continue;
    }
    if (trimmed === "global") { currentSymbol = null; continue; }

    if (trimmed.startsWith("create ")) {
      const target = normalizeRepoPath(parseQuotedOrBare(trimmed.slice(7).replace(/:$/, ""), line));
      const content = readBlock(lines, state, line);
      patch.operations.push({ type: "create_file", path: target, content });
      virtualFiles.set(target, content);
      bump("create");
      continue;
    }

    if (trimmed.startsWith("rewrite ")) {
      const target = normalizeRepoPath(parseQuotedOrBare(trimmed.slice(8).replace(/:$/, ""), line));
      readRepoFile(target, virtualFiles, line);
      const content = readBlock(lines, state, line);
      patch.operations.push({ type: "replace_file", path: target, content });
      virtualFiles.set(target, content);
      bump("rewrite");
      continue;
    }

    if (trimmed === "raw" || trimmed === "raw:") {
      const raw = readBlock(lines, state, line);
      let operation;
      try { operation = JSON.parse(raw); }
      catch { fail("raw block must contain one valid JSON operation object.", line); }
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) fail("raw block must contain one JSON object.", line);
      patch.operations.push(operation);
      bump("raw");
      continue;
    }


    const patternStatement = parseClonePatternStatement(trimmed, line);
    if (patternStatement) {
      if (!currentFile) fail("clone-pattern requires a preceding file directive.", line);
      if (!currentSymbol) fail("clone-pattern requires within <symbol>; pattern inference is intentionally local-only.", line);

      const marker = nextMeaningful(lines, state);
      if (!marker || marker.trimmed.replace(/:$/, "") !== "map") {
        fail("Expected map after clone-pattern.", marker?.line ?? line);
      }
      const rawMappings = readBlock(lines, state, marker.line);
      let mappings;
      try { mappings = JSON.parse(rawMappings); }
      catch { fail("pattern map block must contain valid JSON.", marker.line); }

      const fileContent = readRepoFile(currentFile, virtualFiles, line);
      const region = locateSymbol(fileContent, currentSymbol, line);
      const cloned = clonePatternInRegion(region.source, patternStatement, mappings, line);
      patch.operations.push({
        type: "replace_text",
        path: currentFile,
        search: region.source,
        replace: cloned.text,
        expected_occurrences: 1
      });
      virtualFiles.set(
        currentFile,
        fileContent.slice(0, region.start) + cloned.text + fileContent.slice(region.end)
      );
      console.log(
        `[patch-dsl] pattern=${patternStatement.kind} symbol=${currentSymbol} placement=${patternStatement.placement}` +
        `${patternStatement.containing ? ` exemplar=${JSON.stringify(patternStatement.containing)}` : ""}`
      );
      bump(`pattern-${patternStatement.kind}`);
      continue;
    }
    const editMatch = /^(replace|before|after|delete)(?:\s+(once|all|optional))?$/.exec(trimmed.replace(/:$/, ""));
    if (editMatch) {
      if (!currentFile) fail(`${editMatch[1]} requires a preceding file directive.`, line);
      const kind = editMatch[1];
      const cardinality = editMatch[2] ?? "once";
      const search = readBlock(lines, state, line);
      let replacement = "";
      if (kind !== "delete") {
        const marker = nextMeaningful(lines, state);
        const expectedMarker = kind === "replace" ? "with" : "add";
        if (!marker || marker.trimmed.replace(/:$/, "") !== expectedMarker) fail(`Expected ${expectedMarker} after ${kind} block.`, marker?.line ?? line);
        replacement = readBlock(lines, state, marker.line);
      }

      const fileContent = readRepoFile(currentFile, virtualFiles, line);
      if (currentSymbol) {
        const region = locateSymbol(fileContent, currentSymbol, line);
        const local = applyTextEdit(region.source, kind, search, replacement, cardinality, line);
        if (local.skipped) { bump(`${kind}-optional-skip`); continue; }
        const nextRegion = local.text;
        patch.operations.push({
          type: "replace_text",
          path: currentFile,
          search: region.source,
          replace: nextRegion,
          expected_occurrences: 1
        });
        virtualFiles.set(currentFile, fileContent.slice(0, region.start) + nextRegion + fileContent.slice(region.end));
      } else {
        const applied = applyTextEdit(fileContent, kind, search, replacement, cardinality, line);
        if (applied.skipped) { bump(`${kind}-optional-skip`); continue; }
        patch.operations.push({
          type: "replace_text",
          path: currentFile,
          search,
          replace: applied.replace,
          expected_occurrences: applied.occurrences
        });
        virtualFiles.set(currentFile, applied.text);
      }
      bump(kind);
      continue;
    }

    fail(`Unknown DSL statement: ${trimmed}`, line);
  }

  if (!patch.id) fail("DSL must declare patch <id>.");
  if (!patch.description) delete patch.description;
  if (!patch.planning_goal) delete patch.planning_goal;
  return { patch, stats };
}

function runSelfTest() {
  const fixture = `patch self-test
max-files 1
file scripts/self-test.js
within demo
replace once
<<<
oldThing()
>>>
with
<<<
newThing()
>>>
clone-pattern ui-control after
map
<<<
{
  "do-old": "do-new",
  "Old": "New"
}
>>>
global
after once
<<<
export const y = 1;
>>>
add
<<<

export const z = 2;
>>>
file scripts/self-test.js
within bindings
clone-pattern object-entry after containing executeOld
map
<<<
{
  "executeOld": "executeNew"
}
>>>
clone-pattern runtime-binding after containing executeOld
map
<<<
{
  "executeOld": "executeNative"
}
>>>
file scripts/self-test.js
within route
clone-pattern switch-case after containing oldRoute
map
<<<
{
  "OLD_ROUTE": "NEW_ROUTE",
  "oldRoute": "newRoute"
}
>>>
file scripts/self-test.js
within featurePackage
clone-pattern feature-registration after containing frameConnOldFeature
map
<<<
{
  "frameConnOldFeature": "frameConnNewFeature"
}
>>>
file scripts/self-test.js
within featureDefinition
clone-pattern feature-api-member after containing executeOld
map
<<<
{
  "executeOld": "executeNew",
  "oldExecute": "newExecute"
}
>>>
clone-pattern hook-handler after containing readyOld
map
<<<
{
  "readyOld": "readyNew",
  "oldReady": "newReady"
}
>>>
file scripts/self-test.js
within installFlow
clone-pattern flow-step after containing old-step
map
<<<
{
  "old-step": "new-step",
  "oldStep": "newStep"
}
>>>
file scripts/self-test.js
within persistActorFlag
clone-pattern actor-flag after containing old-flag
map
<<<
{
  "old-flag": "new-flag",
  "oldValue": "newValue"
}
>>>`;
  const seeded = new Map([[
    "scripts/self-test.js",
    `export function demo() {
  const view = \`
    <button class="do-old">Old</button>
  \`;
  return oldThing();
}

export const bindings = {
  executeOld:
    null
};

export function route(kind) {
  switch (kind) {
    case OLD_ROUTE:
      return oldRoute();
    default:
      return fallbackRoute();
  }
}

export const featurePackage = Object.freeze([
  frameConnOldFeature
]);

export const featureDefinition = defineFeature({
  api: {
    executeOld:
      oldExecute
  },
  hooks: {
    readyOld:
      oldReady
  }
});

export function installFlow() {
  installNativeFlowStepBefore({
    stepName: "old-step",
    beforeStep: "target-step",
    flowNames: ["ExampleFlow"],
    step: oldStep
  });
}

export async function persistActorFlag(actor) {
  await actor.setFlag(MODULE_ID, "old-flag", oldValue);
}

export const y = 1;
`
  ]]);
  const { patch } = parseDsl(fixture, seeded);
  if (patch.operations.length !== 11) fail(`Self-test expected 11 operations, found ${patch.operations.length}.`);
  if (!patch.operations[0].replace.includes("newThing()")) fail("Self-test symbol-scoped replacement failed.");
  if (!patch.operations[1].replace.includes('class="do-new">New</button>')) fail("Self-test UI-control pattern cloning failed.");
  if (!patch.operations[2].replace.includes("export const z = 2;")) fail("Self-test global insertion failed.");
  if (!patch.operations[3].replace.includes("executeNew")) fail("Self-test object-entry pattern cloning failed.");
  if (!patch.operations[4].replace.includes("executeNative")) fail("Self-test runtime-binding pattern cloning failed.");
  if (!patch.operations[5].replace.includes("case NEW_ROUTE:") || !patch.operations[5].replace.includes("newRoute()")) fail("Self-test switch-case pattern cloning failed.");
  if (!patch.operations[6].replace.includes("frameConnNewFeature")) fail("Self-test feature-registration pattern cloning failed.");
  if (!patch.operations[7].replace.includes("executeNew") || !patch.operations[7].replace.includes("newExecute")) fail("Self-test feature-api-member pattern cloning failed.");
  if (!patch.operations[8].replace.includes("readyNew") || !patch.operations[8].replace.includes("newReady")) fail("Self-test hook-handler pattern cloning failed.");
  if (!patch.operations[9].replace.includes("new-step") || !patch.operations[9].replace.includes("newStep")) fail("Self-test flow-step pattern cloning failed.");
  if (!patch.operations[10].replace.includes("new-flag") || !patch.operations[10].replace.includes("newValue")) fail("Self-test actor-flag pattern cloning failed.");
  console.log("[patch-dsl] Self-test passed.");
}

function main() {
  if (selfTest) {
    runSelfTest();
    return;
  }
  if (!fs.existsSync(inputPath)) fail(`DSL file not found: ${path.relative(ROOT, inputPath)}`);
  const source = fs.readFileSync(inputPath, "utf8");
  const { patch, stats } = parseDsl(source);
  const rendered = JSON.stringify(patch, null, 2) + "\n";

  console.log(`[patch-dsl] input=${path.relative(ROOT, inputPath)}`);
  console.log(`[patch-dsl] patch=${patch.id}`);
  console.log(`[patch-dsl] operations=${patch.operations.length}`);
  console.log(`[patch-dsl] max_files_changed=${patch.policy.max_files_changed}`);
  for (const [kind, count] of [...stats.entries()].sort()) console.log(`[patch-dsl] ${kind}=${count}`);

  if (checkOnly) {
    console.log("[patch-dsl] Check completed successfully. No JSON was written.");
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, rendered, "utf8");
  console.log(`[patch-dsl] wrote=${path.relative(ROOT, outputPath)}`);
}

try { main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
