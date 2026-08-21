import type { RepositoryModel } from "../repository/model.js";
import { freezeResult, type Analyzer, type DiagnosticFinding } from "./analyzer.js";
import { buildEffectRuntimeAtlas } from "./effect-runtime-linker.js";

export const effectRuntimeAtlasAnalyzer: Analyzer<DiagnosticFinding> = Object.freeze({
  name: "effect-runtime-atlas",
  analyze(model: RepositoryModel) {
    const atlas = buildEffectRuntimeAtlas(model);
    const findings: DiagnosticFinding[] = atlas.regions.map(region => Object.freeze({
      code: region.reconciliation === "native-conflict" ? "RUNTIME_REGION_NATIVE_CONFLICT" : region.reconciliation === "unresolved" ? "UNRESOLVED_RUNTIME_REGION" : "EFFECT_RUNTIME_REGION",
      severity: region.reconciliation === "native-conflict" ? "error" as const : region.reconciliation === "unresolved" ? "warning" as const : "info" as const,
      summary: `Runtime region '${region.id}' spans ${region.files.length} file(s), ${region.entryPointIds.length} entry point(s), and ${region.terminalEffectIds.length} terminal effect(s).`,
      evidence: { id: region.id, files: region.files, effectKinds: region.effectKinds, entryPoints: region.entryPointIds.length, terminalEffects: region.terminalEffectIds.length, observationPoints: region.observationPointIds.length, contracts: region.contractIds, reconciliation: region.reconciliation }
    }));
    if (atlas.coverage.partial) findings.push(Object.freeze({ code: "PARTIAL_EFFECT_RUNTIME_COVERAGE", severity: "warning", summary: "Effect / Runtime Atlas coverage is partial; unresolved sites, parser gaps, or unclassified candidates remain.", evidence: { ...atlas.coverage } }));
    return freezeResult(this.name, {
      runtime_nodes: atlas.nodes.length,
      runtime_edges: atlas.edges.length,
      runtime_regions: atlas.regions.length,
      candidate_sites: atlas.coverage.candidateSites,
      classified_sites: atlas.coverage.classifiedSites,
      unresolved_sites: atlas.coverage.unresolvedSites,
      coverage_percent: atlas.coverage.coveragePercent,
      partial: atlas.coverage.partial
    }, findings);
  }
});
