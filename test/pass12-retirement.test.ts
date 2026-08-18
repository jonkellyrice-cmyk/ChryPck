import assert from "node:assert/strict";
import test from "node:test";
import { assistantCapabilityPolicy } from "../src/core/run/run-state.js";
import { CHRYPCK_TOOL_NAMES } from "../src/mcp/tools.js";
import { buildRepositoryModel } from "../src/repository/model-builder.js";
import { createSnapshot } from "../src/repository/snapshot.js";
import { planDomainDecomposition } from "../src/architecture/domain-decomposer.js";
import { planPathMoves } from "../src/architecture/path-mover.js";

test("model never receives open repository discovery authority",()=>{const idle=assistantCapabilityPolicy("IDLE");assert.equal(idle.direct_source_reconstruction_permitted,false);assert.equal(idle.repository_read_mode,"toolchain_projection_only");assert.deepEqual([...CHRYPCK_TOOL_NAMES],["chrypck_plan","chrypck_context","chrypck_execute","chrypck_result"])});

test("domain decomposer emits compressed review-required proposals",()=>{const text=["export function alphaScore(){return 1;}",...Array(260).fill("// alpha"),"export function alphaRender(){return alphaScore();}",...Array(260).fill("// beta"),"export function betaState(){return 2;}",...Array(260).fill("// beta"),"export function betaWrite(){return betaState();}"].join("\n");const snapshot=createSnapshot("o/r","a".repeat(40),[{path:"src/mixed.ts",sha:"1",size:text.length,text,kind:"source"}],"2026-01-01T00:00:00Z"),model=buildRepositoryModel(snapshot),plan=planDomainDecomposition(model,{paths:["src/mixed.ts"]});assert.equal(plan.approved,false);assert.equal(plan.behaviorChangeAllowed,false);assert.ok(plan.candidates.length>=1);assert.ok(plan.authorizedNewPaths.length>=1);assert.equal(JSON.stringify(plan).includes("alphaScore(){return 1"),false)});

test("path mover derives dependency rewrites without source browsing output",()=>{const a='import { b } from "./b.js";\nexport function a(){return b();}',b='export function b(){return 1;}';const snapshot=createSnapshot("o/r","a".repeat(40),[{path:"src/a.js",sha:"1",size:a.length,text:a,kind:"source"},{path:"src/b.js",sha:"2",size:b.length,text:b,kind:"source"}],"2026-01-01T00:00:00Z"),model=buildRepositoryModel(snapshot),plan=planPathMoves(model,[{from:"src/b.js",to:"src/lib/b.js"}]);assert.deepEqual(plan.gaps,[]);assert.ok(plan.rewrites.some(row=>row.path==="src/a.js"&&row.to.includes("./lib/b.js")));assert.ok(plan.edits.some(edit=>edit.type==="move_file"));assert.equal(plan.approved,false)});
