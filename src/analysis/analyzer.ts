import type { RepositoryModel } from "../repository/model.js";
export interface AnalysisResult<T=unknown>{readonly analyzer:string;readonly findings:readonly T[]} export interface Analyzer<T=unknown>{readonly name:string;analyze(model:RepositoryModel):Promise<AnalysisResult<T>>|AnalysisResult<T>}
