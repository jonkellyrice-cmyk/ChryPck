import type { RepositoryAdapter, RepositoryPublishRequest, RepositoryPublishResult } from "../../repository/adapter.js";
import { createSnapshot, type RepositoryFile, type RepositoryFileKind, type RepositorySnapshot } from "../../repository/snapshot.js";
import { createRepositorySourceProfile, isProfileSourcePath, normalizeRepositoryPath, type RepositorySourceProfile } from "../../repository/source-profile.js";
import type { GitHubRepositoryFileEntry, GitHubTransportClient } from "./client.js";

export interface GitHubRepositoryAdapterOptions {
  readonly profile?: RepositorySourceProfile;
  readonly maxTextFileBytes?: number;
  readonly maxRepositoryFiles?: number;
}

function fileKind(profile: RepositorySourceProfile, path: string): RepositoryFileKind {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (profile.runtimeManifests.has(name)) return "manifest";
  if (isProfileSourcePath(profile, path)) return "source";
  return "asset";
}

function normalizeChanges(changes: ReadonlyMap<string, string | null>): ReadonlyMap<string, string | null> {
  const output = new Map<string, string | null>();
  for (const [rawPath, content] of changes) {
    const path = normalizeRepositoryPath(rawPath);
    if (!path) throw new Error(`Invalid publication path: ${rawPath}`);
    if (output.has(path)) throw new Error(`Duplicate publication path after normalization: ${path}`);
    output.set(path, content);
  }
  return output;
}

export class GitHubRepositoryAdapter implements RepositoryAdapter {
  private readonly profile: RepositorySourceProfile;
  private readonly maxTextFileBytes: number;
  private readonly maxRepositoryFiles: number;

  constructor(private readonly client: GitHubTransportClient, options: GitHubRepositoryAdapterOptions = {}) {
    this.profile = options.profile ?? createRepositorySourceProfile();
    this.maxTextFileBytes = options.maxTextFileBytes ?? 512 * 1024;
    this.maxRepositoryFiles = options.maxRepositoryFiles ?? 12000;
    if (this.maxTextFileBytes < 1 || this.maxRepositoryFiles < 1) throw new Error("GitHub Repository Adapter limits must be positive.");
  }

  async snapshot(repository: string, ref: string): Promise<RepositorySnapshot> {
    const sha = await this.client.resolveCommit(repository, ref);
    const entries = await this.client.listFiles(repository, sha);
    if (entries.length > this.maxRepositoryFiles) throw new Error(`Repository snapshot contains ${entries.length} files; limit is ${this.maxRepositoryFiles}.`);
    const files: RepositoryFile[] = [];
    for (const entry of entries) files.push(await this.materialize(repository, sha, entry));
    return createSnapshot(repository, sha, files);
  }

  private async materialize(repository: string, sha: string, entry: GitHubRepositoryFileEntry): Promise<RepositoryFile> {
    const path = normalizeRepositoryPath(entry.path), kind = fileKind(this.profile, path);
    if (!path) throw new Error(`GitHub returned an invalid repository path: ${entry.path}`);
    if (!isProfileSourcePath(this.profile, path) || entry.size > this.maxTextFileBytes) {
      return Object.freeze({ path, sha: entry.sha, size: entry.size, kind });
    }
    const file = await this.client.readTextFile(repository, path, sha);
    if (!file) throw new Error(`GitHub tree referenced a file that could not be read at the same commit: ${path}`);
    if (file.sha !== entry.sha) throw new Error(`GitHub file SHA changed inside immutable snapshot: ${path}`);
    return Object.freeze({ path, sha: entry.sha, size: file.size, text: file.text, kind });
  }

  async publish(request: RepositoryPublishRequest): Promise<RepositoryPublishResult> {
    const changes = normalizeChanges(request.changes);
    if (changes.size === 0) throw new Error("Repository publication contains no changes.");
    const current = await this.client.resolveCommit(request.repository, request.targetRef);
    if (current !== request.baseCommitSha) throw new Error(`Repository publication base is stale. Expected ${request.baseCommitSha}, found ${current}.`);
    const result = await this.client.commitFiles(request.repository, request.baseCommitSha, request.targetRef, request.message, changes);
    return Object.freeze({
      repository: request.repository,
      targetRef: request.targetRef,
      baseCommitSha: request.baseCommitSha,
      commitSha: result.sha,
      changedPaths: Object.freeze([...changes.keys()].sort())
    });
  }
}
