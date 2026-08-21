import type { RepositoryModel } from "../repository/model.js";
import type { AnalysisResult, Analyzer } from "./analyzer.js";
import { dependencyGraphAnalyzer } from "./dependency-graph.js";
import { dependencyWatershedAnalyzer } from "./dependency-watershed.js";
import { symbolFamiliesAnalyzer } from "./symbol-families.js";
import { effectAtlasAnalyzer } from "./effect-atlas.js";
import { integrationSurfacesAnalyzer } from "./integration-surfaces.js";
import { runtimeSignalsAnalyzer } from "./runtime-signals.js";
import { stateNamespacesAnalyzer } from "./state-namespaces.js";
import { contractMapAnalyzer } from "./contract-map.js";
import { effectRuntimeAtlasAnalyzer } from "./effect-runtime-atlas.js";
export const NATIVE_ANALYZERS:readonly Analyzer[] = Object.freeze([dependencyGraphAnalyzer,dependencyWatershedAnalyzer,symbolFamiliesAnalyzer,effectRuntimeAtlasAnalyzer,effectAtlasAnalyzer,integrationSurfacesAnalyzer,runtimeSignalsAnalyzer,stateNamespacesAnalyzer,contractMapAnalyzer]);
export function runNativeDiagnostics(model:RepositoryModel,analyzers:readonly Analyzer[]=NATIVE_ANALYZERS):readonly AnalysisResult[]{return Object.freeze(analyzers.map(analyzer=>analyzer.analyze(model)));}
export function diagnosticsByName(results:readonly AnalysisResult[]):ReadonlyMap<string,AnalysisResult>{return new Map(results.map(result=>[result.analyzer,result] as const));}
