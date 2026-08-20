import ts from "typescript";
import type {
  ContractCallSite,
  ContractDeclarationSite,
  ContractEventSite,
  ContractFileFacts,
  ContractImportBinding,
  ContractParseGap,
  ContractValue
} from "./contract-types.js";
import { repositoryExtension } from "./source-profile.js";

const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts"]);

function scriptKind(file: string): ts.ScriptKind {
  switch (repositoryExtension(file)) {
    case ".tsx": return ts.ScriptKind.TSX;
    case ".jsx": return ts.ScriptKind.JSX;
    case ".js": case ".mjs": case ".cjs": return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function modifiers(node: ts.Node): readonly ts.Modifier[] {
  return ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return modifiers(node).some(modifier => modifier.kind === kind);
}

function nodeName(node: ts.Node): string | null {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text;
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function typeText(node: ts.TypeNode | undefined, source: ts.SourceFile): string | null {
  return node ? node.getText(source).replace(/\s+/g, " ").trim() : null;
}

function parameters(values: readonly ts.ParameterDeclaration[], source: ts.SourceFile): readonly ContractValue[] {
  return Object.freeze(values.map((parameter, index) => Object.freeze({
    name: nodeName(parameter.name) ?? `parameter-${index + 1}`,
    type: typeText(parameter.type, source),
    optional: Boolean(parameter.questionToken || parameter.initializer),
    rest: Boolean(parameter.dotDotDotToken)
  })));
}

function containingSymbol(node: ts.Node): string {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current) || ts.isMethodDeclaration(current)) {
      return current.name ? nodeName(current.name) ?? "<anonymous>" : "<anonymous>";
    }
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
    current = current.parent;
  }
  return "<module>";
}

function expressionName(node: ts.Expression): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${expressionName(node.expression)}.${node.name.text}`;
  if (ts.isElementAccessExpression(node)) return `${expressionName(node.expression)}[${node.argumentExpression?.getText() ?? "?"}]`;
  return node.getText().replace(/\s+/g, " ").slice(0, 160);
}

function callbackName(node: ts.Expression, index: number): string | null {
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) return expressionName(node);
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return `<callback-${index + 1}>`;
  return null;
}

function callbackArguments(target: string, args: readonly ts.Expression[]): readonly string[] {
  if (!/(?:^|\.)(?:map|filter|reduce|forEach|then|catch|finally|on|once|addEventListener|register)$/.test(target)) return Object.freeze([]);
  return Object.freeze(args.map(callbackName).filter((value): value is string => value !== null));
}

function literalToken(node: ts.Expression | undefined): { value: string; resolved: boolean } {
  if (node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node))) return { value: node.text, resolved: true };
  return { value: node?.getText().replace(/\s+/g, " ").slice(0, 160) || "<unknown>", resolved: false };
}

function diagnosticGaps(file: string, source: ts.SourceFile): readonly ContractParseGap[] {
  const diagnostics = (source as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
  return Object.freeze(diagnostics.map(diagnostic => {
    const position = diagnostic.start ?? 0;
    return Object.freeze({
      file,
      line: source.getLineAndCharacterOfPosition(position).line + 1,
      summary: ts.flattenDiagnosticMessageText(diagnostic.messageText, " ").slice(0, 240)
    });
  }));
}

export function extractContractFileFacts(file: string, text: string): ContractFileFacts {
  if (!SCRIPT_EXTENSIONS.has(repositoryExtension(file))) {
    return Object.freeze({ declarations: Object.freeze([]), imports: Object.freeze([]), calls: Object.freeze([]), events: Object.freeze([]), gaps: Object.freeze([]) });
  }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const declarations: ContractDeclarationSite[] = [];
  const imports: ContractImportBinding[] = [];
  const calls: ContractCallSite[] = [];
  const events: ContractEventSite[] = [];

  const declaration = (
    node: ts.Node,
    name: string,
    kind: ContractDeclarationSite["kind"],
    params: readonly ts.ParameterDeclaration[] = [],
    output?: ts.TypeNode,
    exportedOverride?: boolean
  ) => declarations.push(Object.freeze({
    file,
    name,
    kind,
    exported: exportedOverride ?? hasModifier(node, ts.SyntaxKind.ExportKeyword),
    defaultExport: hasModifier(node, ts.SyntaxKind.DefaultKeyword),
    async: hasModifier(node, ts.SyntaxKind.AsyncKeyword),
    inputs: parameters(params, source),
    output: typeText(output, source),
    line: lineOf(source, node)
  }));

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (clause?.name) imports.push(Object.freeze({ file, localName: clause.name.text, importedName: "default", specifier, line: lineOf(source, node) }));
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) imports.push(Object.freeze({
          file,
          localName: element.name.text,
          importedName: element.propertyName?.text ?? element.name.text,
          specifier,
          line: lineOf(source, element)
        }));
      }
    }

    if (ts.isFunctionDeclaration(node) && node.name) declaration(node, node.name.text, "function", node.parameters, node.type);
    else if (ts.isClassDeclaration(node) && node.name) declaration(node, node.name.text, "class");
    else if (ts.isMethodDeclaration(node) && node.name) declaration(node, nodeName(node.name) ?? "<computed-method>", "method", node.parameters, node.type);
    else if (ts.isVariableStatement(node)) {
      const exported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
      for (const item of node.declarationList.declarations) {
        if (!ts.isIdentifier(item.name)) continue;
        if (item.initializer && (ts.isArrowFunction(item.initializer) || ts.isFunctionExpression(item.initializer))) {
          declaration(node, item.name.text, "variable", item.initializer.parameters, item.initializer.type, exported);
        }
      }
    }

    const call = ts.isCallExpression(node) || ts.isNewExpression(node) ? node : null;
    if (call) {
      const args = call.arguments ?? [];
      const target = expressionName(call.expression);
      const callbacks = callbackArguments(target, args);
      calls.push(Object.freeze({
        file,
        caller: containingSymbol(node),
        target,
        argumentCount: args.length,
        callbackArguments: callbacks,
        constructed: ts.isNewExpression(node),
        line: lineOf(source, node)
      }));
      if (ts.isPropertyAccessExpression(call.expression) && expressionName(call.expression.expression) === "Hooks") {
        const operation = call.expression.name.text;
        if (["on", "once", "off", "call", "callAll"].includes(operation)) {
          const token = literalToken(args[0]);
          const listener = operation === "on" || operation === "once" || operation === "off";
          events.push(Object.freeze({
            file,
            owner: containingSymbol(node),
            operation: operation as ContractEventSite["operation"],
            role: listener ? "listener" : "producer",
            eventName: token.value,
            eventNameResolved: token.resolved,
            payloadCount: Math.max(0, args.length - (listener ? 2 : 1)),
            handler: listener ? callbackName(args[1]!, 0) : null,
            line: lineOf(source, node)
          }));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const byLineName = <T extends { readonly line: number }>(left: T, right: T) => left.line - right.line;
  return Object.freeze({
    declarations: Object.freeze(declarations.sort(byLineName)),
    imports: Object.freeze(imports.sort(byLineName)),
    calls: Object.freeze(calls.sort(byLineName)),
    events: Object.freeze(events.sort(byLineName)),
    gaps: diagnosticGaps(file, source)
  });
}
