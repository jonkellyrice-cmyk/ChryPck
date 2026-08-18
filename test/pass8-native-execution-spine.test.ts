import test from "node:test";
import assert from "node:assert/strict";
import { NativeOrchestrator } from "../src/core/run/orchestrator.js";
import { executeNativeRun } from "../src/core/run/native-execution.js";
import { createStructuralValidator } from "../src/validation/structural-validator.js";
import { buildValidationCommandPlan } from "../src/validation/command-plan.js";
import type { SandboxRunner } from "../src/validation/sandbox-runner.js";

const scopeLock = { schema_version:1, lock_id:"pass8", original_user_instruction:"Change provider", authorized_deliverables:["Change provider"], authorized_paths:["src/provider.ts"], forbidden_expansions:[], allow_capability_construction:false, authorized_capabilities:[] };
const request = { schema_version:2, id:"pass8", planning_goal:"Change provider", scope_lock:scopeLock, operations:[] };
const model = { snapshot:{ repository:"owner/repo", commitSha:"a".repeat(40), createdAt:"2026-01-01T00:00:00Z", files:[{path:"src/provider.ts",sha:"x",size:40,text:"export function provider(){ return 1; }",kind:"source"}] }, fileFacts:[{file:"src/provider.ts",dependencies:[],symbols:[{name:"provider",file:"src/provider.ts",kind:"function",exported:true,line:1}],effects:[],states:[]}], dependencies:[], unresolvedDependencies:[], symbols:[{name:"provider",file:"src/provider.ts",kind:"function",exported:true,line:1}], effects:[], states:[] } as any;
const sandbox:SandboxRunner={async run(command){return{commandId:command.id,exitCode:0,stdout:"ok",stderr:"",timedOut:false,outputTruncated:false}}};
const commandPolicy={allowedExecutables:new Set<string>(),maxCommands:1,maxTimeoutMs:1000,defaultTimeoutMs:1000};
const emptyCommandPlan=()=>buildValidationCommandPlan([],commandPolicy);

test("native spine reaches terminal success without workflow telemetry", async()=>{const o=new NativeOrchestrator(),run=o.admitRequest({repository:"owner/repo",request,requestPath:"request.json"});o.bindRequestCommit(run.runId,"a".repeat(40));const result=await executeNativeRun(o,{runId:run.runId,model,intent:{id:"edit",objective:"Change provider",edits:[{type:"replace_exact",path:"src/provider.ts",search:"return 1",replace:"return 2"}]},structuralValidators:[createStructuralValidator({maxFileBytes:4096})],commandPlan:emptyCommandPlan(),sandboxRunner:sandbox,committer:{async commit(staged){return{commitSha:"b".repeat(40),changedPaths:staged.changedPaths,patchFingerprint:staged.patchFingerprint}}}});assert.equal(result.run.state,"SUCCEEDED");assert.equal(result.run.resultCommitSha,"b".repeat(40));assert.equal(result.run.artifacts.validation?.passed,true);assert.ok(result.run.telemetry.snapshot().every(event=>event.source==="native"));});

test("native spine fails closed on objective mismatch",async()=>{const o=new NativeOrchestrator(),run=o.admitRequest({repository:"owner/repo",request:{...request,id:"mismatch"},requestPath:"request.json"});const result=await executeNativeRun(o,{runId:run.runId,model,intent:{id:"edit",objective:"Broaden objective",edits:[{type:"replace_exact",path:"src/provider.ts",search:"return 1",replace:"return 2"}]},structuralValidators:[],commandPlan:emptyCommandPlan(),sandboxRunner:sandbox,committer:{async commit(){throw new Error("must not commit")}}});assert.equal(result.run.state,"FAILED");assert.equal(result.run.artifacts.failure?.failed_stage,"execution");});
