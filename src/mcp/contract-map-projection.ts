import type { ContractMap, ContractRecord } from "../repository/contract-types.js";
import { emptyContractMap } from "../repository/contract-types.js";

const MAX_RETURNED_CONTRACTS = 12;
const MAX_CONSUMERS = 8;
const MAX_VALUES = 8;
const MAX_EVIDENCE = 6;
const MAX_FAILURES = 4;
const MAX_UNRESOLVED = 8;
const MAX_CONFLICTS = 8;
const MAX_TEXT = 240;

const STOP_WORDS = new Set(["the", "and", "for", "from", "into", "with", "that", "this", "make", "change", "implement", "feature"]);

function bounded(value: string): string {
  return value.length <= MAX_TEXT ? value : `${value.slice(0, MAX_TEXT)}…`;
}

function terms(value: string): readonly string[] {
  return Object.freeze([...new Set(value.toLowerCase().split(/[^a-z0-9_$./-]+/).filter(term => term.length >= 3 && !STOP_WORDS.has(term)))]);
}

function searchText(contract: ContractRecord): string {
  return [
    contract.name,
    contract.kind,
    contract.provider?.file,
    contract.provider?.symbol,
    ...contract.consumers.flatMap(consumer => [consumer.file, consumer.symbol]),
    ...contract.nativeContractRefs,
    ...contract.evidence.map(item => item.summary)
  ].filter((value): value is string => Boolean(value)).join(" ").toLowerCase();
}

function score(contract: ContractRecord, objectiveTerms: readonly string[], corridorPaths: ReadonlySet<string>): number {
  const haystack = searchText(contract);
  let value = 1;
  if (contract.reconciliation === "native-conflict") value += 1000;
  else if (contract.provider === null && contract.reconciliation !== "native-supplemented") value += 200;
  if (contract.provider && corridorPaths.has(contract.provider.file)) value += 300;
  value += contract.consumers.filter(consumer => corridorPaths.has(consumer.file)).length * 100;
  value += objectiveTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 10 : 0), 0);
  if (contract.verification === "native-authoritative") value += 20;
  return value;
}

function projectContract(contract: ContractRecord): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: contract.id,
    kind: contract.kind,
    name: bounded(contract.name),
    provider: contract.provider ? Object.freeze({ ...contract.provider }) : null,
    consumers: Object.freeze(contract.consumers.slice(0, MAX_CONSUMERS).map(consumer => Object.freeze({ ...consumer }))),
    consumer_count: contract.consumers.length,
    consumers_truncated: contract.consumers.length > MAX_CONSUMERS,
    inputs: Object.freeze(contract.inputs.slice(0, MAX_VALUES).map(value => Object.freeze({ ...value, ...(value.type ? { type: bounded(value.type) } : {}) }))),
    outputs: Object.freeze(contract.outputs.slice(0, MAX_VALUES).map(value => Object.freeze({ ...value, ...(value.type ? { type: bounded(value.type) } : {}) }))),
    failures: Object.freeze(contract.failures.slice(0, MAX_FAILURES).map(failure => Object.freeze({ ...failure, summary: bounded(failure.summary) }))),
    confidence: contract.confidence,
    verification: contract.verification,
    reconciliation: contract.reconciliation,
    native_contract_refs: Object.freeze(contract.nativeContractRefs.slice(0, MAX_VALUES)),
    candidate_providers: Object.freeze(contract.candidateProviders.slice(0, MAX_CONSUMERS).map(provider => Object.freeze({ ...provider }))),
    evidence: Object.freeze(contract.evidence.slice(0, MAX_EVIDENCE).map(item => Object.freeze({
      kind: item.kind,
      file: item.file,
      line: item.line,
      summary: bounded(item.summary)
    }))),
    evidence_count: contract.evidence.length,
    evidence_truncated: contract.evidence.length > MAX_EVIDENCE
  });
}

export function projectContractMap(
  map: ContractMap | null | undefined,
  objective: string,
  corridorPaths: readonly string[] = []
): Readonly<Record<string, unknown>> {
  const resolved = map ?? emptyContractMap();
  const objectiveTerms = terms(objective);
  const corridor = new Set(corridorPaths);
  const ranked = resolved.contracts
    .map((contract, index) => ({ contract, index, score: score(contract, objectiveTerms, corridor) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = ranked.slice(0, MAX_RETURNED_CONTRACTS).map(row => projectContract(row.contract));
  const allUnresolved = resolved.contracts.filter(contract => contract.provider === null && contract.reconciliation !== "native-supplemented");
  const unresolved = allUnresolved
    .slice(0, MAX_UNRESOLVED)
    .map(contract => Object.freeze({
      id: contract.id,
      name: bounded(contract.name),
      kind: contract.kind,
      candidate_providers: Object.freeze(contract.candidateProviders.slice(0, MAX_CONSUMERS).map(provider => Object.freeze({ ...provider }))),
      failures: Object.freeze(contract.failures.slice(0, MAX_FAILURES).map(failure => bounded(failure.summary)))
    }));
  const allConflicts = resolved.contracts.filter(contract => contract.reconciliation === "native-conflict");
  const conflicts = allConflicts
    .slice(0, MAX_CONFLICTS)
    .map(contract => Object.freeze({
      id: contract.id,
      name: bounded(contract.name),
      native_contract_refs: Object.freeze([...contract.nativeContractRefs]),
      failures: Object.freeze(contract.failures.filter(failure => failure.kind === "native-conflict").slice(0, MAX_FAILURES).map(failure => bounded(failure.summary)))
    }));
  return Object.freeze({
    schema_version: 1,
    summary: Object.freeze({
      contract_count: resolved.contracts.length,
      returned_contract_count: selected.length,
      resolved_contract_count: resolved.coverage.resolvedContracts,
      unresolved_contract_count: allUnresolved.length,
      returned_unresolved_contract_count: unresolved.length,
      native_confirmed_count: resolved.coverage.nativeConfirmed,
      native_supplemented_count: resolved.coverage.nativeSupplemented,
      native_conflict_count: resolved.coverage.nativeConflicts,
      returned_native_conflict_count: conflicts.length
    }),
    coverage: Object.freeze({ ...resolved.coverage }),
    truncated: selected.length < resolved.contracts.length,
    contracts: Object.freeze(selected),
    unresolved: Object.freeze(unresolved),
    unresolved_truncated: unresolved.length < allUnresolved.length,
    conflicts: Object.freeze(conflicts),
    conflicts_truncated: conflicts.length < allConflicts.length
  });
}
