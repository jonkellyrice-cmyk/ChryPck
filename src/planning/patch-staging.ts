import type { RepositoryModel } from "../repository/model.js";
import type { PatchCorridor } from "./patch-corridor.js";

export interface PatchStage {
  readonly id: string;
  readonly phase: number;
  readonly files: readonly string[];
  readonly dependsOn: readonly string[];
  readonly cyclic: boolean;
}

export interface PatchStagingPlan {
  readonly objective: string;
  readonly certified: boolean;
  readonly stages: readonly PatchStage[];
  readonly gaps: readonly string[];
}

function stronglyConnected(nodes: readonly string[], dependencies: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indexes = new Map<string, number>();
  const low = new Map<string, number>();
  const components: string[][] = [];
  const visit = (node: string): void => {
    indexes.set(node, index); low.set(node, index); index += 1; stack.push(node); onStack.add(node);
    for (const dependency of dependencies.get(node) ?? []) {
      if (!indexes.has(dependency)) { visit(dependency); low.set(node, Math.min(low.get(node) ?? 0, low.get(dependency) ?? 0)); }
      else if (onStack.has(dependency)) low.set(node, Math.min(low.get(node) ?? 0, indexes.get(dependency) ?? 0));
    }
    if (low.get(node) === indexes.get(node)) {
      const component: string[] = [];
      while (stack.length) {
        const member = stack.pop();
        if (!member) break;
        onStack.delete(member); component.push(member);
        if (member === node) break;
      }
      components.push(component.sort());
    }
  };
  for (const node of [...nodes].sort()) if (!indexes.has(node)) visit(node);
  return components;
}

export function planPatchStages(corridor: PatchCorridor, model: RepositoryModel, maxFilesPerStage = 1): PatchStagingPlan {
  if (!corridor.certified) return Object.freeze({ objective: corridor.objective, certified: false, stages: Object.freeze([]), gaps: Object.freeze(["Patch Staging requires a certified corridor."]) });
  if (!Number.isInteger(maxFilesPerStage) || maxFilesPerStage < 1 || maxFilesPerStage > 4) throw new Error("maxFilesPerStage must be an integer from 1 to 4.");
  const selected = new Set(corridor.files.map(file => file.path));
  const dependencies = new Map<string, Set<string>>([...selected].map(path => [path, new Set()]));
  for (const edge of model.dependencies) if (selected.has(edge.from) && selected.has(edge.to) && edge.from !== edge.to) dependencies.get(edge.from)?.add(edge.to);
  const components = stronglyConnected([...selected], dependencies);
  const componentByFile = new Map<string, number>();
  components.forEach((component, id) => component.forEach(file => componentByFile.set(file, id)));
  const consumers = new Map<number, Set<number>>(components.map((_, id) => [id, new Set()]));
  const indegree = new Map<number, number>(components.map((_, id) => [id, 0]));
  for (const [consumerFile, providers] of dependencies) {
    const consumerId = componentByFile.get(consumerFile);
    if (consumerId === undefined) continue;
    for (const providerFile of providers) {
      const providerId = componentByFile.get(providerFile);
      if (providerId === undefined || providerId === consumerId) continue;
      if (!consumers.get(providerId)?.has(consumerId)) {
        consumers.get(providerId)?.add(consumerId);
        indegree.set(consumerId, (indegree.get(consumerId) ?? 0) + 1);
      }
    }
  }
  let frontier = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id).sort((a, b) => a - b);
  const componentPhase = new Map<number, number>();
  let phase = 1;
  while (frontier.length) {
    const next: number[] = [];
    for (const id of frontier) {
      componentPhase.set(id, phase);
      for (const consumer of consumers.get(id) ?? []) {
        const degree = (indegree.get(consumer) ?? 0) - 1;
        indegree.set(consumer, degree);
        if (degree === 0) next.push(consumer);
      }
    }
    frontier = [...new Set(next)].sort((a, b) => a - b);
    phase += 1;
  }
  if (componentPhase.size !== components.length) return Object.freeze({ objective: corridor.objective, certified: false, stages: Object.freeze([]), gaps: Object.freeze(["Condensed dependency graph could not be staged."]) });
  const stages: PatchStage[] = [];
  let serial = 1;
  const maxPhase = Math.max(0, ...componentPhase.values());
  for (let current = 1; current <= maxPhase; current += 1) {
    const componentIds = [...componentPhase.entries()].filter(([, value]) => value === current).map(([id]) => id).sort((a, b) => a - b);
    const files = componentIds.flatMap(id => components[id] ?? []).sort();
    for (let offset = 0; offset < files.length; offset += maxFilesPerStage) {
      const batch = files.slice(offset, offset + maxFilesPerStage);
      const prior = stages.filter(stage => stage.phase < current).map(stage => stage.id);
      stages.push(Object.freeze({
        id: `stage-${String(serial).padStart(2, "0")}`,
        phase: current,
        files: Object.freeze(batch),
        dependsOn: Object.freeze(prior),
        cyclic: batch.some(file => (components[componentByFile.get(file) ?? -1]?.length ?? 0) > 1)
      }));
      serial += 1;
    }
  }
  return Object.freeze({ objective: corridor.objective, certified: true, stages: Object.freeze(stages), gaps: Object.freeze([]) });
}

export const singleStage = (corridor: PatchCorridor): readonly PatchStage[] => [Object.freeze({ id: "stage-01", phase: 1, files: Object.freeze(corridor.files.map(file => file.path)), dependsOn: Object.freeze([]), cyclic: false })];
