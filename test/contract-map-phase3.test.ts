import assert from "node:assert/strict";
import test from "node:test";

import { reconcileContractMap } from "../src/analysis/contract-reconciliation.js";
import { assessPropagation } from "../src/planning/change-propagation.js";
import { buildContextPack } from "../src/planning/context-pack.js";
import { planPatchCorridor } from "../src/planning/patch-corridor.js";
import { runNativePlanning } from "../src/planning/planning-runner.js";
import { buildRepositoryModel } from "../src/repository/model-builder.js";
import { createSnapshot } from "../src/repository/snapshot.js";
import { validateContractImpact } from "../src/validation/contract-validator.js";
import { projectContextIndexSegment } from "../src/mcp/response-projection.js";

function model() {
  const provider = "export function persistBrace(value: string): boolean { return Boolean(value); }";
  const consumer = "import { persistBrace } from './provider.js';\nexport function renderBrace(){ return persistBrace('brace'); }";
  return buildRepositoryModel(createSnapshot("owner/repo", "c".repeat(40), [
    { path: "src/provider.ts", sha: "1", size: provider.length, text: provider, kind: "source" },
    { path: "src/ui.ts", sha: "2", size: consumer.length, text: consumer, kind: "source" }
  ]));
}

function nativeCatalog(parameterCount = 1) {
  return Object.freeze([Object.freeze({
    id: "native-catalog",
    source: "native-contract-catalog.json",
    data: { contracts: [{
      id: "native.brace.persist",
      title: "Persist Brace contract",
      contract_kind: "native-entrypoint",
      summary: "persistBrace is the authoritative Brace persistence entrypoint.",
      keywords: ["persistBrace", "brace"],
      boundary: { frame_conn_consumers: ["src/ui.ts"] },
      signature: { parameter_count: parameterCount, return_type: "boolean" },
      evidence: [{ source_path: "native/brace.ts", symbol: "NativeBrace.persistBrace" }]
    }] }
  })]);
}

test("Contract Map evidence strengthens corridor ranking and bounded Context Pack evidence", () => {
  const repository = model();
  const contractMap = reconcileContractMap(repository.contractMap, nativeCatalog());
  const planningModel = Object.freeze({ ...repository, contractMap });
  const corridor = planPatchCorridor("persist Brace", planningModel, { minOwnerScore: 3, contractMap });
  assert.equal(corridor.certified, true);
  assert.ok(corridor.summary.contractCount >= 1);
  assert.ok(corridor.files.some(file => file.contractIds.length === 1 && file.reasons.some(reason => reason.includes("Contract Map native-confirmed"))));
  const context = buildContextPack(corridor, planningModel);
  assert.ok(context.segments.some(segment => segment.contracts.some(contract => contract.id === corridor.files.flatMap(file => file.contractIds)[0])));
  const projected = projectContextIndexSegment(context.segments[0]!) as any;
  assert.ok(projected.contracts.length > 0);
  assert.equal(JSON.stringify(context.segments.flatMap(segment => segment.contracts)).includes("return Boolean"), false);
});

test("affected native conflicts block corridor certification and propagation", () => {
  const repository = model();
  const contractMap = reconcileContractMap(repository.contractMap, nativeCatalog(2));
  const planningModel = Object.freeze({ ...repository, contractMap });
  const corridor = planPatchCorridor("persist Brace", planningModel, { minOwnerScore: 3, contractMap });
  assert.equal(corridor.certified, false);
  assert.ok(corridor.gaps.some(gap => gap.includes("native conflict")));

  const permissiveCorridor = planPatchCorridor("persist Brace", repository, { minOwnerScore: 3 });
  const report = assessPropagation([{ path: "src/provider.ts", before: repository.snapshot.files[0]?.text ?? null, after: "export function persistBrace(): boolean { return true; }" }], planningModel, permissiveCorridor);
  assert.equal(report.certified, false);
  assert.ok(report.nativeConflictIds.length > 0);
  assert.ok(report.contractConsumers.includes("src/ui.ts"));
});

test("Change Propagation and validation retain contract impact evidence", () => {
  const repository = model();
  const planning = runNativePlanning({ objective: "persist Brace", model: repository, extensions: { nativeContractProvider: () => nativeCatalog() } });
  const planningModel = Object.freeze({ ...repository, contractMap: planning.contractMap });
  const report = assessPropagation([{ path: "src/provider.ts", before: repository.snapshot.files[0]?.text ?? null, after: "export function persistBrace(value: string): boolean { return value.length > 0; }" }], planningModel, planning.corridor);
  assert.equal(report.certified, true);
  assert.ok(report.impactedContractIds.length > 0);
  assert.ok(report.verificationTargets.includes("src/ui.ts"));
  const validation = validateContractImpact({ contractMap: planning.contractMap, propagation: report });
  assert.equal(validation.passed, true);
  assert.ok(validation.findings.some(finding => finding.code === "CONTRACT_IMPACT_VERIFIED"));
});
