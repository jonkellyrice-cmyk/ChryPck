import type { RepositoryModel } from "../repository/model.js";
export type FindingSeverity = "info" | "warning" | "error";
export interface DiagnosticFinding<T = Readonly<Record<string, unknown>>> { readonly code:string; readonly severity:FindingSeverity; readonly summary:string; readonly evidence?:T; }
export interface AnalysisResult<TFinding = DiagnosticFinding> { readonly analyzer:string; readonly summary:Readonly<Record<string, number|string|boolean>>; readonly findings:readonly TFinding[]; }
export interface Analyzer<TFinding = DiagnosticFinding> { readonly name:string; analyze(model:RepositoryModel):AnalysisResult<TFinding>; }
export function freezeResult<T>(analyzer:string,summary:Readonly<Record<string, number|string|boolean>>,findings:readonly T[]):AnalysisResult<T>{return Object.freeze({analyzer,summary:Object.freeze({...summary}),findings:Object.freeze([...findings])});}
