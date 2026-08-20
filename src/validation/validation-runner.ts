import { createHash } from "node:crypto";
import type { ValidationCommandPlan, PlannedValidationCommand } from "./command-plan.js";
import type { SandboxCommandResult, SandboxRunner, SandboxWorkspaceFile } from "./sandbox-runner.js";
import { mergeValidationResults, runValidators, validationResult, type ValidationFinding, type ValidationResult, type Validator } from "./validator.js";
import type { StructuralValidationContext } from "./structural-validator.js";
import { validateContractImpact, type ContractValidationContext } from "./contract-validator.js";

export interface ValidationCommandRecord {
  readonly id: string;
  readonly required: boolean;
  readonly passed: boolean;
  readonly result: SandboxCommandResult | null;
}

export interface NativeValidationReport {
  readonly passed: boolean;
  readonly fingerprint: string;
  readonly structural: ValidationResult;
  readonly contract: ValidationResult;
  readonly commands: readonly ValidationCommandRecord[];
  readonly findings: readonly ValidationFinding[];
}

export interface NativeValidationRequest {
  readonly structuralContext: StructuralValidationContext;
  readonly structuralValidators: readonly Validator<StructuralValidationContext>[];
  readonly commandPlan: ValidationCommandPlan;
  readonly workspace: readonly SandboxWorkspaceFile[];
  readonly sandboxRunner: SandboxRunner;
  readonly contractContext?: ContractValidationContext;
}

function commandFinding(command: PlannedValidationCommand, result: SandboxCommandResult): ValidationFinding | null {
  if (!result.timedOut && result.exitCode === 0) return null;
  const severity = command.required ? "error" as const : "warning" as const;
  const code = result.timedOut ? "COMMAND_TIMEOUT" : "COMMAND_FAILED";
  return {
    validator: "sandbox-command-validator",
    code,
    severity,
    message: result.timedOut ? `Validation command timed out: ${command.id}` : `Validation command failed (${result.exitCode ?? "no exit code"}): ${command.id}`,
    details: { commandId: command.id, exitCode: result.exitCode, outputTruncated: result.outputTruncated }
  };
}

function reportFingerprint(structural: ValidationResult, commands: readonly ValidationCommandRecord[], planFingerprint: string): string {
  return createHash("sha256").update(JSON.stringify({ structural, commands, planFingerprint })).digest("hex");
}

export async function runNativeValidation(request: NativeValidationRequest): Promise<NativeValidationReport> {
  const structural = await runValidators(request.structuralContext, request.structuralValidators);
  const contract = request.contractContext ? validateContractImpact(request.contractContext) : validationResult();
  const records: ValidationCommandRecord[] = [];
  const commandFindings: ValidationFinding[] = [];

  if (structural.passed && contract.passed) {
    for (const command of request.commandPlan.commands) {
      try {
        const result = await request.sandboxRunner.run(command, request.workspace);
        const finding = commandFinding(command, result);
        if (finding) commandFindings.push(finding);
        records.push(Object.freeze({ id: command.id, required: command.required, passed: finding === null, result }));
      } catch (error) {
        const finding: ValidationFinding = {
          validator: "sandbox-command-validator",
          code: "SANDBOX_EXECUTION_ERROR",
          severity: command.required ? "error" : "warning",
          message: `Sandbox execution failed for ${command.id}: ${error instanceof Error ? error.message : String(error)}`,
          details: { commandId: command.id }
        };
        commandFindings.push(finding);
        records.push(Object.freeze({ id: command.id, required: command.required, passed: false, result: null }));
      }
    }
  }

  const combined = mergeValidationResults([structural, contract, validationResult(commandFindings)]);
  return Object.freeze({
    passed: combined.passed,
    fingerprint: reportFingerprint(mergeValidationResults([structural, contract]), records, request.commandPlan.fingerprint),
    structural,
    contract,
    commands: Object.freeze(records),
    findings: combined.findings
  });
}
