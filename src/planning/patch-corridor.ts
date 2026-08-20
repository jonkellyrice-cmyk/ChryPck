import type { AnalysisResult } from "../analysis/analyzer.js";
import type { RepositoryModel, SymbolRecord } from "../repository/model.js";
import type { ContractMap, ContractRecord } from "../repository/contract-types.js";
import type { CertifiedTracePlanningEvidence } from "./trace-handoff.js";

const STOP_WORDS = new Set([
  "the", "and", "for", "from", "into", "with", "that", "this", "make", "change",
  "implement", "ensure", "using", "through", "only", "existing", "current", "behavior"
]);

export interface CorridorSymbolAnchor {
  readonly name: string;
  readonly kind: SymbolRecord["kind"];
  readonly line: number;
  readonly score: number;
}

export interface CorridorFile {
  readonly path: string;
  readonly reasons: readonly string[];
  readonly confidence: number;
  readonly score: number;
  readonly symbols: readonly CorridorSymbolAnchor[];
  readonly contractIds: readonly string[];
}

export interface CorridorClause {
  readonly id: string;
  readonly text: string;
  readonly terms: readonly string[];
  readonly owner: string | null;
  readonly candidateOwners: readonly string[];
  readonly path: readonly string[];
  readonly score: number;
  readonly complete: boolean;
  readonly basis: string;
}

export interface PatchCorridor {
  readonly objective: string;
  readonly certified: boolean;
  readonly files: readonly CorridorFile[];
  readonly corridor: readonly string[];
  readonly clauses: readonly CorridorClause[];
  readonly gaps: readonly string[];
  readonly diagnostics: readonly string[];
  readonly summary: Readonly<{
    clauseCount: number;
    coveredCount: number;
    fileCount: number;
    confidence: "high" | "medium" | "incomplete";
    contractCount: number;
  }>;
}

export interface PatchCorridorOptions {
  readonly diagnostics?: readonly AnalysisResult[];
  readonly traceEvidence?: CertifiedTracePlanningEvidence;
  readonly maxFiles?: number;
  readonly minOwnerScore?: number;
  readonly contractMap?: ContractMap;
}

function normalize(value: string): string {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.\\/:-]+/g, " ")
    .toLowerCase();
}

function termsFor(value: string): string[] {
  return [...new Set(normalize(value).split(/[^a-z0-9$]+/).filter(term => term.length >= 3 && !STOP_WORDS.has(term)))];
}

export function splitObjectiveClauses(value: string): string[] {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const clauses = text
    .split(/\s*;\s*|\s*\.\s+(?=[A-Z0-9])|\s*,\s*/)
    .flatMap(part => part.split(/\s+(?:then|while|but|so that)\s+/i))
    .flatMap(part => part.split(/\s+and\s+(?=(?:the\s+)?(?:add|allow|apply|bind|call|clear|create|display|emit|execute|persist|prevent|prompt|record|render|reset|return|roll|route|run|select|show|spend|update|use|validate)\b)/i))
    .map(part => part.trim().replace(/^and\s+/i, ""))
    .filter(Boolean);
  return clauses.length ? clauses : [text];
}

function fileText(model: RepositoryModel, path: string): string {
  return model.snapshot.files.find(file => file.path === path)?.text ?? "";
}

function traceEvidenceScore(
  path: string,
  terms: readonly string[],
  traceEvidence: CertifiedTracePlanningEvidence | undefined
): number {
  if (!traceEvidence) return 0;
  const hops = traceEvidence.path.filter(hop => hop.file === path);
  if (hops.length === 0) return 0;

  const file = normalize(path);
  const symbols = normalize(hops.map(hop => hop.symbol).join(" "));
  let score = 0;
  for (const term of terms) {
    if (symbols.includes(term)) score += 6;
    if (file.includes(term)) score += 3;
  }

  const blocker = traceEvidence.firstBlocker;
  if (blocker?.file === path) {
    const blockerName = normalize(blocker.symbol);
    for (const term of terms) if (blockerName.includes(term)) score += 4;
  }
  const terminal = traceEvidence.terminalEffect;
  if (terminal?.file === path) {
    const effectText = normalize(`${terminal.kind} ${terminal.symbol ?? ""}`);
    for (const term of terms) if (effectText.includes(term)) score += 4;
  }
  return score;
}

function fileScore(
  model: RepositoryModel,
  path: string,
  terms: readonly string[],
  traceEvidence?: CertifiedTracePlanningEvidence,
  contractMap?: ContractMap
): number {
  const facts = model.fileFacts.find(row => row.file === path);
  if (!facts) return 0;
  const haystacks = [
    { text: normalize(path), weight: 6 },
    { text: normalize(facts.symbols.map(symbol => symbol.name).join(" ")), weight: 5 },
    { text: normalize(facts.effects.map(effect => `${effect.kind} ${effect.detail} ${effect.symbol}`).join(" ")), weight: 4 },
    { text: normalize(facts.states.map(state => `${state.namespace} ${state.key} ${state.operation}`).join(" ")), weight: 4 },
    { text: normalize(facts.dependencies.map(dep => dep.specifier).join(" ")), weight: 2 },
    { text: normalize(fileText(model, path).slice(0, 24000)), weight: 1 }
  ];
  let score = 0;
  for (const term of terms) {
    for (const haystack of haystacks) if (haystack.text.includes(term)) score += haystack.weight + (term.length >= 7 ? 1 : 0);
  }
  const incoming = model.dependencies.filter(edge => edge.to === path).length;
  const outgoing = model.dependencies.filter(edge => edge.from === path).length;
  return score
    + Math.min(4, incoming)
    + Math.min(3, outgoing)
    + traceEvidenceScore(path, terms, traceEvidence)
    + contractEvidenceScore(path, terms, contractMap);
}

function contractText(contract: ContractRecord): string {
  return normalize([
    contract.name,
    contract.kind,
    contract.provider?.symbol ?? "",
    ...contract.consumers.map(endpoint => endpoint.symbol),
    ...contract.nativeContractRefs
  ].join(" "));
}

function relevantContracts(terms: readonly string[], map?: ContractMap): readonly ContractRecord[] {
  if (!map || terms.length === 0) return [];
  return map.contracts.filter(contract => terms.some(term => contractText(contract).includes(term)));
}

function contractEvidenceScore(path: string, terms: readonly string[], map?: ContractMap): number {
  let score = 0;
  for (const contract of relevantContracts(terms, map)) {
    if (contract.provider?.file === path) score += contract.verification === "native-authoritative" ? 8 : 5;
    if (contract.consumers.some(endpoint => endpoint.file === path)) score += 4;
  }
  return score;
}

function candidateOwners(
  model: RepositoryModel,
  terms: readonly string[],
  traceEvidence?: CertifiedTracePlanningEvidence
): readonly { path: string; score: number }[] {
  return model.fileFacts
    .map(facts => ({ path: facts.file, score: fileScore(model, facts.file, terms, traceEvidence, model.contractMap) }))
    .filter(row => row.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
}

function adjacency(model: RepositoryModel): ReadonlyMap<string, ReadonlySet<string>> {
  const graph = new Map<string, Set<string>>();
  for (const facts of model.fileFacts) graph.set(facts.file, new Set());
  for (const edge of model.dependencies) {
    if (!graph.has(edge.from)) graph.set(edge.from, new Set());
    if (!graph.has(edge.to)) graph.set(edge.to, new Set());
    graph.get(edge.from)?.add(edge.to);
    graph.get(edge.to)?.add(edge.from);
  }
  return graph;
}

function shortestPath(graph: ReadonlyMap<string, ReadonlySet<string>>, start: string, end: string): string[] {
  if (start === end) return [start];
  const queue: string[][] = [[start]];
  const seen = new Set([start]);
  while (queue.length) {
    const path = queue.shift() ?? [];
    const tail = path.at(-1);
    if (!tail) continue;
    for (const next of [...(graph.get(tail) ?? [])].sort()) {
      if (seen.has(next)) continue;
      const candidate = [...path, next];
      if (next === end) return candidate;
      seen.add(next);
      queue.push(candidate);
    }
  }
  return [];
}

function certifiedTracePathBetween(
  traceEvidence: CertifiedTracePlanningEvidence | undefined,
  start: string,
  end: string
): string[] {
  if (!traceEvidence || start === end) return [];
  const files = traceEvidence.path.map(hop => hop.file);
  const startIndex = files.indexOf(start);
  const endIndex = files.indexOf(end);
  if (startIndex < 0 || endIndex < 0) return [];
  const low = Math.min(startIndex, endIndex);
  const high = Math.max(startIndex, endIndex);
  return [...new Set(files.slice(low, high + 1))];
}

function symbolAnchors(model: RepositoryModel, path: string, terms: readonly string[]): CorridorSymbolAnchor[] {
  const facts = model.fileFacts.find(row => row.file === path);
  if (!facts) return [];
  return facts.symbols
    .map(symbol => {
      const name = normalize(symbol.name);
      const score = terms.reduce((sum, term) => sum + (name.includes(term) ? 4 : 0), 0) + (symbol.exported ? 1 : 0);
      return { name: symbol.name, kind: symbol.kind, line: symbol.line, score };
    })
    .filter(row => row.score > 0)
    .sort((left, right) => right.score - left.score || left.line - right.line)
    .slice(0, 8);
}

function diagnosticNames(results: readonly AnalysisResult[] | undefined): string[] {
  return (results ?? []).map(result => result.analyzer).sort();
}

export function planPatchCorridor(objective: string, model: RepositoryModel, options: PatchCorridorOptions = {}): PatchCorridor {
  const planningModel = options.contractMap ? Object.freeze({ ...model, contractMap: options.contractMap }) : model;
  const clauses = splitObjectiveClauses(objective);
  const minOwnerScore = options.minOwnerScore ?? 4;
  const graph = adjacency(model);
  const preliminary = clauses.map((text, index) => {
    const terms = termsFor(text);
    const candidates = candidateOwners(planningModel, terms, options.traceEvidence);
    const best = candidates[0] ?? null;
    const runnerUp = candidates[1] ?? null;
    const decisive = Boolean(best && best.score >= minOwnerScore && (!runnerUp || best.score >= runnerUp.score + 2));
    return {
      id: `clause-${index + 1}`,
      text,
      terms,
      owner: decisive ? best?.path ?? null : null,
      candidateOwners: candidates.slice(0, 4).map(row => row.path),
      score: best?.score ?? 0,
      decisive
    };
  });
  const anchor = preliminary.find(row => row.owner)?.owner ?? null;
  const traceFiles = new Set(options.traceEvidence?.path.map(hop => hop.file) ?? []);
  const clauseRows: CorridorClause[] = preliminary.map(row => {
    if (!row.owner) {
      return Object.freeze({
        id: row.id, text: row.text, terms: row.terms, owner: null,
        candidateOwners: row.candidateOwners, path: [], score: row.score, complete: false,
        basis: row.candidateOwners.length ? "owner evidence remained ambiguous" : "no repository evidence matched the clause"
      });
    }
    const tracedPath = anchor ? certifiedTracePathBetween(options.traceEvidence, anchor, row.owner) : [];
    const path = tracedPath.length ? tracedPath : anchor ? shortestPath(graph, anchor, row.owner) : [row.owner];
    const traceBacked = traceFiles.has(row.owner);
    return Object.freeze({
      id: row.id, text: row.text, terms: row.terms, owner: row.owner,
      candidateOwners: row.candidateOwners, path: path.length ? path : [row.owner], score: row.score,
      complete: true,
      basis: traceBacked
        ? "unique repository-model evidence owner strengthened by certified Trace lineage"
        : "unique repository-model evidence owner"
    });
  });

  const selected = new Set<string>();
  for (const clause of clauseRows) {
    if (clause.owner) selected.add(clause.owner);
    for (const path of clause.path) selected.add(path);
  }
  const objectiveContracts = relevantContracts(termsFor(objective), options.contractMap ?? model.contractMap);
  const maxFiles = Math.max(1, Math.min(32, options.maxFiles ?? 16));
  const allTerms = termsFor(objective);
  const fileRows: CorridorFile[] = [...selected]
    .map(path => {
      const supportingClauses = clauseRows.filter(clause => clause.owner === path || clause.path.includes(path));
      const score = fileScore(planningModel, path, allTerms, options.traceEvidence, options.contractMap);
      const reasons = supportingClauses.map(clause => `${clause.id}: ${clause.owner === path ? "owner" : "dependency path"}`);
      if (traceFiles.has(path) && options.traceEvidence) {
        reasons.push(`certified Trace lineage from ${options.traceEvidence.sourceRunId}`);
      }
      const contracts = objectiveContracts.filter(contract => contract.provider?.file === path || contract.consumers.some(endpoint => endpoint.file === path));
      for (const contract of contracts) reasons.push(`Contract Map ${contract.reconciliation}: ${contract.name}`);
      const anchors = symbolAnchors(model, path, allTerms);
      const confidence = Math.min(1, Math.max(0.2, score / 24));
      return Object.freeze({ path, reasons: Object.freeze(reasons), confidence, score, symbols: Object.freeze(anchors), contractIds: Object.freeze(contracts.map(contract => contract.id).sort()) });
    })
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, maxFiles);

  const uncovered = clauseRows.filter(clause => !clause.complete);
  const gaps = uncovered.map(clause => `${clause.id}: ${clause.basis}`);
  if (clauses.length === 0) gaps.push("objective contains no behavioral clause");
  if (fileRows.length === 0) gaps.push("no repository-model path could be certified");
  const selectedPaths = new Set(fileRows.map(file => file.path));
  const relevantConflicts = objectiveContracts.filter(contract => contract.reconciliation === "native-conflict" && [contract.provider, ...contract.consumers].some(endpoint => endpoint && selectedPaths.has(endpoint.file)));
  for (const contract of relevantConflicts) gaps.push(`Contract Map native conflict blocks ${contract.name}: ${contract.failures.map(failure => failure.summary).join("; ")}`);
  const certified = clauses.length > 0 && uncovered.length === 0 && fileRows.length > 0 && relevantConflicts.length === 0;
  const confidence: PatchCorridor["summary"]["confidence"] = !certified
    ? "incomplete"
    : fileRows.every(file => file.confidence >= 0.5) ? "high" : "medium";

  return Object.freeze({
    objective,
    certified,
    files: Object.freeze(fileRows),
    corridor: Object.freeze(fileRows.map(file => file.path)),
    clauses: Object.freeze(clauseRows),
    gaps: Object.freeze(gaps),
    diagnostics: Object.freeze(diagnosticNames(options.diagnostics)),
    summary: Object.freeze({
      clauseCount: clauseRows.length,
      coveredCount: clauseRows.length - uncovered.length,
      fileCount: fileRows.length,
      confidence,
      contractCount: new Set(fileRows.flatMap(file => file.contractIds)).size
    })
  });
}

export const uncertifiedCorridor = (objective: string, _model: RepositoryModel): PatchCorridor => Object.freeze({
  objective,
  certified: false,
  files: Object.freeze([]),
  corridor: Object.freeze([]),
  clauses: Object.freeze([]),
  gaps: Object.freeze(["Patch Corridor has not been planned."]),
  diagnostics: Object.freeze([]),
  summary: Object.freeze({ clauseCount: 0, coveredCount: 0, fileCount: 0, confidence: "incomplete" as const, contractCount: 0 })
});
