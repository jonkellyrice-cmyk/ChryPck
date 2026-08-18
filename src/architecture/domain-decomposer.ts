import type { RepositoryModel, SymbolRecord } from "../repository/model.js";

export interface DomainDecomposerPolicy {
  readonly idealMaxLines: number;
  readonly moderateLines: number;
  readonly highLines: number;
  readonly protectedPathPatterns: readonly RegExp[];
}

export interface DomainDecompositionUnit {
  readonly id: string;
  readonly action: "extract";
  readonly target: string;
  readonly symbols: readonly string[];
  readonly estimatedLines: number;
  readonly effectFamilies: readonly string[];
  readonly seamConfidence: "high" | "medium" | "low";
  readonly recursiveReviewRequired: boolean;
}

export interface DomainDecompositionCandidate {
  readonly source: string;
  readonly decision: "decompose" | "retain";
  readonly recommendation: "HIGH" | "MEDIUM" | "LOW" | "FORBIDDEN";
  readonly reason: string;
  readonly role: "composition_root" | "registry" | "feature_package" | "implementation";
  readonly metrics: Readonly<{
    lines: number;
    topLevelSymbols: number;
    domainGroups: number;
    effectFamilies: number;
    sizePressure: "minimal" | "moderate" | "high" | "very-high";
  }>;
  readonly units: readonly DomainDecompositionUnit[];
}

export interface DomainDecompositionPlan {
  readonly kind: "domain-decomposition";
  readonly planId: string;
  readonly approved: false;
  readonly behaviorChangeAllowed: false;
  readonly candidates: readonly DomainDecompositionCandidate[];
  readonly retainedFiles: readonly DomainDecompositionCandidate[];
  readonly affectedExistingPaths: readonly string[];
  readonly authorizedNewPaths: readonly string[];
  readonly gaps: readonly string[];
  readonly invariants: readonly string[];
}

export interface DomainDecomposerOptions {
  readonly paths?: readonly string[];
  readonly policy?: Partial<DomainDecomposerPolicy>;
}

const DEFAULT_POLICY: DomainDecomposerPolicy = Object.freeze({
  idealMaxLines: 500,
  moderateLines: 800,
  highLines: 1200,
  protectedPathPatterns: Object.freeze([
    /(^|\/)runtime-orchestrator\.[^.]+$/i,
    /(^|\/)[^/]*-registry(?:-core)?\.[^.]+$/i,
    /(^|\/)[^/]*-feature-package\.[^.]+$/i
  ])
});

const STOP = new Set(["the","and","for","from","with","into","feature","handler","service","state","create","update","resolve","build","apply","current","value"]);
function tokens(value: string): string[] {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_./\\-]+/g, " ").toLowerCase().split(/\s+/).map(x => x.replace(/[^a-z0-9]/g, "")).filter(x => x.length >= 3 && !STOP.has(x));
}
function groupKey(symbol: SymbolRecord): string { const list = tokens(symbol.name); return list.slice(0, 2).join("-") || "misc"; }
function pressure(lines: number, p: DomainDecomposerPolicy): DomainDecompositionCandidate["metrics"]["sizePressure"] { return lines <= p.idealMaxLines ? "minimal" : lines <= p.moderateLines ? "moderate" : lines <= p.highLines ? "high" : "very-high"; }
function role(path: string, p: DomainDecomposerPolicy): DomainDecompositionCandidate["role"] {
  if (/runtime-orchestrator/i.test(path)) return "composition_root";
  if (/-registry(?:-core)?\./i.test(path)) return "registry";
  if (/-feature-package\./i.test(path)) return "feature_package";
  if (p.protectedPathPatterns.some(pattern => pattern.test(path))) return "composition_root";
  return "implementation";
}
function targetFor(path: string, id: string): string {
  const slash = path.lastIndexOf("/"); const dir = slash >= 0 ? path.slice(0, slash + 1) : ""; const file = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = file.lastIndexOf("."); const ext = dot >= 0 ? file.slice(dot) : ""; const stem = (dot >= 0 ? file.slice(0, dot) : file).replace(/-(?:feature|tracker|application)$/i, "");
  return `${dir}${stem}-${id}${ext}`;
}
function planIdFor(rows: readonly DomainDecompositionCandidate[]): string {
  const stable = rows.map(row => `${row.source}:${row.recommendation}:${row.units.map(unit => `${unit.id}>${unit.target}:${unit.symbols.join(",")}`).join("|")}`).join("||");
  let hash = 2166136261; for (let i=0;i<stable.length;i++){ hash ^= stable.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `decompose-${(hash >>> 0).toString(16).padStart(8,"0")}`;
}

export function planDomainDecomposition(model: RepositoryModel, options: DomainDecomposerOptions = {}): DomainDecompositionPlan {
  const policy: DomainDecomposerPolicy = Object.freeze({ ...DEFAULT_POLICY, ...options.policy, protectedPathPatterns: options.policy?.protectedPathPatterns ?? DEFAULT_POLICY.protectedPathPatterns });
  const requested = options.paths?.length ? new Set(options.paths) : null;
  const gaps: string[] = [];
  if (requested) for (const path of requested) if (!model.fileFacts.some(f => f.file === path)) gaps.push(`requested path is not present in the repository model: ${path}`);
  const analyses: DomainDecompositionCandidate[] = [];
  for (const facts of model.fileFacts) {
    if (requested && !requested.has(facts.file)) continue;
    const file = model.snapshot.files.find(candidate => candidate.path === facts.file);
    if (!file?.text) continue;
    const lineCount = file.text.split("\n").length;
    const fileRole = role(facts.file, policy);
    const groups = new Map<string, SymbolRecord[]>();
    for (const symbol of facts.symbols) { const key = groupKey(symbol); const bucket = groups.get(key) ?? []; bucket.push(symbol); groups.set(key, bucket); }
    const orderedSymbols = [...facts.symbols].sort((a,b)=>a.line-b.line || a.name.localeCompare(b.name));
    const lineSpan = new Map<string, number>();
    for (let i=0;i<orderedSymbols.length;i++){ const symbol=orderedSymbols[i]!; const next=orderedSymbols[i+1]; lineSpan.set(symbol.name, Math.max(1,(next?.line ?? lineCount+1)-symbol.line)); }
    const effectFamilies = [...new Set(facts.effects.map(effect => effect.kind))].sort();
    let recommendation: DomainDecompositionCandidate["recommendation"] = "LOW", decision: DomainDecompositionCandidate["decision"] = "retain", reason = "File remains within a cohesive or low-pressure implementation boundary.";
    if (fileRole !== "implementation") { recommendation = "FORBIDDEN"; reason = `${fileRole} is decomposition-resistant and requires an explicit architectural decision.`; }
    else if (groups.size >= 2 && lineCount > policy.moderateLines) { recommendation = "HIGH"; decision = "decompose"; reason = "High reasoning pressure combines with multiple symbol-domain groups."; }
    else if (groups.size >= 2 && lineCount > policy.idealMaxLines) { recommendation = "MEDIUM"; decision = "decompose"; reason = "Multiple symbol-domain groups are present under meaningful size pressure."; }
    const units: DomainDecompositionUnit[] = decision === "decompose" ? [...groups.entries()].map(([id, symbols]) => {
      const estimatedLines = symbols.reduce((sum,symbol)=>sum+(lineSpan.get(symbol.name)??1),0);
      const start = Math.min(...symbols.map(symbol=>symbol.line)); const end = Math.max(...symbols.map(symbol=>symbol.line+(lineSpan.get(symbol.name)??1)-1));
      const effects = [...new Set(facts.effects.filter(effect=>effect.line>=start && effect.line<=end).map(effect=>effect.kind))].sort();
      return Object.freeze({ id, action:"extract" as const, target:targetFor(facts.file,id), symbols:Object.freeze(symbols.map(symbol=>symbol.name).sort()), estimatedLines, effectFamilies:Object.freeze(effects), seamConfidence: effects.length <= 1 ? "high" as const : effects.length <= 3 ? "medium" as const : "low" as const, recursiveReviewRequired: estimatedLines > policy.moderateLines && symbols.length >= 5 });
    }).filter(unit=>unit.symbols.length>=2 || unit.estimatedLines>=120).slice(0,12) : [];
    analyses.push(Object.freeze({ source:facts.file, decision, recommendation, reason, role:fileRole, metrics:Object.freeze({ lines:lineCount, topLevelSymbols:facts.symbols.length, domainGroups:groups.size, effectFamilies:effectFamilies.length, sizePressure:pressure(lineCount,policy) }), units:Object.freeze(units) }));
  }
  analyses.sort((a,b)=>b.metrics.lines-a.metrics.lines || a.source.localeCompare(b.source));
  const candidates = analyses.filter(row=>row.decision==="decompose");
  const newPaths = [...new Set(candidates.flatMap(row=>row.units.map(unit=>unit.target)))].sort();
  const affected = [...new Set((requested ? [...requested] : candidates.map(row=>row.source)).filter(path=>model.fileFacts.some(f=>f.file===path)))].sort();
  return Object.freeze({ kind:"domain-decomposition", planId:planIdFor(analyses), approved:false, behaviorChangeAllowed:false, candidates:Object.freeze(candidates), retainedFiles:Object.freeze(analyses.filter(row=>row.decision!=="decompose")), affectedExistingPaths:Object.freeze(affected), authorizedNewPaths:Object.freeze(newPaths), gaps:Object.freeze(gaps), invariants:Object.freeze(["public contracts remain unchanged","runtime effects remain unchanged","persistent state namespaces remain unchanged","native integration behavior remains unchanged","decomposition changes ownership/call topology only","review is required before execution"]) });
}
