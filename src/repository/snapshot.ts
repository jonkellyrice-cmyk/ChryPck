import { normalizeRepositoryPath } from "./source-profile.js";

export type RepositoryFileKind = "source" | "manifest" | "asset" | "unknown";

export interface RepositoryFile {
  readonly path: string;
  readonly sha: string;
  readonly size: number;
  readonly text?: string;
  readonly kind?: RepositoryFileKind;
}

export interface RepositorySnapshot {
  readonly repository: string;
  readonly commitSha: string;
  readonly files: readonly RepositoryFile[];
  readonly createdAt: string;
}

export function createSnapshot(
  repository: string,
  commitSha: string,
  files: readonly RepositoryFile[],
  createdAt = new Date().toISOString()
): RepositorySnapshot {
  const normalized = files.map(file => ({
    ...file,
    path: normalizeRepositoryPath(file.path)
  }));
  const invalid = normalized.find(file => !file.path);
  if (invalid) throw new Error("Repository snapshot contains an invalid repository path.");
  const seen = new Set<string>();
  for (const file of normalized) {
    if (seen.has(file.path)) throw new Error(`Repository snapshot contains duplicate path: ${file.path}`);
    seen.add(file.path);
  }
  return Object.freeze({
    repository: repository.trim(),
    commitSha: commitSha.trim(),
    files: Object.freeze(normalized.sort((left, right) => left.path.localeCompare(right.path)).map(file => Object.freeze(file))),
    createdAt
  });
}
