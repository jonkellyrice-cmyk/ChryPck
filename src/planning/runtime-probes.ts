import type { RepositoryModel } from "../repository/model.js";
import type { PatchCorridor, CorridorClause } from "./patch-corridor.js";
import { buildEffectRuntimeAtlas, type EffectRuntimeAtlas } from "../analysis/effect-runtime-linker.js";

export interface RuntimeProbe {
  readonly id: string;
  readonly clauseId: string;
  readonly kind: "hook" | "effect" | "state" | "symbol" | "dependency" | "manual";
  readonly path: string | null;
  readonly label: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface RuntimeProbeObjective {
  readonly clauseId: string;
  readonly text: string;
  readonly probeIds: readonly string[];
  readonly status: "instrumented" | "manual";
}

export interface RuntimeProbePlan {
  readonly objective: string;
  readonly posture: "observational-only";
  readonly objectives: readonly RuntimeProbeObjective[];
  readonly probes: readonly RuntimeProbe[];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "probe";
}

function probesForClause(clause: CorridorClause, model: RepositoryModel, atlas: EffectRuntimeAtlas): RuntimeProbe[] {
  const output: RuntimeProbe[] = [];
  const paths = new Set([clause.owner, ...clause.path].filter((value): value is string => Boolean(value)));
  for (const path of [...paths].sort()) {
    const facts = model.fileFacts.find(row => row.file === path);
    if (!facts) continue;
    for (const effect of facts.effects) {
      const kind = effect.kind === "hooks" ? "hook" : "effect";
      output.push(Object.freeze({
        id: `${kind}-${slug(`${path}-${effect.kind}-${effect.line}`)}`,
        clauseId: clause.id,
        kind,
        path,
        label: `${effect.detail} at ${path}:${effect.line}`,
        evidence: Object.freeze({ effectKind: effect.kind, symbol: effect.symbol, line: effect.line })
      }));
    }
    for (const state of facts.states) output.push(Object.freeze({
      id: `state-${slug(`${path}-${state.namespace}-${state.key}-${state.line}`)}`,
      clauseId: clause.id,
      kind: "state",
      path,
      label: `${state.access} ${state.namespace}.${state.key}`,
      evidence: Object.freeze({ namespace: state.namespace, key: state.key, operation: state.operation, line: state.line })
    }));
    for (const symbol of facts.symbols.filter(symbol => clause.terms.some(term => symbol.name.toLowerCase().includes(term))).slice(0, 3)) output.push(Object.freeze({
      id: `symbol-${slug(`${path}-${symbol.name}`)}`,
      clauseId: clause.id,
      kind: "symbol",
      path,
      label: `${symbol.kind} ${symbol.name}`,
      evidence: Object.freeze({ symbol: symbol.name, line: symbol.line, exported: symbol.exported })
    }));
    const runtimeNodes = atlas.nodes.filter(node => node.file === path && node.effectKind !== "symbol-operation" && node.reconciliation !== "unresolved");
    for (const node of runtimeNodes) output.push(Object.freeze({
      id: `effect-${slug(node.id)}`,
      clauseId: clause.id,
      kind: node.kind === "entry-point" && node.effectKind === "hooks" ? "hook" : "effect",
      path,
      label: `${node.kind}: ${node.detail} at ${path}:${node.lineStart}`,
      evidence: Object.freeze({ runtimeNodeId: node.id, runtimeRegionIds: atlas.regions.filter(region => region.nodeIds.includes(node.id)).map(region => region.id), effectKind: node.effectKind, role: node.kind, reconciliation: node.reconciliation, line: node.lineStart })
    }));
  }
  const unique = new Map(output.map(probe => [probe.id, probe] as const));
  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id)).slice(0, 8);
}

export function planRuntimeProbes(corridor: PatchCorridor, model: RepositoryModel, effectRuntimeAtlas: EffectRuntimeAtlas = buildEffectRuntimeAtlas(model)): RuntimeProbePlan {
  const probes: RuntimeProbe[] = [];
  const objectives: RuntimeProbeObjective[] = [];
  for (const clause of corridor.clauses) {
    const clauseProbes = clause.complete ? probesForClause(clause, model, effectRuntimeAtlas) : [];
    if (clauseProbes.length === 0) {
      const manual: RuntimeProbe = Object.freeze({
        id: `manual-${clause.id}`,
        clauseId: clause.id,
        kind: "manual",
        path: clause.owner,
        label: `Manual observation required: ${clause.text}`,
        evidence: Object.freeze({ reason: clause.complete ? "no safe static observer candidate" : "clause is not corridor-certified" })
      });
      probes.push(manual);
      objectives.push(Object.freeze({ clauseId: clause.id, text: clause.text, probeIds: Object.freeze([manual.id]), status: "manual" }));
    } else {
      probes.push(...clauseProbes);
      objectives.push(Object.freeze({ clauseId: clause.id, text: clause.text, probeIds: Object.freeze(clauseProbes.map(probe => probe.id)), status: "instrumented" }));
    }
  }
  const unique = new Map(probes.map(probe => [probe.id, probe] as const));
  return Object.freeze({ objective: corridor.objective, posture: "observational-only", objectives: Object.freeze(objectives), probes: Object.freeze([...unique.values()].sort((left, right) => left.id.localeCompare(right.id))) });
}
