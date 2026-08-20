import { createHash } from "node:crypto";
import type {
  ContractEndpoint,
  ContractMap,
  ContractRecord,
  ContractReconciliation
} from "../repository/contract-types.js";
import { emptyContractMap } from "../repository/contract-types.js";

export interface NativeContractCatalogRecord {
  readonly id: string;
  readonly source: string;
  readonly data: unknown;
}

type JsonRecord = Record<string, unknown>;

interface NativeContractEntry {
  readonly catalogId: string;
  readonly catalogSource: string;
  readonly index: number;
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly summary: string;
  readonly keywords: readonly string[];
  readonly consumers: readonly string[];
  readonly evidencePaths: readonly string[];
  readonly evidenceSymbols: readonly string[];
  readonly raw: JsonRecord;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function strings(value: unknown): readonly string[] {
  return Object.freeze(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []);
}

function bounded(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : fallback;
}

function entries(records: readonly NativeContractCatalogRecord[]): readonly NativeContractEntry[] {
  return Object.freeze(records.flatMap(record => {
    const data = asRecord(record.data);
    const contracts = Array.isArray(data?.contracts)
      ? data.contracts.map(asRecord).filter((contract): contract is JsonRecord => contract !== null)
      : [];
    return contracts.map((contract, index) => {
      const boundary = asRecord(contract.boundary);
      const evidence = Array.isArray(contract.evidence)
        ? contract.evidence.map(asRecord).filter((row): row is JsonRecord => row !== null)
        : [];
      return Object.freeze({
        catalogId: record.id,
        catalogSource: record.source,
        index,
        id: bounded(contract.id, `${record.id}#${index + 1}`),
        title: bounded(contract.title, bounded(contract.id, `Native Contract ${index + 1}`)),
        kind: bounded(contract.contract_kind, "native-contract"),
        summary: bounded(contract.summary, "Authoritative project Native Contract."),
        keywords: strings(contract.keywords),
        consumers: strings(boundary?.frame_conn_consumers),
        evidencePaths: Object.freeze(evidence.map(row => row.source_path).filter((value): value is string => typeof value === "string")),
        evidenceSymbols: Object.freeze(evidence.map(row => row.symbol).filter((value): value is string => typeof value === "string")),
        raw: contract
      });
    });
  }));
}

function nativeKey(native: NativeContractEntry): string {
  return `${native.catalogId}:${native.index}:${native.id}`;
}

function endpoints(record: ContractRecord): readonly ContractEndpoint[] {
  return Object.freeze([...(record.provider ? [record.provider] : []), ...record.consumers]);
}

function normalizedTerms(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values
    .flatMap(value => value.toLowerCase().split(/[^a-z0-9_$.-]+/))
    .filter(value => value.length >= 3))]);
}

function matchScore(record: ContractRecord, native: NativeContractEntry): number {
  const contractEndpoints = endpoints(record);
  const pathMatch = contractEndpoints.some(endpoint => native.consumers.includes(endpoint.file) || native.evidencePaths.includes(endpoint.file));
  const symbolMatch = contractEndpoints.some(endpoint => native.evidenceSymbols.some(symbol => symbol === endpoint.symbol || symbol.endsWith(`.${endpoint.symbol}`)));
  const recordTerms = normalizedTerms([record.name, ...contractEndpoints.map(endpoint => endpoint.symbol)]);
  const nativeTerms = new Set(normalizedTerms([native.title, native.summary, native.kind, ...native.keywords, ...native.evidenceSymbols]));
  const termMatches = recordTerms.filter(term => nativeTerms.has(term)).length;
  if (!symbolMatch && !(pathMatch && termMatches > 0)) return 0;
  return (symbolMatch ? 100 : 0) + (pathMatch ? 40 : 0) + Math.min(30, termMatches * 5);
}

function signature(native: NativeContractEntry): JsonRecord | null {
  return asRecord(native.raw.signature);
}

function explicitConflict(record: ContractRecord, native: NativeContractEntry): string | null {
  const declared = signature(native);
  if (!declared) return null;
  const parameterCount = typeof declared.parameter_count === "number"
    ? declared.parameter_count
    : Array.isArray(declared.parameters) ? declared.parameters.length : null;
  if (parameterCount !== null && parameterCount !== record.inputs.length) {
    return `Native Contract ${native.id} requires ${parameterCount} parameter(s); repository evidence exposes ${record.inputs.length}.`;
  }
  if (typeof declared.return_type === "string" && record.outputs[0]?.type && declared.return_type !== record.outputs[0].type) {
    return `Native Contract ${native.id} requires return type ${declared.return_type}; repository evidence exposes ${record.outputs[0].type}.`;
  }
  if (typeof declared.provider_symbol === "string" && record.provider && declared.provider_symbol !== record.provider.symbol) {
    return `Native Contract ${native.id} requires provider ${declared.provider_symbol}; repository evidence resolves ${record.provider.symbol}.`;
  }
  return null;
}

function reconcileRecord(record: ContractRecord, matches: readonly NativeContractEntry[]): ContractRecord {
  if (!matches.length) return record;
  const conflicts = matches.map(native => explicitConflict(record, native)).filter((value): value is string => value !== null);
  const reconciliation: ContractReconciliation = conflicts.length ? "native-conflict" : "native-confirmed";
  return Object.freeze({
    ...record,
    reconciliation,
    verification: conflicts.length ? record.verification : "native-authoritative",
    nativeContractRefs: Object.freeze(matches.map(native => native.id).sort()),
    failures: conflicts.length
      ? Object.freeze([...record.failures, ...conflicts.map(summary => Object.freeze({ kind: "native-conflict" as const, summary }))])
      : record.failures,
    evidence: Object.freeze([
      ...record.evidence,
      ...matches.map(native => Object.freeze({
        kind: "native-contract" as const,
        file: native.catalogSource,
        line: 1,
        summary: `${native.id}: ${native.summary}`
      }))
    ])
  });
}

function supplementalRecord(native: NativeContractEntry): ContractRecord {
  const consumers = native.consumers.map(path => Object.freeze({ file: path, symbol: "<native-contract-consumer>", line: 1, role: "consumer" as const }));
  return Object.freeze({
    id: `contract:native:${createHash("sha256").update(`${native.catalogId}:${native.id}`).digest("hex").slice(0, 16)}`,
    kind: "external-api",
    name: native.title,
    provider: null,
    consumers: Object.freeze(consumers),
    inputs: Object.freeze([]), outputs: Object.freeze([]),
    preconditions: Object.freeze([]), postconditions: Object.freeze([]), failures: Object.freeze([]),
    evidence: Object.freeze([Object.freeze({
      kind: "native-contract" as const,
      file: native.catalogSource,
      line: 1,
      summary: `${native.id}: ${native.summary}`
    })]),
    confidence: "high",
    verification: "native-authoritative",
    nativeContractRefs: Object.freeze([native.id]),
    reconciliation: "native-supplemented",
    candidateProviders: Object.freeze([])
  });
}

export function reconcileContractMap(
  map: ContractMap | undefined,
  catalogs: readonly NativeContractCatalogRecord[]
): ContractMap {
  const base = map ?? emptyContractMap();
  const nativeEntries = entries(catalogs);
  if (!nativeEntries.length) return base;
  const matchedNative = new Set<string>();
  const reconciled = base.contracts.map(record => {
    const matches = nativeEntries
      .map(native => ({ native, score: matchScore(record, native) }))
      .filter(row => row.score > 0)
      .sort((left, right) => right.score - left.score || left.native.id.localeCompare(right.native.id))
      .map(row => row.native);
    for (const native of matches) matchedNative.add(nativeKey(native));
    return reconcileRecord(record, matches);
  });
  const supplemented = nativeEntries.filter(native => !matchedNative.has(nativeKey(native))).map(supplementalRecord);
  const contracts = [...reconciled, ...supplemented]
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  return Object.freeze({
    schemaVersion: 1,
    contracts: Object.freeze(contracts),
    coverage: Object.freeze({
      ...base.coverage,
      nativeConfirmed: contracts.filter(contract => contract.reconciliation === "native-confirmed").length,
      nativeSupplemented: contracts.filter(contract => contract.reconciliation === "native-supplemented").length,
      nativeConflicts: contracts.filter(contract => contract.reconciliation === "native-conflict").length
    }),
    gaps: base.gaps
  });
}
