from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()

def put(rel, text):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text.strip() + '\n', encoding='utf-8')
    print('[scaffold]', rel)

put('src/core/policy/errors.ts', '''
export type PolicyErrorCode = "SCOPE_VIOLATION" | "ABSTRACTION_VIOLATION" | "ABSTRACTION_GAP" | "INVALID_RUN_TRANSITION";
export class PolicyError extends Error {
  constructor(public readonly code: PolicyErrorCode, message: string, public readonly details: Readonly<Record<string, unknown>> = {}) { super(message); this.name = "PolicyError"; }
}
''')
put('src/core/policy/scope-lock.ts', '''
import { PolicyError } from "./errors.js";
export interface ScopeLock { readonly lockId:string; readonly originalUserInstruction:string; readonly authorizedDeliverables:readonly string[]; readonly authorizedPaths:readonly string[]; readonly forbiddenExpansions:readonly string[]; readonly allowCapabilityConstruction:boolean; readonly authorizedCapabilities:readonly string[]; }
export function createScopeLock(input: Omit<ScopeLock,"authorizedPaths"|"forbiddenExpansions"|"allowCapabilityConstruction"|"authorizedCapabilities"> & Partial<Pick<ScopeLock,"authorizedPaths"|"forbiddenExpansions"|"allowCapabilityConstruction"|"authorizedCapabilities">>): ScopeLock {
  if (!input.lockId.trim() || !input.originalUserInstruction.trim() || !input.authorizedDeliverables.length) throw new PolicyError("SCOPE_VIOLATION","Invalid Scope Lock.");
  return Object.freeze({...input, authorizedPaths:Object.freeze([...(input.authorizedPaths ?? [])]), forbiddenExpansions:Object.freeze([...(input.forbiddenExpansions ?? [])]), allowCapabilityConstruction:input.allowCapabilityConstruction ?? false, authorizedCapabilities:Object.freeze([...(input.authorizedCapabilities ?? [])])});
}
export function assertPathInScope(lock:ScopeLock,path:string):void { if(lock.authorizedPaths.length && !lock.authorizedPaths.some(p=>path===p||path.startsWith(p.endsWith("/")?p:p+"/"))) throw new PolicyError("SCOPE_VIOLATION","Path is outside the active Scope Lock.",{path,lockId:lock.lockId}); }
''')
put('src/core/policy/abstraction-lock.ts', '''
import { PolicyError } from "./errors.js";
export const TOOLCHAIN_SURFACES=["symbol-families","dependency-graph","dependency-watershed","integration-surface-atlas","runtime-signal-map","effect-atlas","state-namespace-atlas","native-contract-catalog","patch-corridor","corridor-context","patch-staging","change-propagation","filepatcher","canonical-validation"] as const;
export type ToolchainSurface=typeof TOOLCHAIN_SURFACES[number];
export interface SourceAccessGrant { readonly repository:string; readonly commitSha:string; readonly paths:readonly string[]; readonly evidence:string; readonly expiresAt:number; }
export interface AbstractionLock { readonly allowedSurfaces:ReadonlySet<ToolchainSurface>; readonly directSourceAccessRequiresGrant:boolean; }
export const createDefaultAbstractionLock=():AbstractionLock=>Object.freeze({allowedSurfaces:new Set(TOOLCHAIN_SURFACES),directSourceAccessRequiresGrant:true});
export function assertSurfaceAllowed(lock:AbstractionLock,surface:ToolchainSurface):void { if(!lock.allowedSurfaces.has(surface)) throw new PolicyError("ABSTRACTION_VIOLATION","Surface is below the active abstraction wall.",{surface}); }
export function assertSourceGrant(grant:SourceAccessGrant|null,repository:string,commitSha:string,path:string):void { if(!grant) throw new PolicyError("ABSTRACTION_GAP","No source grant is active.",{path}); if(grant.repository!==repository||grant.commitSha!==commitSha||grant.expiresAt<=Date.now()||!grant.paths.includes(path)) throw new PolicyError("ABSTRACTION_VIOLATION","Source path is not authorized by the active grant.",{path}); }
''')
put('src/core/policy/authorization.ts', '''
import type { ScopeLock } from "./scope-lock.js"; import { assertPathInScope } from "./scope-lock.js";
import type { AbstractionLock, SourceAccessGrant, ToolchainSurface } from "./abstraction-lock.js"; import { assertSourceGrant, assertSurfaceAllowed } from "./abstraction-lock.js";
export interface AuthorizationContext { repository:string; commitSha:string; scopeLock:ScopeLock; abstractionLock:AbstractionLock; sourceGrant:SourceAccessGrant|null; }
export const authorizeSurface=(c:AuthorizationContext,s:ToolchainSurface)=>assertSurfaceAllowed(c.abstractionLock,s);
export function authorizeSourceRead(c:AuthorizationContext,path:string):void { assertPathInScope(c.scopeLock,path); if(c.abstractionLock.directSourceAccessRequiresGrant) assertSourceGrant(c.sourceGrant,c.repository,c.commitSha,path); }
export function authorizeMutation(c:AuthorizationContext,path:string):void { assertPathInScope(c.scopeLock,path); assertSurfaceAllowed(c.abstractionLock,"filepatcher"); }
''')
put('src/core/run/run-state.ts', '''
import { PolicyError } from "../policy/errors.js";
export const RUN_STATES=["CREATED","SCOPE_LOCKED","SNAPSHOTTED","DIAGNOSED","CORRIDOR_CERTIFIED","CONTEXT_READY","PATCH_STAGED","PROPAGATION_CERTIFIED","VALIDATING","COMMITTED","SUCCEEDED","FAILED","CANCELLED"] as const;
export type RunState=typeof RUN_STATES[number];
const order=RUN_STATES.slice(0,11); export const isTerminal=(s:RunState)=>s==="SUCCEEDED"||s==="FAILED"||s==="CANCELLED";
export function assertTransition(from:RunState,to:RunState):void { const ok=to==="FAILED"||to==="CANCELLED"||(order.indexOf(to)===order.indexOf(from)+1); if(isTerminal(from)||!ok) throw new PolicyError("INVALID_RUN_TRANSITION",`Invalid run transition ${from} -> ${to}.`,{from,to}); }
''')
put('src/core/run/request-envelope.ts', '''
import type { ScopeLock } from "../policy/scope-lock.js";
export interface RequestEnvelope { readonly runId:string; readonly repository:string; readonly objective:string; readonly baseRef:string; readonly scopeLock:ScopeLock; readonly createdAt:string; }
export const createRequestEnvelope=(input:Omit<RequestEnvelope,"createdAt">):RequestEnvelope=>Object.freeze({...input,createdAt:new Date().toISOString()});
''')
put('src/core/run/telemetry.ts', '''
import type { RunState } from "./run-state.js";
export interface RunEvent { runId:string; sequence:number; at:string; state:RunState; event:string; data?:Readonly<Record<string,unknown>>; }
export class RunTelemetry { #events:RunEvent[]=[]; constructor(readonly runId:string){} record(state:RunState,event:string,data?:Readonly<Record<string,unknown>>){const e=Object.freeze({runId:this.runId,sequence:this.#events.length+1,at:new Date().toISOString(),state,event,...(data?{data}:{})});this.#events.push(e);return e;} snapshot(){return Object.freeze([...this.#events]);} }
''')
put('src/core/run/orchestrator.ts', '''
import type { ScopeLock } from "../policy/scope-lock.js"; import type { AbstractionLock } from "../policy/abstraction-lock.js"; import { assertTransition,isTerminal,type RunState } from "./run-state.js"; import { RunTelemetry } from "./telemetry.js";
export interface ToolchainRun { runId:string; repository:string; objective:string; scopeLock:ScopeLock; abstractionLock:AbstractionLock; state:RunState; telemetry:RunTelemetry; }
export class RunController { constructor(readonly run:ToolchainRun){} transition(next:RunState,event=next){if(isTerminal(this.run.state))throw new Error(`Run ${this.run.runId} is terminal.`);assertTransition(this.run.state,next);this.run.state=next;this.run.telemetry.record(next,event);return this.run;} }
''')
put('src/repository/snapshot.ts', '''
export interface RepositoryFile { readonly path:string; readonly sha:string; readonly size:number; readonly text?:string; }
export interface RepositorySnapshot { readonly repository:string; readonly commitSha:string; readonly files:readonly RepositoryFile[]; readonly createdAt:string; }
export const createSnapshot=(repository:string,commitSha:string,files:readonly RepositoryFile[]):RepositorySnapshot=>Object.freeze({repository,commitSha,files:Object.freeze([...files].sort((a,b)=>a.path.localeCompare(b.path))),createdAt:new Date().toISOString()});
''')
put('src/repository/model.ts', '''
import type { RepositorySnapshot } from "./snapshot.js";
export interface DependencyEdge {from:string;to:string;kind:string} export interface SymbolRecord{name:string;file:string;kind:string;exported:boolean} export interface EffectRecord{file:string;kind:string;detail:string} export interface StateRecord{namespace:string;file:string;kind:string}
export interface RepositoryModel {snapshot:RepositorySnapshot;dependencies:readonly DependencyEdge[];symbols:readonly SymbolRecord[];effects:readonly EffectRecord[];states:readonly StateRecord[]}
export const emptyModel=(snapshot:RepositorySnapshot):RepositoryModel=>({snapshot,dependencies:[],symbols:[],effects:[],states:[]});
''')
put('src/repository/index.ts', '''
import type { RepositoryModel } from "./model.js";
export interface RepositoryIndex { files:ReadonlyMap<string,number>; symbols:ReadonlyMap<string,readonly number[]>; }
export function buildIndex(model:RepositoryModel):RepositoryIndex {const files=new Map(model.snapshot.files.map((f,i)=>[f.path,i] as const));const symbols=new Map<string,number[]>();model.symbols.forEach((s,i)=>{const a=symbols.get(s.name)??[];a.push(i);symbols.set(s.name,a)});return {files,symbols};}
''')
put('src/analysis/analyzer.ts', '''
import type { RepositoryModel } from "../repository/model.js";
export interface AnalysisResult<T=unknown>{readonly analyzer:string;readonly findings:readonly T[]} export interface Analyzer<T=unknown>{readonly name:string;analyze(model:RepositoryModel):Promise<AnalysisResult<T>>|AnalysisResult<T>}
''')

for file_name, name, source in [
('dependency-graph.ts','dependency-graph','model.dependencies'),('effect-atlas.ts','effect-atlas','model.effects'),('state-namespaces.ts','state-namespaces','model.states')]:
    put('src/analysis/'+file_name, f'''import type {{ RepositoryModel }} from "../repository/model.js"; import type {{ AnalysisResult, Analyzer }} from "./analyzer.js";\nexport const {name.replace('-','_')}Analyzer:Analyzer={{name:"{name}",analyze(model:RepositoryModel):AnalysisResult{{return {{analyzer:"{name}",findings:{source}}};}}}};''')
put('src/analysis/symbol-families.ts','''import type { RepositoryModel } from "../repository/model.js"; import type { Analyzer } from "./analyzer.js"; export const symbolFamiliesAnalyzer:Analyzer={name:"symbol-families",analyze(model:RepositoryModel){const m=new Map<string,Set<string>>();for(const s of model.symbols){const x=m.get(s.name)??new Set<string>();x.add(s.file);m.set(s.name,x)}return{analyzer:"symbol-families",findings:[...m].map(([name,files])=>({name,files:[...files]}))};}};''')
put('src/analysis/integration-surfaces.ts','''import type { RepositoryModel } from "../repository/model.js"; import type { Analyzer } from "./analyzer.js"; export const integrationSurfacesAnalyzer:Analyzer={name:"integration-surfaces",analyze(model:RepositoryModel){const c=new Map<string,number>();for(const e of model.dependencies){c.set(e.from,(c.get(e.from)??0)+1);c.set(e.to,(c.get(e.to)??0)+1)}return{analyzer:"integration-surfaces",findings:[...c].map(([file,degree])=>({file,degree})).sort((a,b)=>b.degree-a.degree)};}};''')
put('src/analysis/runtime-signals.ts','''import type { Analyzer } from "./analyzer.js"; export const runtimeSignalsAnalyzer:Analyzer={name:"runtime-signals",analyze(){return{analyzer:"runtime-signals",findings:[]};}};''')

put('src/planning/patch-corridor.ts','''import type { RepositoryModel } from "../repository/model.js"; export interface CorridorFile{path:string;reasons:readonly string[];confidence:number} export interface PatchCorridor{objective:string;certified:boolean;files:readonly CorridorFile[];gaps:readonly string[]} export const uncertifiedCorridor=(objective:string,_model:RepositoryModel):PatchCorridor=>({objective,certified:false,files:[],gaps:["Legacy Patch Corridor algorithm not yet ported."]});''')
put('src/planning/context-pack.ts','''import type { RepositoryModel } from "../repository/model.js"; import type { PatchCorridor } from "./patch-corridor.js"; export interface ContextSegment{id:string;path:string;content:string;evidence:readonly string[]} export function buildContextPack(c:PatchCorridor,m:RepositoryModel){const p=new Set(c.files.map(f=>f.path));return{objective:c.objective,segments:m.snapshot.files.filter(f=>p.has(f.path)&&f.text!==undefined).map(f=>({id:`file:${f.path}`,path:f.path,content:f.text??"",evidence:["patch-corridor"]}))};}''')
put('src/planning/patch-staging.ts','''import type { PatchCorridor } from "./patch-corridor.js"; export interface PatchStage{id:string;files:readonly string[];dependsOn:readonly string[]} export const singleStage=(c:PatchCorridor):readonly PatchStage[]=>[{id:"stage-1",files:c.files.map(f=>f.path),dependsOn:[]}];''')
put('src/planning/change-propagation.ts','''import type { RepositoryModel } from "../repository/model.js"; export interface ProposedChange{path:string;before:string|null;after:string|null} export function assessPropagation(changes:readonly ProposedChange[],model:RepositoryModel){const changed=new Set(changes.map(c=>c.path));const consumers=[...new Set(model.dependencies.filter(e=>changed.has(e.to)).map(e=>e.from))];return{safeStandalone:consumers.length===0,immediateConsumers:consumers,verificationTargets:[...new Set([...changed,...consumers])]};}''')

put('src/mutation/patch-dsl.ts','''export type PatchOperation={type:"create_file";path:string;content:string}|{type:"replace_file";path:string;content:string;expectedSha256?:string}|{type:"replace_exact";path:string;search:string;replace:string;expectedOccurrences?:number;expectedSha256?:string}; export interface PatchSpec{id:string;objective:string;operations:readonly PatchOperation[]}''')
put('src/mutation/authoring-compiler.ts','''import type { PatchSpec } from "./patch-dsl.js"; export interface AuthoringIntent{id:string;objective:string;instructions:readonly string[]} export interface AuthoringCompiler{compile(intent:AuthoringIntent):Promise<PatchSpec>|PatchSpec} export class PendingAuthoringCompiler implements AuthoringCompiler{compile(i:AuthoringIntent):PatchSpec{throw new Error(`Authoring compiler not yet ported: ${i.id}`)}}''')
put('src/mutation/file-patcher.ts','''import type { PatchSpec } from "./patch-dsl.js"; export interface StagedPatch{patchId:string;files:ReadonlyMap<string,string|null>;changedPaths:readonly string[]} export function stagePatch(spec:PatchSpec,current:ReadonlyMap<string,string|null>):StagedPatch{const files=new Map(current),changed=new Set<string>();for(const op of spec.operations){const old=files.get(op.path)??null;let next:string;if(op.type==="create_file"){if(old!==null)throw new Error(`Target exists: ${op.path}`);next=op.content}else if(op.type==="replace_file"){if(old===null)throw new Error(`Target missing: ${op.path}`);next=op.content}else{if(old===null)throw new Error(`Target missing: ${op.path}`);const count=old.split(op.search).length-1,expected=op.expectedOccurrences??1;if(count!==expected)throw new Error(`Expected ${expected} occurrence(s), found ${count}: ${op.path}`);next=old.split(op.search).join(op.replace)}files.set(op.path,next);if(next!==old)changed.add(op.path)}return{patchId:spec.id,files,changedPaths:[...changed].sort()};}''')
put('src/mutation/transaction.ts','''import type { StagedPatch } from "./file-patcher.js"; export interface CommitReceipt{commitSha:string;changedPaths:readonly string[]} export interface MutationTransaction{validate(staged:StagedPatch):Promise<void>;commit(staged:StagedPatch):Promise<CommitReceipt>}''')
put('src/validation/validator.ts','''export interface ValidationFinding{validator:string;severity:"info"|"warning"|"error";message:string;path?:string} export interface ValidationResult{passed:boolean;findings:readonly ValidationFinding[]} export interface Validator<T>{name:string;validate(value:T):Promise<ValidationResult>|ValidationResult} export async function runValidators<T>(v:T,vs:readonly Validator<T>[]):Promise<ValidationResult>{const findings:ValidationFinding[]=[];for(const x of vs)findings.push(...(await x.validate(v)).findings);return{passed:!findings.some(f=>f.severity==="error"),findings};}''')
put('src/validation/sandbox-runner.ts','''export interface SandboxCommand{command:string;args:readonly string[];timeoutMs:number} export interface SandboxResult{exitCode:number|null;stdout:string;stderr:string;timedOut:boolean} export interface SandboxRunner{run(command:SandboxCommand):Promise<SandboxResult>} export class DisabledSandboxRunner implements SandboxRunner{async run(_c:SandboxCommand):Promise<SandboxResult>{throw new Error("Sandbox execution is disabled until an isolated runner is configured.")}}''')
put('src/adapters/github/client.ts','''export interface GitHubTransportClient{resolveCommit(repository:string,ref:string):Promise<string>;listFiles(repository:string,sha:string):Promise<readonly {path:string;sha:string;size:number}[]>;readTextFile(repository:string,path:string,sha:string):Promise<{path:string;sha:string;size:number;text:string}|null>;commitFiles(repository:string,baseSha:string,message:string,changes:ReadonlyMap<string,string|null>):Promise<{sha:string}>}''')
put('src/adapters/github/repository-adapter.ts','''import type { GitHubTransportClient } from "./client.js"; import { createSnapshot } from "../../repository/snapshot.js"; export class GitHubRepositoryAdapter{constructor(private readonly client:GitHubTransportClient){}async snapshot(repository:string,ref="HEAD"){const sha=await this.client.resolveCommit(repository,ref),files=await this.client.listFiles(repository,sha);return createSnapshot(repository,sha,files)}}''')
put('src/mcp/schemas.ts','''export interface PlanInput{repository:string;objective:string;base_ref?:string} export interface ContextInput{run_id:string;segment_id?:string} export interface ExecuteInput{run_id:string;authoring_intent:{id:string;objective:string;instructions:readonly string[]}} export interface ResultInput{run_id:string}''')
put('src/mcp/tools.ts','''export const CHRYPCK_TOOL_NAMES=["chrypck_plan","chrypck_context","chrypck_execute","chrypck_result"] as const; export type ChryPckToolName=typeof CHRYPCK_TOOL_NAMES[number]; export const CHRYPCK_TOOLS=Object.freeze([{name:"chrypck_plan",readOnly:true},{name:"chrypck_context",readOnly:true},{name:"chrypck_execute",readOnly:false},{name:"chrypck_result",readOnly:true}] as const);''')
put('src/index.ts','''export * from "./core/policy/errors.js";export * from "./core/policy/scope-lock.js";export * from "./core/policy/abstraction-lock.js";export * from "./core/policy/authorization.js";export * from "./core/run/run-state.js";export * from "./core/run/request-envelope.js";export * from "./core/run/telemetry.js";export * from "./core/run/orchestrator.js";export * from "./repository/snapshot.js";export * from "./repository/model.js";export * from "./repository/index.js";export * from "./mutation/patch-dsl.js";export * from "./mutation/file-patcher.js";export * from "./validation/validator.js";export * from "./mcp/tools.js";export * from "./mcp/schemas.js";''')
put('test/native-scaffold.test.ts','''import assert from "node:assert/strict";import test from "node:test";import {createScopeLock} from "../src/core/policy/scope-lock.js";import {createDefaultAbstractionLock} from "../src/core/policy/abstraction-lock.js";import {RunController} from "../src/core/run/orchestrator.js";import {RunTelemetry} from "../src/core/run/telemetry.js";import {stagePatch} from "../src/mutation/file-patcher.js";test("state transition",()=>{const run={runId:"r",repository:"o/r",objective:"x",scopeLock:createScopeLock({lockId:"l",originalUserInstruction:"x",authorizedDeliverables:["x"]}),abstractionLock:createDefaultAbstractionLock(),state:"CREATED" as const,telemetry:new RunTelemetry("r")};new RunController(run).transition("SCOPE_LOCKED");assert.equal(run.state,"SCOPE_LOCKED")});test("patch staging",()=>{const out=stagePatch({id:"p",objective:"x",operations:[{type:"replace_exact",path:"a",search:"x",replace:"y"}]},new Map([["a","x"]]));assert.equal(out.files.get("a"),"y")});''')
