import { createHash } from "node:crypto";
import type { RepositoryModel } from "../repository/model.js";
import type { PatchCorridor } from "../planning/patch-corridor.js";
import { buildTraceGraph, type TraceEdge } from "./trace-graph.js";

/**
 * Bounded Event-Flow Trace (BEFT) scaffold
 * - Provides request/result interfaces and a read-only analysis stub.
 * - Intended to be integrated as an `analysis.kind = "bounded-event-trace"`
 *   mode of `chrypck_plan` and MUST be purely analysis-only.
 */

export interface TraceOptions {
  fileGlobAllow?: string[];
  fileGlobDeny?: string[];
  namespaceAllow?: string[];
  namespaceDeny?: string[];
  symbolAllow?: string[];
  symbolDeny?: string[];
  maxHops?: number;
  maxBranches?: number;
  terminateOnFirstBlocker?: boolean;
  certifyMode?: "strict" | "relaxed";
}

export interface TraceRequest {
  readonly requestId?: string;
  readonly repository: string;
  readonly commitSha?: string;
  readonly sourceSymbol: string;
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
  readonly evidenceIds: string[];
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

/**
 * Stubbed analyzer: performs validation of inputs and returns a deterministic
 * UNABLE_TO_CERTIFY result. Replace with the full algorithm implementation.
 */
export async function analyzeBoundedEventTrace(
  request: TraceRequest,
  model: RepositoryModel,
  corridor: PatchCorridor
): Promise<TraceResult> {
  const requestId = request.requestId ?? cryptoFingerprint(request);
  const emptyResult: TraceResult = Object.freeze({
    requestId,
    status: "UNABLE_TO_CERTIFY",
    entrypoint: undefined,
    path: [],
    excludedBranches: [],
    evidence: []
  });

  // Basic validation: source symbol must exist in the model
  const matchedSymbols = model.symbols.filter(s =>
    s.name === request.sourceSymbol || `${s.file}::${s.name}` === request.sourceSymbol || `${s.name}@${s.file}` === request.sourceSymbol
  );
  if (matchedSymbols.length === 0) return emptyResult;

  // Filters and options
  const opts = request.options ?? {};
  const maxHops = opts.maxHops ?? 12;
  const maxBranches = opts.maxBranches ?? 2;
  const terminateOnFirstBlocker = opts.terminateOnFirstBlocker !== false;

  // Corridor constraint: if certified corridor, only allow files inside it
  const allowedFiles = corridor.certified ? new Set(corridor.files.map(f => f.path)) : null;

  const graph = buildTraceGraph(model);

  // Resolve starting node deterministically: prefer exact file::symbol match
  const exact = matchedSymbols.find(s => `${s.file}::${s.name}` === request.sourceSymbol || `${s.name}@${s.file}` === request.sourceSymbol);
  const chosen = exact ?? matchedSymbols[0]!;
  const startNodeId = `${chosen.name}@${chosen.file}`;

  // helper: match filters
  function pathAllowed(file: string): boolean {
    if (allowedFiles && !allowedFiles.has(file)) return false;
    if (opts.fileGlobDeny && opts.fileGlobDeny.some(p => globMatch(p, file))) return false;
    if (opts.fileGlobAllow && opts.fileGlobAllow.length && !opts.fileGlobAllow.some(p => globMatch(p, file))) return false;
    return true;
  }

  // helper: detect guard patterns conservatively
  function detectGuardForNode(nodeId: string): GuardRecord | null {
    const parts = nodeId.split("@");
    const name = parts[0] ?? "";
    const file = parts[1] ?? "";
    const facts = model.fileFacts.find(f => f.file === file);
    const fileEntry = model.snapshot.files.find(f => f.path === file);
    if (!facts || !fileEntry || fileEntry.text === undefined) return null;
    // find symbol facts
    const symbol = facts.symbols.find(s => s.name === name);
    const startLine = symbol ? symbol.line : 1;
    const nextSymbolLine = facts.symbols.find(s => s.line > startLine)?.line ?? (fileEntry.text.split("\n").length + 1);
    const lines = fileEntry.text.split("\n").slice(startLine - 1, nextSymbolLine - 1);
    const block = lines.join("\n").slice(0, 2000);
    // simple heuristics for early-return guards referencing common event names
    const guardRegexes: Array<[RegExp, string]> = [
      [/(if\s*\([^)]*(?:msg|message|payload|event)[^)]*\)\s*return\b)/i, "early-return"],
      [/(if\s*\([^)]*\b(?:==\s*null|===\s*null|==\s*undefined)\b[^)]*\)\s*return\b)/i, "null-check"],
      [/(if\s*\([^)]*\bseen\b[^)]*\)\s*return\b)/i, "dedupe"],
      [/(if\s*\([^)]*\b(has|includes|contains)\b[^)]*\)\s*return\b)/i, "suppression"],
    ];
    for (const [rx, kind] of guardRegexes) {
      const m = block.match(rx);
      if (m) {
        const snippet = m[1] ?? m[0];
        const evidenceId = cryptoFingerprint({ file, snippet });
        return {
          symbol: name,
          file,
          line: startLine,
          condition: snippet.replace(/\s+/g, " ").trim(),
          guardKind: kind as GuardRecord["guardKind"],
          evidenceIds: [evidenceId]
        };
      }
    }
    return null;
  }

  // traversal
  const queue: string[] = [startNodeId];
  const parent = new Map<string, { from: string | null; via: TraceEdge | null }>();
  parent.set(startNodeId, { from: null, via: null });
  const visited = new Set<string>();
  const excludedBranches: ExclusionRecord[] = [];
  const evidence: EvidenceRecord[] = [];
  let firstBlocker: GuardRecord | undefined = undefined;
  let terminalEffect: EffectRecord | undefined = undefined;

  let hops = 0;
  while (queue.length && hops < maxHops) {
    const current = queue.shift() as string;
    if (visited.has(current)) continue;
    visited.add(current);
    hops += 1;

    // enumerate outgoing edges and apply ordering and filters
    let outgoing: TraceEdge[] = graph.edges.filter((e: TraceEdge) => e.from === current);
    // prioritize call/state-write/state-read over dependency
    outgoing = outgoing.sort((a: TraceEdge, b: TraceEdge) => orderKind(a.kind) - orderKind(b.kind) || a.to.localeCompare(b.to));
    // apply file-based filter
    outgoing = outgoing.filter((e: TraceEdge) => {
      const toParts = (e.to ?? "").split("@");
      const toFile = toParts[1] ?? "";
      if (!pathAllowed(toFile)) {
        excludedBranches.push({ kind: "filter", reason: "file or corridor policy", selector: toFile });
        return false;
      }
      if (opts.symbolDeny && opts.symbolDeny.includes(toParts[0] ?? "")) {
        excludedBranches.push({ kind: "filter", reason: "symbol denylist", selector: toParts[0] ?? "" });
        return false;
      }
      if (opts.symbolAllow && opts.symbolAllow.length && !opts.symbolAllow.includes(toParts[0] ?? "")) {
        excludedBranches.push({ kind: "filter", reason: "symbol allowlist", selector: toParts[0] ?? "" });
        return false;
      }
      return true;
    });

    if (outgoing.length === 0) continue;
    // prune to maxBranches deterministically
    if (outgoing.length > maxBranches) {
      const pruned = outgoing.slice(maxBranches);
      for (const p of pruned) excludedBranches.push({ kind: "pruned", reason: "maxBranches", selector: p.to });
      outgoing = outgoing.slice(0, maxBranches);
    }

    for (const e of outgoing) {
      const to = e.to;
      if (!parent.has(to)) parent.set(to, { from: current, via: e });
      // detect guard at target before enqueuing
      const guard = detectGuardForNode(to);
      if (guard) {
        // create evidence record
        for (const id of guard.evidenceIds) {
          evidence.push({ id, type: "snippet", detail: guard.condition, snippet: guard.condition });
        }
        firstBlocker = firstBlocker ?? guard;
        if (terminateOnFirstBlocker) {
          // reconstruct path to blocker
          queue.length = 0;
          break;
        }
      }
      queue.push(to);
    }
    if (firstBlocker && terminateOnFirstBlocker) break;
  }

  // reconstruct path from start to last visited node or blocker
  const pathNodes: string[] = [];
  // choose terminal node: if blocker present, terminal is guard.symbol@file, else last visited
  let terminalNode: string | null = null;
  if (firstBlocker) terminalNode = `${firstBlocker.symbol}@${firstBlocker.file}`;
  else {
    // pick last parent key that was visited
    for (const key of Array.from(parent.keys()).reverse()) if (visited.has(key)) { terminalNode = key; break; }
  }
  if (terminalNode) {
    let cursor: string | null = terminalNode;
    while (cursor) {
      pathNodes.unshift(cursor);
      const entry = parent.get(cursor);
      cursor = entry?.from ?? null;
    }
  }

  // build TraceHop[]
  const path: TraceHop[] = pathNodes.map((node, idx) => {
    const parts = node.split("@");
    const name = parts[0] ?? "";
    const file = parts[1] ?? "";
    const fileEntry = model.snapshot.files.find(f => f.path === file);
    const text = fileEntry?.text;
    const snippet = text ? snippetFor(name, text) : undefined;
    return Object.freeze({ symbol: name, file, lineStart: undefined, lineEnd: undefined, snippet, edgeType: undefined });
  });

  if (firstBlocker) {
    terminalEffect = undefined;
  } else if (request.targetEffect) {
    // try to match terminal node to targetEffect via symbol name or model.effects
    const matchedEffect = model.effects.find(e => e.kind === request.targetEffect || e.symbol === request.targetEffect);
    if (matchedEffect) terminalEffect = { kind: matchedEffect.kind, symbol: matchedEffect.symbol, file: matchedEffect.file };
  }

  // incorporate runtime-signal evidence from model.effects for path and terminal effect
  for (const node of pathNodes) {
    const [name, file] = node.split("@");
    for (const eff of model.effects.filter(e => e.symbol === name || e.file === file)) {
      const id = cryptoFingerprint({ kind: eff.kind, file: eff.file, symbol: eff.symbol });
      evidence.push({ id, type: "runtime-signal", detail: eff.kind, snippet: `${eff.kind} at ${eff.file}:${eff.line}` });
    }
  }
  if (terminalEffect) {
    const effs = model.effects.filter(e => e.kind === terminalEffect.kind || e.symbol === terminalEffect.symbol);
    for (const eff of effs) {
      const id = cryptoFingerprint({ kind: eff.kind, file: eff.file, symbol: eff.symbol });
      evidence.push({ id, type: "runtime-signal", detail: eff.kind, snippet: `${eff.kind} at ${eff.file}:${eff.line}` });
    }
  }

  // certificate
  const evidenceIds = evidence.map(e => e.id).join(":");
  const pathHash = cryptoFingerprint({ requestId, path: pathNodes.join(","), evidence: evidenceIds });
  const certificate: PathCertificate = {
    certificateId: createHash("sha256").update(pathHash).digest("hex").slice(0, 24),
    requestFingerprint: requestId,
    pathHash,
    createdAt: new Date().toISOString(),
    signer: "beft-analyzer"
  };

  const status: TraceStatus = firstBlocker ? "BLOCKED" : (terminalEffect ? "CERTIFIED" : (path.length ? "UNABLE_TO_CERTIFY" : "UNABLE_TO_CERTIFY"));

  const result: TraceResult = Object.freeze({
    requestId,
    status,
    entrypoint: path.length ? path[0] : undefined,
    path,
    firstBlocker: firstBlocker ?? undefined,
    terminalEffect: terminalEffect ?? undefined,
    excludedBranches: Object.freeze(excludedBranches),
    evidence: Object.freeze(evidence),
    certificate
  });
  return result;
}

function cryptoFingerprint(obj: unknown): string {
  const h = createHash("sha256");
  try { h.update(JSON.stringify(obj, Object.keys(obj as any).sort())); } catch { h.update(String(obj)); }
  return h.digest("hex");
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
  const idx = text.indexOf(name);
  if (idx === -1) return text.slice(0, Math.min(400, text.length));
  const start = Math.max(0, idx - 120);
  const end = Math.min(text.length, idx + 280);
  return text.slice(start, end);
}

function globMatch(pattern: string, value: string): boolean {
  // naive glob: * -> .* , ? -> .
  const esc = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&");
  const re = new RegExp("^" + esc.replace(/\\\*/g, ".*").replace(/\\\?/g, ".") + "$", "i");
  return re.test(value);
}
