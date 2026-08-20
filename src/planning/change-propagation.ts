import type { RepositoryModel } from "../repository/model.js";
import type { PatchCorridor } from "./patch-corridor.js";
import type { ContractMap, ContractRecord } from "../repository/contract-types.js";

export interface ProposedChange { readonly path: string; readonly before: string | null; readonly after: string | null; }

export interface ContractDelta {
  readonly path: string;
  readonly kind: "export-added" | "export-removed" | "export-kind-changed";
  readonly symbol: string;
  readonly breaking: boolean;
}

export interface ChangePropagationReport {
  readonly certified: boolean;
  readonly changedPaths: readonly string[];
  readonly immediateConsumers: readonly string[];
  readonly transitiveConsumers: readonly string[];
  readonly outsideCorridorConsumers: readonly string[];
  readonly contractDeltas: readonly ContractDelta[];
  readonly verificationTargets: readonly string[];
  readonly impactedContractIds: readonly string[];
  readonly contractConsumers: readonly string[];
  readonly nativeConflictIds: readonly string[];
  readonly gaps: readonly string[];
}

function impactedContracts(changed: ReadonlySet<string>, map?: ContractMap): readonly ContractRecord[] {
  return (map?.contracts ?? []).filter(contract =>
    contract.provider !== null && changed.has(contract.provider.file)
    || contract.consumers.some(endpoint => changed.has(endpoint.file))
  );
}

function exportedDeclarations(source: string): ReadonlyMap<string, string> {
  const output = new Map<string, string>();
  const patterns: readonly [string, RegExp][] = [
    ["function", /\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g],
    ["class", /\bexport\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g],
    ["variable", /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g],
    ["interface", /\bexport\s+interface\s+([A-Za-z_$][\w$]*)/g],
    ["type", /\bexport\s+type\s+([A-Za-z_$][\w$]*)/g]
  ];
  for (const [kind, pattern] of patterns) for (const match of source.matchAll(pattern)) if (match[1]) output.set(match[1], kind);
  return output;
}

function contractDeltas(change: ProposedChange): ContractDelta[] {
  const before = exportedDeclarations(change.before ?? "");
  const after = exportedDeclarations(change.after ?? "");
  const output: ContractDelta[] = [];
  for (const symbol of new Set([...before.keys(), ...after.keys()])) {
    const oldKind = before.get(symbol), newKind = after.get(symbol);
    if (!oldKind && newKind) output.push({ path: change.path, kind: "export-added", symbol, breaking: false });
    else if (oldKind && !newKind) output.push({ path: change.path, kind: "export-removed", symbol, breaking: true });
    else if (oldKind && newKind && oldKind !== newKind) output.push({ path: change.path, kind: "export-kind-changed", symbol, breaking: true });
  }
  return output;
}

function transitiveConsumers(model: RepositoryModel, roots: ReadonlySet<string>): string[] {
  const incoming = new Map<string, string[]>();
  for (const edge of model.dependencies) {
    const values = incoming.get(edge.to) ?? [];
    values.push(edge.from); incoming.set(edge.to, values);
  }
  const queue = [...roots];
  const seen = new Set<string>();
  while (queue.length) {
    const provider = queue.shift();
    if (!provider) continue;
    for (const consumer of incoming.get(provider) ?? []) if (!roots.has(consumer) && !seen.has(consumer)) { seen.add(consumer); queue.push(consumer); }
  }
  return [...seen].sort();
}

export function assessPropagation(changes: readonly ProposedChange[], model: RepositoryModel, corridor?: PatchCorridor): ChangePropagationReport {
  const changed = new Set(changes.map(change => change.path));
  const immediate = [...new Set(model.dependencies.filter(edge => changed.has(edge.to) && !changed.has(edge.from)).map(edge => edge.from))].sort();
  const transitive = transitiveConsumers(model, changed);
  const corridorPaths = new Set(corridor?.files.map(file => file.path) ?? []);
  const outside = corridor ? transitive.filter(path => !corridorPaths.has(path)) : [];
  const deltas = changes.flatMap(contractDeltas).sort((left, right) => left.path.localeCompare(right.path) || left.symbol.localeCompare(right.symbol));
  const contracts = impactedContracts(changed, model.contractMap);
  const contractConsumers = [...new Set(contracts.flatMap(contract => contract.consumers.map(endpoint => endpoint.file)).filter(path => !changed.has(path)))].sort();
  const nativeConflicts = contracts.filter(contract => contract.reconciliation === "native-conflict");
  const breaking = deltas.some(delta => delta.breaking);
  const gaps: string[] = [];
  if (breaking && outside.length > 0) gaps.push("Breaking exported-contract changes reach consumers outside the certified corridor.");
  if (nativeConflicts.length > 0) gaps.push(`Changed paths intersect unresolved native Contract Map conflicts: ${nativeConflicts.map(contract => contract.id).sort().join(", ")}`);
  if (breaking) {
    const unboundedContractConsumers = contractConsumers.filter(path => corridor && !corridorPaths.has(path));
    if (unboundedContractConsumers.length > 0) gaps.push("Breaking exported-contract changes reach Contract Map consumers outside the certified corridor.");
  }
  for (const change of changes) if (!model.snapshot.files.some(file => file.path === change.path)) gaps.push(`Changed path is absent from the repository snapshot: ${change.path}`);
  return Object.freeze({
    certified: gaps.length === 0,
    changedPaths: Object.freeze([...changed].sort()),
    immediateConsumers: Object.freeze(immediate),
    transitiveConsumers: Object.freeze(transitive),
    outsideCorridorConsumers: Object.freeze(outside),
    contractDeltas: Object.freeze(deltas),
    verificationTargets: Object.freeze([...new Set([...changed, ...transitive, ...contractConsumers])].sort()),
    impactedContractIds: Object.freeze(contracts.map(contract => contract.id).sort()),
    contractConsumers: Object.freeze(contractConsumers),
    nativeConflictIds: Object.freeze(nativeConflicts.map(contract => contract.id).sort()),
    gaps: Object.freeze(gaps)
  });
}
