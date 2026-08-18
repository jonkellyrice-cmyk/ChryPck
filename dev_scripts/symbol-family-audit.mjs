/**
 * dev_scripts/symbol-family-audit.mjs
 *
 * Frame Conn Symbol Family Tree
 *
 * Builds a hidden static symbol graph, then compresses it into semantic
 * symbol families. The graph itself is intentionally not serialized.
 *
 * Healthy families are summarized. Detailed findings are emitted only for
 * suspicious ownership, naming, usage, or boundary conditions.
 *
 * This is a static analysis tool. It does not execute Foundry or module code.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_VERSION = "1.0.0";
const SCRIPT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_FILE);
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");

const SOURCE_ROOTS = [
  "scripts",
  "styles",
  "action_economy",
  "actor_owned_feature_registry",
  "execution_transaction",
  "lifecycle_service",
  "native_adapter",
  "resource_service",
  "semantic_event_bus",
  "semantic_execution_context",
  "system_bridge",
  "targeting-spatial_service"
];

const JAVASCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".github",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "backups",
  "patch-history"
]);

const requestedOutputIndex = process.argv.indexOf("--output");
const requestedOutput =
  requestedOutputIndex >= 0
    ? process.argv[requestedOutputIndex + 1] ?? null
    : null;

const OUTPUT_FILE = requestedOutput
  ? path.resolve(REPOSITORY_ROOT, requestedOutput)
  : path.join(REPOSITORY_ROOT, "symbol-family-audit-report.json");

const findings = [];

function normalizeSlashes(value) {
  return String(value).replaceAll("\\", "/");
}

function relativePath(absolutePath) {
  return normalizeSlashes(path.relative(REPOSITORY_ROOT, absolutePath));
}

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function addFinding({
  severity,
  code,
  message,
  file = null,
  line = null,
  symbol = null,
  family = null,
  details = null
}) {
  findings.push({
    severity,
    code,
    message,
    file: file ? relativePath(file) : null,
    line,
    symbol,
    family,
    details
  });
}

function getLineNumber(text, index) {
  if (!Number.isFinite(index) || index < 0) return null;
  return text.slice(0, index).split("\n").length;
}

function collectJavaScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;

    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(absolutePath));
      continue;
    }

    if (
      entry.isFile() &&
      JAVASCRIPT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      files.push(absolutePath);
    }
  }

  return files;
}

function collectSourceFiles() {
  return [
    ...new Set(
      SOURCE_ROOTS.flatMap(root =>
        collectJavaScriptFiles(path.join(REPOSITORY_ROOT, root))
      )
    )
  ].sort();
}

function possibleImportTargets(sourceFile, importSpecifier) {
  if (!importSpecifier.startsWith(".")) return [];

  const base = path.resolve(path.dirname(sourceFile), importSpecifier);

  if (path.extname(base)) return [base];

  return [
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, "index.js"),
    path.join(base, "index.mjs")
  ];
}

function resolveRelativeImport(sourceFile, importSpecifier) {
  return (
    possibleImportTargets(sourceFile, importSpecifier).find(fileExists) ?? null
  );
}

function extractImports(text) {
  const imports = [];
  const regex =
    /^[ \t]*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;?/gm;
  let match;

  while ((match = regex.exec(text))) {
    const clause = match[1].trim();
    const source = match[2];
    const names = [];

    const block = clause.match(/\{([\s\S]*?)\}/);
    if (block) {
      for (const raw of block[1].split(",")) {
        const entry = raw.trim();
        if (!entry) continue;

        const alias = entry.match(
          /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/
        );

        names.push({
          imported: alias ? alias[1] : entry,
          local: alias ? alias[2] : entry,
          kind: "named"
        });
      }
    }

    const namespace = clause.match(
      /\*\s+as\s+([A-Za-z_$][\w$]*)/
    );
    if (namespace) {
      names.push({
        imported: "*",
        local: namespace[1],
        kind: "namespace"
      });
    }

    const leadingDefault = clause
      .replace(/\{[\s\S]*?\}/, "")
      .replace(/\*\s+as\s+[A-Za-z_$][\w$]*/, "")
      .replace(/,/g, "")
      .trim();

    if (/^[A-Za-z_$][\w$]*$/.test(leadingDefault)) {
      names.push({
        imported: "default",
        local: leadingDefault,
        kind: "default"
      });
    }

    imports.push({
      source,
      names,
      index: match.index,
      statement: match[0]
    });
  }

  return imports;
}

function extractDeclarations(file, text) {
  const declarations = [];
  const patterns = [
    {
      kind: "function",
      regex:
        /^(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm
    },
    {
      kind: "class",
      regex:
        /^(export\s+)?class\s+([A-Za-z_$][\w$]*)/gm
    },
    {
      kind: "binding",
      regex:
        /^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm
    }
  ];

  for (const { kind, regex } of patterns) {
    let match;
    while ((match = regex.exec(text))) {
      declarations.push({
        id: `${relativePath(file)}#${match[2]}`,
        name: match[2],
        kind,
        file,
        line: getLineNumber(text, match.index),
        exported: Boolean(match[1]),
        defaultExport: false
      });
    }
  }

  const exportBlocks = /export\s*\{([\s\S]*?)\}/g;
  let exportMatch;

  while ((exportMatch = exportBlocks.exec(text))) {
    for (const raw of exportMatch[1].split(",")) {
      const entry = raw.trim();
      if (!entry) continue;

      const alias = entry.match(
        /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/
      );
      const localName = alias ? alias[1] : entry;

      const declaration = declarations.find(item => item.name === localName);
      if (declaration) declaration.exported = true;
    }
  }

  const defaultName =
    text.match(
      /export\s+default\s+(?:class|function)?\s*([A-Za-z_$][\w$]*)?/
    )?.[1] ?? null;

  if (defaultName) {
    const declaration = declarations.find(item => item.name === defaultName);
    if (declaration) {
      declaration.exported = true;
      declaration.defaultExport = true;
    }
  }

  return declarations;
}

function tokenizeIdentifiers(text) {
  const counts = new Map();
  const regex = /\b[A-Za-z_$][\w$]*\b/g;
  let match;

  while ((match = regex.exec(text))) {
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  }

  return counts;
}

function normalizeFamilyToken(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replaceAll("_", "-")
    .replace(/\.(?:js|mjs|cjs)$/i, "")
    .replace(/-feature$/i, "")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function deriveFileFamily(file) {
  const relative = relativePath(file);
  const parts = relative.split("/");
  const basename = normalizeFamilyToken(path.basename(relative));

  if (relative.startsWith("scripts/feature_actions/")) return "actions";
  if (relative.startsWith("scripts/feature_turn/")) return "turn";

  if (relative.startsWith("styles/")) {
    if (relative.includes("ui_application/")) return "ui-application";
    if (relative.includes("ui_movement/")) return "ui-movement";
    if (relative.includes("ui_turn/")) return "ui-turn";
    if (relative.includes("ui-sensors")) return "ui-sensors";
    if (relative.endsWith("ui-registry.js")) return "ui-composition";

    const uiMatch = basename.match(/^ui-([a-z0-9-]+)/);
    if (uiMatch) return `ui-${uiMatch[1]}`;
    return "ui-composition";
  }

  if (relative.startsWith("scripts/")) {
    if (
      basename === "runtime-orchestrator" ||
      basename.startsWith("feature-registry")
    ) {
      return "runtime-composition";
    }

    if (basename === "foundry-integration") return "foundry-integration";
    if (basename.startsWith("foundry-integration")) return "foundry-integration";
    if (basename.startsWith("movement")) return "movement";
    if (basename.startsWith("sensors")) return "sensors";

    const featureMatch = basename.match(/^([a-z0-9-]+)-feature$/);
    if (featureMatch) return featureMatch[1];

    return basename;
  }

  const root = parts[0];
  if (SOURCE_ROOTS.includes(root)) return normalizeFamilyToken(root);

  return basename;
}

const LEADING_VERBS = new Set([
  "add",
  "apply",
  "begin",
  "build",
  "calculate",
  "collect",
  "commit",
  "configure",
  "create",
  "derive",
  "dispatch",
  "emit",
  "end",
  "ensure",
  "execute",
  "find",
  "get",
  "handle",
  "initialize",
  "is",
  "make",
  "normalize",
  "open",
  "prepare",
  "read",
  "register",
  "render",
  "reset",
  "resolve",
  "run",
  "set",
  "snapshot",
  "start",
  "sync",
  "update",
  "validate"
]);

function symbolStem(name) {
  const stripped = name
    .replace(/^FrameConn/, "")
    .replace(/^frameConn/, "")
    .replace(/^FRAME_CONN_/, "")
    .replace(/^frame_conn_/, "");

  const words = stripped
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  while (words.length > 1 && LEADING_VERBS.has(words[0])) {
    words.shift();
  }

  return words.slice(0, 3).join("-");
}

function isLikelyPublicSurface(symbol) {
  const relative = relativePath(symbol.file);

  return (
    relative.endsWith("-feature.js") ||
    relative.includes("registry") ||
    relative.includes("contract") ||
    relative.includes("runtime-orchestrator") ||
    relative.includes("foundry-integration") ||
    symbol.name.endsWith("Feature") ||
    symbol.name.endsWith("Registry")
  );
}

const FORBIDDEN_DIRECT_BOUNDARIES = [
  {
    fromPrefix: "styles/",
    toPrefixes: [
      "native_adapter/",
      "execution_transaction/",
      "lifecycle_service/",
      "targeting-spatial_service/",
      "system_bridge/"
    ],
    message:
      "UI presentation code should consume composed feature/runtime APIs rather than importing deep execution infrastructure directly."
  },
  {
    fromPrefixes: [
      "native_adapter/",
      "execution_transaction/",
      "lifecycle_service/",
      "targeting-spatial_service/",
      "system_bridge/",
      "semantic_execution_context/"
    ],
    toPrefixes: ["styles/"],
    message:
      "Execution/service infrastructure should not depend directly on the presentation layer."
  }
];

function inspectBoundary(sourceFile, targetFile, importStatement) {
  const source = relativePath(sourceFile);
  const target = relativePath(targetFile);

  for (const rule of FORBIDDEN_DIRECT_BOUNDARIES) {
    const fromPrefixes = rule.fromPrefixes ?? [rule.fromPrefix];
    const fromMatches = fromPrefixes.some(prefix => source.startsWith(prefix));
    const toMatches = rule.toPrefixes.some(prefix => target.startsWith(prefix));

    if (fromMatches && toMatches) {
      addFinding({
        severity: "warning",
        code: "SYMBOL_BOUNDARY_CROSSING",
        message: rule.message,
        file: sourceFile,
        details: {
          target,
          import: importStatement.trim()
        }
      });
    }
  }
}

function buildSymbolModel(files, textByFile) {
  const symbols = [];
  const symbolsByFile = new Map();
  const symbolNameIndex = new Map();
  const identifierCountsByFile = new Map();
  const importsByFile = new Map();

  for (const file of files) {
    const text = textByFile.get(file) ?? "";
    const declarations = extractDeclarations(file, text);
    symbolsByFile.set(file, declarations);
    identifierCountsByFile.set(file, tokenizeIdentifiers(text));
    importsByFile.set(file, extractImports(text));

    for (const symbol of declarations) {
      symbol.family = deriveFileFamily(file);
      symbol.stem = symbolStem(symbol.name);
      symbol.incoming = new Set();
      symbol.outgoing = new Set();
      symbol.externalReferences = new Set();
      symbols.push(symbol);

      const group = symbolNameIndex.get(symbol.name) ?? [];
      group.push(symbol);
      symbolNameIndex.set(symbol.name, group);
    }
  }

  const symbolById = new Map(symbols.map(symbol => [symbol.id, symbol]));

  for (const [sourceFile, imports] of importsByFile) {
    for (const imported of imports) {
      if (!imported.source.startsWith(".")) continue;

      const targetFile = resolveRelativeImport(sourceFile, imported.source);
      if (!targetFile || !symbolsByFile.has(targetFile)) continue;

      inspectBoundary(sourceFile, targetFile, imported.statement);

      for (const importedName of imported.names) {
        if (importedName.kind !== "named") continue;

        const target = (symbolsByFile.get(targetFile) ?? []).find(
          symbol => symbol.name === importedName.imported
        );

        if (!target) continue;

        const sourceCandidates =
          symbolNameIndex.get(importedName.local) ?? [];

        target.externalReferences.add(sourceFile);

        for (const sourceSymbol of sourceCandidates) {
          if (sourceSymbol.file !== sourceFile) continue;
          sourceSymbol.outgoing.add(target.id);
          target.incoming.add(sourceSymbol.id);
        }
      }
    }
  }

  // Add conservative reference edges only where the symbol name is globally unique.
  for (const symbol of symbols) {
    if ((symbolNameIndex.get(symbol.name) ?? []).length !== 1) continue;

    for (const file of files) {
      if (file === symbol.file) continue;
      const count = identifierCountsByFile.get(file)?.get(symbol.name) ?? 0;
      if (count <= 0) continue;

      symbol.externalReferences.add(file);

      for (const sourceSymbol of symbolsByFile.get(file) ?? []) {
        const sourceCount =
          identifierCountsByFile.get(file)?.get(sourceSymbol.name) ?? 0;

        if (sourceCount > 0) {
          sourceSymbol.outgoing.add(symbol.id);
          symbol.incoming.add(sourceSymbol.id);
        }
      }
    }
  }

  return {
    symbols,
    symbolsByFile,
    symbolNameIndex,
    identifierCountsByFile,
    importsByFile,
    symbolById
  };
}

function inspectSymbolHealth(model, textByFile) {
  for (const symbol of model.symbols) {
    const text = textByFile.get(symbol.file) ?? "";
    const ownCount =
      model.identifierCountsByFile.get(symbol.file)?.get(symbol.name) ?? 0;

    if (
      /FrameHelm|frameHelm|FRAME_HELM|frame_helm/.test(symbol.name)
    ) {
      addFinding({
        severity: "warning",
        code: "SYMBOL_NAMING_DRIFT",
        message:
          "Live symbol still carries the retired Frame Helm identity.",
        file: symbol.file,
        line: symbol.line,
        symbol: symbol.name,
        family: symbol.family
      });
    }

    if (
      !symbol.exported &&
      ownCount <= 1 &&
      symbol.externalReferences.size === 0
    ) {
      addFinding({
        severity: "info",
        code: "POSSIBLY_UNUSED_PRIVATE_SYMBOL",
        message:
          "Private symbol is declared but has no statically visible use.",
        file: symbol.file,
        line: symbol.line,
        symbol: symbol.name,
        family: symbol.family
      });
    }

    if (
      symbol.exported &&
      symbol.externalReferences.size === 0 &&
      !isLikelyPublicSurface(symbol)
    ) {
      addFinding({
        severity: "info",
        code: "POSSIBLY_UNUSED_EXPORTED_SYMBOL",
        message:
          "Exported symbol has no statically visible repository consumer.",
        file: symbol.file,
        line: symbol.line,
        symbol: symbol.name,
        family: symbol.family,
        details: {
          note:
            "Dynamic Foundry hooks, globals, reflection, or external consumers may still use this symbol."
        }
      });
    }

    // Same-file repeated declaration names are a strong structural defect.
    const sameFileSameName = (model.symbolNameIndex.get(symbol.name) ?? []).filter(
      candidate => candidate.file === symbol.file
    );

    if (sameFileSameName.length > 1 && sameFileSameName[0].id === symbol.id) {
      addFinding({
        severity: "error",
        code: "DUPLICATE_TOP_LEVEL_SYMBOL",
        message:
          "The same top-level symbol name is declared more than once in one file.",
        file: symbol.file,
        line: symbol.line,
        symbol: symbol.name,
        family: symbol.family,
        details: {
          declarations: sameFileSameName.map(item => item.line)
        }
      });
    }

    void text;
  }
}

function buildFamilies(model) {
  const families = new Map();

  for (const symbol of model.symbols) {
    const family = families.get(symbol.family) ?? {
      id: symbol.family,
      symbols: [],
      files: new Set(),
      exportedSymbols: 0,
      privateSymbols: 0,
      incomingFamilies: new Set(),
      outgoingFamilies: new Set(),
      stems: new Map()
    };

    family.symbols.push(symbol);
    family.files.add(symbol.file);

    if (symbol.exported) family.exportedSymbols += 1;
    else family.privateSymbols += 1;

    if (symbol.stem) {
      family.stems.set(
        symbol.stem,
        (family.stems.get(symbol.stem) ?? 0) + 1
      );
    }

    families.set(symbol.family, family);
  }

  for (const family of families.values()) {
    for (const symbol of family.symbols) {
      for (const incomingId of symbol.incoming) {
        const incoming = model.symbolById.get(incomingId);
        if (incoming && incoming.family !== family.id) {
          family.incomingFamilies.add(incoming.family);
        }
      }

      for (const outgoingId of symbol.outgoing) {
        const outgoing = model.symbolById.get(outgoingId);
        if (outgoing && outgoing.family !== family.id) {
          family.outgoingFamilies.add(outgoing.family);
        }
      }

      for (const referenceFile of symbol.externalReferences) {
        const referenceFamily = deriveFileFamily(referenceFile);
        if (referenceFamily !== family.id) {
          family.incomingFamilies.add(referenceFamily);
        }
      }
    }
  }

  return families;
}

function inspectFamilyHealth(families, model) {
  const stemFamilies = new Map();

  for (const family of families.values()) {
    for (const [stem, count] of family.stems) {
      if (!stem || count < 2) continue;
      const owners = stemFamilies.get(stem) ?? new Set();
      owners.add(family.id);
      stemFamilies.set(stem, owners);
    }
  }

  for (const [stem, owners] of stemFamilies) {
    if (owners.size < 2) continue;

    const connected = [...owners].some(left => {
      const family = families.get(left);
      return [...owners].some(
        right =>
          right !== left &&
          (family.incomingFamilies.has(right) ||
            family.outgoingFamilies.has(right))
      );
    });

    if (!connected) {
      addFinding({
        severity: "info",
        code: "SEMANTIC_STEM_SPLIT_ACROSS_FAMILIES",
        message:
          `Symbol stem "${stem}" appears in multiple disconnected families.`,
        details: {
          families: [...owners].sort()
        }
      });
    }
  }

  // Detect exported names with several unrelated owners. This is not
  // inherently wrong, but it is useful vocabulary pressure information.
  for (const [name, symbols] of model.symbolNameIndex) {
    const exported = symbols.filter(symbol => symbol.exported);
    const owners = new Set(exported.map(symbol => symbol.family));

    if (exported.length > 1 && owners.size > 1) {
      addFinding({
        severity: "info",
        code: "SHARED_EXPORTED_SYMBOL_NAME",
        message:
          `Exported symbol name "${name}" is owned by multiple families.`,
        symbol: name,
        details: {
          families: [...owners].sort(),
          locations: exported.map(symbol => relativePath(symbol.file))
        }
      });
    }
  }
}

function familyStatus(family) {
  const familyFindings = findings.filter(finding => {
    if (finding.family === family.id) return true;
    if (!finding.file) return false;
    return family.files.has(path.resolve(REPOSITORY_ROOT, finding.file));
  });

  if (familyFindings.some(finding => finding.severity === "error")) {
    return "error";
  }

  if (familyFindings.some(finding => finding.severity === "warning")) {
    return "warning";
  }

  return "healthy";
}

function serializeFamily(family) {
  const topStems = [...family.stems.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([stem, count]) => ({ stem, count }));

  const familyFindings = findings
    .filter(finding => {
      if (finding.family === family.id) return true;
      if (!finding.file) return false;
      return family.files.has(path.resolve(REPOSITORY_ROOT, finding.file));
    })
    .filter(finding => finding.severity !== "info");

  return {
    id: family.id,
    status: familyStatus(family),
    symbolCount: family.symbols.length,
    fileCount: family.files.size,
    exportedSymbols: family.exportedSymbols,
    privateSymbols: family.privateSymbols,
    incomingFamilies: [...family.incomingFamilies].sort(),
    outgoingFamilies: [...family.outgoingFamilies].sort(),
    locations: [...family.files].map(relativePath).sort(),
    topStems,
    problems: familyFindings
  };
}

function countSeverity(severity) {
  return findings.filter(finding => finding.severity === severity).length;
}

function buildReport(files, model, families) {
  const serializedFamilies = [...families.values()]
    .map(serializeFamily)
    .sort(
      (left, right) =>
        right.symbolCount - left.symbolCount ||
        left.id.localeCompare(right.id)
    );

  const familyBridges = new Set();

  for (const family of serializedFamilies) {
    for (const target of family.outgoingFamilies) {
      familyBridges.add(`${family.id}->${target}`);
    }
  }

  const warnings = countSeverity("warning");
  const errors = countSeverity("error");
  const info = countSeverity("info");

  return {
    audit: {
      name: "Frame Conn Symbol Family Tree",
      scriptVersion: SCRIPT_VERSION,
      generatedAt: new Date().toISOString(),
      repositoryRoot: normalizeSlashes(REPOSITORY_ROOT),
      result: errors > 0 ? "failed" : warnings > 0 ? "warning" : "passed"
    },
    summary: {
      filesScanned: files.length,
      symbols: model.symbols.length,
      families: serializedFamilies.length,
      exportedSymbols: model.symbols.filter(symbol => symbol.exported).length,
      familyBridges: familyBridges.size,
      healthyFamilies: serializedFamilies.filter(
        family => family.status === "healthy"
      ).length,
      warningFamilies: serializedFamilies.filter(
        family => family.status === "warning"
      ).length,
      errorFamilies: serializedFamilies.filter(
        family => family.status === "error"
      ).length,
      errors,
      warnings,
      info
    },
    families: serializedFamilies,
    findings: findings
      .slice()
      .sort((left, right) => {
        const rank = { error: 0, warning: 1, info: 2 };
        return (
          rank[left.severity] - rank[right.severity] ||
          String(left.family ?? "").localeCompare(String(right.family ?? "")) ||
          String(left.symbol ?? "").localeCompare(String(right.symbol ?? ""))
        );
      })
  };
}

function printReport(report) {
  console.log("");
  console.log("Frame Conn symbol family tree:");
  console.log(
    `${report.summary.symbols} symbols | ${report.summary.families} families | ${report.summary.familyBridges} cross-family bridges`
  );
  console.log(
    `${report.summary.healthyFamilies} healthy | ${report.summary.warningFamilies} warning | ${report.summary.errorFamilies} error families`
  );

  console.log("");
  console.log("Largest families:");

  for (const family of report.families.slice(0, 12)) {
    const incoming =
      family.incomingFamilies.length > 0
        ? family.incomingFamilies.join(", ")
        : "source";

    const outgoing =
      family.outgoingFamilies.length > 0
        ? family.outgoingFamilies.join(", ")
        : "no cross-family consumers";

    console.log(
      `  ${family.id}: ${family.symbolCount} symbols | ${family.fileCount} files | ${family.exportedSymbols} exports | ${family.status}`
    );
    console.log(`    ${incoming} -> ${outgoing}`);

    if (family.status !== "healthy") {
      for (const problem of family.problems.slice(0, 6)) {
        console.log(
          `    ${problem.severity.toUpperCase()} ${problem.code}: ${problem.message}`
        );
        if (problem.file) {
          console.log(
            `      ${problem.file}${problem.line ? `:${problem.line}` : ""}`
          );
        }
      }
    }
  }

  console.log("");
  console.log("Symbol family audit complete.");
  console.log(`Result:   ${report.audit.result.toUpperCase()}`);
  console.log(`Errors:   ${report.summary.errors}`);
  console.log(`Warnings: ${report.summary.warnings}`);
  console.log(`Info:     ${report.summary.info}`);
  console.log(`Report:   ${OUTPUT_FILE}`);
}

function runAudit() {
  console.log("Frame Conn symbol family audit starting...");
  console.log(`Repository: ${REPOSITORY_ROOT}`);

  const files = collectSourceFiles();
  const textByFile = new Map();

  for (const file of files) {
    const text = safeReadText(file);
    if (text !== null) textByFile.set(file, text);
  }

  const model = buildSymbolModel(files, textByFile);
  inspectSymbolHealth(model, textByFile);

  const families = buildFamilies(model);
  inspectFamilyHealth(families, model);

  const report = buildReport(files, model, families);

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );

  printReport(report);

  if (report.summary.errors > 0) {
    process.exitCode = 1;
  }
}

runAudit();
