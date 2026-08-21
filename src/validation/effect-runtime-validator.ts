import type { EffectRuntimeAtlas } from "../analysis/effect-runtime-linker.js";
import type { ChangePropagationReport } from "../planning/change-propagation.js";
import { validationResult, type ValidationFinding, type ValidationResult } from "./validator.js";

export interface EffectRuntimeValidationContext {
  readonly atlas: EffectRuntimeAtlas;
  readonly propagation: ChangePropagationReport;
}

export function validateEffectRuntimeImpact(context: EffectRuntimeValidationContext): ValidationResult {
  const impacted = new Set(context.propagation.impactedRuntimeRegionIds);
  const regions = context.atlas.regions.filter(region => impacted.has(region.id));
  const findings: ValidationFinding[] = [];
  for (const region of regions) {
    if (region.reconciliation === "native-conflict") findings.push(Object.freeze({
      validator: "effect-runtime-atlas-validator",
      code: "RUNTIME_NATIVE_CONFLICT",
      severity: "error" as const,
      message: `Staged change intersects native-conflict runtime region: ${region.id}`,
      path: region.files[0],
      details: Object.freeze({ regionId: region.id, files: region.files, contractIds: region.contractIds })
    }));
    else if (region.reconciliation === "unresolved") findings.push(Object.freeze({
      validator: "effect-runtime-atlas-validator",
      code: "UNRESOLVED_RUNTIME_PATH",
      severity: "error" as const,
      message: `Staged change requires an unresolved runtime path: ${region.id}`,
      path: region.files[0],
      details: Object.freeze({ regionId: region.id, files: region.files })
    }));
    else findings.push(Object.freeze({
      validator: "effect-runtime-atlas-validator",
      code: "RUNTIME_IMPACT_VERIFIED",
      severity: "info" as const,
      message: `Staged change retains ${region.reconciliation} runtime impact evidence: ${region.id}`,
      path: region.files[0],
      details: Object.freeze({ regionId: region.id, effectKinds: region.effectKinds, verificationTargets: context.propagation.verificationTargets.filter(path => region.files.includes(path)) })
    }));
  }
  return validationResult(findings);
}
