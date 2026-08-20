import type { SemanticAtlas, SemanticCoverageLedger, SemanticOrientation } from "./types.js";

export interface SemanticAtlasCacheKey {
  readonly repository: string;
  readonly commitSha: string;
  readonly projectProfile: string;
  readonly schemaVersion: number;
}

export interface SemanticAtlasCache {
  get(key: SemanticAtlasCacheKey): SemanticOrientation | null;
  put(key: SemanticAtlasCacheKey, value: SemanticOrientation): void;
}

function cacheKey(key: SemanticAtlasCacheKey): string {
  return `${key.repository}\u0000${key.commitSha}\u0000${key.projectProfile}\u0000${key.schemaVersion}`;
}

function withCacheHit(orientation: SemanticOrientation, cacheHit: boolean): SemanticOrientation {
  const coverage: SemanticCoverageLedger = Object.freeze({
    ...orientation.coverage,
    bootstrap_required: cacheHit ? false : orientation.coverage.bootstrap_required,
    bootstrap_complete: true,
    cache_hit: cacheHit
  });
  const atlas: SemanticAtlas = orientation.atlas;
  return Object.freeze({ atlas, coverage });
}

export class InMemorySemanticAtlasCache implements SemanticAtlasCache {
  readonly #entries = new Map<string, SemanticOrientation>();

  constructor(private readonly maxEntries = 32) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("Semantic Atlas cache size must be a positive integer.");
  }

  get(key: SemanticAtlasCacheKey): SemanticOrientation | null {
    const resolvedKey = cacheKey(key);
    const value = this.#entries.get(resolvedKey);
    if (!value) return null;
    this.#entries.delete(resolvedKey);
    this.#entries.set(resolvedKey, value);
    return withCacheHit(value, true);
  }

  put(key: SemanticAtlasCacheKey, value: SemanticOrientation): void {
    const resolvedKey = cacheKey(key);
    this.#entries.delete(resolvedKey);
    this.#entries.set(resolvedKey, withCacheHit(value, false));
    while (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#entries.delete(oldest);
    }
  }
}

export function semanticAtlasCacheKey(args: {
  readonly repository: string;
  readonly commitSha: string;
  readonly projectProfile: string;
  readonly schemaVersion?: number;
}): SemanticAtlasCacheKey {
  return Object.freeze({
    repository: args.repository,
    commitSha: args.commitSha,
    projectProfile: args.projectProfile,
    schemaVersion: args.schemaVersion ?? 1
  });
}
