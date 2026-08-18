export type PolicyErrorCode = "SCOPE_VIOLATION" | "ABSTRACTION_VIOLATION" | "ABSTRACTION_GAP" | "INVALID_RUN_TRANSITION";
export class PolicyError extends Error {
  constructor(public readonly code: PolicyErrorCode, message: string, public readonly details: Readonly<Record<string, unknown>> = {}) { super(message); this.name = "PolicyError"; }
}
