import test from "node:test";
import assert from "node:assert/strict";
import { GitHubRepositoryAdapter } from "../src/adapters/github/repository-adapter.js";
import type { GitHubTransportClient } from "../src/adapters/github/client.js";

function fakeTransport(): GitHubTransportClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async resolveCommit(_repository, ref) { calls.push(`resolve:${ref}`); return "a".repeat(40); },
    async listFiles() { calls.push("list"); return [{ path:"src/a.ts", sha:"blob-a", size:20 }, { path:"image.png", sha:"blob-b", size:9 }]; },
    async readTextFile(_repository, path) { calls.push(`read:${path}`); return { path, sha:"blob-a", size:20, text:"export const a = 1;" }; },
    async readTextFiles(_repository, entries) {
      calls.push(`archive:${entries.map(entry => entry.path).join(",")}`);
      return new Map(entries.map(entry => [entry.path, { ...entry, text:"export const a = 1;" }]));
    },
    async commitFiles(_repository, baseSha, targetRef, _message, changes) { calls.push(`commit:${targetRef}:${baseSha}:${[...changes.keys()].join(",")}`); return { sha:"b".repeat(40) }; }
  };
}

test("GitHub adapter hydrates one immutable archive and reuses its snapshot", async()=>{const transport=fakeTransport(),adapter=new GitHubRepositoryAdapter(transport);const snapshot=await adapter.snapshot("owner/repo","main");const cached=await adapter.snapshot("owner/repo","main");assert.equal(snapshot.commitSha,"a".repeat(40));assert.equal(cached, snapshot);assert.equal(snapshot.files.find(file=>file.path==="src/a.ts")?.text,"export const a = 1;");assert.equal(snapshot.files.find(file=>file.path==="image.png")?.text,undefined);assert.deepEqual(transport.calls,["resolve:main","list","archive:src/a.ts","resolve:main"]);});

test("GitHub adapter publishes atomically from the exact base commit",async()=>{const transport=fakeTransport(),adapter=new GitHubRepositoryAdapter(transport);const result=await adapter.publish({repository:"owner/repo",targetRef:"main",baseCommitSha:"a".repeat(40),message:"change",changes:new Map([["src/a.ts","export const a = 2;"]])});assert.equal(result.commitSha,"b".repeat(40));assert.deepEqual(result.changedPaths,["src/a.ts"]);assert.deepEqual(transport.calls,["resolve:main",`commit:main:${"a".repeat(40)}:src/a.ts`]);});

test("GitHub adapter fails closed before publish when base ref is stale",async()=>{const transport=fakeTransport();transport.resolveCommit=async()=>"c".repeat(40);const adapter=new GitHubRepositoryAdapter(transport);await assert.rejects(()=>adapter.publish({repository:"owner/repo",targetRef:"main",baseCommitSha:"a".repeat(40),message:"change",changes:new Map([["src/a.ts","x"]])}),/base is stale/);assert.equal(transport.calls.some(call=>call.startsWith("commit:")),false);});
