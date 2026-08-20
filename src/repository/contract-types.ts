export type ContractKind =
  | "exported-api"
  | "function-call"
  | "callback"
  | "event"
  | "lifecycle"
  | "state"
  | "serialization"
  | "external-api";

export type ContractEndpointRole = "provider" | "consumer" | "producer" | "listener" | "reader" | "writer" | "deleter";

export interface ContractValue {
  readonly name: string;
  readonly type: string | null;
  readonly optional: boolean;
  readonly rest: boolean;
}

export interface ContractDeclarationSite {
  readonly file: string;
  readonly name: string;
  readonly kind: "function" | "method" | "class" | "variable";
  readonly exported: boolean;
  readonly defaultExport: boolean;
  readonly async: boolean;
  readonly inputs: readonly ContractValue[];
  readonly output: string | null;
  readonly line: number;
}

export interface ContractImportBinding {
  readonly file: string;
  readonly localName: string;
  readonly importedName: string;
  readonly specifier: string;
  readonly line: number;
}

export interface ContractCallSite {
  readonly file: string;
  readonly caller: string;
  readonly target: string;
  readonly argumentCount: number;
  readonly callbackArguments: readonly string[];
  readonly constructed: boolean;
  readonly line: number;
}

export interface ContractEventSite {
  readonly file: string;
  readonly owner: string;
  readonly operation: "on" | "once" | "off" | "call" | "callAll";
  readonly role: "producer" | "listener";
  readonly eventName: string;
  readonly eventNameResolved: boolean;
  readonly payloadCount: number;
  readonly handler: string | null;
  readonly line: number;
}

export interface ContractParseGap {
  readonly file: string;
  readonly line: number;
  readonly summary: string;
}

export interface ContractFileFacts {
  readonly declarations: readonly ContractDeclarationSite[];
  readonly imports: readonly ContractImportBinding[];
  readonly calls: readonly ContractCallSite[];
  readonly events: readonly ContractEventSite[];
  readonly gaps: readonly ContractParseGap[];
}

export interface ContractEndpoint {
  readonly file: string;
  readonly symbol: string;
  readonly line: number;
  readonly role: ContractEndpointRole;
}

export interface ContractCondition {
  readonly kind: "precondition" | "postcondition";
  readonly summary: string;
  readonly evidence: string;
}

export interface ContractFailure {
  readonly kind: "throw" | "rejection" | "unresolved" | "native-conflict";
  readonly summary: string;
}

export interface ContractEvidence {
  readonly kind: "declaration" | "import" | "call" | "event" | "state" | "native-contract";
  readonly file: string;
  readonly line: number;
  readonly summary: string;
}

export type ContractConfidence = "high" | "medium" | "low";
export type ContractVerification = "syntax" | "resolved" | "native-authoritative";
export type ContractReconciliation = "repository-only" | "native-confirmed" | "native-supplemented" | "native-conflict";

export interface ContractRecord {
  readonly id: string;
  readonly kind: ContractKind;
  readonly name: string;
  readonly provider: ContractEndpoint | null;
  readonly consumers: readonly ContractEndpoint[];
  readonly inputs: readonly ContractValue[];
  readonly outputs: readonly ContractValue[];
  readonly preconditions: readonly ContractCondition[];
  readonly postconditions: readonly ContractCondition[];
  readonly failures: readonly ContractFailure[];
  readonly evidence: readonly ContractEvidence[];
  readonly confidence: ContractConfidence;
  readonly verification: ContractVerification;
  readonly nativeContractRefs: readonly string[];
  readonly reconciliation: ContractReconciliation;
  readonly candidateProviders: readonly ContractEndpoint[];
}

export interface ContractCoverage {
  readonly candidateSites: number;
  readonly resolvedContracts: number;
  readonly unresolvedSites: number;
  readonly ambiguousSites: number;
  readonly externalSites: number;
  readonly nativeConfirmed: number;
  readonly nativeSupplemented: number;
  readonly nativeConflicts: number;
}

export interface ContractMap {
  readonly schemaVersion: 1;
  readonly contracts: readonly ContractRecord[];
  readonly coverage: ContractCoverage;
  readonly gaps: readonly ContractParseGap[];
}

export const emptyContractFileFacts = (): ContractFileFacts => Object.freeze({
  declarations: Object.freeze([]),
  imports: Object.freeze([]),
  calls: Object.freeze([]),
  events: Object.freeze([]),
  gaps: Object.freeze([])
});

export const emptyContractMap = (): ContractMap => Object.freeze({
  schemaVersion: 1,
  contracts: Object.freeze([]),
  coverage: Object.freeze({
    candidateSites: 0,
    resolvedContracts: 0,
    unresolvedSites: 0,
    ambiguousSites: 0,
    externalSites: 0,
    nativeConfirmed: 0,
    nativeSupplemented: 0,
    nativeConflicts: 0
  }),
  gaps: Object.freeze([])
});
