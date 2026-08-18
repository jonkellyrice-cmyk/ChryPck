import type { RepositoryModel } from "../repository/model.js"; import type { AnalysisResult, Analyzer } from "./analyzer.js";
export const effect_atlasAnalyzer:Analyzer={name:"effect-atlas",analyze(model:RepositoryModel):AnalysisResult{return {analyzer:"effect-atlas",findings:model.effects};}};
