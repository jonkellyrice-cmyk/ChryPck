import { validationResult, type ValidationFinding, type Validator } from "./validator.js";

export interface StructuralValidationChange {
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface StructuralValidationContext {
  readonly changes: readonly StructuralValidationChange[];
}

export interface StructuralValidationPolicy {
  readonly maxFileBytes: number;
  readonly rejectConflictMarkers?: boolean;
}

function validPath(value: string): boolean {
  const raw = value.trim().replaceAll("\\", "/");
  return Boolean(raw) && !raw.startsWith("/") && !/^[A-Za-z]:\//.test(raw) && !raw.split("/").includes("..");
}

export function createStructuralValidator(policy: StructuralValidationPolicy): Validator<StructuralValidationContext> {
  return Object.freeze({
    name: "structural-validator",
    validate(context: StructuralValidationContext) {
      const findings: ValidationFinding[] = [];
      const seen = new Set<string>();
      for (const change of context.changes) {
        if (!validPath(change.path)) findings.push({ validator: this.name, code: "INVALID_PATH", severity: "error", message: `Invalid repository path: ${change.path}`, path: change.path });
        if (seen.has(change.path)) findings.push({ validator: this.name, code: "DUPLICATE_CHANGE", severity: "error", message: `Duplicate staged change: ${change.path}`, path: change.path });
        seen.add(change.path);
        if (change.before === change.after) findings.push({ validator: this.name, code: "NOOP_CHANGE", severity: "warning", message: `Staged change is a no-op: ${change.path}`, path: change.path });
        if (change.after === null) continue;
        if (Buffer.byteLength(change.after, "utf8") > policy.maxFileBytes) findings.push({ validator: this.name, code: "FILE_TOO_LARGE", severity: "error", message: `Staged file exceeds maxFileBytes: ${change.path}`, path: change.path });
        if (change.after.includes("\0")) findings.push({ validator: this.name, code: "NULL_BYTE", severity: "error", message: `Staged text contains a null byte: ${change.path}`, path: change.path });
        if (policy.rejectConflictMarkers !== false && /^(?:<<<<<<<|=======|>>>>>>>) /m.test(change.after)) findings.push({ validator: this.name, code: "CONFLICT_MARKER", severity: "error", message: `Merge conflict marker detected: ${change.path}`, path: change.path });
        if (change.path.toLowerCase().endsWith(".json")) {
          try { JSON.parse(change.after); }
          catch (error) { findings.push({ validator: this.name, code: "INVALID_JSON", severity: "error", message: `Invalid JSON in ${change.path}: ${error instanceof Error ? error.message : String(error)}`, path: change.path }); }
        }
      }
      return validationResult(findings);
    }
  });
}
