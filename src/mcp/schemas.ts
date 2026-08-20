import type { AuthoringEdit } from "../mutation/authoring-compiler.js";
import type { ArchitectureRequest } from "../architecture/index.js";
import type { SemanticBootstrapSubmissionInput } from "../semantic/types.js";

export interface TraceAnalysisInput{
  readonly kind: "trace";
  readonly max_hops?: number;
  readonly max_branches?: number;
}

export interface BoundedEventTraceInput {
  readonly kind: "bounded-event-trace";
  readonly sourceSymbol: string;
  readonly targetEffect?: string;
  readonly options?: {
    readonly fileGlobAllow?: string[];
    readonly fileGlobDeny?: string[];
    readonly namespaceAllow?: string[];
    readonly namespaceDeny?: string[];
    readonly symbolAllow?: string[];
    readonly symbolDeny?: string[];
    readonly maxHops?: number;
    readonly maxBranches?: number;
    readonly terminateOnFirstBlocker?: boolean;
  };
}

export type AnalysisInput = TraceAnalysisInput | BoundedEventTraceInput;

export interface PlanInput{
  readonly repository:string;
  readonly objective:string;
  readonly base_ref?:string;
  readonly architecture?:ArchitectureRequest;
  readonly analysis?:AnalysisInput;
  readonly semantic_bootstrap?:SemanticBootstrapSubmissionInput;
}
export interface ContextInput{readonly run_id:string;readonly segment_id?:string}
export type ExecuteInput =
  | Readonly<{ run_id:string; authoring_intent:Readonly<{id:string;objective:string;edits:readonly AuthoringEdit[]}>; commit_message?:string; architecture_approval?:never }>
  | Readonly<{ run_id:string; architecture_approval:Readonly<{plan_id:string}>; commit_message?:string; authoring_intent?:never }>;
export interface ResultInput{readonly run_id:string}
