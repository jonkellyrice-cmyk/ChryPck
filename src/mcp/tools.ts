export const CHRYPCK_TOOL_NAMES = [
  "chrypck_plan",
  "chrypck_context",
  "chrypck_execute",
  "chrypck_result"
] as const;

export type ChryPckToolName = typeof CHRYPCK_TOOL_NAMES[number];

export const CHRYPCK_TOOLS = Object.freeze([
  {
    name: "chrypck_plan",
    readOnly: true,
    description: "Snapshot an allowed repository, run native diagnostics/planning, and establish governed run authority."
  },
  {
    name: "chrypck_context",
    readOnly: true,
    description: "Return only the certified Context Pack, optionally narrowed to one server-issued segment id."
  },
  {
    name: "chrypck_execute",
    readOnly: false,
    description: "Compile typed authoring edits through the certified context, validate them, and publish atomically."
  },
  {
    name: "chrypck_result",
    readOnly: true,
    description: "Return native run state, bounded artifacts, telemetry, and terminal failure/success evidence."
  }
] as const);
