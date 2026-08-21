import type { DependencyKind, DependencyReference, EffectRecord, FileFacts, StateRecord, SymbolRecord } from "./model.js";
import { repositoryExtension } from "./source-profile.js";
import { extractContractFileFacts } from "./contract-extractor.js";
import { createHash } from "node:crypto";
import type { EffectRuntimeEdge, EffectRuntimeEdgeKind, EffectRuntimeNode, EffectRuntimeNodeKind } from "./effect-runtime-types.js";
import { extractDataflowFileFacts } from "./dataflow-extractor.js";

function lineNumber(text: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (text.charCodeAt(cursor) === 10) line += 1;
  return line;
}

export function stripJavaScriptComments(text: string): string {
  return text.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\/\/[^\n\r]*|\/\*[\s\S]*?\*\/)/g, match => {
    if (match.startsWith('"') || match.startsWith("'") || match.startsWith("`")) return match;
    return match.replace(/[^\n]/g, " ");
  });
}

function pushDependency(output: DependencyReference[], file: string, kind: DependencyKind, specifier: string, text: string, index: number): void {
  output.push({ file, kind, specifier, line: lineNumber(text, index) });
}

function extractDependencies(file: string, text: string): DependencyReference[] {
  const output: DependencyReference[] = [];
  const extension = repositoryExtension(file);
  if ([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts"].includes(extension)) {
    const source = stripJavaScriptComments(text);
    const patterns: readonly [DependencyKind, RegExp][] = [
      ["import", /\bimport\s+(?!\()(?:(?!;).)*?\bfrom\s*["']([^"']+)["']/gs],
      ["side-effect-import", /\bimport\s*["']([^"']+)["']/g],
      ["export-from", /\bexport\s+(?:(?!;).)*?\bfrom\s*["']([^"']+)["']/gs],
      ["dynamic-import", /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g],
      ["require", /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g]
    ];
    for (const [kind, pattern] of patterns) {
      for (const match of source.matchAll(pattern)) if (match[1]) pushDependency(output, file, kind, match[1], source, match.index ?? 0);
    }
  } else if ([".css", ".scss"].includes(extension)) {
    for (const match of text.matchAll(/@(?:import|use|forward)\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?/gi)) {
      if (match[1]) pushDependency(output, file, "style-import", match[1], text, match.index ?? 0);
    }
  } else if ([".html", ".hbs", ".handlebars"].includes(extension)) {
    for (const match of text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      if (match[1]) pushDependency(output, file, "template-reference", match[1], text, match.index ?? 0);
    }
  } else if (["module.json", "system.json"].includes(file.split("/").at(-1)?.toLowerCase() ?? "")) {
    try {
      const manifest = JSON.parse(text) as Record<string, unknown>;
      for (const key of ["scripts", "esmodules", "styles"] as const) {
        const values = manifest[key];
        if (!Array.isArray(values)) continue;
        for (const value of values) if (typeof value === "string") pushDependency(output, file, "manifest-reference", value, text, 0);
      }
    } catch {}
  }
  const seen = new Set<string>();
  return output.filter(item => {
    const key = `${item.kind}|${item.specifier}|${item.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind) || a.specifier.localeCompare(b.specifier));
}

function extractSymbols(file: string, text: string): SymbolRecord[] {
  if (![".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts"].includes(repositoryExtension(file))) return [];
  const source = stripJavaScriptComments(text);
  const output: SymbolRecord[] = [];
  const patterns: readonly [SymbolRecord["kind"], RegExp][] = [
    ["function", /(^|\n)\s*(export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g],
    ["class", /(^|\n)\s*(export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b/g],
    ["variable", /(^|\n)\s*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g]
  ];
  for (const [kind, pattern] of patterns) {
    for (const match of source.matchAll(pattern)) {
      const name = match[3];
      if (!name) continue;
      output.push({ name, file, kind, exported: Boolean(match[2]), line: lineNumber(source, match.index ?? 0) });
    }
  }
  return output.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
}

function containingSymbol(symbols: readonly SymbolRecord[], line: number): string {
  let owner = "<module>";
  for (const symbol of symbols) {
    if (symbol.line > line) break;
    owner = symbol.name;
  }
  return owner;
}

interface EffectPattern {
  readonly id: string;
  readonly label: string;
  readonly nodeKind: EffectRuntimeNodeKind;
  readonly edgeKind: EffectRuntimeEdgeKind;
  readonly regex: RegExp;
}

const EFFECT_PATTERNS: readonly EffectPattern[] = [
  { id: "foundry-document", label: "Foundry document mutation", nodeKind: "effect-sink", edgeKind: "mutates-document", regex: /\b(?:actor|item|token|document|combat|scene)\s*\.\s*(?:update|delete|createEmbeddedDocuments|updateEmbeddedDocuments|deleteEmbeddedDocuments)\s*\(/g },
  { id: "embedded-documents", label: "Embedded document mutation", nodeKind: "effect-sink", edgeKind: "mutates-document", regex: /\b(?:createEmbeddedDocuments|updateEmbeddedDocuments|deleteEmbeddedDocuments)\s*\(/g },
  { id: "settings", label: "Settings mutation or registration", nodeKind: "effect-sink", edgeKind: "writes-state", regex: /\bgame\s*\.\s*settings\s*\.\s*(?:set|register)\s*\(/g },
  { id: "hooks", label: "Foundry hook registration", nodeKind: "entry-point", edgeKind: "registers", regex: /\bHooks\s*\.\s*(?:on|once)\s*\(/g },
  { id: "hooks", label: "Foundry hook emission", nodeKind: "observation-point", edgeKind: "emits", regex: /\bHooks\s*\.\s*(?:call|callAll)\s*\(/g },
  { id: "hooks", label: "Foundry hook unregistration", nodeKind: "runtime-operation", edgeKind: "invokes-callback", regex: /\bHooks\s*\.\s*off\s*\(/g },
  { id: "chat-output", label: "Chat output", nodeKind: "observation-point", edgeKind: "observed-by", regex: /\bChatMessage\s*\.\s*create\s*\(/g },
  { id: "notifications", label: "User notification", nodeKind: "observation-point", edgeKind: "observed-by", regex: /\bui\s*\.\s*notifications\s*\.\s*(?:info|warn|error)\s*\(/g },
  { id: "canvas-token", label: "Canvas or token mutation", nodeKind: "effect-sink", edgeKind: "mutates-document", regex: /\b(?:canvas\s*\.\s*tokens|token\s*\.\s*document)\b[\s\S]{0,80}?\.\s*(?:setTarget|control|release|update)\s*\(/g },
  { id: "application-lifecycle", label: "Application lifecycle operation", nodeKind: "effect-sink", edgeKind: "crosses-integration-boundary", regex: /\b(?:FrameConnApplication|application|app)\s*\.\s*(?:render|close)\s*\(/g },
  { id: "native-execution", label: "Native execution boundary", nodeKind: "integration-boundary", edgeKind: "delegates-native", regex: /\b(?:(?:execute|run|roll)Native(?![A-Za-z0-9_$]*(?:Verification|Verifier|Probe|Check)\b)[A-Za-z0-9_$]*)\s*\(/g },
  { id: "network-request", label: "Network request", nodeKind: "integration-boundary", edgeKind: "crosses-integration-boundary", regex: /\b(?:fetch|axios\s*\.\s*(?:get|post|put|patch|delete))\s*\(/g },
  { id: "timer", label: "Scheduled callback", nodeKind: "entry-point", edgeKind: "registers", regex: /\b(?:setTimeout|setInterval|queueMicrotask)\s*\(/g },
  { id: "event-emission", label: "Event emission", nodeKind: "observation-point", edgeKind: "emits", regex: /\.\s*emit\s*\(/g }
];

function stableRuntimeId(prefix: string, parts: readonly (string | number)[]): string {
  return `${prefix}-${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 20)}`;
}

function extractRuntimeEvidence(file: string, text: string, symbols: readonly SymbolRecord[]): {
  readonly effects: readonly EffectRecord[];
  readonly nodes: readonly EffectRuntimeNode[];
  readonly edges: readonly EffectRuntimeEdge[];
} {
  const output: EffectRecord[] = [];
  const nodes: EffectRuntimeNode[] = [];
  const edges: EffectRuntimeEdge[] = [];
  for (const pattern of EFFECT_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    for (const match of text.matchAll(regex)) {
      const line = lineNumber(text, match.index ?? 0);
      const symbol = containingSymbol(symbols, line);
      const confidence = symbol === "<module>" ? "pattern-detected" as const : "lexically-associated" as const;
      const nodeId = stableRuntimeId("runtime-node", [file, pattern.nodeKind, pattern.id, line, symbol, pattern.label]);
      const operationId = stableRuntimeId("runtime-operation", [file, symbol]);
      output.push({ file, kind: pattern.id, detail: pattern.label, line, symbol });
      nodes.push(Object.freeze({ id: nodeId, kind: pattern.nodeKind, effectKind: pattern.id, file, symbol, lineStart: line, lineEnd: line, detail: pattern.label, confidence, extractionSource: "source-pattern", unresolvedReason: null }));
      if (symbol !== "<module>") {
        nodes.push(Object.freeze({ id: operationId, kind: "runtime-operation", effectKind: "symbol-operation", file, symbol, lineStart: symbols.find(candidate => candidate.name === symbol)?.line ?? line, lineEnd: line, detail: `Runtime operation ${symbol}`, confidence: "lexically-associated", extractionSource: "symbol-association", unresolvedReason: null }));
        edges.push(Object.freeze({ id: stableRuntimeId("runtime-edge", [operationId, pattern.edgeKind, nodeId]), kind: pattern.edgeKind, from: operationId, to: nodeId, file, line, confidence: "lexically-associated", extractionSource: "symbol-association", unresolvedReason: null }));
      } else {
        const unresolvedId = stableRuntimeId("runtime-unresolved", [file, pattern.id, line]);
        nodes.push(Object.freeze({ id: unresolvedId, kind: "unresolved-runtime-site", effectKind: pattern.id, file, symbol, lineStart: line, lineEnd: line, detail: `Owner unresolved for ${pattern.label}`, confidence: "unresolved", extractionSource: "source-pattern", unresolvedReason: "No enclosing symbol could be established from bounded source evidence." }));
        edges.push(Object.freeze({ id: stableRuntimeId("runtime-edge", [unresolvedId, "unresolved-runtime-link", nodeId]), kind: "unresolved-runtime-link", from: unresolvedId, to: nodeId, file, line, confidence: "unresolved", extractionSource: "source-pattern", unresolvedReason: "The effect site is detected, but its runtime owner is unresolved." }));
      }
    }
  }
  const uniqueNodes = new Map(nodes.map(node => [node.id, node] as const));
  const uniqueEdges = new Map(edges.map(edge => [edge.id, edge] as const));
  return Object.freeze({
    effects: Object.freeze(output.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind))),
    nodes: Object.freeze([...uniqueNodes.values()].sort((a, b) => a.file.localeCompare(b.file) || a.lineStart - b.lineStart || a.id.localeCompare(b.id))),
    edges: Object.freeze([...uniqueEdges.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.id.localeCompare(b.id)))
  });
}

interface ResolvedToken { readonly value: string; readonly resolved: boolean; }

function stringConstants(text: string): ReadonlyMap<string, string> {
  const output = new Map<string, string>();
  for (const match of text.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*["'`]([^"'`]*)["'`]\s*;/g)) if (match[1] && match[2] !== undefined) output.set(match[1], match[2]);
  return output;
}

function resolveToken(token: string, constants: ReadonlyMap<string, string>): ResolvedToken {
  const trimmed = token.trim();
  const literal = trimmed.match(/^["'`]([^"'`]*)["'`]$/);
  if (literal?.[1] !== undefined) return { value: literal[1], resolved: true };
  const constant = constants.get(trimmed);
  if (constant !== undefined) return { value: constant, resolved: true };
  return { value: trimmed || "<unknown>", resolved: false };
}

function extractStates(file: string, text: string): StateRecord[] {
  const constants = stringConstants(text);
  const output: StateRecord[] = [];
  let match: RegExpExecArray | null;
  const flagRegex = /\.\s*(getFlag|setFlag|unsetFlag)\s*\(\s*([^,\n)]+)\s*,\s*([^,\n)]+)(?:\s*,|\s*\))/g;
  while ((match = flagRegex.exec(text))) {
    const namespace = resolveToken(match[2] ?? "", constants), key = resolveToken(match[3] ?? "", constants), operation = match[1] ?? "getFlag";
    output.push({ kind: "foundry-flag", namespace: namespace.value, key: key.value, operation, access: operation === "getFlag" ? "read" : operation === "setFlag" ? "write" : "delete", namespaceResolved: namespace.resolved, keyResolved: key.resolved, file, line: lineNumber(text, match.index) });
  }
  const settingsRegex = /\bgame\s*\.\s*settings\s*\.\s*(register|get|set)\s*\(\s*([^,\n)]+)\s*,\s*([^,\n)]+)(?:\s*,|\s*\))/g;
  while ((match = settingsRegex.exec(text))) {
    const namespace = resolveToken(match[2] ?? "", constants), key = resolveToken(match[3] ?? "", constants), operation = match[1] ?? "get";
    output.push({ kind: "foundry-setting", namespace: namespace.value, key: key.value, operation, access: operation === "get" ? "read" : "write", namespaceResolved: namespace.resolved, keyResolved: key.resolved, file, line: lineNumber(text, match.index) });
  }
  const storageRegex = /\b(localStorage|sessionStorage)\s*\.\s*(getItem|setItem|removeItem)\s*\(\s*([^,\n)]+)(?:\s*,|\s*\))/g;
  while ((match = storageRegex.exec(text))) {
    const key = resolveToken(match[3] ?? "", constants), namespace = match[1] ?? "localStorage", operation = match[2] ?? "getItem";
    output.push({ kind: "web-storage", namespace, key: key.value, operation, access: operation === "getItem" ? "read" : operation === "setItem" ? "write" : "delete", namespaceResolved: true, keyResolved: key.resolved, file, line: lineNumber(text, match.index) });
  }
  const globalRegex = /\b(game|globalThis)\s*\.\s*([A-Za-z_$][\w$]*)\s*=/g;
  while ((match = globalRegex.exec(text))) output.push({ kind: "public-global", namespace: match[1] ?? "globalThis", key: match[2] ?? "<unknown>", operation: "assign", access: "write", namespaceResolved: true, keyResolved: true, file, line: lineNumber(text, match.index) });
  const flagPathRegex = /flags\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_.-]+)/g;
  while ((match = flagPathRegex.exec(text))) output.push({ kind: "flag-path", namespace: match[1] ?? "<unknown>", key: match[2] ?? "<unknown>", operation: "path-reference", access: "unknown", namespaceResolved: true, keyResolved: true, file, line: lineNumber(text, match.index) });
  return output.sort((a, b) => a.line - b.line || `${a.namespace}.${a.key}`.localeCompare(`${b.namespace}.${b.key}`));
}

export function parseSourceFile(file: string, text: string): FileFacts {
  const symbols = extractSymbols(file, text);
  const runtime = extractRuntimeEvidence(file, text, symbols);
  return Object.freeze({
    file,
    dependencies: Object.freeze(extractDependencies(file, text)),
    symbols: Object.freeze(symbols),
    effects: runtime.effects,
    runtimeNodes: runtime.nodes,
    runtimeEdges: runtime.edges,
    states: Object.freeze(extractStates(file, text)),
    contractSites: extractContractFileFacts(file, text),
    dataflow: extractDataflowFileFacts(file, text)
  });
}
