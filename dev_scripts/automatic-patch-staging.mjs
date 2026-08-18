import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const STAGER_VERSION = "1.0.0";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

function argValue(flag, fallback = null) {
  const index = argv.indexOf(flag);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

const selfTest = argv.includes("--self-test");
const reportOnly = argv.includes("--report-only");
const overwrite = argv.includes("--overwrite");
const explicitGoal = argValue("--goal");
const corridorPath = argValue("--corridor");
const patchPath = argValue("--patch");
const outputPath = argValue("--output");
const outputDirArg = argValue("--output-dir");
const maxFilesPerSpec = Number(argValue("--max-files-per-spec", "1"));

const arr = value => Array.isArray(value) ? value : [];
const normalizePath = value => String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
const slug = value => String(value ?? "patch")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 56) || "patch";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runJsonTool(script, args, prefix) {
  const output = path.join(os.tmpdir(), `${prefix}-${process.pid}.json`);
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "dev_scripts", script), ...args, "--output", output],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
  );
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${script} failed; Automatic Patch Staging requires healthy upstream diagnostics.`);
  }
  return readJson(output);
}

function getCorridor(goal) {
  if (corridorPath) return readJson(path.resolve(ROOT, corridorPath));
  if (!goal) throw new Error("A --goal or corridor report with a goal is required.");
  return runJsonTool("patch-corridor-planner.mjs", ["--goal", goal], "patch-staging-corridor");
}

function getFamilyAudit() {
  return runJsonTool("symbol-family-audit.mjs", [], "patch-staging-families");
}

function familyIndex(audit) {
  const byId = new Map();
  const byFile = new Map();
  for (const family of arr(audit.families)) {
    byId.set(family.id, family);
    for (const file of arr(family.locations)) byFile.set(normalizePath(file), family.id);
  }
  return { byId, byFile };
}

function selectedDependencyGraph(corridor, audit) {
  const { byId } = familyIndex(audit);
  const selected = new Set(arr(corridor.corridor).filter(id => byId.has(id)));
  const dependencies = new Map([...selected].map(id => [id, new Set()]));

  for (const id of selected) {
    const family = byId.get(id);
    for (const provider of arr(family.outgoingFamilies)) {
      if (selected.has(provider) && provider !== id) dependencies.get(id).add(provider);
    }
  }
  return { selected, dependencies };
}

function stronglyConnectedComponents(nodes, dependencies) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indexes = new Map();
  const low = new Map();
  const components = [];

  function visit(node) {
    indexes.set(node, index);
    low.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const dependency of dependencies.get(node) ?? []) {
      if (!indexes.has(dependency)) {
        visit(dependency);
        low.set(node, Math.min(low.get(node), low.get(dependency)));
      } else if (onStack.has(dependency)) {
        low.set(node, Math.min(low.get(node), indexes.get(dependency)));
      }
    }

    if (low.get(node) === indexes.get(node)) {
      const component = [];
      while (stack.length) {
        const member = stack.pop();
        onStack.delete(member);
        component.push(member);
        if (member === node) break;
      }
      components.push(component.sort());
    }
  }

  for (const node of [...nodes].sort()) if (!indexes.has(node)) visit(node);
  return components;
}

function topologicalPhases(selected, dependencies) {
  const components = stronglyConnectedComponents(selected, dependencies);
  const componentByFamily = new Map();
  components.forEach((members, index) => members.forEach(member => componentByFamily.set(member, index)));

  // A family lists what it depends on. Reverse that relation so providers point to consumers.
  const consumers = new Map(components.map((_, index) => [index, new Set()]));
  const indegree = new Map(components.map((_, index) => [index, 0]));
  for (const [consumer, providers] of dependencies) {
    const consumerComponent = componentByFamily.get(consumer);
    for (const provider of providers) {
      const providerComponent = componentByFamily.get(provider);
      if (providerComponent === consumerComponent) continue;
      if (!consumers.get(providerComponent).has(consumerComponent)) {
        consumers.get(providerComponent).add(consumerComponent);
        indegree.set(consumerComponent, indegree.get(consumerComponent) + 1);
      }
    }
  }

  let frontier = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id).sort((a, b) => a - b);
  const phaseByComponent = new Map();
  let phase = 1;
  let visited = 0;
  while (frontier.length) {
    const next = [];
    for (const component of frontier) {
      phaseByComponent.set(component, phase);
      visited += 1;
      for (const consumer of consumers.get(component)) {
        indegree.set(consumer, indegree.get(consumer) - 1);
        if (indegree.get(consumer) === 0) next.push(consumer);
      }
    }
    frontier = [...new Set(next)].sort((a, b) => a - b);
    phase += 1;
  }

  if (visited !== components.length) throw new Error("Condensed dependency graph unexpectedly remained cyclic.");

  const phases = [];
  for (let index = 1; index < phase; index += 1) {
    const componentIds = [...phaseByComponent.entries()].filter(([, value]) => value === index).map(([id]) => id);
    const families = componentIds.flatMap(id => components[id]).sort();
    const cyclicGroups = componentIds.map(id => components[id]).filter(group => group.length > 1);
    phases.push({ index, families, cyclicGroups });
  }
  return { phases };
}

function crossCuttingReasons(corridor, phases) {
  const reasons = [];
  const familyCount = Number(corridor.summary?.families ?? arr(corridor.corridor).length);
  const fileCount = Number(corridor.summary?.files ?? arr(corridor.files).length);
  const clauseCount = Number(corridor.clauseCoverage?.clauseCount ?? arr(corridor.clauses).length);
  if (familyCount >= 4) reasons.push(`${familyCount} architectural families`);
  if (fileCount >= 6) reasons.push(`${fileCount} predicted files`);
  if (clauseCount >= 3) reasons.push(`${clauseCount} behavioral clauses`);
  if (phases.length >= 3) reasons.push(`${phases.length} dependency phases`);
  return reasons;
}

function classifyPhase(index, total) {
  if (total === 1) return "Atomic implementation";
  if (index === 1) return "Providers and foundations";
  if (index === total) return "Consumers and composition";
  return "Dependency propagation";
}

function operationPaths(operation) {
  if (typeof operation?.path === "string") return [normalizePath(operation.path)];
  if (operation?.type === "replace_tree_text") {
    throw new Error("replace_tree_text cannot be automatically partitioned because one operation can span multiple dependency families. Split it explicitly before staging.");
  }
  throw new Error(`Operation ${String(operation?.type)} has no single deterministic file path and cannot be automatically staged.`);
}

function groupPatchOperations(patch, byFile, corridorFiles) {
  const grouped = new Map();
  for (const operation of arr(patch?.operations)) {
    const paths = operationPaths(operation);
    if (paths.length !== 1) throw new Error("Automatic staging requires exactly one deterministic path per operation.");
    const file = paths[0];
    if (!corridorFiles.has(file)) throw new Error(`Patch operation targets ${file}, which is outside the certified corridor.`);
    const family = byFile.get(file);
    if (!family) throw new Error(`No symbol-family owner found for staged patch file: ${file}`);
    const row = grouped.get(file) ?? { file, family, operations: [] };
    row.operations.push(operation);
    grouped.set(file, row);
  }
  return grouped;
}

function buildFileRows(corridor, audit, patch) {
  const { byFile } = familyIndex(audit);
  const corridorFiles = new Set(arr(corridor.files).map(row => normalizePath(row.file)));
  const patchGroups = patch ? groupPatchOperations(patch, byFile, corridorFiles) : new Map();
  const rows = [];

  const sourceRows = patchGroups.size
    ? [...patchGroups.values()]
    : arr(corridor.files).map(row => ({
        file: normalizePath(row.file),
        family: row.family ?? byFile.get(normalizePath(row.file)),
        operations: []
      }));

  for (const row of sourceRows) {
    if (!row.family) throw new Error(`No symbol-family owner found for staged file: ${row.file}`);
    rows.push(row);
  }
  return rows;
}

function buildSpecs(goal, corridor, audit, patch, maxFiles) {
  if (!corridor.clauseCoverage?.complete) {
    throw new Error("Automatic Patch Staging refuses an uncertified corridor with incomplete clause coverage.");
  }
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 4) {
    throw new Error("--max-files-per-spec must be an integer from 1 to 4. The safe default is 1.");
  }

  const { selected, dependencies } = selectedDependencyGraph(corridor, audit);
  const topology = topologicalPhases(selected, dependencies);
  const fileRows = buildFileRows(corridor, audit, patch);
  const phaseByFamily = new Map();
  for (const phase of topology.phases) phase.families.forEach(family => phaseByFamily.set(family, phase.index));

  const planSlug = slug(patch?.id ?? goal);
  const specs = [];
  let serial = 1;
  const phases = topology.phases.map(phase => {
    const rows = fileRows.filter(row => phaseByFamily.get(row.family) === phase.index)
      .sort((a, b) => a.family.localeCompare(b.family) || a.file.localeCompare(b.file));
    const phaseSpecs = [];
    for (let offset = 0; offset < rows.length; offset += maxFiles) {
      const group = rows.slice(offset, offset + maxFiles);
      const allowedPaths = group.map(row => row.file);
      const operations = group.flatMap(row => row.operations);
      const specId = `${planSlug}-phase-${String(phase.index).padStart(2, "0")}-step-${String(serial).padStart(2, "0")}`;
      const spec = {
        schema_version: 2,
        id: specId,
        description: `Automatic Patch Staging phase ${phase.index}/${topology.phases.length} (${classifyPhase(phase.index, topology.phases.length)}). Scope is locked to: ${allowedPaths.join(", ")}.`,
        planning_goal: goal,
        policy: {
          max_files_changed: allowedPaths.length,
          allowed_paths: allowedPaths
        },
        operations
      };
      const fileName = `${String(serial).padStart(2, "0")}-${specId}.json`;
      const record = { serial, fileName, allowedPaths, operationCount: operations.length, spec };
      phaseSpecs.push(record);
      specs.push(record);
      serial += 1;
    }
    return {
      index: phase.index,
      name: classifyPhase(phase.index, topology.phases.length),
      families: phase.families,
      cyclicGroups: phase.cyclicGroups,
      files: rows.map(row => row.file),
      specs: phaseSpecs.map(record => ({
        serial: record.serial,
        fileName: record.fileName,
        allowedPaths: record.allowedPaths,
        operationCount: record.operationCount
      }))
    };
  });

  const reasons = crossCuttingReasons(corridor, topology.phases);
  return {
    planSlug,
    phases,
    specs,
    report: {
      stager: {
        name: "Frame Conn Automatic Patch Staging",
        version: STAGER_VERSION,
        generatedAt: new Date().toISOString()
      },
      goal,
      mode: patch && arr(patch.operations).length ? "partition-existing-patch" : "authoring-skeletons",
      sourcePatchId: patch?.id ?? null,
      corridor: {
        plannerVersion: corridor.planner?.version ?? null,
        confidence: corridor.summary?.confidence ?? null,
        clauseCoverageComplete: Boolean(corridor.clauseCoverage?.complete),
        families: arr(corridor.corridor),
        files: arr(corridor.files).map(row => normalizePath(row.file))
      },
      crossCutting: {
        recommended: reasons.length > 0,
        reasons
      },
      dependencyRule: "Symbol-family outgoingFamilies are imports/dependencies. Providers are therefore staged before consumers by reversing those edges and topologically layering the certified corridor. Strongly connected families remain in one phase and are never falsely ordered.",
      safety: {
        maxFilesPerSpec: maxFiles,
        exactAllowedPaths: true,
        outsideCorridorRejected: true,
        ambiguousMultiFileOperationsRejected: true,
        operationsInvented: false
      },
      phases
    }
  };
}

function writePlan(result, targetDir, reportFile, allowOverwrite) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const record of result.specs) {
    const target = path.join(targetDir, record.fileName);
    if (fs.existsSync(target) && !allowOverwrite) {
      throw new Error(`Refusing to overwrite existing staged spec: ${normalizePath(path.relative(ROOT, target))}. Use --overwrite explicitly.`);
    }
  }
  for (const record of result.specs) {
    fs.writeFileSync(path.join(targetDir, record.fileName), `${JSON.stringify(record.spec, null, 2)}\n`, "utf8");
  }
  fs.writeFileSync(reportFile, `${JSON.stringify(result.report, null, 2)}\n`, "utf8");
}

function printPlan(report, outputDirectory = null) {
  console.log(`\nFrame Conn Automatic Patch Staging v${STAGER_VERSION}`);
  console.log(`goal=${report.goal}`);
  console.log(`mode=${report.mode}`);
  console.log(`cross_cutting=${report.crossCutting.recommended ? "yes" : "no"}${report.crossCutting.reasons.length ? ` (${report.crossCutting.reasons.join(", ")})` : ""}`);
  console.log(`${report.phases.length} dependency phase(s)`);
  for (const phase of report.phases) {
    console.log(`  Phase ${phase.index} — ${phase.name}`);
    console.log(`    families: ${phase.families.join(", ") || "none"}`);
    console.log(`    files: ${phase.files.length}`);
    if (phase.cyclicGroups.length) {
      for (const group of phase.cyclicGroups) console.log(`    atomic-cycle: ${group.join(" <-> ")}`);
    }
    for (const spec of phase.specs) {
      console.log(`    spec ${String(spec.serial).padStart(2, "0")}: ${spec.allowedPaths.join(", ")} | operations=${spec.operationCount}`);
    }
  }
  if (outputDirectory) console.log(`staged_specs=${normalizePath(path.relative(ROOT, outputDirectory))}`);
}

function runSelfTest() {
  const corridor = {
    planner: { version: "test" },
    clauseCoverage: { complete: true, clauseCount: 3 },
    summary: { families: 4, files: 4, confidence: "high" },
    corridor: ["provider", "domain", "ui", "runtime-composition"],
    files: [
      { file: "provider.js", family: "provider" },
      { file: "domain.js", family: "domain" },
      { file: "ui.js", family: "ui" },
      { file: "runtime.js", family: "runtime-composition" }
    ]
  };
  const audit = {
    families: [
      { id: "provider", locations: ["provider.js"], outgoingFamilies: [] },
      { id: "domain", locations: ["domain.js"], outgoingFamilies: ["provider"] },
      { id: "ui", locations: ["ui.js"], outgoingFamilies: ["domain"] },
      { id: "runtime-composition", locations: ["runtime.js"], outgoingFamilies: ["ui"] }
    ]
  };
  const patch = {
    id: "demo",
    operations: [
      { type: "replace_text", path: "ui.js", search: "a", replace: "b" },
      { type: "replace_text", path: "provider.js", search: "a", replace: "b" }
    ]
  };
  const result = buildSpecs("demo cross-cutting change", corridor, audit, patch, 1);
  const phases = result.report.phases;
  if (phases.find(p => p.families.includes("provider"))?.index !== 1) throw new Error("provider was not staged first");
  if (phases.find(p => p.families.includes("runtime-composition"))?.index !== 4) throw new Error("consumer/composition was not staged last");
  if (result.specs.length !== 2) throw new Error("existing patch was not partitioned by file");
  if (result.specs.some(row => row.spec.policy.allowed_paths.length !== 1)) throw new Error("allowed_paths lock missing");
  if (result.specs.some(row => row.spec.operations.length !== 1)) throw new Error("operations were not preserved exactly");

  const cyclicAudit = {
    families: [
      { id: "a", locations: ["a.js"], outgoingFamilies: ["b"] },
      { id: "b", locations: ["b.js"], outgoingFamilies: ["a"] }
    ]
  };
  const cyclicCorridor = {
    planner: { version: "test" },
    clauseCoverage: { complete: true, clauseCount: 1 },
    summary: { families: 2, files: 2, confidence: "high" },
    corridor: ["a", "b"],
    files: [{ file: "a.js", family: "a" }, { file: "b.js", family: "b" }]
  };
  const cycleResult = buildSpecs("cycle", cyclicCorridor, cyclicAudit, null, 1);
  if (cycleResult.report.phases.length !== 1 || cycleResult.report.phases[0].cyclicGroups.length !== 1) {
    throw new Error("strongly connected families were falsely ordered");
  }

  let rejected = false;
  try {
    buildSpecs("outside", corridor, audit, { id: "bad", operations: [{ type: "replace_text", path: "outside.js", search: "a", replace: "b" }] }, 1);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("outside-corridor operation was not rejected");
  console.log("[automatic-patch-staging] Self-test passed.");
}

if (selfTest) {
  runSelfTest();
  process.exit(0);
}

try {
  const patch = patchPath ? readJson(path.resolve(ROOT, patchPath)) : null;
  const goal = explicitGoal ?? patch?.planning_goal ?? null;
  const corridor = getCorridor(goal);
  const resolvedGoal = goal ?? corridor.goal;
  if (!resolvedGoal) throw new Error("Unable to resolve behavioral goal from --goal, patch.planning_goal, or corridor report.");
  const audit = getFamilyAudit();
  const result = buildSpecs(resolvedGoal, corridor, audit, patch, maxFilesPerSpec);

  const defaultDir = path.join(ROOT, "dev_scripts", "staged-patches", result.planSlug);
  const outputDirectory = path.resolve(ROOT, outputDirArg ?? defaultDir);
  const reportFile = path.resolve(ROOT, outputPath ?? path.join(outputDirectory, "staging-plan.json"));

  if (!reportOnly) writePlan(result, outputDirectory, reportFile, overwrite);
  else {
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, `${JSON.stringify(result.report, null, 2)}\n`, "utf8");
  }
  printPlan(result.report, reportOnly ? null : outputDirectory);
} catch (error) {
  console.error(`[automatic-patch-staging] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
