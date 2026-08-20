import type { CorridorContextPack } from "../planning/context-pack.js";
import type { PatchCorridor } from "../planning/patch-corridor.js";
import { createPatchSpec, normalizePatchPath, sha256Text, type PatchOperation, type PatchSpec } from "./patch-dsl.js";

export type AuthoringEdit =
  | { readonly type: "create_file"; readonly path: string; readonly content: string }
  | { readonly type: "replace_file"; readonly path: string; readonly content: string }
  | { readonly type: "replace_exact"; readonly path: string; readonly search: string; readonly replace: string; readonly expectedOccurrences?: number }
  | { readonly type: "insert_before_exact"; readonly path: string; readonly anchor: string; readonly content: string; readonly expectedOccurrences?: number }
  | { readonly type: "insert_after_exact"; readonly path: string; readonly anchor: string; readonly content: string; readonly expectedOccurrences?: number }
  | { readonly type: "delete_exact"; readonly path: string; readonly search: string; readonly expectedOccurrences?: number }
  | { readonly type: "remove_file"; readonly path: string }
  | { readonly type: "move_file"; readonly from: string; readonly to: string };

export interface AuthoringIntent {
  readonly id: string;
  readonly objective: string;
  readonly edits: readonly AuthoringEdit[];
}

export interface AuthoringAuthority {
  readonly corridor: PatchCorridor;
  readonly context: CorridorContextPack;
  readonly allowedNewPaths?: readonly string[];
  readonly maxFilesChanged?: number;
}

function existingContent(context: CorridorContextPack): ReadonlyMap<string, string> {
  return new Map(context.segments.map(segment => [segment.path, segment.content] as const));
}

function existingHashes(context: CorridorContextPack): ReadonlyMap<string, string> {
  return new Map(context.segments.map(segment => [segment.path, segment.sourceSha256 || sha256Text(segment.content)] as const));
}

function normalizeNewPaths(values: readonly string[] | undefined): ReadonlySet<string> {
  return new Set((values ?? []).map(normalizePatchPath).filter(Boolean));
}

function guardedExistingOperation(edit: Exclude<AuthoringEdit, { type: "create_file" }>, expectedSha256: string): PatchOperation {
  switch (edit.type) {
    case "replace_file": return { ...edit, path: normalizePatchPath(edit.path), expectedSha256 };
    case "replace_exact": return { ...edit, path: normalizePatchPath(edit.path), expectedSha256 };
    case "insert_before_exact": return { ...edit, path: normalizePatchPath(edit.path), expectedSha256 };
    case "insert_after_exact": return { ...edit, path: normalizePatchPath(edit.path), expectedSha256 };
    case "delete_exact": return { ...edit, path: normalizePatchPath(edit.path), expectedSha256 };
    case "remove_file": return { ...edit, path: normalizePatchPath(edit.path), expectedSha256 };
    case "move_file": return { ...edit, from: normalizePatchPath(edit.from), to: normalizePatchPath(edit.to), expectedSha256 };
  }
}

export function compileAuthoringIntent(intent: AuthoringIntent, authority: AuthoringAuthority): PatchSpec {
  if (!authority.corridor.certified || authority.context.certified !== true) {
    throw new Error("Authoring compiler requires certified Patch Corridor and Context Pack authority.");
  }
  if (authority.context.commitSha.trim() === "") throw new Error("Authoring context is missing its immutable base commit.");
  const existing = existingContent(authority.context);
  const hashes = existingHashes(authority.context);
  const grantedExisting = new Set(authority.context.grantedPaths.map(normalizePatchPath));
  const allowedNew = normalizeNewPaths(authority.allowedNewPaths);
  const operations: PatchOperation[] = [];
  const touched = new Set<string>();

  for (const edit of intent.edits) {
    if (edit.type === "create_file") {
      const path = normalizePatchPath(edit.path);
      if (!path || !allowedNew.has(path)) throw new Error(`New file is not explicitly authorized: ${edit.path}`);
      if (existing.has(path)) throw new Error(`create_file targets an existing context path: ${path}`);
      operations.push({ ...edit, path });
      touched.add(path);
      continue;
    }

    if (edit.type === "move_file") {
      const from = normalizePatchPath(edit.from), to = normalizePatchPath(edit.to);
      const content = existing.get(from);
      const expectedSha256 = hashes.get(from);
      if (!from || !to || !grantedExisting.has(from) || content === undefined || !expectedSha256) throw new Error(`Move source is not granted by Context Pack: ${edit.from}`);
      if (!allowedNew.has(to)) throw new Error(`Move destination is not explicitly authorized: ${edit.to}`);
      operations.push(guardedExistingOperation({ ...edit, from, to }, expectedSha256));
      touched.add(from); touched.add(to);
      continue;
    }

    const path = normalizePatchPath(edit.path);
    const content = existing.get(path);
    const expectedSha256 = hashes.get(path);
    if (!path || !grantedExisting.has(path) || content === undefined || !expectedSha256) throw new Error(`Edit path is not granted by Context Pack: ${edit.path}`);
    operations.push(guardedExistingOperation({ ...edit, path } as Exclude<AuthoringEdit, { type: "create_file" }>, expectedSha256));
    touched.add(path);
  }

  const maxFiles = authority.maxFilesChanged ?? Math.max(1, authority.corridor.files.length);
  if (touched.size > maxFiles) throw new Error(`Authoring intent touches ${touched.size} paths; authority permits ${maxFiles}.`);
  if (operations.length === 0) throw new Error("Authoring intent contains no mutation edits.");

  return createPatchSpec({
    id: intent.id,
    objective: intent.objective,
    baseCommitSha: authority.context.commitSha,
    allowedPaths: [...touched],
    operations
  });
}

export interface AuthoringCompiler {
  compile(intent: AuthoringIntent, authority: AuthoringAuthority): PatchSpec;
}

export class NativeAuthoringCompiler implements AuthoringCompiler {
  compile(intent: AuthoringIntent, authority: AuthoringAuthority): PatchSpec {
    return compileAuthoringIntent(intent, authority);
  }
}
