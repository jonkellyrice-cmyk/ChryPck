import type { RepositoryModel } from "../repository/model.js"; import type { AnalysisResult, Analyzer } from "./analyzer.js";
export const dependency_graphAnalyzer:Analyzer={name:"dependency-graph",analyze(model:RepositoryModel):AnalysisResult{return {analyzer:"dependency-graph",findings:model.dependencies};}};
