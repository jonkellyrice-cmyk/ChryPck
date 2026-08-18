import type { RepositoryModel } from "../repository/model.js"; import type { AnalysisResult, Analyzer } from "./analyzer.js";
export const state_namespacesAnalyzer:Analyzer={name:"state-namespaces",analyze(model:RepositoryModel):AnalysisResult{return {analyzer:"state-namespaces",findings:model.states};}};
