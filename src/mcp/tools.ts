export const CHRYPCK_TOOL_NAMES=["chrypck_plan","chrypck_context","chrypck_execute","chrypck_result"] as const;
export type ChryPckToolName=typeof CHRYPCK_TOOL_NAMES[number];
export const CHRYPCK_TOOLS=Object.freeze([
{name:"chrypck_plan",readOnly:true,description:"Build the hidden repository model, expose compressed diagnostics, optionally produce a review-required decomposition/move plan, and certify a bounded corridor."},
{name:"chrypck_context",readOnly:true,description:"Return only server-certified Context Pack expansion; arbitrary paths are never accepted."},
{name:"chrypck_execute",readOnly:false,description:"Execute typed bounded edits or an explicitly approved server-issued path-move plan through mutation, propagation, validation, and atomic publication."},
{name:"chrypck_result",readOnly:true,description:"Return bounded native run state, telemetry, propagation/validation outcomes, and terminal evidence."}
] as const);
