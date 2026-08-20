import type { RepositoryAdapter, RepositoryPublishRequest, RepositoryPublishResult } from "../../repository/adapter.js";
import { createSnapshot, type RepositoryFile, type RepositoryFileKind, type RepositorySnapshot } from "../../repository/snapshot.js";
import { createRepositorySourceProfile, isProfileSourcePath, normalizeRepositoryPath, type RepositorySourceProfile } from "../../repository/source-profile.js";
import type { GitHubRepositoryFileEntry, GitHubTransportClient } from "./client.js";
import { InMemoryRepositorySnapshotCache, type RepositorySnapshotCache } from "../../repository/snapshot-cache.js";

export interface GitHubRepositoryAdapterOptions {
  readonly profile?: RepositorySourceProfile;
  readonly maxTextFileBytes?: number;
  readonly maxRepositoryFiles?: number;
  readonly snapshotCache?: RepositorySnapshotCache;
}

function fileKind(profile: RepositorySourceProfile, path: string): RepositoryFileKind {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  if (profile.runtimeManifests.has(name)) return "manifest";
  if (isProfileSourcePath(profile, path)) return "source";
  return "asset";
}

function isSemanticMetadataTextPath(path: string): boolean {
  const normalized = path.toLowerCase();
  const name = normalized.split("/").at(-1) ?? normalized;
  if (["readme.md", "readme.mdx", "architecture.md", "design.md", "contributing.md"].includes(name)) return true;
  return normalized.startsWith("docs/") && /\.(md|mdx|txt)$/.test(normalized);
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
  private readonly snapshotCache: RepositorySnapshotCache;

  constructor(private readonly client: GitHubTransportClient, options: GitHubRepositoryAdapterOptions = {}) {
    this.profile = options.profile ?? createRepositorySourceProfile();
    this.maxTextFileBytes = options.maxTextFileBytes ?? 512 * 1024;
    this.maxRepositoryFiles = options.maxRepositoryFiles ?? 12000;
    this.snapshotCache = options.snapshotCache ?? new InMemoryRepositorySnapshotCache();
    if (this.maxTextFileBytes < 1 || this.maxRepositoryFiles < 1) throw new Error("GitHub Repository Adapter limits must be positive.");
  }

  async snapshot(repository: string, ref: string): Promise<RepositorySnapshot> {
    const sha = await this.client.resolveCommit(repository, ref);
    const cached = await this.snapshotCache.get(repository, sha);
    if (cached) return cached;
    const entries = await this.client.listFiles(repository, sha);
    if (entries.length > this.maxRepositoryFiles) throw new Error(`Repository snapshot contains ${entries.length} files; limit is ${this.maxRepositoryFiles}.`);
    const readableEntries = entries.filter(entry => this.shouldHydrate(entry));
    const hydrated = await this.client.readTextFiles(repository, readableEntries, sha);
    const files = entries.map(entry => this.materialize(entry, hydrated));
    const snapshot = createSnapshot(repository, sha, files);
    await this.snapshotCache.put(snapshot);
    return snapshot;
  }

  private shouldHydrate(entry: GitHubRepositoryFileEntry): boolean {
    const path = normalizeRepositoryPath(entry.path);
    return Boolean(path) && entry.size <= this.maxTextFileBytes &&
      (isProfileSourcePath(this.profile, path) || isSemanticMetadataTextPath(path));
  }

  private materialize(entry: GitHubRepositoryFileEntry, hydrated: ReadonlyMap<string, { readonly text: string }>): RepositoryFile {
    const path = normalizeRepositoryPath(entry.path), kind = fileKind(this.profile, path);
    if (!path) throw new Error(`GitHub returned an invalid repository path: ${entry.path}`);
    const file = hydrated.get(path);
    return Object.freeze({ path, sha: entry.sha, size: entry.size, ...(file ? { text: file.text } : {}), kind });
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
