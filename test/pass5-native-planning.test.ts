import assert from "node:assert/strict";
import test from "node:test";
import type { RepositoryModel } from "../src/repository/model.js";
import { planPatchCorridor } from "../src/planning/patch-corridor.js";
import { buildContextPack } from "../src/planning/context-pack.js";
import { planPatchStages } from "../src/planning/patch-staging.js";
import { assessPropagation } from "../src/planning/change-propagation.js";
import { planRuntimeProbes } from "../src/planning/runtime-probes.js";

const model:RepositoryModel={snapshot:{repository:"o/r",commitSha:"a".repeat(40),createdAt:"2026-01-01T00:00:00Z",files:[
{path:"src/provider.ts",sha:"1",size:80,text:'export function persistBrace(){ game.settings.set("demo","brace",true); }'},
{path:"src/ui.ts",sha:"2",size:100,text:'import { persistBrace } from "./provider.js";\nexport function renderBracePrompt(){ Hooks.on("render", persistBrace); }'},
{path:"src/app.ts",sha:"3",size:60,text:'import { renderBracePrompt } from "./ui.js";\nrenderBracePrompt();'}]},fileFacts:[
{file:"src/provider.ts",dependencies:[],symbols:[{name:"persistBrace",file:"src/provider.ts",kind:"function",exported:true,line:1}],effects:[{file:"src/provider.ts",kind:"settings",detail:"Settings",line:1,symbol:"persistBrace"}],states:[{namespace:"demo",key:"brace",file:"src/provider.ts",kind:"foundry-setting",operation:"set",access:"write",namespaceResolved:true,keyResolved:true,line:1}]},
{file:"src/ui.ts",dependencies:[{file:"src/ui.ts",specifier:"./provider.js",kind:"import",line:1}],symbols:[{name:"renderBracePrompt",file:"src/ui.ts",kind:"function",exported:true,line:2}],effects:[{file:"src/ui.ts",kind:"hooks",detail:"Foundry hooks",line:2,symbol:"renderBracePrompt"}],states:[]},
{file:"src/app.ts",dependencies:[{file:"src/app.ts",specifier:"./ui.js",kind:"import",line:1}],symbols:[],effects:[],states:[]}],dependencies:[
{file:"src/ui.ts",specifier:"./provider.js",kind:"import",line:1,from:"src/ui.ts",to:"src/provider.ts"},
{file:"src/app.ts",specifier:"./ui.js",kind:"import",line:1,from:"src/app.ts",to:"src/ui.ts"}],unresolvedDependencies:[],symbols:[
{name:"persistBrace",file:"src/provider.ts",kind:"function",exported:true,line:1},{name:"renderBracePrompt",file:"src/ui.ts",kind:"function",exported:true,line:2}],effects:[
{file:"src/provider.ts",kind:"settings",detail:"Settings",line:1,symbol:"persistBrace"},{file:"src/ui.ts",kind:"hooks",detail:"Foundry hooks",line:2,symbol:"renderBracePrompt"}],states:[{namespace:"demo",key:"brace",file:"src/provider.ts",kind:"foundry-setting",operation:"set",access:"write",namespaceResolved:true,keyResolved:true,line:1}]};

test("native planning composes corridor context staging propagation and probes",()=>{
 const corridor=planPatchCorridor("Render Brace prompt, and persist Brace state",model,{minOwnerScore:3});
 assert.equal(corridor.certified,true); assert.ok(corridor.files.some(f=>f.path==="src/ui.ts")); assert.ok(corridor.files.some(f=>f.path==="src/provider.ts"));
 const context=buildContextPack(corridor,model); assert.ok(context.grantedPaths.includes("src/ui.ts")); assert.ok(context.segments.every(s=>s.content.length>0));
 const staging=planPatchStages(corridor,model,1); const provider=staging.stages.find(s=>s.files.includes("src/provider.ts")); const ui=staging.stages.find(s=>s.files.includes("src/ui.ts")); assert.ok(provider&&ui); assert.ok(provider.phase<=ui.phase);
 const propagation=assessPropagation([{path:"src/ui.ts",before:'export function renderBracePrompt(){}',after:'function renderBracePrompt(){}'}],model,corridor); assert.ok(propagation.immediateConsumers.includes("src/app.ts")); assert.equal(propagation.certified,false);
 const probes=planRuntimeProbes(corridor,model); assert.ok(probes.probes.some(p=>p.kind==="hook")); assert.ok(probes.probes.some(p=>p.kind==="state"));
});
