import { createHash } from "node:crypto";

export const PATCH_DSL_SCHEMA_VERSION = 1;

export type PatchOperation =
  | { readonly type: "create_file"; readonly path: string; readonly content: string }
  | { readonly type: "replace_file"; readonly path: string; readonly content: string; readonly expectedSha256?: string }
  | { readonly type: "replace_exact"; readonly path: string; readonly search: string; readonly replace: string; readonly expectedOccurrences?: number; readonly expectedSha256?: string }
  | { readonly type: "insert_before_exact"; readonly path: string; readonly anchor: string; readonly content: string; readonly expectedOccurrences?: number; readonly expectedSha256?: string }
  | { readonly type: "insert_after_exact"; readonly path: string; readonly anchor: string; readonly content: string; readonly expectedOccurrences?: number; readonly expectedSha256?: string }
  | { readonly type: "delete_exact"; readonly path: string; readonly search: string; readonly expectedOccurrences?: number; readonly expectedSha256?: string }
  | { readonly type: "remove_file"; readonly path: string; readonly expectedSha256?: string }
  | { readonly type: "move_file"; readonly from: string; readonly to: string; readonly expectedSha256?: string };

export interface PatchSpec {
  readonly schemaVersion: typeof PATCH_DSL_SCHEMA_VERSION;
  readonly id: string;
  readonly objective: string;
  readonly baseCommitSha: string;
  readonly allowedPaths: readonly string[];
  readonly operations: readonly PatchOperation[];
  readonly fingerprint: string;
}

export interface PatchSpecInput {
  readonly id: string;
  readonly objective: string;
  readonly baseCommitSha: string;
  readonly allowedPaths: readonly string[];
  readonly operations: readonly PatchOperation[];
}

export function normalizePatchPath(value: string): string {
  const raw = String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!raw || raw.startsWith("/")) return "";
  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return "";
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, stable(record[key])]));
  }
  return value;
}

function operationPaths(operation: PatchOperation): readonly string[] {
  return operation.type === "move_file" ? [operation.from, operation.to] : [operation.path];
}

function validateOccurrenceGuard(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
    throw new TypeError(`${label} must be a positive integer when supplied.`);
  }
}

export function normalizePatchOperation(operation: PatchOperation): PatchOperation {
  if (operation.type === "move_file") {
    const from = normalizePatchPath(operation.from), to = normalizePatchPath(operation.to);
    if (!from || !to || from === to) throw new TypeError("move_file requires distinct valid repository paths.");
    return Object.freeze({ ...operation, from, to });
  }
  const path = normalizePatchPath(operation.path);
  if (!path) throw new TypeError(`${operation.type} requires a valid repository path.`);
  if (operation.type === "replace_exact" || operation.type === "delete_exact") {
    if (!operation.search) throw new TypeError(`${operation.type} requires non-empty search text.`);
    validateOccurrenceGuard(operation.expectedOccurrences, `${operation.type}.expectedOccurrences`);
  }
  if (operation.type === "insert_before_exact" || operation.type === "insert_after_exact") {
    if (!operation.anchor) throw new TypeError(`${operation.type} requires a non-empty anchor.`);
    validateOccurrenceGuard(operation.expectedOccurrences, `${operation.type}.expectedOccurrences`);
  }
  return Object.freeze({ ...operation, path });
}

export function createPatchSpec(input: PatchSpecInput): PatchSpec {
  const id = input.id.trim(), objective = input.objective.trim(), baseCommitSha = input.baseCommitSha.trim();
  if (!id || !objective || !baseCommitSha) throw new TypeError("Patch spec requires id, objective, and baseCommitSha.");
  const operations = Object.freeze(input.operations.map(normalizePatchOperation));
  const allowedPaths = Object.freeze([...new Set(input.allowedPaths.map(normalizePatchPath).filter(Boolean))].sort());
  const allowed = new Set(allowedPaths);
  for (const operation of operations) {
    for (const path of operationPaths(operation)) {
      if (!allowed.has(path)) throw new TypeError(`Patch operation path is outside allowedPaths: ${path}`);
    }
  }
  const projection: Omit<PatchSpec, "fingerprint"> = { schemaVersion: PATCH_DSL_SCHEMA_VERSION, id, objective, baseCommitSha, allowedPaths, operations };
  const serialized = JSON.stringify(stable(projection));
  if (serialized === undefined) throw new TypeError("Patch spec must be JSON-serializable.");
  return Object.freeze({ ...projection, fingerprint: sha256Text(serialized) });
}

export function patchOperationPaths(operation: PatchOperation): readonly string[] {
  return Object.freeze([...operationPaths(operation)]);
}
