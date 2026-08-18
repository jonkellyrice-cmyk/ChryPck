/**
 * dev_scripts/effect-atlas.mjs
 *
 * Frame Conn Effect Atlas
 *
 * Builds a static side-effect index over live source files, compresses it into
 * effect families and ownership summaries, and expands only suspicious or
 * forbidden sites. This tool does not execute Foundry or module code.
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

const EFFECT_PATTERNS = [
  {
    id: "foundry-document",
    label: "Foundry documents",
    regex: /\b(?:actor|item|token|document|combat|scene)\s*\.\s*(?:update|delete|createEmbeddedDocuments|updateEmbeddedDocuments|deleteEmbeddedDocuments)\s*\(/g
  },
  {
    id: "embedded-documents",
    label: "Embedded documents",
    regex: /\b(?:createEmbeddedDocuments|updateEmbeddedDocuments|deleteEmbeddedDocuments)\s*\(/g
  },
  {
    id: "settings",
    label: "Settings",
    regex: /\bgame\s*\.\s*settings\s*\.\s*(?:set|register)\s*\(/g
  },
  {
    id: "hooks",
    label: "Foundry hooks",
    regex: /\bHooks\s*\.\s*(?:on|once|off|call|callAll)\s*\(/g
  },
  {
    id: "chat-output",
    label: "Chat/output",
    regex: /\bChatMessage\s*\.\s*create\s*\(/g
  },
  {
    id: "notifications",
    label: "Notifications",
    regex: /\bui\s*\.\s*notifications\s*\.\s*(?:info|warn|error)\s*\(/g
  },
  {
    id: "canvas-token",
    label: "Canvas/token",
    regex: /\b(?:canvas\s*\.\s*tokens|token\s*\.\s*document)\b[\s\S]{0,80}?\.\s*(?:setTarget|control|release|update)\s*\(/g
  },
  {
    id: "application-lifecycle",
    label: "Application lifecycle",
    regex: /\b(?:FrameConnApplication|application|app)\s*\.\s*(?:render|close)\s*\(/g
  },
  {
    id: "native-execution",
    label: "Native execution",
    regex: /\b(?:(?:execute|run|roll)Native(?![A-Za-z0-9_$]*(?:Verification|Verifier|Probe|Check)\b)[A-Za-z0-9_$]*)\s*\(/g
  }
];

const requestedOutputIndex = process.argv.indexOf("--output");
const requestedOutput =
  requestedOutputIndex >= 0
    ? process.argv[requestedOutputIndex + 1] ?? null
    : null;

const OUTPUT_FILE = requestedOutput
  ? path.resolve(REPOSITORY_ROOT, requestedOutput)
  : path.join(REPOSITORY_ROOT, "effect-atlas-report.json");

function normalizeSlashes(value) {
  return String(value).replaceAll("\\", "/");
}

function relativePath(absolutePath) {
  return normalizeSlashes(path.relative(REPOSITORY_ROOT, absolutePath));
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
  const basename = normalizeFamilyToken(path.basename(relative));

  if (relative.startsWith("scripts/feature_actions/")) return "actions";
  if (relative.startsWith("scripts/feature_turn/")) return "turn";

  if (relative.startsWith("styles/")) {
    if (relative.includes("ui_application/")) return "ui-application";
    if (relative.includes("ui_movement/")) return "ui-movement";
    if (relative.includes("ui_turn/")) return "ui-turn";
    if (relative.includes("ui-sensors")) return "ui-sensors";
    if (relative.endsWith("ui-registry.js")) return "ui-composition";
    return "ui-composition";
  }

  if (relative.startsWith("scripts/")) {
    if (
      basename === "runtime-orchestrator" ||
      basename.startsWith("feature-registry")
    ) {
      return "runtime-composition";
    }
    if (basename.startsWith("foundry-integration")) return "foundry-integration";
    if (basename.startsWith("movement")) return "movement";
    if (basename.startsWith("sensors")) return "sensors";
    return basename;
  }

  return normalizeFamilyToken(relative.split("/")[0]);
}

function getLineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function findContainingSymbol(text, index) {
  const prefix = text.slice(0, index);
  const candidates = [];
  const patterns = [
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    /(?:^|\n)\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/g
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(prefix))) {
      candidates.push({ name: match[1], index: match.index });
    }
  }

  candidates.sort((a, b) => b.index - a.index);
  return candidates[0]?.name ?? "<module>";
}

function classifyOwnership(effectId, family, relativeFile) {
  const uiFamily = family.startsWith("ui-");

  if (
    (effectId === "foundry-document" || effectId === "embedded-documents") &&
    uiFamily
  ) {
    return {
      status: "forbidden",
      severity: "error",
      reason: "Presentation/UI code directly mutates Foundry documents."
    };
  }

  if (
    effectId === "settings" &&
    !["foundry-integration", "runtime-composition"].includes(family)
  ) {
    return {
      status: "forbidden",
      severity: "error",
      reason: "Foundry settings writes belong at the Foundry/runtime integration boundary."
    };
  }

  if (
    effectId === "native-execution" &&
    ![
      "native-adapter",
      "action-execution",
      "execution-transaction",
      "system-bridge",
      "actions",
      "runtime-composition"
    ].includes(family)
  ) {
    return {
      status: "suspicious",
      severity: "warning",
      reason: "Native execution appears outside the expected execution/adapter boundary."
    };
  }

  if (
    effectId === "chat-output" &&
    uiFamily
  ) {
    return {
      status: "suspicious",
      severity: "warning",
      reason: "Presentation code is producing Foundry chat output directly."
    };
  }

  if (
    ["runtime-composition", "foundry-integration"].includes(family)
  ) {
    return {
      status: "delegated",
      severity: null,
      reason: "Effect occurs at an explicit composition/integration boundary."
    };
  }

  return {
    status: "expected",
    severity: null,
    reason: null
  };
}

function scanEffects(files) {
  const sites = [];

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const family = deriveFileFamily(file);
    const relativeFile = relativePath(file);

    for (const pattern of EFFECT_PATTERNS) {
      pattern.regex.lastIndex = 0;
      let match;

      while ((match = pattern.regex.exec(text))) {
        const ownership = classifyOwnership(pattern.id, family, relativeFile);

        sites.push({
          effect: pattern.id,
          label: pattern.label,
          family,
          file: relativeFile,
          line: getLineNumber(text, match.index),
          symbol: findContainingSymbol(text, match.index),
          expression: match[0].replace(/\s+/g, " ").trim().slice(0, 160),
          ownership: ownership.status,
          severity: ownership.severity,
          reason: ownership.reason
        });

        if (match[0].length === 0) pattern.regex.lastIndex += 1;
      }
    }
  }

  return sites;
}

function buildEffectFamilies(sites) {
  const grouped = new Map();

  for (const pattern of EFFECT_PATTERNS) {
    grouped.set(pattern.id, {
      id: pattern.id,
      label: pattern.label,
      sites: [],
      files: new Set(),
      symbols: new Set(),
      owners: new Set()
    });
  }

  for (const site of sites) {
    const group = grouped.get(site.effect);
    group.sites.push(site);
    group.files.add(site.file);
    group.symbols.add(`${site.file}#${site.symbol}`);
    group.owners.add(site.family);
  }

  return [...grouped.values()]
    .map(group => ({
      id: group.id,
      label: group.label,
      siteCount: group.sites.length,
      fileCount: group.files.size,
      symbolCount: group.symbols.size,
      owners: [...group.owners].sort(),
      expected: group.sites.filter(site => site.ownership === "expected").length,
      delegated: group.sites.filter(site => site.ownership === "delegated").length,
      suspicious: group.sites.filter(site => site.ownership === "suspicious").length,
      forbidden: group.sites.filter(site => site.ownership === "forbidden").length
    }))
    .filter(group => group.siteCount > 0)
    .sort((a, b) => b.siteCount - a.siteCount || a.id.localeCompare(b.id));
}

function buildOwnerFamilies(sites) {
  const grouped = new Map();

  for (const site of sites) {
    if (!grouped.has(site.family)) {
      grouped.set(site.family, {
        id: site.family,
        sites: [],
        files: new Set(),
        symbols: new Set(),
        effects: new Set()
      });
    }

    const group = grouped.get(site.family);
    group.sites.push(site);
    group.files.add(site.file);
    group.symbols.add(`${site.file}#${site.symbol}`);
    group.effects.add(site.effect);
  }

  return [...grouped.values()]
    .map(group => ({
      id: group.id,
      siteCount: group.sites.length,
      fileCount: group.files.size,
      symbolCount: group.symbols.size,
      effects: [...group.effects].sort(),
      suspicious: group.sites.filter(site => site.ownership === "suspicious").length,
      forbidden: group.sites.filter(site => site.ownership === "forbidden").length,
      status:
        group.sites.some(site => site.ownership === "forbidden")
          ? "error"
          : group.sites.some(site => site.ownership === "suspicious")
            ? "warning"
            : "healthy"
    }))
    .sort((a, b) => b.siteCount - a.siteCount || a.id.localeCompare(b.id));
}

function printReport(report) {
  const { summary, effectFamilies, ownerFamilies, findings } = report;

  console.log("Frame Conn effect atlas starting...");
  console.log(`Repository: ${REPOSITORY_ROOT}`);
  console.log("");
  console.log("Frame Conn effect atlas:");
  console.log(
    `${summary.effectSites} effect sites | ${summary.effectProducingSymbols} effect-producing symbols | ${summary.effectFamilies} effect families`
  );
  console.log(
    `${summary.expected} expected | ${summary.delegated} delegated | ${summary.suspicious} suspicious | ${summary.forbidden} forbidden`
  );

  if (effectFamilies.length > 0) {
    console.log("");
    console.log("Effect families:");
    for (const family of effectFamilies) {
      console.log(
        `  ${family.label}: ${family.siteCount} sites | ${family.symbolCount} symbols | ${family.fileCount} files`
      );
    }
  }

  if (ownerFamilies.length > 0) {
    console.log("");
    console.log("Largest effect owners:");
    for (const owner of ownerFamilies.slice(0, 12)) {
      console.log(
        `  ${owner.id}: ${owner.siteCount} sites | ${owner.symbolCount} symbols | ${owner.effects.length} effect types | ${owner.status}`
      );
    }
  }

  if (findings.length > 0) {
    console.log("");
    console.log("Expanded effect diagnostics:");
    for (const finding of findings) {
      console.log(
        `  ${finding.severity.toUpperCase()} ${finding.effect} in ${finding.family}`
      );
      console.log(
        `    ${finding.file}:${finding.line} :: ${finding.symbol}`
      );
      console.log(`    ${finding.reason}`);
      console.log(`    observed: ${finding.expression}`);
    }
  }

  console.log("");
  console.log("Effect atlas complete.");
  console.log(`Result:   ${summary.errors > 0 ? "FAILED" : summary.warnings > 0 ? "WARNING" : "PASSED"}`);
  console.log(`Errors:   ${summary.errors}`);
  console.log(`Warnings: ${summary.warnings}`);
  console.log(`Report:   ${OUTPUT_FILE}`);
}

const sourceFiles = collectSourceFiles();
const sites = scanEffects(sourceFiles);
const effectFamilies = buildEffectFamilies(sites);
const ownerFamilies = buildOwnerFamilies(sites);
const findings = sites
  .filter(site => site.severity)
  .sort((a, b) =>
    a.severity.localeCompare(b.severity) ||
    a.family.localeCompare(b.family) ||
    a.file.localeCompare(b.file) ||
    a.line - b.line
  );

const report = {
  audit: {
    name: "Frame Conn Effect Atlas",
    scriptVersion: SCRIPT_VERSION,
    generatedAt: new Date().toISOString(),
    repositoryRoot: REPOSITORY_ROOT,
    result: findings.some(item => item.severity === "error")
      ? "failed"
      : findings.some(item => item.severity === "warning")
        ? "warning"
        : "passed"
  },
  summary: {
    filesScanned: sourceFiles.length,
    effectSites: sites.length,
    effectProducingSymbols: new Set(
      sites.map(site => `${site.file}#${site.symbol}`)
    ).size,
    effectFamilies: effectFamilies.length,
    ownerFamilies: ownerFamilies.length,
    expected: sites.filter(site => site.ownership === "expected").length,
    delegated: sites.filter(site => site.ownership === "delegated").length,
    suspicious: sites.filter(site => site.ownership === "suspicious").length,
    forbidden: sites.filter(site => site.ownership === "forbidden").length,
    errors: findings.filter(item => item.severity === "error").length,
    warnings: findings.filter(item => item.severity === "warning").length
  },
  effectFamilies,
  ownerFamilies,
  findings
};

fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");
printReport(report);

if (report.summary.errors > 0) {
  process.exitCode = 1;
}
