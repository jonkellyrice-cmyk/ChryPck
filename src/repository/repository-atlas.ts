import type { RepositoryModel } from "./model.js";
import type { RepositoryFile, RepositoryFileKind } from "./snapshot.js";

export const DEFAULT_REPOSITORY_ATLAS_MAX_NODES = 240;

export interface RepositoryAtlasFileNode {
  readonly kind: "file";
  readonly path: string;
  readonly file_kind: RepositoryFileKind;
  readonly size_bytes: number;
  readonly modeled: boolean;
}

export interface RepositoryAtlasDirectoryNode {
  readonly kind: "directory";
  readonly path: string;
  readonly file_count: number;
  readonly modeled_file_count: number;
  readonly source_file_count: number;
  readonly manifest_file_count: number;
  readonly asset_file_count: number;
  readonly unknown_file_count: number;
  readonly children: readonly RepositoryAtlasNode[];
  readonly truncated: boolean;
  readonly omitted_node_count: number;
}

export type RepositoryAtlasNode = RepositoryAtlasFileNode | RepositoryAtlasDirectoryNode;

export interface RepositoryAtlas {
  readonly schema_version: 1;
  readonly representation: "compressed-path-tree";
  readonly complete: boolean;
  readonly max_nodes: number;
  readonly total_node_count: number;
  readonly returned_node_count: number;
  readonly omitted_node_count: number;
  readonly entries: readonly RepositoryAtlasNode[];
}

export interface RepositoryCoverageLedger {
  readonly schema_version: 1;
  readonly repository_files: {
    readonly total: number;
    readonly text_backed: number;
    readonly modeled: number;
    readonly unmodeled: number;
    readonly by_kind: Readonly<Record<RepositoryFileKind, number>>;
  };
  readonly repository_model: {
    readonly file_fact_records: number;
    readonly symbols_indexed: number;
    readonly dependency_edges: number;
    readonly unresolved_dependencies: number;
    readonly effects_indexed: number;
    readonly state_records: number;
  };
  readonly atlas_projection: {
    readonly complete: boolean;
    readonly total_node_count: number;
    readonly returned_node_count: number;
    readonly omitted_node_count: number;
    readonly max_nodes: number;
  };
}

export interface RepositoryOrientation {
  readonly atlas: RepositoryAtlas;
  readonly coverage: RepositoryCoverageLedger;
}

export interface RepositoryOrientationOptions {
  readonly maxAtlasNodes?: number;
}

interface AtlasStats {
  files: number;
  modeled: number;
  source: number;
  manifest: number;
  asset: number;
  unknown: number;
}

interface MutableDirectoryNode {
  readonly kind: "directory";
  readonly name: string;
  readonly path: string;
  readonly children: Map<string, MutableAtlasNode>;
  stats: AtlasStats;
}

interface MutableFileNode {
  readonly kind: "file";
  readonly name: string;
  readonly path: string;
  readonly file: RepositoryFile;
  readonly modeled: boolean;
  stats: AtlasStats;
}

type MutableAtlasNode = MutableDirectoryNode | MutableFileNode;

function emptyStats(): AtlasStats {
  return { files: 0, modeled: 0, source: 0, manifest: 0, asset: 0, unknown: 0 };
}

function addStats(target: AtlasStats, source: AtlasStats): AtlasStats {
  target.files += source.files;
  target.modeled += source.modeled;
  target.source += source.source;
  target.manifest += source.manifest;
  target.asset += source.asset;
  target.unknown += source.unknown;
  return target;
}

function fileKind(file: RepositoryFile): RepositoryFileKind {
  return file.kind ?? "unknown";
}

function fileStats(file: RepositoryFile, modeled: boolean): AtlasStats {
  const stats = emptyStats();
  stats.files = 1;
  stats.modeled = modeled ? 1 : 0;
  stats[fileKind(file)] = 1;
  return stats;
}

function createRoot(): MutableDirectoryNode {
  return { kind: "directory", name: "", path: "", children: new Map(), stats: emptyStats() };
}

function insertFile(root: MutableDirectoryNode, file: RepositoryFile, modeledPaths: ReadonlySet<string>): void {
  const parts = file.path.split("/").filter(Boolean);
  let directory = root;
  for (let index = 0; index < parts.length; index += 1) {
    const name = parts[index]!;
    const path = parts.slice(0, index + 1).join("/");
    const isFile = index === parts.length - 1;
    const existing = directory.children.get(name);
    if (isFile) {
      if (existing) throw new Error(`Repository Atlas found a duplicate path: ${file.path}`);
      const modeled = modeledPaths.has(file.path);
      directory.children.set(name, {
        kind: "file",
        name,
        path,
        file,
        modeled,
        stats: fileStats(file, modeled)
      });
      return;
    }
    if (existing?.kind === "file") throw new Error(`Repository Atlas path collides with a file: ${path}`);
    if (!existing) {
      const next: MutableDirectoryNode = { kind: "directory", name, path, children: new Map(), stats: emptyStats() };
      directory.children.set(name, next);
      directory = next;
    } else {
      directory = existing;
    }
  }
}

function calculateStats(node: MutableAtlasNode): AtlasStats {
  if (node.kind === "file") return node.stats;
  const stats = emptyStats();
  for (const child of node.children.values()) addStats(stats, calculateStats(child));
  node.stats = stats;
  return stats;
}

function collapseDirectory(node: MutableDirectoryNode): MutableDirectoryNode {
  let current = node;
  while (current.children.size === 1) {
    const onlyChild = current.children.values().next().value as MutableAtlasNode | undefined;
    if (!onlyChild || onlyChild.kind !== "directory") break;
    current = onlyChild;
  }
  return current;
}

function canonicalNode(node: MutableAtlasNode): MutableAtlasNode {
  return node.kind === "directory" ? collapseDirectory(node) : node;
}

function nodeSort(left: MutableAtlasNode, right: MutableAtlasNode): number {
  const canonicalLeft = canonicalNode(left);
  const canonicalRight = canonicalNode(right);
  if (canonicalLeft.kind !== canonicalRight.kind) return canonicalLeft.kind === "directory" ? -1 : 1;
  if (canonicalLeft.kind === "file" && canonicalRight.kind === "file") {
    const rank: Record<RepositoryFileKind, number> = { manifest: 0, source: 1, unknown: 2, asset: 3 };
    const difference = rank[fileKind(canonicalLeft.file)] - rank[fileKind(canonicalRight.file)];
    if (difference !== 0) return difference;
  }
  return canonicalLeft.path.localeCompare(canonicalRight.path);
}

function fullNodeCount(node: MutableAtlasNode, memo: WeakMap<object, number>): number {
  const canonical = canonicalNode(node);
  if (canonical.kind === "file") return 1;
  const cached = memo.get(canonical);
  if (cached !== undefined) return cached;
  let count = 1;
  for (const child of canonical.children.values()) count += fullNodeCount(child, memo);
  memo.set(canonical, count);
  return count;
}

function selectBreadthFirst(root: MutableDirectoryNode, maxNodes: number): ReadonlySet<MutableAtlasNode> {
  const selected = new Set<MutableAtlasNode>();
  const queue = [...root.children.values()].sort(nodeSort);
  let cursor = 0;
  while (cursor < queue.length && selected.size < maxNodes) {
    const raw = queue[cursor++];
    if (!raw) continue;
    const node = canonicalNode(raw);
    if (selected.has(node)) continue;
    selected.add(node);
    if (node.kind === "directory") queue.push(...[...node.children.values()].sort(nodeSort));
  }
  return selected;
}

interface ProjectionResult {
  readonly node: RepositoryAtlasNode;
  readonly returnedNodes: number;
}

function projectSelectedNode(
  rawNode: MutableAtlasNode,
  selected: ReadonlySet<MutableAtlasNode>,
  countMemo: WeakMap<object, number>
): ProjectionResult | null {
  const node = canonicalNode(rawNode);
  if (!selected.has(node)) return null;
  if (node.kind === "file") {
    return {
      node: Object.freeze({
        kind: "file",
        path: node.path,
        file_kind: fileKind(node.file),
        size_bytes: node.file.size,
        modeled: node.modeled
      }),
      returnedNodes: 1
    };
  }

  const projectedChildren: RepositoryAtlasNode[] = [];
  let returnedNodes = 1;
  for (const child of [...node.children.values()].sort(nodeSort)) {
    const projected = projectSelectedNode(child, selected, countMemo);
    if (!projected) continue;
    projectedChildren.push(projected.node);
    returnedNodes += projected.returnedNodes;
  }
  const totalNodes = fullNodeCount(node, countMemo);
  const omittedNodes = Math.max(0, totalNodes - returnedNodes);
  return {
    node: Object.freeze({
      kind: "directory",
      path: node.path,
      file_count: node.stats.files,
      modeled_file_count: node.stats.modeled,
      source_file_count: node.stats.source,
      manifest_file_count: node.stats.manifest,
      asset_file_count: node.stats.asset,
      unknown_file_count: node.stats.unknown,
      children: Object.freeze(projectedChildren),
      truncated: omittedNodes > 0,
      omitted_node_count: omittedNodes
    }),
    returnedNodes
  };
}

function positiveNodeLimit(value: number | undefined): number {
  const resolved = value ?? DEFAULT_REPOSITORY_ATLAS_MAX_NODES;
  if (!Number.isInteger(resolved) || resolved < 1) throw new Error("Repository Atlas max node count must be a positive integer.");
  return resolved;
}

export function buildRepositoryOrientation(
  model: RepositoryModel,
  options: RepositoryOrientationOptions = {}
): RepositoryOrientation {
  const modeledPaths = new Set(model.fileFacts.map(facts => facts.file));
  const root = createRoot();
  for (const file of model.snapshot.files) insertFile(root, file, modeledPaths);
  calculateStats(root);

  const maxNodes = positiveNodeLimit(options.maxAtlasNodes);
  const countMemo = new WeakMap<object, number>();
  const totalNodeCount = [...root.children.values()].reduce((sum, child) => sum + fullNodeCount(child, countMemo), 0);
  const selected = selectBreadthFirst(root, maxNodes);
  const entries: RepositoryAtlasNode[] = [];
  let returnedNodeCount = 0;
  for (const child of [...root.children.values()].sort(nodeSort)) {
    const projected = projectSelectedNode(child, selected, countMemo);
    if (!projected) continue;
    entries.push(projected.node);
    returnedNodeCount += projected.returnedNodes;
  }
  const omittedNodeCount = Math.max(0, totalNodeCount - returnedNodeCount);
  const atlas: RepositoryAtlas = Object.freeze({
    schema_version: 1,
    representation: "compressed-path-tree",
    complete: omittedNodeCount === 0,
    max_nodes: maxNodes,
    total_node_count: totalNodeCount,
    returned_node_count: returnedNodeCount,
    omitted_node_count: omittedNodeCount,
    entries: Object.freeze(entries)
  });

  const kindCounts: Record<RepositoryFileKind, number> = { source: 0, manifest: 0, asset: 0, unknown: 0 };
  let textBacked = 0;
  for (const file of model.snapshot.files) {
    kindCounts[fileKind(file)] += 1;
    if (file.text !== undefined) textBacked += 1;
  }
  const coverage: RepositoryCoverageLedger = Object.freeze({
    schema_version: 1,
    repository_files: Object.freeze({
      total: model.snapshot.files.length,
      text_backed: textBacked,
      modeled: model.fileFacts.length,
      unmodeled: Math.max(0, model.snapshot.files.length - model.fileFacts.length),
      by_kind: Object.freeze({ ...kindCounts })
    }),
    repository_model: Object.freeze({
      file_fact_records: model.fileFacts.length,
      symbols_indexed: model.symbols.length,
      dependency_edges: model.dependencies.length,
      unresolved_dependencies: model.unresolvedDependencies.length,
      effects_indexed: model.effects.length,
      state_records: model.states.length
    }),
    atlas_projection: Object.freeze({
      complete: atlas.complete,
      total_node_count: atlas.total_node_count,
      returned_node_count: atlas.returned_node_count,
      omitted_node_count: atlas.omitted_node_count,
      max_nodes: atlas.max_nodes
    })
  });

  return Object.freeze({ atlas, coverage });
}
