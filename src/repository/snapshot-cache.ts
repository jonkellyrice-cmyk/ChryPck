import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";
import type { RepositorySnapshot } from "./snapshot.js";

export interface RepositorySnapshotCache {
  get(repository: string, commitSha: string): Promise<RepositorySnapshot | null>;
  put(snapshot: RepositorySnapshot): Promise<void>;
}

function cachePath(repository: string, commitSha: string): string {
  const repositoryKey = createHash("sha256").update(repository).digest("hex").slice(0, 20);
  return `chrypck/snapshots/v1/${repositoryKey}/${commitSha}.json`;
}

export class InMemoryRepositorySnapshotCache implements RepositorySnapshotCache {
  readonly #entries = new Map<string, RepositorySnapshot>();

  async get(repository: string, commitSha: string): Promise<RepositorySnapshot | null> {
    const snapshot = this.#entries.get(cachePath(repository, commitSha)) ?? null;
    console.info(JSON.stringify({ event: "chrypck.snapshot_cache", backend: "memory", outcome: snapshot ? "hit" : "miss", repository, commit_sha: commitSha }));
    return snapshot;
  }

  async put(snapshot: RepositorySnapshot): Promise<void> {
    this.#entries.set(cachePath(snapshot.repository, snapshot.commitSha), snapshot);
    console.info(JSON.stringify({ event: "chrypck.snapshot_cache", backend: "memory", outcome: "write", repository: snapshot.repository, commit_sha: snapshot.commitSha, files: snapshot.files.length }));
  }
}

export class VercelBlobRepositorySnapshotCache implements RepositorySnapshotCache {
  constructor(private readonly token: string) {}

  async get(repository: string, commitSha: string): Promise<RepositorySnapshot | null> {
    const result = await get(cachePath(repository, commitSha), {
      access: "private",
      token: this.token,
      useCache: true
    });
    if (!result || result.statusCode !== 200 || !result.stream) {
      console.info(JSON.stringify({ event: "chrypck.snapshot_cache", backend: "vercel-blob", outcome: "miss", repository, commit_sha: commitSha }));
      return null;
    }
    console.info(JSON.stringify({ event: "chrypck.snapshot_cache", backend: "vercel-blob", outcome: "hit", repository, commit_sha: commitSha }));
    return await new Response(result.stream).json() as RepositorySnapshot;
  }

  async put(snapshot: RepositorySnapshot): Promise<void> {
    await put(cachePath(snapshot.repository, snapshot.commitSha), JSON.stringify(snapshot), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      token: this.token
    });
    console.info(JSON.stringify({ event: "chrypck.snapshot_cache", backend: "vercel-blob", outcome: "write", repository: snapshot.repository, commit_sha: snapshot.commitSha, files: snapshot.files.length }));
  }
}

export function createRepositorySnapshotCache(env: NodeJS.ProcessEnv = process.env): RepositorySnapshotCache {
  const token = String(env.BLOB_READ_WRITE_TOKEN ?? "").trim();
  return token
    ? new VercelBlobRepositorySnapshotCache(token)
    : new InMemoryRepositorySnapshotCache();
}
