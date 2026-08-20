import assert from "node:assert/strict";
import test from "node:test";

import { reconcileContractMap } from "../src/analysis/contract-reconciliation.js";
import { contractMapAnalyzer } from "../src/analysis/contract-map.js";
import { projectContractMap } from "../src/mcp/contract-map-projection.js";
import { runNativePlanning } from "../src/planning/planning-runner.js";
import { buildRepositoryModel } from "../src/repository/model-builder.js";
import { createSnapshot } from "../src/repository/snapshot.js";

function repositoryModel() {
  const provider = "export function persistBrace(value: string): boolean { return Boolean(value); }";
  const consumer = "import { persistBrace } from './provider.js';\nexport function useBrace(){ return persistBrace('brace'); }";
  return buildRepositoryModel(createSnapshot("owner/repo", "a".repeat(40), [
    { path: "src/provider.ts", sha: "1", size: provider.length, text: provider, kind: "source" },
    { path: "src/ui.ts", sha: "2", size: consumer.length, text: consumer, kind: "source" }
  ]));
}

function catalog(parameterCount = 1) {
  return Object.freeze([Object.freeze({
    id: "test-native-catalog",
    source: "native-contract-catalog.json",
    data: {
      contracts: [
        {
          id: "native.brace.persist",
          title: "Persist Brace contract",
          contract_kind: "native-entrypoint",
          summary: "persistBrace is the authoritative Brace persistence entrypoint.",
          keywords: ["persistBrace", "brace"],
          boundary: { frame_conn_consumers: ["src/ui.ts"] },
          signature: { parameter_count: parameterCount, return_type: "boolean" },
          evidence: [{ source_path: "native/brace.ts", symbol: "NativeBrace.persistBrace" }]
        },
        {
          id: "native.unmatched.lifecycle",
          title: "Unmatched native lifecycle",
          contract_kind: "native-flow",
          summary: "A native obligation with no repository implementation evidence.",
          keywords: ["unmatched"],
          boundary: { frame_conn_consumers: ["src/missing.ts"] },
          evidence: [{ source_path: "native/missing.ts", symbol: "MissingFlow" }]
        }
      ]
    }
  })]);
}

test("Native Contract reconciliation confirms evidenced contracts and supplements unmatched obligations", () => {
  const model = repositoryModel();
  const reconciled = reconcileContractMap(model.contractMap, catalog());
  const persisted = reconciled.contracts.find(contract => contract.name === "persistBrace");
  assert.ok(persisted);
  assert.equal(persisted.reconciliation, "native-confirmed");
  assert.equal(persisted.verification, "native-authoritative");
  assert.deepEqual(persisted.nativeContractRefs, ["native.brace.persist"]);
  assert.ok(persisted.evidence.some(evidence => evidence.kind === "native-contract"));
  assert.equal(reconciled.coverage.nativeConfirmed, 1);
  assert.equal(reconciled.coverage.nativeSupplemented, 1);
  assert.equal(reconciled.coverage.nativeConflicts, 0);
  assert.ok(reconciled.contracts.some(contract => contract.reconciliation === "native-supplemented" && contract.nativeContractRefs.includes("native.unmatched.lifecycle")));
});

test("Native Contract reconciliation reports only explicit structured signature conflicts", () => {
  const reconciled = reconcileContractMap(repositoryModel().contractMap, catalog(2));
  const persisted = reconciled.contracts.find(contract => contract.name === "persistBrace");
  assert.ok(persisted);
  assert.equal(persisted.reconciliation, "native-conflict");
  assert.ok(persisted.failures.some(failure => failure.kind === "native-conflict" && /requires 2 parameter/.test(failure.summary)));
  assert.equal(reconciled.coverage.nativeConflicts, 1);
  const diagnostics = contractMapAnalyzer.analyze(Object.freeze({ ...repositoryModel(), contractMap: reconciled }));
  assert.ok(diagnostics.findings.some(finding => finding.code === "NATIVE_CONTRACT_CONFLICT" && finding.severity === "error"));
});

test("bounded Contract Map projection ranks objective evidence and reports truncation", () => {
  const source = Array.from({ length: 18 }, (_, index) => `export function contract${index}(value: string): string { return value; }`).join("\n");
  const model = buildRepositoryModel(createSnapshot("owner/repo", "b".repeat(40), [
    { path: "src/contracts.ts", sha: "1", size: source.length, text: source, kind: "source" }
  ]));
  const projected = projectContractMap(model.contractMap, "change contract17", ["src/contracts.ts"]) as any;
  assert.equal(projected.schema_version, 1);
  assert.equal(projected.summary.contract_count, 18);
  assert.equal(projected.summary.returned_contract_count, 12);
  assert.equal(projected.truncated, true);
  assert.equal(projected.contracts[0].name, "contract17");
  assert.equal(JSON.stringify(projected).includes("return value"), false, "Contract Map projection must not expose source bodies");
});

test("native planning retains the reconciled Contract Map without changing corridor authority", () => {
  const model = repositoryModel();
  const result = runNativePlanning({
    objective: "persist Brace",
    model,
    extensions: { nativeContractProvider: () => catalog() }
  });
  assert.equal(result.contractMap.coverage.nativeConfirmed, 1);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.analyzer === "contract-map"));
  assert.equal(result.corridor.diagnostics.includes("contract-map"), true);
});
