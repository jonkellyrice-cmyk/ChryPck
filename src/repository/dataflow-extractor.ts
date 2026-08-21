import { createHash } from "node:crypto";
import ts from "typescript";

import type { DataflowEdge, DataflowEdgeKind, DataflowFileFacts, DataflowGap, DataflowNode, DataflowNodeKind } from "./dataflow-types.js";
import { emptyDataflowFileFacts } from "./dataflow-types.js";

const SCRIPT_KINDS: Readonly<Record<string, ts.ScriptKind>> = Object.freeze({
  ".js": ts.ScriptKind.JS, ".mjs": ts.ScriptKind.JS, ".cjs": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX, ".ts": ts.ScriptKind.TS, ".mts": ts.ScriptKind.TS,
  ".cts": ts.ScriptKind.TS, ".tsx": ts.ScriptKind.TSX
});

function extension(path: string): string { return path.toLowerCase().match(/\.[^.\/]+$/)?.[0] ?? ""; }
function stableId(prefix: string, parts: readonly (string | number)[]): string { return `${prefix}-${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 20)}`; }
function compact(text: string, max = 160): string { const value = text.replace(/\s+/g, " ").trim(); return value.length <= max ? value : `${value.slice(0, max)}…`; }
function declaredName(node: ts.BindingName): string { return ts.isIdentifier(node) ? node.text : compact(node.getText(), 100); }

function containingSymbol(node: ts.Node): string {
  let current: ts.Node | undefined = node;
  while (current) {
    if ((ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isMethodDeclaration(current)) && current.name) return current.name.getText();
    if (ts.isArrowFunction(current) && ts.isVariableDeclaration(current.parent)) return declaredName(current.parent.name);
    current = current.parent;
  }
  return "<module>";
}

function calleeName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return `${calleeName(expression.expression)}.${expression.name.text}`;
  return compact(expression.getText(), 100);
}

function propertyName(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const argument = node.argumentExpression;
  return argument && (ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument)) ? argument.text : null;
}

function stateOperation(name: string): "read" | "write" | null {
  if (/\.(?:getFlag|getItem|get)$/.test(name)) return "read";
  if (/\.(?:setFlag|unsetFlag|setItem|removeItem|set)$/.test(name)) return "write";
  return null;
}

function isEffectSink(name: string): boolean {
  return /(?:\.update|\.delete|createEmbeddedDocuments|updateEmbeddedDocuments|deleteEmbeddedDocuments|ChatMessage\.create|ui\.notifications\.(?:info|warn|error)|Hooks\.(?:call|callAll)|\.emit)$/.test(name);
}

export function extractDataflowFileFacts(file: string, text: string): DataflowFileFacts {
  const scriptKind = SCRIPT_KINDS[extension(file)];
  if (scriptKind === undefined) return emptyDataflowFileFacts();
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind);
  const nodes = new Map<string, DataflowNode>(), edges = new Map<string, DataflowEdge>();
  const gaps: DataflowGap[] = [], controls: string[] = [];
  const expressionCache = new Map<string, DataflowNode>();
  let candidateSites = 0;

  const range = (node: ts.Node) => ({
    start: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    end: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1
  });
  const addGap = (node: ts.Node, kind: DataflowGap["kind"], summary: string): void => {
    const line = range(node).start, id = stableId("dataflow-gap", [file, line, kind, summary]);
    if (!gaps.some(gap => gap.id === id)) gaps.push(Object.freeze({ id, file, line, kind, summary }));
  };
  const addEdge = (from: string, to: string, kind: DataflowEdgeKind, node: ts.Node, unresolvedReason: string | null = null): void => {
    if (from === to && kind !== "aliases") return;
    const line = range(node).start, id = stableId("dataflow-edge", [from, kind, to, file, line]);
    edges.set(id, Object.freeze({ id, kind, from, to, file, line, confidence: unresolvedReason ? "unresolved" : "syntax-confirmed", extractionSource: "typescript-ast", unresolvedReason }));
  };
  const addNode = (node: ts.Node, kind: DataflowNodeKind, detail: string, value: string | null = null, unresolvedReason: string | null = null): DataflowNode => {
    const location = range(node), id = stableId("dataflow-node", [file, node.getStart(source), node.getEnd(), kind, value ?? ""]);
    const record: DataflowNode = Object.freeze({ id, kind, file, symbol: containingSymbol(node), value, lineStart: location.start, lineEnd: location.end, detail, confidence: unresolvedReason ? "unresolved" : "syntax-confirmed", extractionSource: "typescript-ast", unresolvedReason });
    nodes.set(id, record);
    for (const control of controls) addEdge(control, id, "control-dependency", node);
    return record;
  };

  const expressionNode = (expression: ts.Expression): DataflowNode => {
    const node = ts.isParenthesizedExpression(expression) ? expression.expression : expression;
    const cacheKey = `${node.pos}:${node.end}`, cached = expressionCache.get(cacheKey);
    if (cached) return cached;
    let result: DataflowNode;
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) {
      const value = compact(node.getText(source), 80);
      result = addNode(node, "literal-source", `Literal ${value}`, value);
    } else if (ts.isIdentifier(node)) {
      result = addNode(node, "declaration", `Reference ${node.text}`, node.text);
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const property = propertyName(node);
      result = addNode(node, property ? "property-read" : "unresolved-value-site", property ? `Read property ${property}` : "Dynamic property read", property, property ? null : "Computed property name is not statically resolved.");
      addEdge(expressionNode(node.expression).id, result.id, property ? "reads-property" : "unresolved-flow", node, property ? null : "Computed property name is not statically resolved.");
      if (!property) addGap(node, "dynamic-access", "Computed property read cannot be statically resolved.");
    } else if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression), operation = stateOperation(name);
      const kind: DataflowNodeKind = operation === "read" ? "state-read" : operation === "write" ? "state-write" : isEffectSink(name) ? "effect-sink" : "call-result";
      result = addNode(node, kind, `${operation ? `${operation} state through` : kind === "effect-sink" ? "Effect sink" : "Result of"} ${name}`, name);
      if (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) {
        addEdge(expressionNode(node.expression.expression).id, result.id, operation === "read" ? "reads-state" : operation === "write" ? "writes-state" : "transforms", node);
      }
      node.arguments.forEach((argument, index) => {
        const value = expressionNode(argument);
        const argumentNode = addNode(argument, "call-argument", `Argument ${index + 1} to ${name}`, `${name}#${index}`);
        addEdge(value.id, argumentNode.id, "passes-argument", argument);
        addEdge(argumentNode.id, result.id, operation === "read" ? "reads-state" : operation === "write" ? "writes-state" : "passes-argument", argument);
      });
    } else if (ts.isAwaitExpression(node)) {
      result = addNode(node, "transformation", "Awaited value", "await");
      addEdge(expressionNode(node.expression).id, result.id, "transforms", node);
    } else if (ts.isBinaryExpression(node) || ts.isConditionalExpression(node) || ts.isTemplateExpression(node) || ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) {
      result = addNode(node, "transformation", `Transform ${compact(node.getText(source), 100)}`);
      node.forEachChild(child => { if (ts.isExpression(child) && child !== node) addEdge(expressionNode(child).id, result.id, "transforms", child); });
    } else {
      const syntax = ts.SyntaxKind[node.kind];
      result = addNode(node, "unresolved-value-site", `Unsupported expression ${syntax}`, null, "Expression kind is not yet modeled by the Dataflow substrate.");
      addGap(node, "unsupported-syntax", `Unsupported dataflow expression: ${syntax}.`);
    }
    expressionCache.set(cacheKey, result);
    return result;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node)) {
      candidateSites += 1;
      const condition = addNode(node.expression, "control-condition", `Condition ${compact(node.expression.getText(source), 100)}`);
      controls.push(condition.id); visit(node.thenStatement); if (node.elseStatement) visit(node.elseStatement); controls.pop(); return;
    }
    if (ts.isParameter(node)) {
      candidateSites += 1;
      const parameter = addNode(node, "parameter", `Parameter ${declaredName(node.name)}`, declaredName(node.name));
      if (node.initializer) addEdge(expressionNode(node.initializer).id, parameter.id, "defines", node);
    } else if (ts.isVariableDeclaration(node)) {
      candidateSites += 1;
      const name = declaredName(node.name), declaration = addNode(node.name, "declaration", `Declaration ${name}`, name);
      if (node.initializer) addEdge(expressionNode(node.initializer).id, declaration.id, ts.isIdentifier(node.initializer) ? "aliases" : ts.isCallExpression(node.initializer) ? "receives-result" : "defines", node);
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      candidateSites += 1;
      const propertyWrite = ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left);
      const target = addNode(node.left, propertyWrite ? "property-write" : "assignment", `Assign ${compact(node.left.getText(source), 100)}`, compact(node.left.getText(source), 100));
      addEdge(expressionNode(node.right).id, target.id, propertyWrite ? "writes-property" : "assigns", node);
    } else if (ts.isReturnStatement(node)) {
      candidateSites += 1;
      const returned = addNode(node, "return-value", "Returned value", containingSymbol(node));
      if (node.expression) addEdge(expressionNode(node.expression).id, returned.id, "returns", node);
    } else if (ts.isCallExpression(node) && !expressionCache.has(`${node.pos}:${node.end}`)) {
      candidateSites += 1; expressionNode(node);
    }
    ts.forEachChild(node, visit);
  };

  const parseDiagnostics = (source as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
  for (const diagnostic of parseDiagnostics) {
    const position = diagnostic.start ?? 0, line = source.getLineAndCharacterOfPosition(position).line + 1;
    const summary = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    gaps.push(Object.freeze({ id: stableId("dataflow-gap", [file, line, "parse-error", summary]), file, line, kind: "parse-error", summary }));
  }
  visit(source);
  const orderedNodes = [...nodes.values()].sort((a, b) => a.lineStart - b.lineStart || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const orderedEdges = [...edges.values()].sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const orderedGaps = [...new Map(gaps.map(gap => [gap.id, gap] as const)).values()].sort((a, b) => a.line - b.line || a.id.localeCompare(b.id));
  const unresolvedSites = orderedNodes.filter(node => node.confidence === "unresolved").length;
  return Object.freeze({ nodes: Object.freeze(orderedNodes), edges: Object.freeze(orderedEdges), gaps: Object.freeze(orderedGaps), coverage: Object.freeze({ candidateSites, classifiedSites: Math.max(0, candidateSites - unresolvedSites), unresolvedSites, parserGaps: orderedGaps.length, partial: unresolvedSites > 0 || orderedGaps.length > 0 }) });
}
