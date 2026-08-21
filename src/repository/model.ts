import type { RepositorySnapshot } from "./snapshot.js";
import type { ContractFileFacts, ContractMap } from "./contract-types.js";
import { emptyContractMap } from "./contract-types.js";
import type { EffectRuntimeEdge, EffectRuntimeNode } from "./effect-runtime-types.js";

export type DependencyKind = "import" | "side-effect-import" | "export-from" | "dynamic-import" | "require" | "style-import" | "template-reference" | "manifest-reference";

export interface DependencyReference {
  readonly file: string;
  readonly specifier: string;
  readonly kind: DependencyKind;
  readonly line: number;
}

export interface DependencyEdge extends DependencyReference {
  readonly from: string;
  readonly to: string;
}

export interface UnresolvedDependency extends DependencyReference {
  readonly external: boolean;
  readonly candidates: readonly string[];
}

export interface SymbolRecord {
  readonly name: string;
  readonly file: string;
  readonly kind: "function" | "class" | "variable";
  readonly exported: boolean;
  readonly line: number;
}

export interface EffectRecord {
  readonly file: string;
  readonly kind: string;
  readonly detail: string;
  readonly line: number;
  readonly symbol: string;
}

export interface StateRecord {
  readonly namespace: string;
  readonly key: string;
  readonly file: string;
  readonly kind: "foundry-flag" | "foundry-setting" | "web-storage" | "public-global" | "flag-path";
  readonly operation: string;
  readonly access: "read" | "write" | "delete" | "unknown";
  readonly namespaceResolved: boolean;
  readonly keyResolved: boolean;
  readonly line: number;
}

export interface FileFacts {
  readonly file: string;
  readonly dependencies: readonly DependencyReference[];
  readonly symbols: readonly SymbolRecord[];
  readonly effects: readonly EffectRecord[];
  readonly runtimeNodes?: readonly EffectRuntimeNode[];
  readonly runtimeEdges?: readonly EffectRuntimeEdge[];
  readonly states: readonly StateRecord[];
  readonly contractSites?: ContractFileFacts;
}

export interface RepositoryModel {
  readonly snapshot: RepositorySnapshot;
  readonly fileFacts: readonly FileFacts[];
  readonly dependencies: readonly DependencyEdge[];
  readonly unresolvedDependencies: readonly UnresolvedDependency[];
  readonly symbols: readonly SymbolRecord[];
  readonly effects: readonly EffectRecord[];
  readonly runtimeNodes?: readonly EffectRuntimeNode[];
  readonly runtimeEdges?: readonly EffectRuntimeEdge[];
  readonly states: readonly StateRecord[];
  readonly contractMap?: ContractMap;
}

export const emptyModel = (snapshot: RepositorySnapshot): RepositoryModel => Object.freeze({
  snapshot,
  fileFacts: Object.freeze([]),
  dependencies: Object.freeze([]),
  unresolvedDependencies: Object.freeze([]),
  symbols: Object.freeze([]),
  effects: Object.freeze([]),
  runtimeNodes: Object.freeze([]),
  runtimeEdges: Object.freeze([]),
  states: Object.freeze([]),
  contractMap: emptyContractMap()
});
