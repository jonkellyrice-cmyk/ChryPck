import { createHash } from "node:crypto";
import type { DependencyEdge, FileFacts, StateRecord, UnresolvedDependency } from "./model.js";
import type {
  ContractCallSite,
  ContractDeclarationSite,
  ContractEndpoint,
  ContractEvidence,
  ContractFileFacts,
  ContractMap,
  ContractRecord,
  ContractValue
} from "./contract-types.js";
import { emptyContractFileFacts } from "./contract-types.js";
import { normalizeRepositoryPath, repositoryExtension } from "./source-profile.js";

function contractId(kind: ContractRecord["kind"], key: string): string {
  return `contract:${kind}:${createHash("sha256").update(`${kind}:${key}`).digest("hex").slice(0, 16)}`;
}

function endpoint(file: string, symbol: string, line: number, role: ContractEndpoint["role"]): ContractEndpoint {
  return Object.freeze({ file, symbol, line, role });
}

function evidence(kind: ContractEvidence["kind"], file: string, line: number, summary: string): ContractEvidence {
  return Object.freeze({ kind, file, line, summary });
}

function outputFor(declaration: ContractDeclarationSite): readonly ContractValue[] {
  return declaration.output
    ? Object.freeze([Object.freeze({ name: "return", type: declaration.output, optional: false, rest: false })])
    : Object.freeze([]);
}

function sites(facts: FileFacts): ContractFileFacts {
  return facts.contractSites ?? emptyContractFileFacts();
}

interface ProviderResolution {
  readonly providers: readonly ContractDeclarationSite[];
  readonly external: boolean;
  readonly importEvidence: ContractEvidence | null;
}

function callRoot(target: string): string {
  return target.split(/[.[]/, 1)[0] ?? target;
}

function sourceCompatibleImportTarget(file: string, specifier: string, fileFacts: readonly FileFacts[]): string | null {
  if (!specifier.startsWith(".")) return null;
  const directory = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
  const joined = normalizeRepositoryPath(directory ? `${directory}/${specifier}` : specifier);
  if (!joined) return null;
  const extension = repositoryExtension(joined);
  const stem = extension ? joined.slice(0, -extension.length) : joined;
  const candidates = extension
    ? [joined, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map(candidate => `${stem}${candidate}`)]
    : [joined, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map(candidate => `${joined}${candidate}`)];
  return candidates.find(candidate => fileFacts.some(row => row.file === candidate)) ?? null;
}

function resolveCall(
  call: ContractCallSite,
  fileFacts: readonly FileFacts[],
  dependencies: readonly DependencyEdge[],
  unresolved: readonly UnresolvedDependency[]
): ProviderResolution {
  const localFacts = fileFacts.find(row => row.file === call.file);
  if (!localFacts) return { providers: [], external: false, importEvidence: null };
  const root = callRoot(call.target);
  const local = sites(localFacts).declarations.filter(row => row.name === root);
  if (local.length) return { providers: local, external: false, importEvidence: null };
  const binding = sites(localFacts).imports.find(row => row.localName === root);
  if (!binding) return { providers: [], external: false, importEvidence: null };
  const edge = dependencies.find(candidate => candidate.from === call.file && candidate.specifier === binding.specifier);
  const targetPath = edge?.to ?? sourceCompatibleImportTarget(call.file, binding.specifier, fileFacts);
  if (targetPath) {
    const targetFacts = fileFacts.find(row => row.file === targetPath);
    const providers = targetFacts
      ? sites(targetFacts).declarations.filter(row => row.exported && (binding.importedName === "default" ? row.defaultExport : row.name === binding.importedName))
      : [];
    return {
      providers,
      external: false,
      importEvidence: evidence("import", binding.file, binding.line, `${binding.localName} imports ${binding.importedName} from ${binding.specifier}.`)
    };
  }
  const external = unresolved.some(candidate => candidate.file === call.file && candidate.specifier === binding.specifier && candidate.external);
  return {
    providers: [],
    external,
    importEvidence: evidence("import", binding.file, binding.line, `${binding.localName} imports ${binding.importedName} from ${binding.specifier}.`)
  };
}

function lifecycleEvent(name: string): boolean {
  return /^(?:init|ready|setup)$/i.test(name) || /^(?:render|pre|create|update|delete)[A-Z_-]/.test(name);
}

function declarationContracts(
  fileFacts: readonly FileFacts[],
  dependencies: readonly DependencyEdge[],
  unresolved: readonly UnresolvedDependency[]
): { records: ContractRecord[]; consumedCalls: Set<ContractCallSite>; ambiguous: number; external: number; unresolved: number } {
  const records: ContractRecord[] = [];
  const consumedCalls = new Set<ContractCallSite>();
  let ambiguous = 0, external = 0, unresolvedCount = 0;
  const allCalls = fileFacts
    .flatMap(row => [...sites(row).calls])
    .filter(call => !/^Hooks\.(?:on|once|off|call|callAll)$/.test(call.target));
  const resolutions = new Map(allCalls.map(call => [call, resolveCall(call, fileFacts, dependencies, unresolved)] as const));

  for (const facts of fileFacts) {
    for (const declaration of sites(facts).declarations) {
      const consumers: ContractEndpoint[] = [];
      const contractEvidence: ContractEvidence[] = [evidence("declaration", declaration.file, declaration.line, `${declaration.exported ? "Exported" : "Local"} ${declaration.kind} ${declaration.name}.`)];
      for (const call of allCalls) {
        const resolution = resolutions.get(call)!;
        if (resolution.providers.length === 1 && resolution.providers[0] === declaration) {
          consumedCalls.add(call);
          consumers.push(endpoint(call.file, call.caller, call.line, "consumer"));
          contractEvidence.push(evidence("call", call.file, call.line, `${call.caller} calls ${call.target} with ${call.argumentCount} argument(s).`));
          if (resolution.importEvidence) contractEvidence.push(resolution.importEvidence);
        }
      }
      if (!declaration.exported && consumers.length === 0) continue;
      const callback = allCalls.some(call => consumedCalls.has(call) && resolutions.get(call)?.providers[0] === declaration && call.callbackArguments.length > 0);
      records.push(Object.freeze({
        id: contractId(declaration.exported ? "exported-api" : callback ? "callback" : "function-call", `${declaration.file}:${declaration.name}:${declaration.line}`),
        kind: declaration.exported ? "exported-api" : callback ? "callback" : "function-call",
        name: declaration.name,
        provider: endpoint(declaration.file, declaration.name, declaration.line, "provider"),
        consumers: Object.freeze(consumers.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)),
        inputs: declaration.inputs,
        outputs: outputFor(declaration),
        preconditions: Object.freeze([]),
        postconditions: Object.freeze([]),
        failures: Object.freeze([]),
        evidence: Object.freeze(contractEvidence),
        confidence: "high",
        verification: "resolved",
        nativeContractRefs: Object.freeze([]),
        reconciliation: "repository-only",
        candidateProviders: Object.freeze([])
      }));
    }
  }

  for (const call of allCalls) {
    if (consumedCalls.has(call)) continue;
    const resolution = resolutions.get(call)!;
    if (resolution.providers.length > 1) ambiguous += 1;
    else if (resolution.external) external += 1;
    else if (resolution.importEvidence || call.callbackArguments.length > 0) unresolvedCount += 1;
    else continue;
    const candidates = resolution.providers.map(provider => endpoint(provider.file, provider.name, provider.line, "provider"));
    records.push(Object.freeze({
      id: contractId(resolution.external ? "external-api" : call.callbackArguments.length ? "callback" : "function-call", `${call.file}:${call.line}:${call.target}`),
      kind: resolution.external ? "external-api" : call.callbackArguments.length ? "callback" : "function-call",
      name: call.target,
      provider: candidates.length === 1 ? candidates[0]! : null,
      consumers: Object.freeze([endpoint(call.file, call.caller, call.line, "consumer")]),
      inputs: Object.freeze([]),
      outputs: Object.freeze([]),
      preconditions: Object.freeze([]),
      postconditions: Object.freeze([]),
      failures: Object.freeze([Object.freeze({ kind: "unresolved", summary: resolution.external ? "Provider is external to the repository snapshot." : "Provider could not be resolved uniquely." })]),
      evidence: Object.freeze([
        evidence("call", call.file, call.line, `${call.caller} calls ${call.target} with ${call.argumentCount} argument(s).`),
        ...(resolution.importEvidence ? [resolution.importEvidence] : [])
      ]),
      confidence: resolution.external ? "medium" : "low",
      verification: "syntax",
      nativeContractRefs: Object.freeze([]),
      reconciliation: "repository-only",
      candidateProviders: Object.freeze(candidates)
    }));
  }
  return { records, consumedCalls, ambiguous, external, unresolved: unresolvedCount };
}

function eventContracts(fileFacts: readonly FileFacts[]): ContractRecord[] {
  const sitesByEvent = new Map<string, ReturnType<typeof sites>["events"] extends readonly (infer T)[] ? T[] : never>();
  for (const event of fileFacts.flatMap(row => [...sites(row).events])) {
    const key = event.eventNameResolved ? event.eventName : `${event.file}:${event.line}:${event.eventName}`;
    const list = sitesByEvent.get(key) ?? [];
    list.push(event);
    sitesByEvent.set(key, list);
  }
  return [...sitesByEvent.entries()].map(([name, eventSites]) => {
    const producers = eventSites.filter(site => site.role === "producer");
    const listeners = eventSites.filter(site => site.role === "listener");
    const providerSite = producers.length === 1 ? producers[0]! : null;
    const resolvedName = eventSites.every(site => site.eventNameResolved);
    const resolved = resolvedName && producers.length === 1;
    return Object.freeze({
      id: contractId(lifecycleEvent(name) ? "lifecycle" : "event", name),
      kind: lifecycleEvent(name) ? "lifecycle" as const : "event" as const,
      name,
      provider: providerSite ? endpoint(providerSite.file, providerSite.owner, providerSite.line, "producer") : null,
      consumers: Object.freeze(listeners.map(site => endpoint(site.file, site.handler ?? site.owner, site.line, "listener"))),
      inputs: Object.freeze([]),
      outputs: Object.freeze([]),
      preconditions: Object.freeze([]),
      postconditions: Object.freeze([]),
      failures: Object.freeze(resolved || listeners.length === 0 ? [] : [Object.freeze({ kind: "unresolved" as const, summary: "Event producer is absent or ambiguous in the repository snapshot." })]),
      evidence: Object.freeze(eventSites.map(site => evidence("event", site.file, site.line, `Hooks.${site.operation} ${site.eventName}.`))),
      confidence: resolved ? "high" as const : !resolvedName ? "low" as const : "medium" as const,
      verification: resolved ? "resolved" as const : "syntax" as const,
      nativeContractRefs: Object.freeze([]),
      reconciliation: "repository-only" as const,
      candidateProviders: Object.freeze(producers.map(site => endpoint(site.file, site.owner, site.line, "producer")))
    });
  });
}

function stateContracts(states: readonly StateRecord[]): ContractRecord[] {
  const grouped = new Map<string, StateRecord[]>();
  for (const state of states) {
    const key = `${state.kind}:${state.namespace}:${state.key}`;
    const list = grouped.get(key) ?? [];
    list.push(state);
    grouped.set(key, list);
  }
  return [...grouped.entries()].map(([name, rows]) => {
    const writers = rows.filter(row => row.access === "write");
    const readers = rows.filter(row => row.access === "read");
    const deleters = rows.filter(row => row.access === "delete");
    const provider = writers.length === 1 ? endpoint(writers[0]!.file, writers[0]!.operation, writers[0]!.line, "writer") : null;
    return Object.freeze({
      id: contractId("state", name),
      kind: "state" as const,
      name,
      provider,
      consumers: Object.freeze([
        ...readers.map(row => endpoint(row.file, row.operation, row.line, "reader" as const)),
        ...deleters.map(row => endpoint(row.file, row.operation, row.line, "deleter" as const))
      ]),
      inputs: Object.freeze([]), outputs: Object.freeze([]),
      preconditions: Object.freeze([]), postconditions: Object.freeze([]),
      failures: Object.freeze(writers.length !== 1 ? [Object.freeze({
        kind: "unresolved" as const,
        summary: writers.length === 0 ? "State surface has no resolved writer." : "State surface has multiple writers."
      })] : []),
      evidence: Object.freeze(rows.map(row => evidence("state", row.file, row.line, `${row.operation} ${row.namespace}.${row.key}.`))),
      confidence: rows.every(row => row.namespaceResolved && row.keyResolved) ? "high" as const : "low" as const,
      verification: provider ? "resolved" as const : "syntax" as const,
      nativeContractRefs: Object.freeze([]), reconciliation: "repository-only" as const,
      candidateProviders: Object.freeze(writers.map(row => endpoint(row.file, row.operation, row.line, "writer")))
    });
  });
}

export function linkContractMap(
  fileFacts: readonly FileFacts[],
  dependencies: readonly DependencyEdge[],
  unresolvedDependencies: readonly UnresolvedDependency[],
  states: readonly StateRecord[]
): ContractMap {
  const declarations = declarationContracts(fileFacts, dependencies, unresolvedDependencies);
  const events = eventContracts(fileFacts);
  const state = stateContracts(states);
  const contracts = [...declarations.records, ...events, ...state].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const gaps = fileFacts.flatMap(row => [...sites(row).gaps]).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const candidateSites = fileFacts.reduce((sum, row) => {
    const contractSites = sites(row);
    return sum + contractSites.declarations.length + contractSites.calls.length + contractSites.events.length;
  }, states.length);
  return Object.freeze({
    schemaVersion: 1,
    contracts: Object.freeze(contracts),
    coverage: Object.freeze({
      candidateSites,
      resolvedContracts: contracts.filter(record => record.verification === "resolved" && record.provider !== null).length,
      unresolvedSites: contracts.filter(record => record.provider === null).length + gaps.length,
      ambiguousSites: declarations.ambiguous,
      externalSites: declarations.external,
      nativeConfirmed: 0,
      nativeSupplemented: 0,
      nativeConflicts: 0
    }),
    gaps: Object.freeze(gaps)
  });
}
