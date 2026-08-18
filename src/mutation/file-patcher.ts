import { normalizePatchPath, patchOperationPaths, sha256Text, type PatchOperation, type PatchSpec } from "./patch-dsl.js";

export interface FileChange {
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly beforeSha256: string | null;
  readonly afterSha256: string | null;
  readonly kind: "create" | "modify" | "delete";
}

export interface StagedPatch {
  readonly patchId: string;
  readonly patchFingerprint: string;
  readonly baseCommitSha: string;
  readonly files: ReadonlyMap<string, string>;
  readonly changes: readonly FileChange[];
  readonly changedPaths: readonly string[];
  readonly createdPaths: readonly string[];
  readonly modifiedPaths: readonly string[];
  readonly deletedPaths: readonly string[];
}

export interface FilePatcherPolicy {
  readonly protectedPaths?: readonly string[];
  readonly allowNoop?: boolean;
  readonly maxFilesChanged?: number;
  readonly maxTotalAddedBytes?: number;
  readonly maxSingleFileBytes?: number;
}

export const DEFAULT_PROTECTED_PATHS = Object.freeze([".git", "node_modules", ".env"] as const);

function isProtected(path: string, protectedPaths: readonly string[]): boolean {
  return protectedPaths.some(raw => {
    const protectedPath = normalizePatchPath(raw);
    if (!protectedPath) return false;
    if (protectedPath === ".env") return path === ".env" || path.startsWith(".env.");
    return path === protectedPath || path.startsWith(`${protectedPath}/`);
  });
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0, cursor = 0;
  while ((cursor = text.indexOf(needle, cursor)) >= 0) { count += 1; cursor += needle.length; }
  return count;
}

function expectedCount(operation: Extract<PatchOperation, { type: "replace_exact" | "insert_before_exact" | "insert_after_exact" | "delete_exact" }>): number {
  return operation.expectedOccurrences ?? 1;
}

function assertOccurrence(text: string, needle: string, operation: Extract<PatchOperation, { type: "replace_exact" | "insert_before_exact" | "insert_after_exact" | "delete_exact" }>): void {
  const count = countOccurrences(text, needle), expected = expectedCount(operation);
  if (count !== expected) throw new Error(`Expected ${expected} occurrence(s), found ${count}: ${operation.type} ${operation.path}`);
}

function guardPath(operation: PatchOperation): string | null {
  return operation.type === "create_file" ? null : operation.type === "move_file" ? operation.from : operation.path;
}

function guardHash(operation: PatchOperation): string | undefined {
  return operation.type === "create_file" ? undefined : operation.expectedSha256;
}

function assertPreflight(spec: PatchSpec, base: ReadonlyMap<string, string>, policy: FilePatcherPolicy): void {
  const protectedPaths = policy.protectedPaths ?? DEFAULT_PROTECTED_PATHS;
  for (const operation of spec.operations) {
    for (const path of patchOperationPaths(operation)) if (isProtected(path, protectedPaths)) throw new Error(`Protected path mutation refused: ${path}`);
    const path = guardPath(operation), expected = guardHash(operation);
    if (operation.type === "create_file") {
      if (base.has(operation.path)) throw new Error(`Target exists: ${operation.path}`);
      continue;
    }
    if (!path || !base.has(path)) throw new Error(`Target missing: ${path ?? "<unknown>"}`);
    if (expected && sha256Text(base.get(path)!) !== expected) throw new Error(`SHA-256 precondition failed: ${path}`);
    if (operation.type === "move_file" && base.has(operation.to)) throw new Error(`Move destination exists: ${operation.to}`);
  }
}

function applyOperation(files: Map<string, string>, operation: PatchOperation): void {
  if (operation.type === "create_file") { files.set(operation.path, operation.content); return; }
  if (operation.type === "move_file") {
    const content = files.get(operation.from);
    if (content === undefined) throw new Error(`Move source missing during staging: ${operation.from}`);
    if (files.has(operation.to)) throw new Error(`Move destination exists during staging: ${operation.to}`);
    files.delete(operation.from); files.set(operation.to, content); return;
  }
  const current = files.get(operation.path);
  if (current === undefined) throw new Error(`Target missing during staging: ${operation.path}`);
  switch (operation.type) {
    case "replace_file": files.set(operation.path, operation.content); return;
    case "replace_exact": assertOccurrence(current, operation.search, operation); files.set(operation.path, current.split(operation.search).join(operation.replace)); return;
    case "insert_before_exact": assertOccurrence(current, operation.anchor, operation); files.set(operation.path, current.split(operation.anchor).join(`${operation.content}${operation.anchor}`)); return;
    case "insert_after_exact": assertOccurrence(current, operation.anchor, operation); files.set(operation.path, current.split(operation.anchor).join(`${operation.anchor}${operation.content}`)); return;
    case "delete_exact": assertOccurrence(current, operation.search, operation); files.set(operation.path, current.split(operation.search).join("")); return;
    case "remove_file": files.delete(operation.path); return;
  }
}

function diffFiles(base: ReadonlyMap<string, string>, staged: ReadonlyMap<string, string>): FileChange[] {
  const paths = [...new Set([...base.keys(), ...staged.keys()])].sort();
  const changes: FileChange[] = [];
  for (const path of paths) {
    const before = base.get(path) ?? null, after = staged.get(path) ?? null;
    if (before === after) continue;
    changes.push(Object.freeze({
      path, before, after,
      beforeSha256: before === null ? null : sha256Text(before),
      afterSha256: after === null ? null : sha256Text(after),
      kind: before === null ? "create" : after === null ? "delete" : "modify"
    }));
  }
  return changes;
}

export function stagePatch(spec: PatchSpec, base: ReadonlyMap<string, string>, policy: FilePatcherPolicy = {}): StagedPatch {
  assertPreflight(spec, base, policy);
  const files = new Map(base);
  for (const operation of spec.operations) applyOperation(files, operation);
  const changes = diffFiles(base, files);
  if (!policy.allowNoop && changes.length === 0) throw new Error("Patch produced no changes.");
  if (policy.maxFilesChanged !== undefined && changes.length > policy.maxFilesChanged) throw new Error(`Patch changes ${changes.length} files; limit is ${policy.maxFilesChanged}.`);
  const encoder = new TextEncoder();
  const addedBytes = changes.reduce((sum, change) => sum + Math.max(0, encoder.encode(change.after ?? "").length - encoder.encode(change.before ?? "").length), 0);
  if (policy.maxTotalAddedBytes !== undefined && addedBytes > policy.maxTotalAddedBytes) throw new Error(`Patch adds ${addedBytes} bytes; limit is ${policy.maxTotalAddedBytes}.`);
  if (policy.maxSingleFileBytes !== undefined) {
    for (const change of changes) if (change.after !== null && encoder.encode(change.after).length > policy.maxSingleFileBytes) throw new Error(`Staged file exceeds size limit: ${change.path}`);
  }
  return Object.freeze({
    patchId: spec.id,
    patchFingerprint: spec.fingerprint,
    baseCommitSha: spec.baseCommitSha,
    files,
    changes: Object.freeze(changes),
    changedPaths: Object.freeze(changes.map(change => change.path)),
    createdPaths: Object.freeze(changes.filter(change => change.kind === "create").map(change => change.path)),
    modifiedPaths: Object.freeze(changes.filter(change => change.kind === "modify").map(change => change.path)),
    deletedPaths: Object.freeze(changes.filter(change => change.kind === "delete").map(change => change.path))
  });
}
