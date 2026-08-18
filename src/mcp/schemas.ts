import type { AuthoringEdit } from "../mutation/authoring-compiler.js";

export interface PlanInput {
  readonly repository: string;
  readonly objective: string;
  readonly base_ref?: string;
}

export interface ContextInput {
  readonly run_id: string;
  readonly segment_id?: string;
}

export interface ExecuteInput {
  readonly run_id: string;
  readonly authoring_intent: {
    readonly id: string;
    readonly objective: string;
    readonly edits: readonly AuthoringEdit[];
  };
  readonly commit_message?: string;
}

export interface ResultInput {
  readonly run_id: string;
}
