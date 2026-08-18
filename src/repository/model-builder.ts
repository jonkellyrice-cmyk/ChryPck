import type { DependencyEdge, FileFacts, RepositoryModel, UnresolvedDependency } from "./model.js";
import { resolveImportPath } from "./path-resolution.js";
import { createRepositorySourceProfile, isProfileSourcePath, type RepositorySourceProfile } from "./source-profile.js";
import { parseSourceFile } from "./source-parser.js";
import type { RepositorySnapshot } from "./snapshot.js";

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
  const states = fileFacts.flatMap(facts => facts.states).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || `${a.namespace}.${a.key}`.localeCompare(`${b.namespace}.${b.key}`));
  dependencies.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));
  unresolvedDependencies.sort((a, b) => a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier) || a.kind.localeCompare(b.kind));

  return Object.freeze({
    snapshot,
    fileFacts: Object.freeze(fileFacts),
    dependencies: Object.freeze(dependencies),
    unresolvedDependencies: Object.freeze(unresolvedDependencies),
    symbols: Object.freeze(symbols),
    effects: Object.freeze(effects),
    states: Object.freeze(states)
  });
}
