import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TEXT_EXTS = new Set([".ts",".tsx",".js",".jsx",".mjs",".cjs",".sql",".json",".yml",".yaml"]);

function args(argv) {
  const out = { snapshot: null, output: null, selfTest: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === "--self-test") out.selfTest = true;
    else if (value === "--strict") out.strict = true;
    else if (value === "--snapshot") out.snapshot = argv[++i];
    else if (value === "--output") out.output = argv[++i];
    else throw new Error(`unknown-argument:${value}`);
  }
  return out;
}

const compact = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function schemaFacts(source) {
  const result = new Map();
  const pattern = /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*z\.object\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const fields = new Map();
    for (const raw of match[2].split("\n")) {
      const field = raw.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*([^,\n]+),?\s*$/);
      if (!field) continue;
      const expression = compact(field[2]);
      fields.set(field[1], {
        expression,
        optional: /\.optional\s*\(\s*\)/.test(expression),
        defaulted: /\.default\s*\(/.test(expression),
      });
    }
    result.set(match[1], fields);
  }
  return result;
}

function enumFacts(source) {
  const result = new Map();
  const pattern = /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*z\.enum\s*\(\s*\[([\s\S]*?)\]\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    result.set(match[1], new Set([...match[2].matchAll(/["'`]([^"'`]+)["'`]/g)].map((entry) => entry[1])));
  }
  return result;
}

function unionFacts(source) {
  const result = new Map();
  const pattern = /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g;
  for (const match of source.matchAll(pattern)) {
    const members = match[2].split("|").map(compact).filter(Boolean);
    if (members.length > 0) {
      result.set(match[1], { members: new Set(members), unionLike: members.length > 1 });
    }
  }
  return result;
}

function interfaceFacts(source) {
  const result = new Map();
  const pattern = /\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)[^{]*\{([\s\S]*?)\n\}/g;
  for (const match of source.matchAll(pattern)) {
    const members = new Map();
    for (const raw of match[2].split("\n")) {
      const line = raw.trim();
      const member = line.match(/^([A-Za-z_$][\w$]*)(\?)?\s*(\([^;]*\)\s*:\s*[^;]+|:\s*[^;]+);?$/);
      if (member) members.set(member[1], { signature: compact(`${member[1]}${member[2] ?? ""}${member[3]}`), optional: member[2] === "?" });
    }
    result.set(match[1], members);
  }
  return result;
}

function returnFacts(source) {
  const result = new Map();
  const pattern = /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*:\s*([^{\n]+)\{/g;
  for (const match of source.matchAll(pattern)) result.set(match[1], compact(match[2]));
  return result;
}

function addDelta(list, value) {
  list.push({ breaking: false, confidence: "high", ...value });
}

function compareSchemas(before, after, file, out) {
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const oldFields = before.get(name);
    const newFields = after.get(name);
    if (!oldFields || !newFields) continue;
    for (const field of new Set([...oldFields.keys(), ...newFields.keys()])) {
      const oldValue = oldFields.get(field);
      const newValue = newFields.get(field);
      if (!oldValue && newValue) {
        addDelta(out, { kind:"schema_field_added", file, symbol:name, member:field, after:newValue.expression, breaking:!newValue.optional && !newValue.defaulted });
        continue;
      }
      if (oldValue && !newValue) {
        addDelta(out, { kind:"schema_field_removed", file, symbol:name, member:field, before:oldValue.expression, breaking:true });
        continue;
      }
      if (!oldValue || !newValue) continue;
      if (oldValue.optional && !newValue.optional) addDelta(out, { kind:"optional_to_required", file, symbol:name, member:field, breaking:true });
      if (!oldValue.optional && newValue.optional) addDelta(out, { kind:"required_to_optional", file, symbol:name, member:field });
      if (!oldValue.defaulted && newValue.defaulted) addDelta(out, { kind:"default_added", file, symbol:name, member:field });
      if (oldValue.defaulted && !newValue.defaulted) addDelta(out, { kind:"default_removed", file, symbol:name, member:field, breaking:true });
      const strip = (text) => compact(text.replace(/\.optional\s*\(\s*\)|\.default\s*\([^)]*\)/g, ""));
      if (strip(oldValue.expression) !== strip(newValue.expression)) addDelta(out, { kind:"field_type_changed", file, symbol:name, member:field, breaking:true });
    }
  }
}

function compareSets(before, after, file, addedKind, removedKind, out) {
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const oldSet = before.get(name);
    const newSet = after.get(name);
    if (!oldSet || !newSet) continue;
    for (const member of newSet) if (!oldSet.has(member)) addDelta(out, { kind:addedKind, file, symbol:name, member, breaking:addedKind === "enum_member_added", confidence:addedKind === "enum_member_added" ? "medium" : "high" });
    for (const member of oldSet) if (!newSet.has(member)) addDelta(out, { kind:removedKind, file, symbol:name, member, breaking:true });
  }
}

function compareUnions(before, after, file, out) {
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const oldFact = before.get(name);
    const newFact = after.get(name);
    if (!oldFact || !newFact || (!oldFact.unionLike && !newFact.unionLike)) continue;
    for (const member of newFact.members) {
      if (!oldFact.members.has(member)) addDelta(out, { kind: "union_member_added", file, symbol: name, member });
    }
    for (const member of oldFact.members) {
      if (!newFact.members.has(member)) addDelta(out, { kind: "union_member_removed", file, symbol: name, member, breaking: true });
    }
  }
}

function compareInterfaces(before, after, file, out) {
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const oldMembers = before.get(name);
    const newMembers = after.get(name);
    if (!oldMembers || !newMembers) continue;
    for (const member of new Set([...oldMembers.keys(), ...newMembers.keys()])) {
      const oldValue = oldMembers.get(member);
      const newValue = newMembers.get(member);
      if (!oldValue && newValue) addDelta(out, { kind:"interface_member_added", file, symbol:name, member, breaking:!newValue.optional });
      else if (oldValue && !newValue) addDelta(out, { kind:"interface_member_removed", file, symbol:name, member, breaking:true });
      else if (oldValue && newValue && oldValue.signature !== newValue.signature) addDelta(out, { kind:"interface_member_changed", file, symbol:name, member, breaking:true });
    }
  }
}

function deltasFor(change) {
  if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(change.path)) return [];
  const before = change.before ?? "";
  const after = change.after ?? "";
  const out = [];
  compareSchemas(schemaFacts(before), schemaFacts(after), change.path, out);
  compareSets(enumFacts(before), enumFacts(after), change.path, "enum_member_added", "enum_member_removed", out);
  compareUnions(unionFacts(before), unionFacts(after), change.path, out);
  compareInterfaces(interfaceFacts(before), interfaceFacts(after), change.path, out);
  const oldReturns = returnFacts(before);
  const newReturns = returnFacts(after);
  for (const [name, oldType] of oldReturns) {
    const nextType = newReturns.get(name);
    if (nextType && nextType !== oldType) addDelta(out, { kind:"return_type_changed", file:change.path, symbol:name, before:oldType, after:nextType, breaking:true });
  }
  return out;
}

function repositoryFiles() {
  const out = [];
  const skip = new Set([".git","node_modules",".next","dist","coverage"]);
  const excludedRecoveryTrees = ["dev_scripts/backups", "dev_scripts/patch-history"];
  function visit(dir) {
    const relativeDir = path.relative(ROOT, dir).split(path.sep).join("/");
    if (excludedRecoveryTrees.some((tree) => relativeDir === tree || relativeDir.startsWith(`${tree}/`))) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes:true })) {
      if (skip.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && TEXT_EXTS.has(path.extname(entry.name).toLowerCase())) out.push(absolute);
    }
  }
  visit(ROOT);
  return out;
}

function consumers(deltas, changedFiles) {
  const breaking = deltas.filter((delta) => delta.breaking);
  if (!breaking.length) return [];
  const changed = new Set(changedFiles);
  const out = [];
  for (const absolute of repositoryFiles()) {
    const file = path.relative(ROOT, absolute).split(path.sep).join("/");
    if (changed.has(file)) continue;
    let source = "";
    try { source = fs.readFileSync(absolute, "utf8"); } catch { continue; }
    for (const delta of breaking) {
      let evidence = null;
      if (delta.kind.startsWith("interface_member_")) evidence = source.match(new RegExp(`\\bimplements\\s+${delta.symbol}\\b`))?.[0] ?? null;
      if (!evidence && source.includes(delta.symbol)) evidence = source.split("\n").find((line) => line.includes(delta.symbol))?.trim() ?? delta.symbol;
      if (!evidence) continue;
      out.push({ file, symbol:delta.symbol, deltaKind:delta.kind, evidence:evidence.slice(0,220), immediatelyBreaking:delta.kind.startsWith("interface_member_") ? evidence.includes("implements") : true });
      if (out.length >= 20) return out;
    }
  }
  return out;
}

function obligations(snapshot, deltas) {
  const paths = snapshot.changes.map((change) => change.path);
  const out = new Map();
  const add = (id, reason) => out.set(id, { id, critical:true, reason });
  if (paths.some((file) => /\.(?:ts|tsx)$/.test(file)) || deltas.length) add("typescript-compiles","The one-file intermediate state must still compile after contract inference changes.");
  if (deltas.some((delta) => delta.kind.startsWith("interface_member_"))) add("interface-implementations-conform","Every implementation must still satisfy the staged interface.");
  if (deltas.some((delta) => delta.kind.startsWith("schema_") || ["optional_to_required","default_removed","field_type_changed"].includes(delta.kind))) add("schema-construction-sites-parse","Existing construction/parse sites must remain valid against the staged schema.");
  if (paths.some((file) => /storage|supabase|migrations\/|\.sql$/.test(file))) {
    add("persistence-old-new-compatible","Persistence must tolerate pre-stage and post-stage data shapes during rollout.");
    add("persistence-roundtrip","Serialization/deserialization must round-trip the staged state.");
  }
  if (snapshot.changes.some((change) => ((change.before ?? "").match(/\b(?:import|export)\b/g)?.length ?? 0) !== ((change.after ?? "").match(/\b(?:import|export)\b/g)?.length ?? 0))) add("module-resolution-holds","Imports and exports must resolve in the intermediate state.");
  add("integration-invariants-hold","Existing integration invariants must remain satisfiable after the stage.");
  return [...out.values()];
}

function strategies(snapshot, deltas) {
  const out = [];
  const seen = new Set();
  const add = (pattern, reason) => { if (!seen.has(pattern)) { seen.add(pattern); out.push({ pattern, reason }); } };
  for (const delta of deltas) {
    if (delta.kind === "optional_to_required" || (delta.kind === "schema_field_added" && delta.breaking)) add("introduce optional -> populate consumers -> make required","Avoid breaking current construction sites in the first stage.");
    if (delta.kind === "default_removed") add("retain default -> populate explicit values -> remove default","Preserve compatibility until all constructors supply the value.");
    if (delta.kind === "interface_member_added" && delta.breaking) add("add compatible/optional member -> update implementations -> require member","A required member immediately breaks implementations.");
    if (["enum_member_removed","union_member_removed"].includes(delta.kind)) add("deprecate variant -> migrate producers/consumers -> remove variant","Removal can break persisted values and exhaustive consumers.");
    if (delta.kind === "return_type_changed") add("add compatible return adapter -> migrate callers -> tighten return type","Direct return-shape replacement can invalidate callers.");
  }
  if (snapshot.changes.some((change) => /\.sql$/.test(change.path) && /\bADD\s+COLUMN\b[\s\S]*\bNOT\s+NULL\b/i.test(change.after ?? ""))) add("add nullable column -> teach adapter -> backfill -> strengthen NOT NULL","A non-null column can reject old rows or writers.");
  return out;
}

function signalCounts(source) {
  const count = (pattern) => source.match(pattern)?.length ?? 0;
  return {
    split:count(/\.split\s*\(/g), flatMap:count(/\.flatMap\s*\(/g), map:count(/\.map\s*\(/g),
    newlineJoin:count(/\.join\s*\(\s*["'`]\\n["'`]\s*\)/g), decompose:count(/\.decompose\s*\(/g),
    filter:count(/\.filter\s*\(/g), schedule:count(/scheduleNextEligible\s*\(/g),
  };
}

function fanOut(snapshot) {
  const out = [];
  for (const change of snapshot.changes) {
    const before = signalCounts(change.before ?? "");
    const after = signalCounts(change.after ?? "");
    const increased = Object.keys(after).filter((key) => after[key] > before[key]);
    const amplification = after.newlineJoin > before.newlineJoin || after.flatMap > before.flatMap || after.split > before.split;
    if (/planner|decomposer/i.test(change.path) && after.decompose > 0 && amplification) out.push({ file:change.path, kind:"task-cardinality-amplification", severity:"high", evidence:`fan-out operators increased: ${increased.join(", ")}`, recommendation:"Probe task count and decomposition shape for representative inputs." });
    else if (amplification) out.push({ file:change.path, kind:"collection-or-payload-amplification", severity:"medium", evidence:`fan-out operators increased: ${increased.join(", ")}`, recommendation:"Probe output cardinality and downstream invocation count." });
    if (/orchestration|scheduler|worker/i.test(change.path) && (after.filter !== before.filter || after.schedule !== before.schedule)) out.push({ file:change.path, kind:"scheduler-selection-change", severity:"high", evidence:"scheduler/filter selection logic changed", recommendation:"Probe deterministic ordering, claim races, leases, and project-state gating." });
  }
  return out;
}

function verification(snapshot, deltas, warnings) {
  const paths = snapshot.changes.map((change) => change.path);
  const out = new Map();
  const add = (id, reason) => out.set(id, { id, priority:"critical", reason });
  if (deltas.length || paths.some((file) => /\.(?:ts|tsx)$/.test(file))) add("typecheck","Contract/type changes can invalidate the intermediate compile state.");
  if (deltas.some((delta) => delta.kind.startsWith("schema_") || ["optional_to_required","default_removed","field_type_changed"].includes(delta.kind))) add("schema-construction-probe","Verify representative constructors/parsers against the staged schema.");
  if (deltas.some((delta) => delta.kind.startsWith("interface_member_"))) add("interface-conformance-probe","Verify every implementation satisfies the staged interface.");
  if (paths.some((file) => /storage|supabase|migrations\/|\.sql$/.test(file))) add("persistence-roundtrip-probe","Verify old/new data-shape serialization and migration compatibility.");
  if (paths.some((file) => /planner|decomposer/i.test(file)) || warnings.some((warning) => warning.kind === "task-cardinality-amplification")) add("task-count-decomposition-probe","Planner/decomposer payload changes can amplify task cardinality.");
  if (paths.some((file) => /orchestration|scheduler|worker/i.test(file)) || warnings.some((warning) => warning.kind === "scheduler-selection-change")) add("scheduler-concurrency-probe","Scheduling changes need deterministic ordering and claim/lease race coverage.");
  if (paths.some((file) => /package\.json$|tsconfig|next\.config|vite\.config|webpack|config\./i.test(file))) add("build","Build/configuration behavior changed.");
  add("integration","The staged state must preserve established runtime invariants.");
  return [...out.values()];
}

function analyze(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.changes)) throw new Error("invalid-transition-snapshot");
  const contractDeltas = snapshot.changes.flatMap(deltasFor);
  const immediateConsumers = consumers(contractDeltas, snapshot.changes.map((change) => change.path));
  const behavioralFanOut = fanOut(snapshot);
  const breaking = contractDeltas.filter((delta) => delta.breaking);
  const immediate = immediateConsumers.filter((consumer) => consumer.immediatelyBreaking);
  return {
    version:1, goal:snapshot.goal ?? null, changedFiles:snapshot.changes.map((change) => change.path),
    contractDeltas, immediateConsumers,
    intermediateStateObligations:obligations(snapshot, contractDeltas),
    compatibilityStrategies:strategies(snapshot, contractDeltas),
    behavioralFanOut,
    verificationTargets:verification(snapshot, contractDeltas, behavioralFanOut),
    assessment:{ safeStandalone:breaking.length === 0 || immediate.length === 0, breakingDeltaCount:breaking.length, immediateConsumerCount:immediate.length, highFanOutRiskCount:behavioralFanOut.filter((warning) => warning.severity === "high").length },
  };
}

function print(report) {
  console.log(`[change-propagation] ${report.changedFiles.length} file(s) | ${report.contractDeltas.length} contract delta(s) | ${report.assessment.breakingDeltaCount} breaking | ${report.behavioralFanOut.length} fan-out warning(s)`);
  console.log(`[change-propagation] standalone=${report.assessment.safeStandalone ? "likely-safe" : "unsafe-or-needs-compatibility-stage"}`);
  for (const delta of report.contractDeltas.filter((entry) => entry.breaking).slice(0,8)) console.log(`[change-propagation] breaking=${delta.kind}:${delta.symbol}${delta.member ? `.${delta.member}` : ""}`);
  for (const warning of report.behavioralFanOut.slice(0,6)) console.log(`[change-propagation] fanout=${warning.severity}:${warning.kind}:${warning.file}`);
  for (const target of report.verificationTargets) console.log(`[change-propagation] verify=${target.priority}:${target.id}`);
}

function selfTest() {
  const report = analyze({ version:1, goal:"self-test", changes:[
    { path:"scripts/example/contracts.ts", before:`
export const ExampleSchema = z.object({
  name: z.string().optional(),
  count: z.number().default(0),
});
export const ExampleState = z.enum(["A","B"]);
export type Mode = "one" | "two";
export interface Store {
  get(): string;
}
export function value(): string { return "x"; }
`, after:`
export const ExampleSchema = z.object({
  name: z.string(),
  count: z.number(),
});
export const ExampleState = z.enum(["A","B","C"]);
export type Mode = "one";
export interface Store {
  get(): string;
  save(value: string): void;
}
export function value(): number { return 1; }
`},
    { path:"scripts/example/planner.js", before:`return this.decomposer.decompose({ objective: goal });`, after:`const objective = milestones.map(x => x.objective).join("\\n"); return this.decomposer.decompose({ objective });`},
  ]});
  const kinds = new Set(report.contractDeltas.map((delta) => delta.kind));
  for (const expected of ["optional_to_required","default_removed","enum_member_added","union_member_removed","interface_member_added","return_type_changed"]) if (!kinds.has(expected)) throw new Error(`self-test-missing-delta:${expected}`);
  if (!report.compatibilityStrategies.some((entry) => entry.pattern.includes("introduce optional"))) throw new Error("self-test-missing-compatibility-strategy");
  if (!report.behavioralFanOut.some((entry) => entry.kind === "task-cardinality-amplification")) throw new Error("self-test-missing-fanout-warning");
  if (!report.verificationTargets.some((entry) => entry.id === "typecheck")) throw new Error("self-test-missing-typecheck-target");
  console.log("[change-propagation] Self-test passed.");
}

const options = args(process.argv.slice(2));
if (options.selfTest) selfTest();
else {
  if (!options.snapshot) throw new Error("--snapshot is required unless --self-test is used");
  const report = analyze(JSON.parse(fs.readFileSync(path.resolve(options.snapshot), "utf8")));
  print(report);
  if (options.output) fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (options.strict && !report.assessment.safeStandalone) process.exitCode = 2;
}
