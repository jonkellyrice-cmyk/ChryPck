import type { ChangePropagationReport } from "../planning/change-propagation.js";
import type { ContractMap } from "../repository/contract-types.js";
import { validationResult, type ValidationResult } from "./validator.js";

export interface ContractValidationContext {
  readonly contractMap: ContractMap;
  readonly propagation: ChangePropagationReport;
}

export function validateContractImpact(context: ContractValidationContext): ValidationResult {
  const impacted = new Set(context.propagation.impactedContractIds);
  const contracts = context.contractMap.contracts.filter(contract => impacted.has(contract.id));
  const findings = contracts.map(contract => {
    const conflict = contract.reconciliation === "native-conflict";
    return Object.freeze({
      validator: "contract-map-validator",
      code: conflict ? "NATIVE_CONTRACT_CONFLICT" : "CONTRACT_IMPACT_VERIFIED",
      severity: conflict ? "error" as const : "info" as const,
      message: conflict
        ? `Staged change intersects unresolved native contract conflict: ${contract.name}`
        : `Staged change impact includes ${contract.reconciliation} contract: ${contract.name}`,
      path: contract.provider?.file,
      details: Object.freeze({
        contractId: contract.id,
        reconciliation: contract.reconciliation,
        verification: contract.verification,
        nativeContractRefs: contract.nativeContractRefs
      })
    });
  });
  return validationResult(findings);
}
