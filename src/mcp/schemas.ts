import type { AuthoringEdit } from "../mutation/authoring-compiler.js";
import type { ArchitectureRequest } from "../architecture/index.js";
export interface PlanInput{readonly repository:string;readonly objective:string;readonly base_ref?:string;readonly architecture?:ArchitectureRequest}
export interface ContextInput{readonly run_id:string;readonly segment_id?:string}
export type ExecuteInput =
  | Readonly<{ run_id:string; authoring_intent:Readonly<{id:string;objective:string;edits:readonly AuthoringEdit[]}>; commit_message?:string; architecture_approval?:never }>
  | Readonly<{ run_id:string; architecture_approval:Readonly<{plan_id:string}>; commit_message?:string; authoring_intent?:never }>;
export interface ResultInput{readonly run_id:string}
