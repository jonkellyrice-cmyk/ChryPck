import type { RepositoryModel } from "../repository/model.js";
import type { ContractValue } from "../repository/contract-types.js";
import { emptyContractMap } from "../repository/contract-types.js";
import { freezeResult, type Analyzer, type DiagnosticFinding } from "./analyzer.js";

function compactValues(values: readonly ContractValue[]): readonly string[] {
  return Object.freeze(values.map(value => `${value.name}${value.optional ? "?" : ""}${value.type ? `:${value.type}` : ""}`));
}

export const contractMapAnalyzer: Analyzer<DiagnosticFinding> = {
  name: "contract-map",
  analyze(model: RepositoryModel) {
    const map = model.contractMap ?? emptyContractMap();
    const findings: DiagnosticFinding[] = map.contracts.map(contract => ({
      code: contract.reconciliation === "native-conflict"
        ? "NATIVE_CONTRACT_CONFLICT"
        : contract.reconciliation === "native-supplemented"
          ? "NATIVE_CONTRACT_SUPPLEMENT"
          : contract.provider ? "CONTRACT_SURFACE" : "UNRESOLVED_CONTRACT_PROVIDER",
      severity: contract.reconciliation === "native-conflict"
        ? "error" as const
        : contract.reconciliation === "native-supplemented" || contract.provider
          ? "info" as const
          : "warning" as const,
      summary: `${contract.kind} contract '${contract.name}' has ${contract.consumers.length} consumer(s).`,
      evidence: {
        contract_id: contract.id,
        kind: contract.kind,
        provider: contract.provider,
        consumers: contract.consumers,
        inputs: compactValues(contract.inputs),
        outputs: compactValues(contract.outputs),
        confidence: contract.confidence,
        verification: contract.verification,
        reconciliation: contract.reconciliation,
        native_contract_refs: contract.nativeContractRefs
      }
    }));
    for (const gap of map.gaps) findings.push({
      code: "CONTRACT_PARSE_GAP",
      severity: "warning",
      summary: gap.summary,
      evidence: { file: gap.file, line: gap.line }
    });
    return freezeResult(this.name, {
      contracts: map.contracts.length,
      resolved: map.coverage.resolvedContracts,
      unresolved: map.coverage.unresolvedSites,
      ambiguous: map.coverage.ambiguousSites,
      external: map.coverage.externalSites,
      native_confirmed: map.coverage.nativeConfirmed,
      native_supplemented: map.coverage.nativeSupplemented,
      native_conflicts: map.coverage.nativeConflicts
    }, findings);
  }
};
