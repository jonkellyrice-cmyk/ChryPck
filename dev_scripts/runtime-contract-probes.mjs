#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const VERSION="1.0.0";
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const DEFAULT_CATALOG=path.join(ROOT,"dev_scripts/native-contract-catalog.json");
const DEFAULT_OUT=path.join(ROOT,"dev_scripts/runtime-probes");
const stop=new Set(["the","and","for","with","from","that","this","frame","conn","lancer","native","runtime","feature","action"]);
const tok=v=>[...new Set(String(v??"").toLowerCase().split(/[^a-z0-9_$.-]+/).filter(x=>x.length>1&&!stop.has(x)))];
const sid=v=>String(v??"probe").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,72)||"probe";

function args(argv){
  const a={goal:null,id:null,corridor:null,map:null,native:null,catalog:DEFAULT_CATALOG,out:null,self:false};
  for(let i=2;i<argv.length;i++){const x=argv[i];
    if(x==="--goal")a.goal=argv[++i]; else if(x==="--id")a.id=argv[++i];
    else if(x==="--corridor")a.corridor=path.resolve(argv[++i]??"");
    else if(x==="--runtime-map")a.map=path.resolve(argv[++i]??"");
    else if(x==="--native-root")a.native=path.resolve(argv[++i]??"");
    else if(x==="--catalog")a.catalog=path.resolve(argv[++i]??DEFAULT_CATALOG);
    else if(x==="--output-dir")a.out=path.resolve(argv[++i]??DEFAULT_OUT);
    else if(x==="--self-test")a.self=true;
    else if(x==="--help"||x==="-h"){console.log("Runtime Contract Probes: --goal <text> [--native-root <path>] [--output-dir <path>] | --self-test");process.exit(0);}
    else throw new Error(`Unknown argument: ${x}`);
  } return a;
}
function run(script,av,label){
  const r=spawnSync(process.execPath,[script,...av],{cwd:ROOT,encoding:"utf8",maxBuffer:16*1024*1024});
  if(r.stdout)process.stdout.write(r.stdout); if(r.stderr)process.stderr.write(r.stderr);
  if(r.error||r.status!==0)throw new Error(`${label} failed${r.error?`: ${r.error}`:` (${r.status})`}`);
}
function corridor(goal,file){
  if(file){const x=JSON.parse(fs.readFileSync(file,"utf8"));if(x.clauseCoverage?.complete!==true)throw new Error("Clause-complete corridor required.");return x;}
  const o=path.join(os.tmpdir(),`fc-probe-corridor-${process.pid}.json`);
  run(path.join(ROOT,"dev_scripts/patch-corridor-planner.mjs"),["--goal",goal,"--output",o],"Patch Corridor"); return corridor(goal,o);
}
function signalMap(file,native){
  if(file)return JSON.parse(fs.readFileSync(file,"utf8"));
  const o=path.join(os.tmpdir(),`fc-probe-map-${process.pid}.json`),av=["--output",o,"--json-only"];
  if(native)av.push("--native-root",native);
  run(path.join(ROOT,"dev_scripts/runtime-signal-map.mjs"),av,"Runtime Signal Map"); return JSON.parse(fs.readFileSync(o,"utf8"));
}
function catalog(file){return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{contracts:[],native_system:null};}
function clauses(c){return(c.clauses??[]).map((x,i)=>({id:x.id??`clause-${i+1}`,text:x.text??String(x),concerns:[...new Set([...(x.concerns??[]),...((x.obligations??[]).map(y=>y.concern).filter(Boolean))])]}));}
function nodeText(n){return[n.name,n.kind,n.effectKind,n.file,n.selector,n.eventName,...(n.tags??[]),n.evidence].filter(Boolean).join(" ").toLowerCase();}
function bonus(conc,k){if(conc==="presentation"&&["event","hook","effect"].includes(k))return 5;if(["hook/event","hook"].includes(conc)&&["hook","event"].includes(k))return 6;if(conc==="native-execution"&&["flow","flow-step","effect","callable"].includes(k))return 5;if(["state","lifecycle","reaction","action-economy","movement"].includes(conc)&&["hook","effect","callable"].includes(k))return 3;return 0;}
function nodes(map,cl){return(map.nodes??[]).map(n=>{let s=tok(cl.text).reduce((z,t)=>z+(nodeText(n).includes(t)?4:0),0);for(const c of cl.concerns)s+=bonus(c,n.kind);return{n,s};}).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,8);}
function contracts(cat,cl){const q=tok(cl.text);return(cat.contracts??[]).filter(c=>c.status==="proven").map(c=>{const h=[c.id,c.title,c.summary,...(c.keywords??[])].join(" ").toLowerCase();return{c,s:q.reduce((z,t)=>z+(h.includes(t)?4:0),0)}}).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,4);}
function probe(n,cid){
  const ev={nodeId:n.id??null,source:n.source??null,file:n.file??null,line:n.line??null};
  if(n.kind==="flow"&&n.name)return{id:`flow-${sid(n.name)}`,clauseIds:[cid],kind:"flow",flowName:n.name,label:`Flow ${n.name}`,evidence:ev};
  if(n.kind==="hook"&&n.name)return{id:`hook-${sid(n.name)}`,clauseIds:[cid],kind:"hook",hookName:n.name,label:`Hook ${n.name}`,evidence:ev};
  if(n.kind==="event"&&n.eventName)return{id:`event-${sid(n.eventName+"-"+(n.selector??n.name))}`,clauseIds:[cid],kind:"event",eventName:n.eventName,selector:n.selector??null,label:`${n.eventName} ${n.selector??""}`.trim(),evidence:ev};
  if(n.kind==="effect"&&String(n.name??"").endsWith("ChatMessage.create"))return{id:"effect-chat-message-create",clauseIds:[cid],kind:"method",objectPath:"ChatMessage",methodName:"create",label:"ChatMessage.create",evidence:ev};
  return null;
}
function flowNames(c){const s=new Set();for(const e of c.evidence??[])for(const n of String(e.symbol??"").match(/[A-Za-z_$][\w$]*Flow/g)??[])s.add(n);for(const n of String(c.summary??"").match(/\b[A-Za-z_$][\w$]*Flow\b/g)??[])s.add(n);return[...s];}
function manifest(goal,id,cor,map,cat){
  const ps=new Map(),objectives=[];
  for(const cl of clauses(cor)){const ns=nodes(map,cl),cs=contracts(cat,cl),ids=[];
    const add=p=>{if(!p)return;const old=ps.get(p.id);if(old)old.clauseIds=[...new Set([...old.clauseIds,...p.clauseIds])];else ps.set(p.id,p);ids.push(p.id);};
    for(const {n} of ns)add(probe(n,cl.id));
    for(const {c} of cs)for(const f of flowNames(c))add({id:`flow-${sid(f)}`,clauseIds:[cl.id],kind:"flow",flowName:f,label:`Proven Flow ${f}`,contractIds:[c.id]});
    const u=[...new Set(ids)];objectives.push({clauseId:cl.id,text:cl.text,concerns:cl.concerns,probeIds:u,contractIds:cs.map(x=>x.c.id),status:u.length?"instrumented":"manual",manual:u.length?null:`No safe automatic observer proven for: ${cl.text}`});
  }
  return{schemaVersion:1,tool:"Frame Conn Runtime Contract Probes",toolVersion:VERSION,id,goal,generatedAt:new Date().toISOString(),posture:"Observational and reversible; unproven boundaries remain manual.",nativeSystem:cat.native_system??null,clauseCoverage:cor.clauseCoverage??null,objectives,probes:[...ps.values()].sort((a,b)=>a.id.localeCompare(b.id))};
}
function harness(m){return`(()=>{"use strict";const M=${JSON.stringify(m)};const K="FrameConnRuntimeProbe";if(window[K]?.active)window[K].stop();const S={active:false,n:0,events:[],clean:[]};const snap=()=>({combatId:game?.combat?.id??null,round:game?.combat?.round??null,turn:game?.combat?.turn??null,combatantId:game?.combat?.combatant?.id??null});const rec=(id,kind,label,payload={})=>{const e={sequence:++S.n,time:new Date().toISOString(),probeId:id,kind,label,combat:snap(),payload};S.events.push(e);console.log("[Frame Conn Probe]",e);return e};const hook=p=>{if(!Hooks?.on||!Hooks?.off)return false;const h=(...a)=>rec(p.id,p.kind,p.label,{args:a});const n=Hooks.on(p.hookName,h);S.clean.push(()=>Hooks.off(p.hookName,n??h));return true};const flow=p=>{if(!Hooks?.on||!Hooks?.off)return false;for(const x of["preFlow","postFlow"]){const name="lancer."+x+"."+p.flowName,h=(...a)=>rec(p.id,x,p.label,{hook:name,args:a}),n=Hooks.on(name,h);S.clean.push(()=>Hooks.off(name,n??h))}return true};const event=p=>{const h=e=>{const t=e.target;if(!p.selector||t?.matches?.(p.selector)||t?.closest?.(p.selector))rec(p.id,p.kind,p.label,{type:e.type,selector:p.selector})};document.addEventListener(p.eventName,h,true);S.clean.push(()=>document.removeEventListener(p.eventName,h,true));return true};const method=p=>{const o=p.objectPath.split(".").reduce((v,k)=>v?.[k],globalThis);if(!o||typeof o[p.methodName]!=="function")return false;const f=o[p.methodName],w=function(...a){rec(p.id,p.kind,p.label,{phase:"call"});return f.apply(this,a)};o[p.methodName]=w;S.clean.push(()=>{if(o[p.methodName]===w)o[p.methodName]=f});return true};const install=p=>{try{return p.kind==="hook"?hook(p):p.kind==="flow"?flow(p):p.kind==="event"?event(p):p.kind==="method"?method(p):false}catch(e){rec(p.id,"install-error",p.label,{error:String(e)});return false}};const A={manifest:M,get active(){return S.active},start(){if(S.active)return A;S.active=true;const installed=[],unavailable=[];for(const p of M.probes)(install(p)?installed:unavailable).push(p.id);rec("session","session","started",{installed,unavailable});return A},mark:(l,d={})=>rec("manual","manual",l,d),snapshot:(l="snapshot",d={})=>rec("snapshot","snapshot",l,d),evaluate(){return M.objectives.map(o=>{const seen=o.probeIds.filter(id=>S.events.some(e=>e.probeId===id));return{clauseId:o.clauseId,text:o.text,result:o.status==="manual"?"MANUAL":seen.length?"OBSERVED":"NOT_OBSERVED",observedProbeIds:seen}})},report(){return{schemaVersion:1,id:M.id,goal:M.goal,evaluation:A.evaluate(),events:[...S.events]}},stop(){for(const f of S.clean.splice(0).reverse())try{f()}catch(e){console.warn("[Frame Conn Probe] cleanup",e)}S.active=false;rec("session","cleanup","stopped; instrumentation restored");return A.report()}};window[K]=A;A.start();console.log("[Frame Conn Probe] FrameConnRuntimeProbe ready")})();`;}
function checklist(m){return[`# Runtime Probe Checklist — ${m.id}`,"",`**Goal:** ${m.goal}`,"","1. Run `foundry-runtime-probe.js` in the Foundry browser console.","2. Perform the behavior normally; probes do not trigger gameplay.","3. Inspect `FrameConnRuntimeProbe.evaluate()` and `.report()`.","4. Use `.mark()` / `.snapshot()` for manual clauses.","5. Call `.stop()` to restore instrumentation.","","## Obligations","",...m.objectives.flatMap(o=>[`- **${o.clauseId}: ${o.text}** — ${o.status}`,o.probeIds.length?`  - probes: ${o.probeIds.join(", ")}`:`  - ${o.manual}`])].join("\n")+"\n";}
function write(m,out){fs.mkdirSync(out,{recursive:true});const a=path.join(out,"probe-manifest.json"),b=path.join(out,"foundry-runtime-probe.js"),c=path.join(out,"RUNTIME_TEST_CHECKLIST.md");fs.writeFileSync(a,JSON.stringify(m,null,2)+"\n");fs.writeFileSync(b,harness(m));fs.writeFileSync(c,checklist(m));return{a,b,c};}
function selfTest(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"fc-probe-"));try{const c={clauseCoverage:{complete:true},clauses:[{id:"c1",text:"show damage control",concerns:["presentation"]},{id:"c2",text:"run DemoFlow chat",concerns:["native-execution"]},{id:"c3",text:"clear state after turn",concerns:["state"]}]};const map={nodes:[{id:"e",kind:"event",source:"frame-conn",name:"click .damage",eventName:"click",selector:".damage"},{id:"f",kind:"flow",name:"DemoFlow"},{id:"h",kind:"hook",name:"updateCombat"},{id:"m",kind:"effect",name:"ChatMessage.create"}]};const cat={contracts:[{id:"demo",status:"proven",title:"DemoFlow chat",summary:"DemoFlow chat",keywords:["demo","chat"],evidence:[{symbol:"DemoFlow"}]}]};const m=manifest("show damage, run DemoFlow chat, clear state","self",c,map,cat);for(const k of["event","flow","hook","method"])if(!m.probes.some(p=>p.kind===k))throw new Error(`missing ${k}`);const f=write(m,dir),r=spawnSync(process.execPath,["--check",f.b],{encoding:"utf8"});if(r.status!==0)throw new Error(r.stderr);console.log("[runtime-contract-probes] Self-test passed.");}finally{fs.rmSync(dir,{recursive:true,force:true})}}
function main(){const a=args(process.argv);if(a.self)return selfTest();if(!a.goal?.trim())throw new Error("--goal required");const goal=a.goal.trim(),id=sid(a.id??goal),m=manifest(goal,id,corridor(goal,a.corridor),signalMap(a.map,a.native),catalog(a.catalog)),out=a.out??path.join(DEFAULT_OUT,id),f=write(m,out),n=m.objectives.filter(x=>x.status==="instrumented").length;console.log(`Frame Conn Runtime Contract Probes ${VERSION}`);console.log(`clauses=${m.objectives.length} instrumented=${n} manual=${m.objectives.length-n} probes=${m.probes.length}`);console.log(`manifest=${path.relative(ROOT,f.a)}\nharness=${path.relative(ROOT,f.b)}\nchecklist=${path.relative(ROOT,f.c)}`)}
try{main()}catch(e){console.error(`[runtime-contract-probes] ${e instanceof Error?e.message:String(e)}`);process.exit(1)}
