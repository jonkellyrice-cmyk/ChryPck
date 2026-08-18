import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PLANNER_VERSION = "1.2.0";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const selfTest = argv.includes("--self-test");
const gi = argv.indexOf("--goal");
const goal = (gi >= 0 ? argv[gi + 1] : argv.filter(x => !x.startsWith("--")).join(" "))?.trim();
const oi = argv.indexOf("--output");
const output = path.resolve(ROOT, oi >= 0 ? argv[oi + 1] : "patch-corridor-report.json");

const STOP = new Set([
  "the","and","for","from","into","with","that","this","wire","wiring","make",
  "patch","frame","conn","through","authoritative","given","change","implement","ensure"
]);
const norm = v => String(v ?? "")
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .replace(/[_.\\/:-]+/g, " ")
  .toLowerCase();
const arr = v => Array.isArray(v) ? v : [];
const termsFor = value => [...new Set(norm(value).split(/[^a-z0-9$]+/).filter(x => x.length >= 3 && !STOP.has(x)))];

const CONCERNS = Object.freeze([
  { id:"presentation", words:["ui","presentation","button","prompt","panel","control","display","render","dialog","label"], owners:["ui-turn","ui-application","ui-movement","ui-sensors"] },
  { id:"reaction", words:["reaction","react","brace","interrupt","response"], owners:["turn","actions","brace"] },
  { id:"movement", words:["movement","move","boost","speed","hex","elevation","jump","climb","fly","teleport"], owners:["movement","turn","ui-movement"] },
  { id:"action-economy", words:["action","quick","full","protocol","overcharge","spend","budget","committed","plan","restriction"], owners:["turn","actions","action-execution","action-economy"] },
  { id:"native-execution", words:["native","lancer","execute","execution","roll","attack","weapon","flow","damage","damagecalc"], owners:["native-adapter","action-execution","system-bridge"] },
  { id:"state", words:["state","flag","persist","track","ledger","record","used","lock","restriction","cleanup","clear"], owners:["turn","brace","runtime-composition"] },
  { id:"runtime-composition", words:["runtime","register","registry","composition","binding","provider","capability"], owners:["runtime-composition","foundry-integration","system-bridge"] },
  { id:"hook-event", words:["hook","event","emit","listener","callback","chat","message","card"], owners:["foundry-integration","native-adapter","ui-application"] },
  { id:"targeting", words:["target","targeting","spatial","sensor","sensors","range"], owners:["targeting-spatial","ui-sensors","sensors"] },
  { id:"lifecycle", words:["lifecycle","expire","reset","round","combat","turn","cleanup","end"], owners:["turn","foundry-integration","lifecycle"] },
  { id:"transaction", words:["transaction","validation","commit","rollback","resource","semantic"], owners:["execution-transaction","semantic-event-bus","resource-service","action-economy"] }
]);

function splitGoalClauses(value) {
  const protectedText = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!protectedText) return [];
  const primary = protectedText
    .split(/\s*;\s*|\s*\.\s+(?=[A-Z0-9])|\s*,\s*/)
    .flatMap(part => part.split(/\s+(?:then|while|but|so that)\s+/i))
    .flatMap(part => part.split(/\s+and\s+(?=(?:the\s+)?(?:player|frame|native|it|this|that|apply|spend|restrict|show|render|update|record|execute|add|prevent|allow|prompt|select|gain|reduce|halve|track|clear|reset|roll|use|offer|display|handle|emit|create|persist|consume|mark|register|bind)\b)/i))
    .map(part => part.trim().replace(/^and\s+/i, ""))
    .filter(Boolean);
  return primary.length ? primary : [protectedText];
}

function detectConcerns(text) {
  const haystack = ` ${norm(text)} `;
  return CONCERNS.filter(concern => concern.words.some(word => haystack.includes(` ${norm(word)} `))).map(concern => concern.id);
}

function concernDefinition(id) {
  return CONCERNS.find(concern => concern.id === id) ?? null;
}

function runSelfTest() {
  const clauses = splitGoalClauses("offer Brace when hit, spend a reaction, halve the triggering damage, and restrict the next turn");
  if (clauses.length < 4) throw new Error(`Expected >=4 clauses, found ${clauses.length}`);
  const expected = ["reaction","native-execution","action-economy"];
  const detected = new Set(clauses.flatMap(detectConcerns));
  for (const concern of expected) if (!detected.has(concern)) throw new Error(`Missing concern ${concern}`);
  const syntheticFamilies = new Set(["turn","actions","native-adapter","ui-application"]);
  for (const concernId of expected) {
    const owners = concernDefinition(concernId)?.owners ?? [];
    if (!owners.some(owner => syntheticFamilies.has(owner))) throw new Error(`No synthetic owner for ${concernId}`);
  }
  console.log("[patch-corridor] Clause-aware self-test passed.");
}

if (selfTest) {
  runSelfTest();
  process.exit(0);
}

if (!goal) {
  console.error('Usage: npm run patch-corridor -- --goal "wire committed Scan through native execution"');
  process.exit(2);
}

const terms = termsFor(goal);
const containsAny = values => terms.some(t => values.includes(t));
const scoreWithTerms = (v, localTerms = terms) => {
  const h = norm(v);
  return localTerms.reduce((n,t) => n + (h.includes(t) ? (t.length >= 7 ? 4 : 2) : 0), 0);
};

function diagnostic(name, prefix) {
  const out = path.join(os.tmpdir(), `${prefix}-${process.pid}.json`);
  const r = spawnSync(process.execPath, [path.join(ROOT,"dev_scripts",name),"--output",out], {cwd:ROOT,encoding:"utf8"});
  if (r.status !== 0) throw new Error(`${name} failed; planner requires healthy diagnostics.`);
  return JSON.parse(fs.readFileSync(out,"utf8"));
}

function topSymbols(text, localTerms = terms) {
  const found = [];
  for (const [kind,re] of [
    ["function",/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm],
    ["class",/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm],
    ["binding",/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm]
  ]) {
    let m;
    while ((m = re.exec(text))) {
      const s = scoreWithTerms(m[1], localTerms);
      if (s) found.push({name:m[1],kind,line:text.slice(0,m.index).split("\n").length,score:s});
    }
  }
  return found.sort((a,b)=>b.score-a.score||a.line-b.line).slice(0,8);
}

const repo = diagnostic("repo-audit.mjs","corridor-repo");
const symbols = diagnostic("symbol-family-audit.mjs","corridor-symbol");
const effects = diagnostic("effect-atlas.mjs","corridor-effect");
const families = new Map(arr(symbols.families).map(f => [f.id,f]));

const graph = new Map();
for (const f of families.values()) {
  if (!graph.has(f.id)) graph.set(f.id,new Set());
  for (const x of [...arr(f.incomingFamilies),...arr(f.outgoingFamilies)]) {
    graph.get(f.id).add(x);
    if (!graph.has(x)) graph.set(x,new Set());
    graph.get(x).add(f.id);
  }
}

const actionIntent = containsAny(["action","actions","committed","plan","attack","scan","boost","lock","target","reaction"]);
const presentationIntent = containsAny(["committed","presentation","button","panel","ui","execute-control","control","prompt","render"]);
const endpointIntent = containsAny(["native","lancer","execute","execution","roll","attack","endpoint","flow","damage"]);
const transactionIntent = containsAny(["transaction","hook","validation","commit","economy","resource","semantic"]);
const lifecycleIntent = containsAny(["lifecycle","expire","reset","status","condition","cleanup","combat","round"]);
const targetingIntent = containsAny(["target","targeting","spatial","sensor","range"]);

const dormantUnlessRequested = new Set();
if (!lifecycleIntent) {
  dormantUnlessRequested.add("lifecycle");
  dormantUnlessRequested.add("lifecycle-service");
}
if (!targetingIntent) {
  dormantUnlessRequested.add("targeting-spatial");
  dormantUnlessRequested.add("targeting-spatial-service");
}
if (!transactionIntent) {
  dormantUnlessRequested.add("action-economy");
  dormantUnlessRequested.add("execution-transaction");
  dormantUnlessRequested.add("semantic-event-bus");
  dormantUnlessRequested.add("resource-service");
  dormantUnlessRequested.add("actor-owned-feature-registry");
}

const ranked = [...families.values()].map(f => {
  let s = scoreWithTerms(f.id)*4 + scoreWithTerms(arr(f.locations).join(" "));
  for (const stem of arr(f.topStems)) s += scoreWithTerms(stem.stem)*Math.min(3,Number(stem.count??1));
  if (actionIntent && ["actions","action-execution","turn"].includes(f.id)) s += 12;
  if (presentationIntent && ["ui-turn","ui-application"].includes(f.id)) s += 14;
  if (endpointIntent && ["native-adapter","action-execution","system-bridge"].includes(f.id)) s += 12;
  if (dormantUnlessRequested.has(f.id)) s -= 18;
  return {id:f.id,score:s};
}).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));

function existing(ids, { allowDormant = false } = {}) {
  return ids.filter(id => families.has(id) && (allowDormant || !dormantUnlessRequested.has(id)));
}

let sourceAnchors = [];
if (actionIntent) sourceAnchors.push("actions","action-execution","turn");
if (presentationIntent) sourceAnchors.push("ui-turn","ui-application");
sourceAnchors = existing([...new Set(sourceAnchors)]);

let endpointAnchors = [];
if (endpointIntent) endpointAnchors.push("action-execution","native-adapter","system-bridge");
endpointAnchors = existing([...new Set(endpointAnchors)]);

if (!sourceAnchors.length) sourceAnchors = ranked.filter(x=>x.score>0 && !dormantUnlessRequested.has(x.id)).slice(0,2).map(x=>x.id);
if (!endpointAnchors.length) endpointAnchors = ranked.filter(x=>x.score>0 && !sourceAnchors.includes(x.id) && !dormantUnlessRequested.has(x.id)).slice(0,2).map(x=>x.id);

function pathBetween(a,b, { allowDormant = false } = {}) {
  if (a === b) return [a];
  const q=[[a]], seen=new Set([a]);
  while(q.length) {
    const p=q.shift(), tail=p[p.length-1];
    for(const n of graph.get(tail)??[]) {
      if(seen.has(n) || (!allowDormant && dormantUnlessRequested.has(n))) continue;
      const next=[...p,n];
      if(n===b) return next;
      seen.add(n); q.push(next);
    }
  }
  return [];
}

function nearestPath(owner, anchors, options = {}) {
  if (!owner) return [];
  let best = [];
  for (const anchor of anchors) {
    const candidate = pathBetween(owner, anchor, options);
    if (candidate.length && (!best.length || candidate.length < best.length)) best = candidate;
  }
  return best.length ? best : [owner];
}

const rawClauses = splitGoalClauses(goal);
const clauseRecords = rawClauses.map((text,index) => {
  const concerns = detectConcerns(text);
  return {
    id:`clause-${index+1}`,
    text,
    terms:termsFor(text),
    concerns,
    obligations:[],
    complete:false
  };
});

const allAnchors = [...new Set([...sourceAnchors,...endpointAnchors])];
for (const clause of clauseRecords) {
  if (!clause.concerns.length) {
    const lexical = ranked.filter(row => row.score > 0 && scoreWithTerms(row.id, clause.terms) > 0 && !dormantUnlessRequested.has(row.id));
    if (lexical.length === 1 || (lexical.length > 1 && lexical[0].score > lexical[1].score)) {
      const owner = lexical[0].id;
      clause.obligations.push({concern:"lexical",candidateOwners:[owner],owner,path:nearestPath(owner,allAnchors),status:"covered",basis:"unique lexical family match"});
    } else {
      clause.obligations.push({concern:"unclassified",candidateOwners:lexical.slice(0,4).map(row=>row.id),owner:null,path:[],status:"unresolved",basis:"no deterministic concern/owner mapping"});
    }
  } else {
    for (const concernId of clause.concerns) {
      const definition = concernDefinition(concernId);
      const allowDormant = (concernId === "targeting" && targetingIntent) || (concernId === "lifecycle" && lifecycleIntent) || (concernId === "transaction" && transactionIntent);
      const candidates = existing(definition?.owners ?? [], {allowDormant});
      let selected = null;
      let selectedPath = [];
      for (const candidate of candidates) {
        const route = nearestPath(candidate, allAnchors, {allowDormant});
        if (!route.length) continue;
        selected = candidate;
        selectedPath = route;
        break;
      }
      clause.obligations.push({
        concern:concernId,
        candidateOwners:candidates,
        owner:selected,
        path:selectedPath,
        status:selected ? "covered" : "unresolved",
        basis:selected ? "deterministic concern-to-family ownership rule" : "no available owner/path in current architecture"
      });
    }
  }
  clause.complete = clause.obligations.length > 0 && clause.obligations.every(item => item.status === "covered" && item.owner && item.path.length);
}

const clauseCoverageComplete = clauseRecords.length > 0 && clauseRecords.every(clause => clause.complete);
const uncoveredClauses = clauseRecords.filter(clause => !clause.complete).map(clause => clause.id);

const corridor = new Set([...sourceAnchors,...endpointAnchors]);
for (const clause of clauseRecords) {
  for (const obligation of clause.obligations) for (const family of obligation.path) corridor.add(family);
}
for (const a of sourceAnchors) {
  let best = [];
  for (const b of endpointAnchors) {
    const p = pathBetween(a,b);
    if (p.length && (!best.length || p.length < best.length)) best = p;
  }
  for (const n of best.slice(0,8)) corridor.add(n);
}
for (const b of endpointAnchors) {
  let best = [];
  for (const a of sourceAnchors) {
    const p = pathBetween(a,b);
    if (p.length && (!best.length || p.length < best.length)) best = p;
  }
  for (const n of best.slice(0,8)) corridor.add(n);
}

const familyScores = new Map(ranked.map(x=>[x.id,x.score]));
const clauseTermsByFamily = new Map();
for (const clause of clauseRecords) {
  for (const obligation of clause.obligations) {
    for (const family of obligation.path) {
      const set = clauseTermsByFamily.get(family) ?? new Set();
      clause.terms.forEach(term => set.add(term));
      clauseTermsByFamily.set(family,set);
    }
  }
}

const familyRows = new Map();
for (const id of corridor) {
  const f=families.get(id);
  if(!f) continue;
  const localTerms=[...new Set([...terms,...(clauseTermsByFamily.get(id)??[])])];
  const rows=[];
  for(const rel of arr(f.locations)) {
    const abs=path.join(ROOT,rel);
    if(!fs.existsSync(abs)||!fs.statSync(abs).isFile()) continue;
    const text=fs.readFileSync(abs,"utf8");
    let s=(familyScores.get(id)??0)+scoreWithTerms(rel,localTerms)*4+scoreWithTerms(text.slice(0,18000),localTerms);
    const normalizedRel=norm(rel);
    if (actionIntent && normalizedRel.includes("action")) s += 8;
    if (presentationIntent && (normalizedRel.includes("committed") || normalizedRel.includes("ui turn") || normalizedRel.includes("presentation"))) s += 14;
    if (endpointIntent && (normalizedRel.includes("native") || normalizedRel.includes("action execution"))) s += 12;
    if (norm(text).includes("committed plan")) s += presentationIntent ? 10 : 0;
    if (text.includes("executeControl")) s += presentationIntent ? 10 : 0;
    rows.push({file:rel,family:id,score:s,symbols:topSymbols(text,localTerms)});
  }
  rows.sort((a,b)=>b.score-a.score||a.file.localeCompare(b.file));
  familyRows.set(id,rows);
}

const clauseOwnerSet = new Set(clauseRecords.flatMap(c=>c.obligations.map(o=>o.owner).filter(Boolean)));
const anchorSet = new Set([...sourceAnchors,...endpointAnchors,...clauseOwnerSet]);
const orderedFamilies = [...corridor].sort((a,b)=>
  (clauseOwnerSet.has(b)?1:0)-(clauseOwnerSet.has(a)?1:0) ||
  (anchorSet.has(b)?1:0)-(anchorSet.has(a)?1:0) ||
  (familyScores.get(b)??0)-(familyScores.get(a)??0) ||
  a.localeCompare(b)
);
const files=[];
for (const id of orderedFamilies) {
  const quota = clauseOwnerSet.has(id) ? 2 : anchorSet.has(id) ? 2 : 1;
  for (const row of (familyRows.get(id)??[]).slice(0,quota)) {
    if (!files.some(x=>x.file===row.file)) files.push(row);
    if (files.length >= 16) break;
  }
  if (files.length >= 16) break;
}

const effectOwners=arr(effects.ownerFamilies)
  .filter(x=>corridor.has(x.id))
  .sort((a,b)=>Number(b.siteCount??0)-Number(a.siteCount??0))
  .slice(0,6);

const flow=repo.dependencyFlow??repo.dependency_flow??{};
const rivers=arr(flow.rivers??flow.majorRivers);
const runtime=rivers.filter(r=>arr(r.streams).some(s=>corridor.has(s.id??s.name))).map(r=>({
  river:r.name??r.id??"runtime",
  convergence:r.convergence??r.convergencePoint??null,
  outlet:r.outlet??null
}));
if(!runtime.length) runtime.push({river:"runtime",convergence:"scripts/feature-registry.js / styles/ui-registry.js",outlet:"scripts/runtime-orchestrator.js"});

const symbolCount=files.reduce((n,f)=>n+f.symbols.length,0);
const representedSource = sourceAnchors.some(id=>files.some(f=>f.family===id));
const representedEndpoint = endpointAnchors.some(id=>files.some(f=>f.family===id));
const representedClauseOwners = [...clauseOwnerSet].every(id=>files.some(f=>f.family===id));
const confidence = clauseCoverageComplete && representedSource && representedEndpoint && representedClauseOwners && symbolCount >= 2 ? "high" :
  clauseCoverageComplete && (representedSource || representedEndpoint) && symbolCount ? "medium" : "incomplete";

const report={
  planner:{name:"Frame Conn Clause-Aware Patch Corridor Planner",version:PLANNER_VERSION,generatedAt:new Date().toISOString()},
  goal,terms,
  intent:{action:actionIntent,presentation:presentationIntent,endpoint:endpointIntent,transaction:transactionIntent,lifecycle:lifecycleIntent,targeting:targetingIntent},
  clauses:clauseRecords,
  clauseCoverage:{
    complete:clauseCoverageComplete,
    clauseCount:clauseRecords.length,
    coveredCount:clauseRecords.length-uncoveredClauses.length,
    uncoveredClauses,
    rule:"Every required behavioral clause must resolve to at least one architectural owner and a statically known family path before the corridor is complete."
  },
  anchors:{source:sourceAnchors,endpoint:endpointAnchors,clauseOwners:[...clauseOwnerSet]},
  summary:{families:corridor.size,files:files.length,symbols:symbolCount,confidence,clauseCoverageComplete},
  corridor:[...corridor],
  rankedFamilies:ranked.slice(0,12),
  files,runtime,effects:effectOwners,
  scope:{
    maxFilesSuggested:Math.max(1,files.length),
    certificationRule:"All behavioral clauses must be covered. Prefer edits inside this corridor; justify any file outside it by a newly discovered dependency, runtime binding, or effect boundary."
  },
  baseline:{
    dependencyErrors:repo.summary?.errors??null,
    symbolErrors:symbols.summary?.errors??null,
    effectErrors:effects.summary?.errors??null,
    effectWarnings:effects.summary?.warnings??null
  }
};
fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n");

console.log(`\nFrame Conn clause-aware patch corridor: ${goal}`);
console.log(`${report.summary.families} families | ${report.summary.files} files | ${symbolCount} symbol anchors | ${confidence} confidence`);
console.log(`  clause coverage: ${report.clauseCoverage.coveredCount}/${report.clauseCoverage.clauseCount} ${clauseCoverageComplete?"COMPLETE":"INCOMPLETE"}`);
for (const clause of clauseRecords) {
  console.log(`  ${clause.id} ${clause.complete?"✓":"✗"} ${clause.text}`);
  for (const obligation of clause.obligations) {
    console.log(`    ${obligation.concern}: ${obligation.owner??"UNRESOLVED"}${obligation.path.length?` | ${obligation.path.join(" -> ")}`:""}`);
  }
}
console.log(`  source anchors: ${sourceAnchors.join(", ")||"none"}`);
console.log(`  endpoint anchors: ${endpointAnchors.join(", ")||"none"}`);
console.log(`\nCorridor:\n  ${report.corridor.join(" -> ")}`);
console.log("\nTargeted patch surface:");
for(const f of files) {
  console.log(`  ${f.file} [${f.family}]`);
  for(const s of f.symbols.slice(0,5)) console.log(`    L${s.line} ${s.kind} ${s.name}`);
}
console.log("\nRuntime convergence:");
for(const r of runtime) console.log(`  ${r.river}: ${r.convergence??"composition"}${r.outlet?` -> ${r.outlet}`:""}`);
console.log("\nEffect boundary candidates:");
if(!effectOwners.length) console.log("  none in current corridor");
for(const e of effectOwners) console.log(`  ${e.id}: ${e.siteCount??0} effect sites | ${e.status??"healthy"}`);
console.log(`\nExpected scope: <= ${report.scope.maxFilesSuggested} files; report: ${output}`);

if (!clauseCoverageComplete) {
  console.error("\n[patch-corridor] Refusing to certify corridor: one or more behavioral clauses lack an architectural owner/path.");
  process.exit(3);
}
