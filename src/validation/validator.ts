export type ValidationSeverity = "info" | "warning" | "error";

export interface ValidationFinding {
  readonly validator: string;
  readonly code: string;
  readonly severity: ValidationSeverity;
  readonly message: string;
  readonly path?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface ValidationResult {
  readonly passed: boolean;
  readonly findings: readonly ValidationFinding[];
}

export interface Validator<TContext> {
  readonly name: string;
  validate(context: TContext): Promise<ValidationResult> | ValidationResult;
}

export const validationResult = (findings: readonly ValidationFinding[] = []): ValidationResult => Object.freeze({
  passed: !findings.some(finding => finding.severity === "error"),
  findings: Object.freeze([...findings])
});

export function mergeValidationResults(results: readonly ValidationResult[]): ValidationResult {
  return validationResult(results.flatMap(result => result.findings));
}

export async function runValidators<TContext>(context: TContext, validators: readonly Validator<TContext>[]): Promise<ValidationResult> {
  const results: ValidationResult[] = [];
  for (const validator of validators) {
    try {
      results.push(await validator.validate(context));
    } catch (error) {
      results.push(validationResult([{
        validator: validator.name,
        code: "VALIDATOR_EXCEPTION",
        severity: "error",
        message: error instanceof Error ? error.message : String(error)
      }]));
    }
  }
  return mergeValidationResults(results);
}
