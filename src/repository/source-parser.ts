import type { DependencyKind, DependencyReference, EffectRecord, FileFacts, StateRecord, SymbolRecord } from "./model.js";
import { repositoryExtension } from "./source-profile.js";

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

const EFFECT_PATTERNS: readonly { readonly id: string; readonly label: string; readonly regex: RegExp }[] = [
  { id: "foundry-document", label: "Foundry documents", regex: /\b(?:actor|item|token|document|combat|scene)\s*\.\s*(?:update|delete|createEmbeddedDocuments|updateEmbeddedDocuments|deleteEmbeddedDocuments)\s*\(/g },
  { id: "embedded-documents", label: "Embedded documents", regex: /\b(?:createEmbeddedDocuments|updateEmbeddedDocuments|deleteEmbeddedDocuments)\s*\(/g },
  { id: "settings", label: "Settings", regex: /\bgame\s*\.\s*settings\s*\.\s*(?:set|register)\s*\(/g },
  { id: "hooks", label: "Foundry hooks", regex: /\bHooks\s*\.\s*(?:on|once|off|call|callAll)\s*\(/g },
  { id: "chat-output", label: "Chat/output", regex: /\bChatMessage\s*\.\s*create\s*\(/g },
  { id: "notifications", label: "Notifications", regex: /\bui\s*\.\s*notifications\s*\.\s*(?:info|warn|error)\s*\(/g },
  { id: "canvas-token", label: "Canvas/token", regex: /\b(?:canvas\s*\.\s*tokens|token\s*\.\s*document)\b[\s\S]{0,80}?\.\s*(?:setTarget|control|release|update)\s*\(/g },
  { id: "application-lifecycle", label: "Application lifecycle", regex: /\b(?:FrameConnApplication|application|app)\s*\.\s*(?:render|close)\s*\(/g },
  { id: "native-execution", label: "Native execution", regex: /\b(?:(?:execute|run|roll)Native(?![A-Za-z0-9_$]*(?:Verification|Verifier|Probe|Check)\b)[A-Za-z0-9_$]*)\s*\(/g }
];

function extractEffects(file: string, text: string, symbols: readonly SymbolRecord[]): EffectRecord[] {
  const output: EffectRecord[] = [];
  for (const pattern of EFFECT_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    for (const match of text.matchAll(regex)) {
      const line = lineNumber(text, match.index ?? 0);
      output.push({ file, kind: pattern.id, detail: pattern.label, line, symbol: containingSymbol(symbols, line) });
    }
  }
  return output.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
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
  return Object.freeze({
    file,
    dependencies: Object.freeze(extractDependencies(file, text)),
    symbols: Object.freeze(symbols),
    effects: Object.freeze(extractEffects(file, text, symbols)),
    states: Object.freeze(extractStates(file, text))
  });
}
