#!/usr/bin/env node

/**
 * Frame Conn Corridor Context Pack
 *
 * Converts a certified clause-aware Patch Corridor report into a compact,
 * source-backed authoring packet. It never broadens corridor scope and never
 * invents callers, imports, symbol boundaries, exemplars, or ownership.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const VERSION = "1.0.0";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CODE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const IGNORE_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", "dev_scripts/backups", "dev_scripts/patch-history"]);

function args(argv) {
  const out = { goal:null, corridor:null, output:path.join(ROOT,"corridor-context-pack.json"), maxSlices:24, selfTest:false, printSource:false };
  for (let i=2;i<argv.length;i++) {
    const a=argv[i];
    if (a==="--goal") out.goal=argv[++i]??null;
    else if (a==="--corridor") out.corridor=argv[++i]??null;
    else if (a==="--output") out.output=path.resolve(ROOT,argv[++i]??"corridor-context-pack.json");
    else if (a==="--max-slices") out.maxSlices=Math.max(1,Number(argv[++i]??24)||24);
    else if (a==="--self-test") out.selfTest=true;
    else if (a==="--print-source") out.printSource=true;
    else if (a==="--help"||a==="-h") {
      console.log('Usage: npm run corridor-context -- --goal "behavioral goal" [--output file]\n       npm run corridor-context -- --corridor patch-corridor-report.json\n       npm run corridor-context -- --self-test');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

const slash=v=>String(v).replaceAll("\\","/");
const lineAt=(text,index)=>text.slice(0,index).split("\n").length;

function matching(text, open, left="{", right="}") {
  let depth=0, quote=null, escaped=false, lineComment=false, blockComment=false;
  for(let i=open;i<text.length;i++) {
    const c=text[i], n=text[i+1];
    if(lineComment){ if(c==="\n") lineComment=false; continue; }
    if(blockComment){ if(c==="*"&&n==="/"){ blockComment=false;i++; } continue; }
    if(quote){ if(escaped) escaped=false; else if(c==="\\") escaped=true; else if(c===quote) quote=null; continue; }
    if(c==="/"&&n==="/"){ lineComment=true;i++;continue; }
    if(c==="/"&&n==="*"){ blockComment=true;i++;continue; }
    if(c==='"'||c==="'"||c==='`'){ quote=c;continue; }
    if(c===left) depth++;
    else if(c===right){ depth--; if(depth===0)return i; }
  }
  return -1;
}

function declarations(text) {
  const found=[];
  const patterns=[
    ["function",/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm],
    ["class",/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/gm],
    ["binding",/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm]
  ];
  for(const [kind,re] of patterns) for(const m of text.matchAll(re)) found.push({kind,name:m[1],start:m.index,line:lineAt(text,m.index)});
  found.sort((a,b)=>a.start-b.start);
  for(let i=0;i<found.length;i++) {
    const d=found[i];
    const next=found[i+1]?.start??text.length;
    if(d.kind==="function"||d.kind==="class") {
      const open=text.indexOf("{",d.start);
      const close=open>=0?matching(text,open):-1;
      d.end=close>=0?close+1:Math.min(next,text.length);
    } else {
      let end=Math.min(next,text.length), depth=0, quote=null, escaped=false;
      for(let p=text.indexOf("=",d.start)+1;p<next;p++) {
        const c=text[p];
        if(quote){ if(escaped)escaped=false; else if(c==="\\")escaped=true; else if(c===quote)quote=null; continue; }
        if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
        if("([{".includes(c))depth++; else if(")] }".replace(" ","").includes(c))depth=Math.max(0,depth-1);
        if(c===";"&&depth===0){end=p+1;break;}
      }
      d.end=end;
    }
    d.endLine=lineAt(text,Math.max(d.start,d.end-1));
  }
  return found;
}

function resolveSymbol(text, requested) {
  const matches=declarations(text).filter(d=>d.name===requested.name && (!requested.kind||d.kind===requested.kind));
  if(matches.length!==1) return {status:"unresolved",reason:`expected one ${requested.kind??"symbol"} ${requested.name}; found ${matches.length}`};
  const d=matches[0];
  return {status:"resolved",...d,source:text.slice(d.start,d.end)};
}

function parseImports(text) {
  const rows=[];
  const re=/^import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;?/gm;
  for(const m of text.matchAll(re)) {
    const spec=m[1], names=[];
    const def=spec.match(/^([A-Za-z_$][\w$]*)/); if(def)names.push(def[1]);
    const ns=spec.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/); if(ns)names.push(ns[1]);
    const braces=spec.match(/\{([\s\S]*?)\}/);
    if(braces) for(const part of braces[1].split(",")) { const x=part.trim().match(/(?:^|\bas\s+)([A-Za-z_$][\w$]*)$/); if(x)names.push(x[1]); }
    rows.push({source:m[2],names:[...new Set(names)],line:lineAt(text,m.index),statement:m[0].trim()});
  }
  return rows;
}

function relevantImports(text, slice) {
  return parseImports(text).filter(row=>row.names.some(name=>new RegExp(`\\b${name.replace(/[$]/g,"\\$")}\\b`).test(slice)));
}

function collectCodeFiles(root) {
  const out=[];
  function walk(dir, rel="") {
    for(const ent of fs.readdirSync(dir,{withFileTypes:true})) {
      const childRel=slash(path.join(rel,ent.name));
      if(ent.isDirectory()) { if([...IGNORE_DIRS].some(x=>childRel===x||childRel.startsWith(`${x}/`)))continue; walk(path.join(dir,ent.name),childRel); }
      else if(ent.isFile()&&CODE_EXTENSIONS.has(path.extname(ent.name).toLowerCase()))out.push({abs:path.join(dir,ent.name),rel:childRel});
    }
  }
  walk(root); return out;
}

function enclosingSymbol(text,index) {
  const ds=declarations(text).filter(d=>d.start<=index&&d.end>=index);
  return ds.sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0]??null;
}

function callersFor(symbol, codeFiles, ownFile) {
  const out=[]; const re=new RegExp(`\\b${symbol.replace(/[$]/g,"\\$")}\\b`,"g");
  for(const f of codeFiles) {
    const text=fs.readFileSync(f.abs,"utf8"); let m;
    while((m=re.exec(text))) {
      if(f.rel===ownFile) {
        const decl=declarations(text).find(d=>d.name===symbol&&m.index>=d.start&&m.index<d.start+Math.min(120,d.end-d.start));
        if(decl)continue;
      }
      const owner=enclosingSymbol(text,m.index);
      const lineText=text.slice(text.lastIndexOf("\n",m.index)+1,(text.indexOf("\n",m.index)===-1?text.length:text.indexOf("\n",m.index))).trim();
      if(/^import\b|^export\b/.test(lineText))continue;
      out.push({file:f.rel,line:lineAt(text,m.index),enclosingSymbol:owner?.name??null,evidence:lineText.slice(0,220)});
      if(out.length>=12)return out;
    }
  }
  return out;
}

function structuralSignature(source) {
  return {
    hasReturn:/\breturn\b/.test(source),
    hasAwait:/\bawait\b/.test(source),
    hasHooks:/\bHooks\./.test(source),
    hasHtml:/<button\b|html`|<div\b/.test(source),
    hasSwitch:/\bswitch\s*\(/.test(source),
    lines:source.split("\n").length
  };
}

function exemplarFor(text, resolved) {
  const peers=declarations(text).filter(d=>d.kind===resolved.kind&&d.name!==resolved.name&&Math.abs(d.line-resolved.line)<=140);
  if(!peers.length)return {status:"none",reason:"no nearby same-kind symbol"};
  const sig=structuralSignature(resolved.source);
  const scored=peers.map(p=>{
    const src=text.slice(p.start,p.end), ps=structuralSignature(src);
    let score=0; for(const k of ["hasReturn","hasAwait","hasHooks","hasHtml","hasSwitch"])if(sig[k]===ps[k])score++;
    score+=Math.max(0,2-Math.floor(Math.abs(sig.lines-ps.lines)/20));
    return {...p,score,source:src};
  }).sort((a,b)=>b.score-a.score||Math.abs(a.line-resolved.line)-Math.abs(b.line-resolved.line));
  if(scored.length>1&&scored[0].score===scored[1].score)return {status:"ambiguous",reason:`top exemplar score tied (${scored[0].score})`,candidates:scored.slice(0,3).map(x=>({name:x.name,line:x.line,score:x.score}))};
  const p=scored[0];
  return {status:"resolved",name:p.name,kind:p.kind,lineStart:p.line,lineEnd:p.endLine,score:p.score,source:p.source};
}

function ownershipFor(report,family) {
  const clauses=[];
  for(const clause of report.clauses??[]) for(const obligation of clause.obligations??[]) {
    if(obligation.owner===family||(obligation.path??[]).includes(family)) clauses.push({clauseId:clause.id,clause:clause.text,concern:obligation.concern,owner:obligation.owner,path:obligation.path,basis:obligation.basis});
  }
  return clauses;
}

function getCorridor(options) {
  if(options.corridor) return JSON.parse(fs.readFileSync(path.resolve(ROOT,options.corridor),"utf8"));
  if(!options.goal)throw new Error("Supply --goal or --corridor.");
  const tmp=path.join(os.tmpdir(),`frame-conn-context-corridor-${process.pid}.json`);
  const planner=path.join(ROOT,"dev_scripts","patch-corridor-planner.mjs");
  const r=spawnSync(process.execPath,[planner,"--goal",options.goal,"--output",tmp],{cwd:ROOT,encoding:"utf8"});
  if(r.stdout)process.stdout.write(r.stdout); if(r.stderr)process.stderr.write(r.stderr);
  if(r.status!==0)throw new Error("Clause-aware Patch Corridor did not certify the goal; context pack refused.");
  return JSON.parse(fs.readFileSync(tmp,"utf8"));
}

function buildPack(report,maxSlices=24) {
  if(report.clauseCoverage?.complete!==true)throw new Error("Context Pack requires clauseCoverage.complete === true.");
  const codeFiles=collectCodeFiles(ROOT);
  const slices=[]; const omissions=[];
  for(const fileRow of report.files??[]) {
    if(slices.length>=maxSlices)break;
    const abs=path.join(ROOT,fileRow.file);
    if(!fs.existsSync(abs)){omissions.push({file:fileRow.file,reason:"planner-selected file missing"});continue;}
    const text=fs.readFileSync(abs,"utf8");
    for(const requested of fileRow.symbols??[]) {
      if(slices.length>=maxSlices)break;
      const resolved=resolveSymbol(text,requested);
      if(resolved.status!=="resolved"){omissions.push({file:fileRow.file,symbol:requested.name,reason:resolved.reason});continue;}
      slices.push({
        file:fileRow.file,
        family:fileRow.family,
        symbol:{name:resolved.name,kind:resolved.kind,lineStart:resolved.line,lineEnd:resolved.endLine},
        ownership:ownershipFor(report,fileRow.family),
        imports:relevantImports(text,resolved.source),
        callers:callersFor(resolved.name,codeFiles,fileRow.file),
        exemplar:exemplarFor(text,resolved),
        source:resolved.source
      });
    }
  }
  return {
    schemaVersion:1,
    tool:"Frame Conn Corridor Context Pack",
    toolVersion:VERSION,
    generatedAt:new Date().toISOString(),
    goal:report.goal,
    corridor:{families:report.corridor,clauseCoverage:report.clauseCoverage,summary:report.summary},
    summary:{slices:slices.length,files:new Set(slices.map(x=>x.file)).size,omissions:omissions.length},
    slices,omissions,
    safety:{scopeRule:"Only planner-selected files/symbols are materialized.",callerRule:"Callers are lexical source references with enclosing-symbol evidence, not runtime proof.",exemplarRule:"Exemplars are emitted only for a unique top structural match; ties are marked ambiguous."}
  };
}

function selfTest() {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"context-pack-test-"));
  try {
    const text='import { helper, unused } from "./dep.js";\n\nexport function alpha(value) {\n  return helper(value);\n}\n\nexport function beta(value) {\n  return helper(value + 1);\n}\n';
    const r=resolveSymbol(text,{name:"alpha",kind:"function"});
    if(r.status!=="resolved"||!r.source.includes("return helper"))throw new Error("symbol resolution failed");
    const imports=relevantImports(text,r.source); if(imports.length!==1||!imports[0].names.includes("helper"))throw new Error("relevant import extraction failed");
    const exemplar=exemplarFor(text,r); if(exemplar.status!=="resolved"||exemplar.name!=="beta")throw new Error("exemplar resolution failed");
    console.log("[corridor-context-pack] Self-test passed.");
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
}

const options=args(process.argv);
if(options.selfTest){selfTest();process.exit(0);}
const report=getCorridor(options);
const pack=buildPack(report,options.maxSlices);
fs.mkdirSync(path.dirname(options.output),{recursive:true});
fs.writeFileSync(options.output,JSON.stringify(pack,null,2)+"\n");
console.log(`\nFrame Conn Corridor Context Pack`);
console.log(`${pack.summary.slices} exact symbol slices | ${pack.summary.files} files | ${pack.summary.omissions} omissions`);
for(const slice of pack.slices) {
  console.log(`  ${slice.file}:${slice.symbol.lineStart}-${slice.symbol.lineEnd} ${slice.symbol.kind} ${slice.symbol.name}`);
  console.log(`    imports=${slice.imports.length} callers=${slice.callers.length} exemplar=${slice.exemplar.status}`);
  const clauseIds=[...new Set(slice.ownership.map(x=>x.clauseId))];
  if(clauseIds.length)console.log(`    ownership=${slice.family}; clauses=${clauseIds.join(",")}`);
  if(options.printSource) {
    console.log(`----- CONTEXT SLICE ${slice.file}:${slice.symbol.lineStart}-${slice.symbol.lineEnd} ${slice.symbol.name} -----`);
    console.log(slice.source);
    console.log(`----- END CONTEXT SLICE ${slice.symbol.name} -----`);
  }
}
if(pack.omissions.length){console.log("  omissions:");for(const o of pack.omissions)console.log(`    ${o.file}${o.symbol?`:${o.symbol}`:""} — ${o.reason}`);}
console.log(`Report: ${options.output}`);
