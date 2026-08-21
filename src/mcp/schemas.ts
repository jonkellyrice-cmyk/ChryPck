import type { AuthoringEdit } from "../mutation/authoring-compiler.js";
import type { ArchitectureRequest } from "../architecture/index.js";
import type { TraceHandoffReference } from "../planning/trace-handoff.js";
import type { AnalysisHandoffReference } from "../planning/analysis-handoff.js";
import type { DataflowSliceCriterion, DataflowSliceDirection, DataflowSliceOptions } from "../analysis/dataflow-slice.js";
import type { SemanticBootstrapSubmissionInput } from "../semantic/types.js";

export interface TraceAnalysisInput {
  readonly kind: "trace";
  readonly sourceSymbol?: string;
  readonly targetEffect?: string;
  readonly options?: {
    readonly fileGlobAllow?: string[];
    readonly fileGlobDeny?: string[];
    readonly symbolAllow?: string[];
    readonly symbolDeny?: string[];
    readonly maxHops?: number;
    readonly maxBranches?: number;
    readonly terminateOnFirstBlocker?: boolean;
    readonly certifyMode?: "strict" | "relaxed";
  };
}

export interface DataflowSliceAnalysisInput {
  readonly kind: "dataflow-slice";
  readonly criterion: DataflowSliceCriterion;
  readonly direction: DataflowSliceDirection;
  readonly target?: DataflowSliceCriterion;
  readonly options?: DataflowSliceOptions;
}

export type AnalysisInput = TraceAnalysisInput | DataflowSliceAnalysisInput;
export type ResponseMode = "compact" | "full";

export interface PlanInput {
  readonly repository:string;
  readonly objective:string;
  readonly base_ref?:string;
  readonly architecture?:ArchitectureRequest;
  readonly analysis?:AnalysisInput;
  readonly trace_handoff?:TraceHandoffReference;
  readonly analysis_handoff?:AnalysisHandoffReference;
  readonly semantic_bootstrap?:SemanticBootstrapSubmissionInput;
  /** Compact is the governed default: return handles and bounded grants, not every persisted artifact. */
  readonly response_mode?:ResponseMode;
}
export interface ContextInput{readonly run_id:string;readonly segment_id?:string}
export type ExecuteInput =
  | Readonly<{ run_id:string; authoring_intent:Readonly<{id:string;objective:string;edits:readonly AuthoringEdit[]}>; commit_message?:string; architecture_approval?:never }>
  | Readonly<{ run_id:string; architecture_approval:Readonly<{plan_id:string}>; commit_message?:string; authoring_intent?:never }>;
export interface ResultInput{readonly run_id:string;readonly response_mode?:ResponseMode}
