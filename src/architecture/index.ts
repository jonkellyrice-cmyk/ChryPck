import type { AnalysisResult } from "../analysis/analyzer.js";
import type { RepositoryModel } from "../repository/model.js";
import type { PatchCorridor } from "../planning/patch-corridor.js";
import { planDomainDecomposition, type DomainDecompositionPlan, type DomainDecomposerOptions } from "./domain-decomposer.js";
import { planPathMoves, type PathMove, type PathMovePlan } from "./path-mover.js";

export type ArchitectureRequest =
  | Readonly<{ kind: "decompose"; paths?: readonly string[] }>
  | Readonly<{ kind: "move"; moves: readonly PathMove[] }>;
export type ArchitecturePlan = DomainDecompositionPlan | PathMovePlan;

export function planArchitecture(model: RepositoryModel, request: ArchitectureRequest): ArchitecturePlan {
  if (request.kind === "move") return planPathMoves(model, request.moves);
  const options: DomainDecomposerOptions = { paths: request.paths };
  return planDomainDecomposition(model, options);
}

export function architectureCorridor(objective: string, model: RepositoryModel, plan: ArchitecturePlan, diagnostics: readonly AnalysisResult[]): PatchCorridor {
  const missing = plan.affectedExistingPaths.filter(path => !model.fileFacts.some(facts => facts.file === path));
  const gaps = [...plan.gaps, ...missing.map(path => `architecture path missing from repository model: ${path}`)];
  const paths = [...new Set(plan.affectedExistingPaths)].sort();
  const files = paths.map(path => Object.freeze({ path, reasons:Object.freeze([`${plan.kind} certified architectural path`]), confidence:1, score:100, symbols:Object.freeze([]) }));
  const certified = gaps.length === 0 && paths.length > 0;
  return Object.freeze({
    objective,
    certified,
    files:Object.freeze(files),
    corridor:Object.freeze(paths),
    clauses:Object.freeze([{ id:"architecture-1", text:objective, terms:Object.freeze([]), owner:paths[0] ?? null, candidateOwners:Object.freeze(paths.slice(0,4)), path:Object.freeze(paths), score:certified?100:0, complete:certified, basis:certified?`${plan.kind} plan resolved against repository model`:`${plan.kind} plan contains gaps` }]),
    gaps:Object.freeze(gaps),
    diagnostics:Object.freeze(diagnostics.map(result=>result.analyzer).sort()),
    summary:Object.freeze({ clauseCount:1, coveredCount:certified?1:0, fileCount:paths.length, confidence:certified?"high" as const:"incomplete" as const })
  });
}
