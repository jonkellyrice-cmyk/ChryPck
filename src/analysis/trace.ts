import { createHash } from "node:crypto";
import type { RepositoryModel, SymbolRecord } from "../repository/model.js";
import type { PatchCorridor } from "../planning/patch-corridor.js";
import { buildTraceGraph, type TraceEdge } from "./trace-graph.js";

/**
 * Canonical bounded trace engine.
 *
 * Public ChryPck exposes only analysis.kind = "trace". This implementation is
 * the former Bounded Event-Flow Trace (BEFT) engine, promoted to be the single
 * trace implementation. It is read-only, corridor-aware, bounded, evidence-
 * backed, and refuses to invent an arbitrary seed when the objective cannot be
 * tied to repository evidence.
 */

export interface TraceOptions {
  readonly fileGlobAllow?: readonly string[];
  readonly fileGlobDeny?: readonly string[];
  readonly symbolAllow?: readonly string[];
  readonly symbolDeny?: readonly string[];
  readonly maxHops?: number;
  readonly maxBranches?: number;
  readonly terminateOnFirstBlocker?: boolean;
  readonly certifyMode?: "strict" | "relaxed";
}

export interface TraceRequest {
  readonly requestId?: string;
  readonly repository: string;
  readonly commitSha?: string;
  readonly objective: string;
  readonly sourceSymbol?: string;
  readonly targetEffect?: string;
  readonly options?: TraceOptions;
}

export type TraceStatus = "CERTIFIED" | "BLOCKED" | "UNABLE_TO_CERTIFY" | "LIMITS_EXCEEDED";

export interface TraceHop {
  readonly symbol: string;
  readonly file: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  readonly snippet?: string;
  readonly edgeType?: string;
}

export interface GuardRecord {
  readonly symbol: string;
  readonly file: string;
  readonly line: number;
  readonly condition: string;
  readonly guardKind: "early-return" | "suppression" | "dedupe" | "null-check" | "permission" | "other";
  readonly evidenceIds: readonly string[];
}

export interface EffectRecord {
  readonly kind: string;
  readonly symbol?: string;
  readonly file?: string;
  readonly snippet?: string;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly type: string;
  readonly detail?: string;
  readonly snippet?: string;
}

export interface ExclusionRecord {
  readonly kind: "policy" | "filter" | "pruned";
  readonly reason: string;
  readonly selector: string;
}

export interface PathCertificate {
  readonly certificateId: string;
  readonly requestFingerprint: string;
  readonly pathHash: string;
  readonly createdAt: string;
  readonly signer?: string;
}

export interface TraceResult {
  readonly requestId: string;
  readonly status: TraceStatus;
  readonly entrypoint?: TraceHop;
  readonly path: readonly TraceHop[];
  readonly firstBlocker?: GuardRecord;
  readonly terminalEffect?: EffectRecord;
  readonly excludedBranches: readonly ExclusionRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly certificate?: PathCertificate;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "from", "into", "with", "that", "this", "when", "where",
  "why", "does", "doesnt", "isnt", "not", "work", "working", "figure", "trace",
  "find", "locate", "runtime", "path", "event", "flow", "problem", "issue", "bug"
]);

function normalize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.\\/:-]+/g, " ")
    .toLowerCase();
}

function objectiveTerms(value: string): readonly string[] {
  return Object.freeze([...new Set(
    normalize(value)
      .split(/[^a-z0-9$]+/)
      .map(term => term.trim())
      .filter(term => term.length >= 3 && !STOP_WORDS.has(term))
  )]);
}

function exactSymbol(value: string, model: RepositoryModel): SymbolRecord | null {
  const requested = value.trim();
  if (!requested) return null;
  return model.symbols.find(symbol =>
    symbol.name === requested ||
    `${symbol.file}::${symbol.name}` === requested ||
    `${symbol.name}@${symbol.file}` === requested
  ) ?? null;
}

function resolveObjectiveSeed(
  request: TraceRequest,
  model: RepositoryModel,
  corridor: PatchCorridor
): SymbolRecord | null {
  if (request.sourceSymbol) return exactSymbol(request.sourceSymbol, model);

  const corridorCandidates = corridor.files
    .flatMap(file => file.symbols.map(anchor => ({ file: file.path, name: anchor.name, score: anchor.score })))
    .filter(anchor => anchor.score > 0)
    .sort((left, right) => right.score - left.score || left.file.localeCompare(right.file) || left.name.localeCompare(right.name));
  for (const anchor of corridorCandidates) {
    const symbol = model.symbols.find(candidate => candidate.file === anchor.file && candidate.name === anchor.name);
    if (symbol) return symbol;
  }

  const terms = objectiveTerms(request.objective);
  const ranked = model.symbols
    .map(symbol => {
      const name = normalize(symbol.name);
      const file = normalize(symbol.file);
      let score = symbol.exported ? 1 : 0;
      for (const term of terms) {
        if (name.includes(term)) score += 8;
        if (file.includes(term)) score += 3;
      }
      return { symbol, score };
    })
    .filter(row => row.score >= 8)
    .sort((left, right) => right.score - left.score || left.symbol.file.localeCompare(right.symbol.file) || left.symbol.line - right.symbol.line);

  return ranked[0]?.symbol ?? null;
}

function cryptoFingerprint(obj: unknown): string {
  const hash = createHash("sha256");
  try {
    hash.update(JSON.stringify(obj));
  } catch {
    hash.update(String(obj));
  }
  return hash.digest("hex");
}

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&");
  const expression = new RegExp("^" + escaped.replace(/\\\*/g, ".*").replace(/\\\?/g, ".") + "$", "i");
  return expression.test(value);
}

function orderKind(kind: string): number {
  switch (kind) {
    case "calls": return 0;
    case "state-write": return 1;
    case "state-read": return 2;
    case "effect": return 3;
    case "dependency": return 4;
    default: return 5;
  }
}

function snippetFor(name: string, text: string): string {
  const index = text.indexOf(name);
  if (index === -1) return text.slice(0, Math.min(400, text.length));
  const start = Math.max(0, index - 120);
  const end = Math.min(text.length, index + 280);
  return text.slice(start, end);
}

function nodeParts(nodeId: string): { readonly name: string; readonly file: string } {
  const [name = "", file = ""] = nodeId.split("@");
  return { name, file };
}

export function analyzeTrace(
  request: TraceRequest,
  model: RepositoryModel,
  corridor: PatchCorridor
): TraceResult {
  const requestId = request.requestId ?? cryptoFingerprint(request);
  const emptyResult = (): TraceResult => Object.freeze({
    requestId,
    status: "UNABLE_TO_CERTIFY" as const,
    entrypoint: undefined,
    path: Object.freeze([]),
    excludedBranches: Object.freeze([]),
    evidence: Object.freeze([])
  });

  const chosen = resolveObjectiveSeed(request, model, corridor);
  if (!chosen) return emptyResult();

  const options = request.options ?? {};
  const maxHops = Math.max(1, options.maxHops ?? 12);
  const maxBranches = Math.max(1, options.maxBranches ?? 2);
  const terminateOnFirstBlocker = options.terminateOnFirstBlocker !== false;
  const allowedFiles = corridor.certified ? new Set(corridor.files.map(file => file.path)) : null;
  if (allowedFiles && !allowedFiles.has(chosen.file)) return emptyResult();

  const graph = buildTraceGraph(model);
  const startNodeId = `${chosen.name}@${chosen.file}`;

  const pathAllowed = (file: string): boolean => {
    if (allowedFiles && !allowedFiles.has(file)) return false;
    if (options.fileGlobDeny?.some(pattern => globMatch(pattern, file))) return false;
    if (options.fileGlobAllow?.length && !options.fileGlobAllow.some(pattern => globMatch(pattern, file))) return false;
    return true;
  };

  const detectGuardForNode = (nodeId: string): GuardRecord | null => {
    const { name, file } = nodeParts(nodeId);
    const facts = model.fileFacts.find(candidate => candidate.file === file);
    const fileEntry = model.snapshot.files.find(candidate => candidate.path === file);
    if (!facts || !fileEntry || fileEntry.text === undefined) return null;
    const symbol = facts.symbols.find(candidate => candidate.name === name);
    const startLine = symbol?.line ?? 1;
    const nextSymbolLine = facts.symbols.find(candidate => candidate.line > startLine)?.line ?? (fileEntry.text.split("\n").length + 1);
    const block = fileEntry.text.split("\n").slice(startLine - 1, nextSymbolLine - 1).join("\n").slice(0, 2000);
    const patterns: readonly [RegExp, GuardRecord["guardKind"]][] = [
      [/(if\s*\([^)]*(?:msg|message|payload|event)[^)]*\)\s*return\b)/i, "early-return"],
      [/(if\s*\([^)]*\b(?:==\s*null|===\s*null|==\s*undefined)\b[^)]*\)\s*return\b)/i, "null-check"],
      [/(if\s*\([^)]*\bseen\b[^)]*\)\s*return\b)/i, "dedupe"],
      [/(if\s*\([^)]*\b(has|includes|contains)\b[^)]*\)\s*return\b)/i, "suppression"]
    ];
    for (const [pattern, guardKind] of patterns) {
      const match = block.match(pattern);
      if (!match) continue;
      const condition = (match[1] ?? match[0]).replace(/\s+/g, " ").trim();
      return Object.freeze({
        symbol: name,
        file,
        line: startLine,
        condition,
        guardKind,
        evidenceIds: Object.freeze([cryptoFingerprint({ file, name, condition })])
      });
    }
    return null;
  };

  const suspectFieldsAtNode = (nodeId: string): readonly string[] => {
    const { name, file } = nodeParts(nodeId);
    const fileEntry = model.snapshot.files.find(candidate => candidate.path === file);
    const facts = model.fileFacts.find(candidate => candidate.file === file);
    if (!fileEntry?.text || !facts) return Object.freeze([]);
    const symbol = facts.symbols.find(candidate => candidate.name === name);
    const startLine = symbol?.line ?? 1;
    const nextSymbolLine = facts.symbols.find(candidate => candidate.line > startLine)?.line ?? (fileEntry.text.split("\n").length + 1);
    const block = fileEntry.text.split("\n").slice(startLine - 1, nextSymbolLine - 1).join("\n").slice(0, 2000);
    const suspects: string[] = [];
    const patterns: readonly [RegExp, string][] = [
      [/(?:message|msg|payload)\.id\b/i, "message.id"],
      [/(?:message|msg|payload)\[['"]id['"]\]/i, "message['id']"],
      [/\btargetUuid\b/i, "targetUuid"],
      [/\btarget_uuid\b/i, "target_uuid"],
      [/\btargetId\b/i, "targetId"]
    ];
    for (const [pattern, label] of patterns) if (pattern.test(block)) suspects.push(label);
    return Object.freeze(suspects);
  };

  const upstreamMentionsField = (field: string, pathNodes: readonly string[]): boolean => {
    const pathFiles = new Set(pathNodes.map(node => nodeParts(node).file));
    for (const effect of model.effects) {
      if (effect.detail?.toLowerCase().includes(field.toLowerCase())) return true;
      if (effect.symbol && pathNodes.some(node => node.startsWith(`${effect.symbol}@`))) return true;
      if (pathFiles.has(effect.file)) return true;
    }
    return false;
  };

  const effectAtNode = (nodeId: string): EffectRecord | null => {
    if (!request.targetEffect) return null;
    const { name, file } = nodeParts(nodeId);
    const effect = model.effects.find(candidate =>
      candidate.file === file &&
      (candidate.symbol === name || candidate.symbol === "<module>") &&
      (candidate.kind === request.targetEffect || candidate.symbol === request.targetEffect)
    );
    return effect ? Object.freeze({ kind: effect.kind, symbol: effect.symbol, file: effect.file }) : null;
  };

  const queue: string[] = [startNodeId];
  const parent = new Map<string, { readonly from: string | null; readonly via: TraceEdge | null }>();
  parent.set(startNodeId, { from: null, via: null });
  const visited = new Set<string>();
  const excludedBranches: ExclusionRecord[] = [];
  const evidence: EvidenceRecord[] = [];
  let firstBlocker: GuardRecord | undefined;
  let terminalEffect: EffectRecord | undefined;
  let terminalNode: string | null = null;
  let hops = 0;

  const addGuardEvidence = (guard: GuardRecord): void => {
    for (const id of guard.evidenceIds) {
      evidence.push(Object.freeze({ id, type: "snippet", detail: guard.condition, snippet: guard.condition }));
    }
  };

  while (queue.length && hops < maxHops) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    hops += 1;
    terminalNode = current;

    const currentGuard = detectGuardForNode(current);
    if (currentGuard) {
      firstBlocker ??= currentGuard;
      addGuardEvidence(currentGuard);
      if (terminateOnFirstBlocker) break;
    }

    const effect = effectAtNode(current);
    if (effect) {
      terminalEffect = effect;
      break;
    }

    let outgoing = graph.edges
      .filter(edge => edge.from === current)
      .sort((left, right) => orderKind(left.kind) - orderKind(right.kind) || left.to.localeCompare(right.to));

    outgoing = outgoing.filter(edge => {
      const { name, file } = nodeParts(edge.to);
      if (!pathAllowed(file)) {
        excludedBranches.push(Object.freeze({ kind: "filter", reason: "file or corridor policy", selector: file }));
        return false;
      }
      if (options.symbolDeny?.includes(name)) {
        excludedBranches.push(Object.freeze({ kind: "filter", reason: "symbol denylist", selector: name }));
        return false;
      }
      if (options.symbolAllow?.length && !options.symbolAllow.includes(name)) {
        excludedBranches.push(Object.freeze({ kind: "filter", reason: "symbol allowlist", selector: name }));
        return false;
      }
      return true;
    });

    if (outgoing.length > maxBranches) {
      for (const pruned of outgoing.slice(maxBranches)) {
        excludedBranches.push(Object.freeze({ kind: "pruned", reason: "maxBranches", selector: pruned.to }));
      }
      outgoing = outgoing.slice(0, maxBranches);
    }

    for (const edge of outgoing) {
      const target = edge.to;
      if (!parent.has(target)) parent.set(target, { from: current, via: edge });

      const guard = detectGuardForNode(target);
      if (guard) {
        firstBlocker ??= guard;
        addGuardEvidence(guard);
        terminalNode = target;
        if (terminateOnFirstBlocker) {
          queue.length = 0;
          break;
        }
      }

      if (!guard) {
        const suspects = suspectFieldsAtNode(target);
        if (suspects.length) {
          const pathToTarget: string[] = [];
          let cursor: string | null = target;
          while (cursor) {
            pathToTarget.unshift(cursor);
            cursor = parent.get(cursor)?.from ?? null;
          }
          const upstreamHasField = suspects.some(field => upstreamMentionsField(field, pathToTarget));
          if (!upstreamHasField) {
            const detail = `possible-missing-field: ${suspects.join(",")} on ${target}`;
            const evidenceId = cryptoFingerprint({ detail, path: pathToTarget.join(",") });
            const inferred: GuardRecord = Object.freeze({
              symbol: nodeParts(target).name,
              file: nodeParts(target).file,
              line: 0,
              condition: detail,
              guardKind: "null-check",
              evidenceIds: Object.freeze([evidenceId])
            });
            evidence.push(Object.freeze({ id: evidenceId, type: "inferred-missing-field", detail, snippet: detail }));
            firstBlocker ??= inferred;
            terminalNode = target;
            if (terminateOnFirstBlocker) {
              queue.length = 0;
              break;
            }
          }
        }
      }

      if (!visited.has(target)) queue.push(target);
    }

    if (firstBlocker && terminateOnFirstBlocker) break;
  }

  const limitsExceeded = queue.length > 0 && hops >= maxHops && !firstBlocker && !terminalEffect;
  const pathNodes: string[] = [];
  if (terminalNode) {
    let cursor: string | null = terminalNode;
    while (cursor) {
      pathNodes.unshift(cursor);
      cursor = parent.get(cursor)?.from ?? null;
    }
  }

  const path: TraceHop[] = pathNodes.map(node => {
    const { name, file } = nodeParts(node);
    const symbol = model.symbols.find(candidate => candidate.name === name && candidate.file === file);
    const fileEntry = model.snapshot.files.find(candidate => candidate.path === file);
    const via = parent.get(node)?.via;
    return Object.freeze({
      symbol: name,
      file,
      lineStart: symbol?.line,
      lineEnd: symbol?.line,
      snippet: fileEntry?.text ? snippetFor(name, fileEntry.text) : undefined,
      edgeType: via?.kind
    });
  });

  for (const node of pathNodes) {
    const { name, file } = nodeParts(node);
    for (const effect of model.effects.filter(candidate => candidate.symbol === name || candidate.file === file)) {
      const id = cryptoFingerprint({ kind: effect.kind, file: effect.file, symbol: effect.symbol, line: effect.line });
      evidence.push(Object.freeze({ id, type: "runtime-signal", detail: effect.kind, snippet: `${effect.kind} at ${effect.file}:${effect.line}` }));
    }
  }

  const uniqueEvidence = Object.freeze([...new Map(evidence.map(row => [row.id, row] as const)).values()]);
  const pathHash = cryptoFingerprint({ requestId, path: pathNodes, evidence: uniqueEvidence.map(row => row.id) });
  const certificate: PathCertificate | undefined = path.length
    ? Object.freeze({
        certificateId: createHash("sha256").update(pathHash).digest("hex").slice(0, 24),
        requestFingerprint: requestId,
        pathHash,
        createdAt: new Date().toISOString(),
        signer: "trace-beft"
      })
    : undefined;

  let status: TraceStatus;
  if (firstBlocker) status = "BLOCKED";
  else if (limitsExceeded) status = "LIMITS_EXCEEDED";
  else if (request.targetEffect) status = terminalEffect ? "CERTIFIED" : "UNABLE_TO_CERTIFY";
  else status = path.length ? "CERTIFIED" : "UNABLE_TO_CERTIFY";

  return Object.freeze({
    requestId,
    status,
    entrypoint: path[0],
    path: Object.freeze(path),
    firstBlocker,
    terminalEffect,
    excludedBranches: Object.freeze(excludedBranches),
    evidence: uniqueEvidence,
    certificate
  });
}
