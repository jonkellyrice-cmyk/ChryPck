import type { RepositorySnapshot } from "./snapshot.js";

export interface RepositoryPublishRequest {
  readonly repository: string;
  readonly targetRef: string;
  readonly baseCommitSha: string;
  readonly message: string;
  readonly changes: ReadonlyMap<string, string | null>;
}

export interface RepositoryPublishResult {
  readonly repository: string;
  readonly targetRef: string;
  readonly baseCommitSha: string;
  readonly commitSha: string;
  readonly changedPaths: readonly string[];
}

export interface RepositoryAdapter {
  snapshot(repository: string, ref: string): Promise<RepositorySnapshot>;
  publish(request: RepositoryPublishRequest): Promise<RepositoryPublishResult>;
}
