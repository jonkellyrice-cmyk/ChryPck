import type { DependencyEdge, EffectRecord, FileFacts, RepositoryModel, StateRecord, SymbolRecord, UnresolvedDependency } from "./model.js";
import type { RepositoryFile } from "./snapshot.js";
import type { ContractRecord } from "./contract-types.js";
import type { EffectRuntimeEdge, EffectRuntimeNode } from "./effect-runtime-types.js";
import type { DataflowEdge, DataflowNode } from "./dataflow-types.js";

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
  readonly runtimeNodesById: ReadonlyMap<string, EffectRuntimeNode>;
  readonly runtimeNodesByKind: ReadonlyMap<string, readonly EffectRuntimeNode[]>;
  readonly runtimeNodesByEffectKind: ReadonlyMap<string, readonly EffectRuntimeNode[]>;
  readonly runtimeNodesByFile: ReadonlyMap<string, readonly EffectRuntimeNode[]>;
  readonly runtimeOutgoingEdges: ReadonlyMap<string, readonly EffectRuntimeEdge[]>;
  readonly runtimeIncomingEdges: ReadonlyMap<string, readonly EffectRuntimeEdge[]>;
  readonly statesByNamespace: ReadonlyMap<string, readonly StateRecord[]>;
  readonly contractsById: ReadonlyMap<string, ContractRecord>;
  readonly contractsByProviderFile: ReadonlyMap<string, readonly ContractRecord[]>;
  readonly contractsByConsumerFile: ReadonlyMap<string, readonly ContractRecord[]>;
  readonly dataflowNodesById: ReadonlyMap<string, DataflowNode>;
  readonly dataflowNodesByFile: ReadonlyMap<string, readonly DataflowNode[]>;
  readonly dataflowOutgoingEdges: ReadonlyMap<string, readonly DataflowEdge[]>;
  readonly dataflowIncomingEdges: ReadonlyMap<string, readonly DataflowEdge[]>;
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
  const runtimeByKind = new Map<string, EffectRuntimeNode[]>();
  const runtimeByEffectKind = new Map<string, EffectRuntimeNode[]>();
  const runtimeByFile = new Map<string, EffectRuntimeNode[]>();
  const runtimeOutgoing = new Map<string, EffectRuntimeEdge[]>();
  const runtimeIncoming = new Map<string, EffectRuntimeEdge[]>();
  const contractsByProvider = new Map<string, ContractRecord[]>();
  const contractsByConsumer = new Map<string, ContractRecord[]>();
  const dataflowByFile = new Map<string, DataflowNode[]>();
  const dataflowOutgoing = new Map<string, DataflowEdge[]>();
  const dataflowIncoming = new Map<string, DataflowEdge[]>();

  for (const symbol of model.symbols) append(symbols, symbol.name, symbol);
  for (const edge of model.dependencies) { append(outgoing, edge.from, edge); append(incoming, edge.to, edge); }
  for (const reference of model.unresolvedDependencies) append(unresolved, reference.file, reference);
  for (const effect of model.effects) append(effects, effect.kind, effect);
  for (const node of model.runtimeNodes ?? []) {
    append(runtimeByKind, node.kind, node);
    append(runtimeByEffectKind, node.effectKind, node);
    append(runtimeByFile, node.file, node);
  }
  for (const edge of model.runtimeEdges ?? []) {
    append(runtimeOutgoing, edge.from, edge);
    append(runtimeIncoming, edge.to, edge);
  }
  for (const state of model.states) append(states, state.namespace, state);
  for (const contract of model.contractMap?.contracts ?? []) {
    if (contract.provider) append(contractsByProvider, contract.provider.file, contract);
    for (const consumer of contract.consumers) append(contractsByConsumer, consumer.file, contract);
  }
  for (const node of model.dataflowNodes ?? []) append(dataflowByFile, node.file, node);
  for (const edge of model.dataflowEdges ?? []) {
    append(dataflowOutgoing, edge.from, edge);
    append(dataflowIncoming, edge.to, edge);
  }

  return Object.freeze({
    files,
    factsByFile,
    symbolsByName: freezeMapArrays(symbols),
    outgoingDependencies: freezeMapArrays(outgoing),
    incomingDependencies: freezeMapArrays(incoming),
    unresolvedByFile: freezeMapArrays(unresolved),
    effectsByKind: freezeMapArrays(effects),
    runtimeNodesById: new Map((model.runtimeNodes ?? []).map(node => [node.id, node] as const)),
    runtimeNodesByKind: freezeMapArrays(runtimeByKind),
    runtimeNodesByEffectKind: freezeMapArrays(runtimeByEffectKind),
    runtimeNodesByFile: freezeMapArrays(runtimeByFile),
    runtimeOutgoingEdges: freezeMapArrays(runtimeOutgoing),
    runtimeIncomingEdges: freezeMapArrays(runtimeIncoming),
    statesByNamespace: freezeMapArrays(states),
    contractsById: new Map((model.contractMap?.contracts ?? []).map(contract => [contract.id, contract] as const)),
    contractsByProviderFile: freezeMapArrays(contractsByProvider),
    contractsByConsumerFile: freezeMapArrays(contractsByConsumer),
    dataflowNodesById: new Map((model.dataflowNodes ?? []).map(node => [node.id, node] as const)),
    dataflowNodesByFile: freezeMapArrays(dataflowByFile),
    dataflowOutgoingEdges: freezeMapArrays(dataflowOutgoing),
    dataflowIncomingEdges: freezeMapArrays(dataflowIncoming)
  });
}
