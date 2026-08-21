import type { DependencyEdge, FileFacts, RepositoryModel, UnresolvedDependency } from "./model.js";
import { resolveImportPath } from "./path-resolution.js";
import { createRepositorySourceProfile, isProfileSourcePath, type RepositorySourceProfile } from "./source-profile.js";
import { parseSourceFile } from "./source-parser.js";
import type { RepositorySnapshot } from "./snapshot.js";
import { linkContractMap } from "./contract-linker.js";

export interface RepositoryModelBuildOptions {
  readonly profile?: RepositorySourceProfile;
}

export function buildRepositoryModel(snapshot: RepositorySnapshot, options: RepositoryModelBuildOptions = {}): RepositoryModel {
  const profile = options.profile ?? createRepositorySourceProfile();
  const repositoryPaths = new Set(snapshot.files.map(file => file.path));
  const fileFacts: FileFacts[] = [];
  const dependencies: DependencyEdge[] = [];
  const unresolvedDependencies: UnresolvedDependency[] = [];

  for (const file of snapshot.files) {
    if (file.text === undefined || !isProfileSourcePath(profile, file.path)) continue;
    const facts = parseSourceFile(file.path, file.text);
    fileFacts.push(facts);
    for (const reference of facts.dependencies) {
      const resolution = resolveImportPath(file.path, reference.specifier, repositoryPaths);
      if (resolution.resolvedPath) {
        dependencies.push({ ...reference, from: file.path, to: resolution.resolvedPath });
      } else {
        unresolvedDependencies.push({ ...reference, external: resolution.external, candidates: resolution.candidates });
      }
    }
  }

  const symbols = fileFacts.flatMap(facts => facts.symbols).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name));
  const effects = fileFacts.flatMap(facts => facts.effects).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));
  const runtimeNodes = fileFacts.flatMap(facts => facts.runtimeNodes ?? []).sort((a, b) => a.file.localeCompare(b.file) || a.lineStart - b.lineStart || a.id.localeCompare(b.id));
  const runtimeEdges = fileFacts.flatMap(facts => facts.runtimeEdges ?? []).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.id.localeCompare(b.id));
  const states = fileFacts.flatMap(facts => facts.states).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || `${a.namespace}.${a.key}`.localeCompare(`${b.namespace}.${b.key}`));
  const dataflowNodes = fileFacts.flatMap(facts => facts.dataflow?.nodes ?? []).sort((a, b) => a.file.localeCompare(b.file) || a.lineStart - b.lineStart || a.id.localeCompare(b.id));
  const dataflowEdges = fileFacts.flatMap(facts => facts.dataflow?.edges ?? []).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.id.localeCompare(b.id));
  const dataflowGaps = fileFacts.flatMap(facts => facts.dataflow?.gaps ?? []).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.id.localeCompare(b.id));
  dependencies.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));
  unresolvedDependencies.sort((a, b) => a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier) || a.kind.localeCompare(b.kind));
  const contractMap = linkContractMap(fileFacts, dependencies, unresolvedDependencies, states);

  return Object.freeze({
    snapshot,
    fileFacts: Object.freeze(fileFacts),
    dependencies: Object.freeze(dependencies),
    unresolvedDependencies: Object.freeze(unresolvedDependencies),
    symbols: Object.freeze(symbols),
    effects: Object.freeze(effects),
    runtimeNodes: Object.freeze(runtimeNodes),
    runtimeEdges: Object.freeze(runtimeEdges),
    states: Object.freeze(states),
    contractMap,
    dataflowNodes: Object.freeze(dataflowNodes),
    dataflowEdges: Object.freeze(dataflowEdges),
    dataflowGaps: Object.freeze(dataflowGaps)
  });
}
