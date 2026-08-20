import { CHRYPCK_TOOL_NAMES } from "./tools.js";

export const GOVERNED_CONNECTOR_MANIFEST_SCHEMA =
  "governed-connector-manifest" as const;
export const GOVERNED_CONNECTOR_MANIFEST_VERSION = 1 as const;

export type GovernedConnectorManifestEffect = "read" | "write" | "destructive";
export type GovernedConnectorManifestApproval =
  | "automatic"
  | "explicit-intent"
  | "always";

export type GovernedConnectorManifestCapability = {
  readonly toolName: (typeof CHRYPCK_TOOL_NAMES)[number];
  readonly label: string;
  readonly description: string;
  readonly effect: GovernedConnectorManifestEffect;
  readonly approval: GovernedConnectorManifestApproval;
  readonly returns: string;
  readonly errorBehavior: string;
  readonly programmaticEligible: boolean;
};

export type ChryPckGovernedConnectorManifest = {
  readonly schema: typeof GOVERNED_CONNECTOR_MANIFEST_SCHEMA;
  readonly schemaVersion: typeof GOVERNED_CONNECTOR_MANIFEST_VERSION;
  readonly connector: {
    readonly id: "chrypck";
    readonly label: "ChryPck";
    readonly domain: "repository-development";
    readonly description: string;
    readonly audience: "orchestrator";
    readonly selectionMode: "workflow-bundle";
  };
  readonly transport: {
    readonly kind: "mcp";
    readonly path: "/mcp";
    readonly authentication: "bearer";
  };
  readonly capabilities: readonly GovernedConnectorManifestCapability[];
};

export const CHRYPCK_GOVERNED_CONNECTOR_MANIFEST: ChryPckGovernedConnectorManifest =
  Object.freeze({
    schema: GOVERNED_CONNECTOR_MANIFEST_SCHEMA,
    schemaVersion: GOVERNED_CONNECTOR_MANIFEST_VERSION,
    connector: Object.freeze({
      id: "chrypck",
      label: "ChryPck",
      domain: "repository-development",
      description:
        "Policy-enforced governed repository development. ChryPck plans bounded repository work, exposes only certified context, executes policy-constrained edits, validates broadly, and returns authoritative terminal evidence.",
      audience: "orchestrator",
      selectionMode: "workflow-bundle",
    }),
    transport: Object.freeze({
      kind: "mcp",
      path: "/mcp",
      authentication: "bearer",
    }),
    capabilities: Object.freeze([
      Object.freeze({
        toolName: "chrypck_plan",
        label: "Plan governed repository work",
        description:
          "Start governed repository work by building bounded diagnostics, a certified Patch Corridor, and the initial Context Pack for the requested objective.",
        effect: "read",
        approval: "automatic",
        returns:
          "A bounded run identifier, repository diagnostics, certified change/context scope, architecture-review state when requested, and the next permitted action.",
        errorBehavior:
          "Returns structured policy or transport failure evidence. Fail-closed policy outcomes are authoritative and must not be bypassed with another repository capability.",
        programmaticEligible: false,
      }),
      Object.freeze({
        toolName: "chrypck_context",
        label: "Read certified repository context",
        description:
          "Read only server-certified Context Pack evidence for an existing ChryPck run, optionally expanding one server-issued segment.",
        effect: "read",
        approval: "automatic",
        returns:
          "The certified context index or one bounded server-issued context segment together with the run's next permitted action.",
        errorBehavior:
          "Returns structured run, policy, or transport failure evidence. Arbitrary repository paths are never accepted as a fallback.",
        programmaticEligible: false,
      }),
      Object.freeze({
        toolName: "chrypck_execute",
        label: "Execute governed repository change",
        description:
          "Execute user-authorized bounded edits or explicit approval of an already-issued architecture plan through propagation, validation, and atomic publication.",
        effect: "write",
        approval: "explicit-intent",
        returns:
          "The governed execution outcome, including publication state, propagation/validation evidence, and the resulting permitted next action.",
        errorBehavior:
          "Returns structured policy, validation, conflict, or transport failure evidence. A failed or denied mutation must not be simulated, broadened, or retried through an unrestricted repository tool.",
        programmaticEligible: false,
      }),
      Object.freeze({
        toolName: "chrypck_result",
        label: "Read governed repository result",
        description:
          "Read the authoritative bounded state and terminal outcome of an existing ChryPck run after planning, execution, or failure.",
        effect: "read",
        approval: "automatic",
        returns:
          "Bounded run state, project profile, propagation and validation evidence, telemetry, terminal status, and other authoritative result metadata.",
        errorBehavior:
          "Returns structured run or transport failure evidence. Missing or failed run state must be reported rather than inferred.",
        programmaticEligible: false,
      }),
    ]),
  });

validateManifest(CHRYPCK_GOVERNED_CONNECTOR_MANIFEST);

export function getChryPckGovernedConnectorManifest(): ChryPckGovernedConnectorManifest {
  return CHRYPCK_GOVERNED_CONNECTOR_MANIFEST;
}

function validateManifest(manifest: ChryPckGovernedConnectorManifest): void {
  const manifestToolNames = manifest.capabilities
    .map((capability) => capability.toolName)
    .sort((left, right) => left.localeCompare(right));
  const runtimeToolNames = [...CHRYPCK_TOOL_NAMES].sort((left, right) =>
    left.localeCompare(right),
  );

  if (
    manifestToolNames.length !== runtimeToolNames.length ||
    manifestToolNames.some((toolName, index) => toolName !== runtimeToolNames[index])
  ) {
    throw new Error(
      "ChryPck governed connector manifest must describe exactly the exported MCP tool surface.",
    );
  }

  for (const capability of manifest.capabilities) {
    if (
      !capability.label.trim() ||
      !capability.description.trim() ||
      !capability.returns.trim() ||
      !capability.errorBehavior.trim()
    ) {
      throw new Error(
        `ChryPck governed connector capability ${capability.toolName} is incomplete.`,
      );
    }
    if (
      capability.effect !== "read" &&
      capability.approval === "automatic"
    ) {
      throw new Error(
        `ChryPck governed connector capability ${capability.toolName} cannot mutate automatically.`,
      );
    }
    if (
      capability.programmaticEligible &&
      (capability.effect !== "read" || capability.approval !== "automatic")
    ) {
      throw new Error(
        `ChryPck governed connector capability ${capability.toolName} is not eligible for programmatic execution.`,
      );
    }
  }
}
