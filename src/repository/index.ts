import type { DependencyEdge, EffectRecord, FileFacts, RepositoryModel, StateRecord, SymbolRecord, UnresolvedDependency } from "./model.js";
import type { RepositoryFile } from "./snapshot.js";

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function freezeMapArrays<K, V>(source: Map<K, V[]>): ReadonlyMap<K, readonly V[]> {
  return new Map([...source].map(([key, values]) => [key, Object.freeze([...values])] as const));
}

export interface RepositoryIndex {
  readonly files: ReadonlyMap<string, RepositoryFile>;
  readonly factsByFile: ReadonlyMap<string, FileFacts>;
  readonly symbolsByName: ReadonlyMap<string, readonly SymbolRecord[]>;
  readonly outgoingDependencies: ReadonlyMap<string, readonly DependencyEdge[]>;
  readonly incomingDependencies: ReadonlyMap<string, readonly DependencyEdge[]>;
  readonly unresolvedByFile: ReadonlyMap<string, readonly UnresolvedDependency[]>;
  readonly effectsByKind: ReadonlyMap<string, readonly EffectRecord[]>;
  readonly statesByNamespace: ReadonlyMap<string, readonly StateRecord[]>;
}

export function buildIndex(model: RepositoryModel): RepositoryIndex {
  const files = new Map(model.snapshot.files.map(file => [file.path, file] as const));
  const factsByFile = new Map(model.fileFacts.map(facts => [facts.file, facts] as const));
  const symbols = new Map<string, SymbolRecord[]>();
  const outgoing = new Map<string, DependencyEdge[]>();
  const incoming = new Map<string, DependencyEdge[]>();
  const unresolved = new Map<string, UnresolvedDependency[]>();
  const effects = new Map<string, EffectRecord[]>();
  const states = new Map<string, StateRecord[]>();

  for (const symbol of model.symbols) append(symbols, symbol.name, symbol);
  for (const edge of model.dependencies) { append(outgoing, edge.from, edge); append(incoming, edge.to, edge); }
  for (const reference of model.unresolvedDependencies) append(unresolved, reference.file, reference);
  for (const effect of model.effects) append(effects, effect.kind, effect);
  for (const state of model.states) append(states, state.namespace, state);

  return Object.freeze({
    files,
    factsByFile,
    symbolsByName: freezeMapArrays(symbols),
    outgoingDependencies: freezeMapArrays(outgoing),
    incomingDependencies: freezeMapArrays(incoming),
    unresolvedByFile: freezeMapArrays(unresolved),
    effectsByKind: freezeMapArrays(effects),
    statesByNamespace: freezeMapArrays(states)
  });
}
