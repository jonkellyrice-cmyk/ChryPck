import assert from "node:assert/strict";
import test from "node:test";
import { NativeOrchestrator } from "../src/core/run/orchestrator.js";
test("native orchestrator begins at READY after policy admission",()=>{const request={schema_version:2,id:"r",planning_goal:"x",scope_lock:{original_user_instruction:"x",authorized_deliverables:["x"],authorized_paths:[],forbidden_expansions:[]},operations:[]};const run=new NativeOrchestrator().admitRequest({repository:"o/r",request,requestPath:"dev_scripts/github-filepatcher.json"});assert.equal(run.state,"READY")});
