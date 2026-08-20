import { createHash } from "node:crypto";
import type { RepositoryModel } from "../repository/model.js";
import type { SemanticRegionKind } from "./types.js";

export const DEFAULT_SEMANTIC_MAX_REGIONS = 32;

export interface SemanticRegionCandidate {
  readonly id: string;
  readonly kind: SemanticRegionKind;
  readonly nameHint: string;
  readonly pathScopes: readonly string[];
  readonly paths: readonly string[];
  readonly score: number;
  readonly depth: number;
}

interface MutableCandidate {
  prefix: string;
  paths: Set<string>;
  symbolCount: number;
  effectCount: number;
  stateCount: number;
  boundaryEdges: number;
  depth: number;
}

function semanticId(repository: string, prefix: string): string {
  const slug = prefix || "repository";
  const digest = createHash("sha256").update(`${repository}:${slug}`).digest("hex").slice(0, 10);
  return `semantic:${slug.replace(/[^a-zA-Z0-9/_-]+/g, "-")}:${digest}`;
}

function nameHint(prefix: string, repository: string): string {
  if (!prefix) return repository.split("/").at(-1) ?? repository;
  return prefix
    .split("/")
    .at(-1)!
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, match => match.toUpperCase());
}

function prefixesFor(path: string): readonly string[] {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return Object.freeze([]);
  const directories = parts.slice(0, -1);
  const maxDepth = Math.min(3, directories.length);
  const output: string[] = [];
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    output.push(directories.slice(0, depth).join("/"));
  }
  return Object.freeze(output);
}

function candidateFor(map: Map<string, MutableCandidate>, prefix: string): MutableCandidate {
  const existing = map.get(prefix);
  if (existing) return existing;
  const created: MutableCandidate = {
    prefix,
    paths: new Set<string>(),
    symbolCount: 0,
    effectCount: 0,
    stateCount: 0,
    boundaryEdges: 0,
    depth: prefix.split("/").length
  };
  map.set(prefix, created);
  return created;
}

function contains(prefix: string, path: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function score(candidate: MutableCandidate): number {
  return (
    candidate.paths.size * 4 +
    Math.min(candidate.symbolCount, 20) +
    candidate.effectCount * 3 +
    candidate.stateCount * 3 +
    candidate.boundaryEdges * 2
  );
}

function meaningful(candidate: MutableCandidate): boolean {
  if (candidate.depth === 1 && candidate.paths.size > 0) return true;
  return candidate.paths.size >= 2 || candidate.effectCount > 0 || candidate.stateCount > 0 || candidate.boundaryEdges >= 2;
}

function preserveBreadth(
  candidates: readonly MutableCandidate[],
  maxRegions: number
): readonly MutableCandidate[] {
  const budget = Math.max(1, maxRegions - 1);
  const topLevel = candidates
    .filter(candidate => candidate.depth === 1)
    .sort((left, right) => right.paths.size - left.paths.size || left.prefix.localeCompare(right.prefix));
  const selected = new Map<string, MutableCandidate>();
  for (const candidate of topLevel.slice(0, budget)) selected.set(candidate.prefix, candidate);
  if (selected.size >= budget) return Object.freeze([...selected.values()]);

  const deeper = candidates
    .filter(candidate => candidate.depth > 1)
    .sort((left, right) => score(right) - score(left) || left.depth - right.depth || left.prefix.localeCompare(right.prefix));
  for (const candidate of deeper) {
    if (selected.size >= budget) break;
    selected.set(candidate.prefix, candidate);
  }
  return Object.freeze([...selected.values()].sort((left, right) => left.depth - right.depth || left.prefix.localeCompare(right.prefix)));
}

export function buildSemanticRegionCandidates(
  model: RepositoryModel,
  maxRegions = DEFAULT_SEMANTIC_MAX_REGIONS
): readonly SemanticRegionCandidate[] {
  if (!Number.isInteger(maxRegions) || maxRegions < 1) throw new Error("Semantic region limit must be a positive integer.");
  const candidates = new Map<string, MutableCandidate>();

  for (const facts of model.fileFacts) {
    for (const prefix of prefixesFor(facts.file)) {
      const candidate = candidateFor(candidates, prefix);
      candidate.paths.add(facts.file);
      candidate.symbolCount += facts.symbols.length;
      candidate.effectCount += facts.effects.length;
      candidate.stateCount += facts.states.length;
    }
  }

  for (const edge of model.dependencies) {
    for (const candidate of candidates.values()) {
      const fromInside = contains(candidate.prefix, edge.from);
      const toInside = contains(candidate.prefix, edge.to);
      if (fromInside !== toInside) candidate.boundaryEdges += 1;
    }
  }

  const selected = preserveBreadth(
    [...candidates.values()].filter(meaningful),
    maxRegions
  );

  const repositoryPaths = Object.freeze(model.fileFacts.map(facts => facts.file).sort());
  const repositoryCandidate: SemanticRegionCandidate = Object.freeze({
    id: semanticId(model.snapshot.repository, ""),
    kind: "repository",
    nameHint: nameHint("", model.snapshot.repository),
    pathScopes: Object.freeze(["**"]),
    paths: repositoryPaths,
    score: repositoryPaths.length,
    depth: 0
  });

  const regionCandidates = selected.map(candidate => Object.freeze({
    id: semanticId(model.snapshot.repository, candidate.prefix),
    kind: candidate.depth === 1 ? "subsystem" as const : "module-group" as const,
    nameHint: nameHint(candidate.prefix, model.snapshot.repository),
    pathScopes: Object.freeze([`${candidate.prefix}/**`]),
    paths: Object.freeze([...candidate.paths].sort()),
    score: score(candidate),
    depth: candidate.depth
  }));

  return Object.freeze([repositoryCandidate, ...regionCandidates]);
}

export function regionForPath(
  regions: readonly SemanticRegionCandidate[],
  path: string
): SemanticRegionCandidate {
  const matching = regions
    .filter(region => region.kind !== "repository" && region.paths.includes(path))
    .sort((left, right) => right.depth - left.depth || right.score - left.score);
  return matching[0] ?? regions[0]!;
}
