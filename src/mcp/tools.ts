export const CHRYPCK_TOOL_NAMES=["chrypck_plan","chrypck_context","chrypck_execute","chrypck_result"] as const;
export type ChryPckToolName=typeof CHRYPCK_TOOL_NAMES[number];
export const CHRYPCK_TOOLS=Object.freeze([
{name:"chrypck_plan",readOnly:true,description:"Start governed repository work. Build bounded diagnostics and a certified corridor for the requested objective; optional analysis/architecture modes stay read-only until an explicit execute step."},
{name:"chrypck_context",readOnly:true,description:"Read only server-certified Context Pack evidence from an existing READY run. Omit segment_id for the index or use a server-issued segment_id for one bounded source expansion; arbitrary paths are never accepted."},
{name:"chrypck_execute",readOnly:false,description:"Mutate an existing planned run using exactly one mode: typed bounded authoring edits or explicit approval of a server-issued architecture plan. ChryPck performs propagation, validation, and atomic publication."},
{name:"chrypck_result",readOnly:true,description:"Read the authoritative bounded run state and outcome, especially after execution or failure, including validation/propagation evidence and terminal status."}
] as const);
