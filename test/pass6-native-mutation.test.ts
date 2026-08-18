import assert from "node:assert/strict";
import test from "node:test";
import { compileAuthoringIntent } from "../src/mutation/authoring-compiler.js";
import { prepareNativeMutation } from "../src/mutation/mutation-runner.js";
import { commitMutationTransaction, validateMutationTransaction } from "../src/mutation/transaction.js";

const corridor:any={objective:"change alpha",certified:true,files:[{path:"src/a.ts"},{path:"src/b.ts"}],corridor:[],clauses:[],gaps:[],diagnostics:[],summary:{clauseCount:1,coveredCount:1,fileCount:2,confidence:"high"}};
const context:any={objective:"change alpha",certified:true,commitSha:"base-sha",segments:[{id:"file:src/a.ts",path:"src/a.ts",content:"alpha\nneedle\n",evidence:[],symbols:[],dependencies:[],consumers:[]},{id:"file:src/b.ts",path:"src/b.ts",content:"beta\n",evidence:[],symbols:[],dependencies:[],consumers:[]}],omissions:[],grantedPaths:["src/a.ts","src/b.ts"]};
const authority={corridor,context,allowedNewPaths:["src/c.ts","src/moved.ts"],maxFilesChanged:4};

test("authoring compiler emits guarded deterministic patch",()=>{const spec=compileAuthoringIntent({id:"p",objective:"change alpha",edits:[{type:"replace_exact",path:"src/a.ts",search:"needle",replace:"changed"},{type:"create_file",path:"src/c.ts",content:"new\n"}]},authority);assert.equal(spec.baseCommitSha,"base-sha");assert.equal(spec.operations.length,2);assert.match((spec.operations[0] as any).expectedSha256,/^[a-f0-9]{64}$/);assert.match(spec.fingerprint,/^[a-f0-9]{64}$/);});

test("native patch staging is atomic and supports exact edits",()=>{const base=new Map([["src/a.ts","alpha\nneedle\n"],["src/b.ts","beta\n"]]);const prepared=prepareNativeMutation({id:"p",objective:"change alpha",edits:[{type:"insert_before_exact",path:"src/a.ts",anchor:"needle",content:"before\n"},{type:"insert_after_exact",path:"src/a.ts",anchor:"needle",content:"\nafter"},{type:"delete_exact",path:"src/b.ts",search:"beta",expectedOccurrences:1},{type:"create_file",path:"src/c.ts",content:"new\n"}]},authority,base,{maxFilesChanged:3});assert.equal(prepared.transaction.state,"STAGED");assert.equal(prepared.transaction.staged.files.get("src/a.ts"),"alpha\nbefore\nneedle\nafter\n");assert.equal(prepared.transaction.staged.files.get("src/b.ts"),"\n");assert.deepEqual(prepared.transaction.staged.changedPaths,["src/a.ts","src/b.ts","src/c.ts"]);});

test("staging refuses stale guards without mutating base",()=>{const base=new Map([["src/a.ts","stale\n"],["src/b.ts","beta\n"]]);assert.throws(()=>prepareNativeMutation({id:"p",objective:"change alpha",edits:[{type:"replace_file",path:"src/a.ts",content:"x"}]},authority,base),/SHA-256 precondition failed/);assert.equal(base.get("src/a.ts"),"stale\n");});

test("validation gates commit and receipt fingerprint",async()=>{const base=new Map([["src/a.ts","alpha\nneedle\n"],["src/b.ts","beta\n"]]);let tx=prepareNativeMutation({id:"p",objective:"change alpha",edits:[{type:"replace_exact",path:"src/a.ts",search:"needle",replace:"changed"}]},authority,base).transaction;tx=await validateMutationTransaction(tx,[{name:"ok",validate:()=>({validator:"ok",passed:true,summary:"pass"})}]);assert.equal(tx.state,"VALIDATED");tx=await commitMutationTransaction(tx,{commit:async staged=>({commitSha:"commit",changedPaths:staged.changedPaths,patchFingerprint:staged.patchFingerprint})});assert.equal(tx.state,"COMMITTED");});

test("compiler refuses ungranted and unauthorized new paths",()=>{assert.throws(()=>compileAuthoringIntent({id:"x",objective:"bad",edits:[{type:"replace_file",path:"src/nope.ts",content:"x"}]},authority),/not granted/);assert.throws(()=>compileAuthoringIntent({id:"x",objective:"bad",edits:[{type:"create_file",path:"src/nope.ts",content:"x"}]},authority),/not explicitly authorized/);});
