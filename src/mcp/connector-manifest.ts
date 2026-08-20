import { CHRYPCK_TOOL_NAMES } from "./tools.js";

export const GOVERNED_CONNECTOR_MANIFEST_SCHEMA =
  "governed-connector-manifest" as const;
export const GOVERNED_CONNECTOR_MANIFEST_VERSION = 3 as const;

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

export type ChryPckDiagnosticSurface = {
  readonly id:
    | "repository-atlas"
    | "coverage-ledger"
    | "semantic-atlas"
    | "semantic-coverage-ledger"
    | "dependency-graph"
    | "dependency-watershed"
    | "symbol-families"
    | "effect-atlas"
    | "integration-surfaces"
    | "runtime-signals"
    | "state-namespaces"
    | "native-contracts"
    | "runtime-probes"
    | "patch-corridor"
    | "context-pack"
    | "change-propagation";
  readonly purpose: string;
};

export type ChryPckWorkflowPhase = {
  readonly id:
    | "semantic-bootstrap"
    | "repository-orientation"
    | "general-analysis"
    | "focused-analysis"
    | "certified-context"
    | "cross-cutting-patch"
    | "execute"
    | "verify";
  readonly toolNames: readonly (typeof CHRYPCK_TOOL_NAMES)[number][];
  readonly guidance: string;
};

export type ChryPckAnalysisMode =
  | {
      readonly kind: "trace";
      readonly when: string;
      readonly input: "analysis: { kind: 'trace', max_hops?, max_branches? }";
    }
  | {
      readonly kind: "bounded-event-trace";
      readonly when: string;
      readonly input: "analysis: { kind: 'bounded-event-trace', sourceSymbol, targetEffect?, options? }";
    };

export type ChryPckGovernedConnectorManifest = {
  readonly schema: typeof GOVERNED_CONNECTOR_MANIFEST_SCHEMA;
  readonly schemaVersion: typeof GOVERNED_CONNECTOR_MANIFEST_VERSION;
  readonly connector: {
    readonly id: "chrypck";
    readonly label: "ChryPck";
    readonly aliases: readonly string[];
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
  readonly workflow: {
    readonly strategy: "semantic-orient-analyze-narrow-execute-validate";
    readonly summary: string;
    readonly diagnosticSurfaces: readonly ChryPckDiagnosticSurface[];
    readonly analysisModes: readonly ChryPckAnalysisMode[];
    readonly phases: readonly ChryPckWorkflowPhase[];
    readonly patchStrategy: string;
    readonly failurePolicy: string;
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
      aliases: Object.freeze([
        "ChryPck",
        "Chry Pck",
        "ChryPck MCP",
        "CherryPick",
        "Cherry Pick",
        "Cherry-Pick",
      ]),
      domain: "repository-development",
      description:
        "Policy-enforced governed repository development. ChryPck is designed to be the model's sole repository capability: it builds an exhaustive hidden Repository Model; on an uncached repository state it first requires the host LLM to complete a bounded chunked Semantic Atlas bootstrap from server-curated metadata; then it projects a structural Repository Atlas, evidence-backed Semantic Atlas, coverage ledgers, compressed dependency/runtime/symbol diagnostics, a certified Patch Corridor and Context Pack, executes coherent bounded cross-file patches, performs Change Propagation and broad validation, and returns authoritative terminal evidence.",
      audience: "orchestrator",
      selectionMode: "workflow-bundle",
    }),
    transport: Object.freeze({
      kind: "mcp",
      path: "/mcp",
      authentication: "bearer",
    }),
    workflow: Object.freeze({
      strategy: "semantic-orient-analyze-narrow-execute-validate",
      summary:
        "Use ChryPck as a staged repository workflow. If chrypck_plan reports semantic_bootstrap.status='required', stop ordinary repository work and repeatedly interpret the server-issued metadata chunks into evidence-cited semantic claims through chrypck_plan.semantic_bootstrap until ChryPck reports complete. Then read the Structural Atlas for where things are and the Semantic Atlas for repository purpose, subsystem responsibilities, boundaries and high-level flows. Next use compressed diagnostics to narrow attention, focused trace when useful, expand only server-certified Context Pack segments, synthesize one coherent patch across every certified runtime/dependency touch point, execute only with current user mutation authorization, and verify through the authoritative result.",
      diagnosticSurfaces: Object.freeze([
        Object.freeze({ id: "repository-atlas", purpose: "Provides a bounded compressed path tree over the whole immutable repository snapshot so the model knows the repository's global structural shape without receiving file contents." }),
        Object.freeze({ id: "coverage-ledger", purpose: "States how much of the repository was snapshotted, text-backed, modeled and structurally projected, including explicit Atlas truncation so omitted structure is never mistaken for nonexistent structure." }),
        Object.freeze({ id: "semantic-atlas", purpose: "Provides an evidence-backed semantic glossary of repository purpose, major subsystems/module groups, responsibilities, boundaries, upstream/downstream relationships and key flows. It is orientation evidence, not source authority or mutation authority." }),
        Object.freeze({ id: "semantic-coverage-ledger", purpose: "States how many semantic regions were considered, synthesized, partial or deterministic-only, how many claims were rejected, whether bootstrap was required/completed, how many chunks were processed, and whether the semantic map came from cache." }),
        Object.freeze({ id: "dependency-graph", purpose: "Shows dependency relationships across the hidden Repository Model." }),
        Object.freeze({ id: "dependency-watershed", purpose: "Shows upstream/downstream impact around relevant files and symbols." }),
        Object.freeze({ id: "symbol-families", purpose: "Groups related declarations, implementations, handlers, callers, and state participants." }),
        Object.freeze({ id: "effect-atlas", purpose: "Maps externally meaningful effects and the code paths that produce them." }),
        Object.freeze({ id: "integration-surfaces", purpose: "Identifies boundaries where subsystems, adapters, UI, runtime, or native APIs meet." }),
        Object.freeze({ id: "runtime-signals", purpose: "Projects event, callback, lifecycle, and runtime-flow evidence." }),
        Object.freeze({ id: "state-namespaces", purpose: "Shows related state ownership and mutation surfaces." }),
        Object.freeze({ id: "native-contracts", purpose: "Projects authoritative framework/native-system entry points and contracts when a project profile provides them." }),
        Object.freeze({ id: "runtime-probes", purpose: "Provides bounded project-profile runtime observations when configured." }),
        Object.freeze({ id: "patch-corridor", purpose: "Certifies the files/symbols the model may change for the objective." }),
        Object.freeze({ id: "context-pack", purpose: "Provides bounded exact-source expansion only for server-certified touch points." }),
        Object.freeze({ id: "change-propagation", purpose: "Propagates the authored change across dependent touch points before broad validation and publication." }),
      ]),
      analysisModes: Object.freeze([
        Object.freeze({
          kind: "trace",
          when: "Use after semantic bootstrap/orientation for a bug, runtime path, dependency path, handler chain, event flow, or other objective where the important question is how execution or dependency relationships travel through the repository.",
          input: "analysis: { kind: 'trace', max_hops?, max_branches? }",
        }),
        Object.freeze({
          kind: "bounded-event-trace",
          when: "Use after semantic bootstrap/orientation when a concrete source symbol/event is known and the goal is to follow it toward a target effect, UI behavior, mutation, callback, or other downstream consequence with explicit hop/branch bounds.",
          input: "analysis: { kind: 'bounded-event-trace', sourceSymbol, targetEffect?, options? }",
        }),
      ]),
      phases: Object.freeze([
        Object.freeze({
          id: "semantic-bootstrap",
          toolNames: Object.freeze(["chrypck_plan"] as const),
          guidance: "On the first uncached plan for an immutable repository commit/profile, chrypck_plan intentionally returns semantic_bootstrap.status='required' instead of ordinary diagnostics. Read every bounded metadata region in current_chunk, formulate concise architectural interpretations using only evidence_refs supplied by that same region, and call chrypck_plan again with semantic_bootstrap { bootstrap_id, chunk_id, interpretations }. Repeat chunk by chunk until status='complete'. Do not continue the user's repository task, request Context Pack source, trace, or execute while semantic bootstrap remains required. If a bootstrap session expires, accept the server-issued restart and repeat the bounded pass.",
        }),
        Object.freeze({
          id: "repository-orientation",
          toolNames: Object.freeze(["chrypck_plan"] as const),
          guidance: "After bootstrap completes, read repository_atlas + coverage to understand where the repository is organized, then semantic_atlas + semantic_coverage to understand what the repository and its major regions are for, what they own/do not own, and how they relate. Semantic claims are evidence-backed but inferential: use confidence/provenance correctly and let Repository Model diagnostics, native contracts, traces and certified source override semantic interpretation when they conflict.",
        }),
        Object.freeze({
          id: "general-analysis",
          toolNames: Object.freeze(["chrypck_plan"] as const),
          guidance: "Use ChryPck's dependency graph/watershed, symbol families, effect atlas, integration surfaces, runtime signals, state namespaces, native contracts, runtime probes and Patch Corridor to narrow the user's objective. Do not browse the repository outside ChryPck and do not mistake compressed or omitted evidence for absence.",
        }),
        Object.freeze({
          id: "focused-analysis",
          toolNames: Object.freeze(["chrypck_plan"] as const),
          guidance: "For a concrete bug or runtime question, request trace analysis. Prefer bounded-event-trace when a source symbol/event is known; otherwise use trace and let the diagnostic surfaces identify the relevant chain and blockers.",
        }),
        Object.freeze({
          id: "certified-context",
          toolNames: Object.freeze(["chrypck_context"] as const),
          guidance: "Use chrypck_context only after semantic orientation and objective-local analysis identify the exact touch points. Read the certified Context Pack index and only server-issued source segments needed to understand implementation or author the patch. Never substitute arbitrary path reads.",
        }),
        Object.freeze({
          id: "cross-cutting-patch",
          toolNames: Object.freeze(["chrypck_plan", "chrypck_context"] as const),
          guidance: "Synthesize the complete fix across the full certified runtime/dependency path. Use Semantic Atlas for architectural intent, Structural Atlas for global location, compressed diagnostics for relationships, and Context Pack for exact implementation. Include every necessary certified touch point in one coherent bounded authoring intent rather than applying isolated local edits one by one.",
        }),
        Object.freeze({
          id: "execute",
          toolNames: Object.freeze(["chrypck_execute"] as const),
          guidance: "Only after the current user turn authorizes mutation, submit the coherent typed authoring_intent for the full patch. ChryPck stages, propagates, validates and atomically publishes it; semantic metadata never expands the certified corridor or mutation authority.",
        }),
        Object.freeze({
          id: "verify",
          toolNames: Object.freeze(["chrypck_result"] as const),
          guidance: "Always read chrypck_result after execution or failure and report only the authoritative terminal, propagation, validation and publication evidence returned by ChryPck. Semantic orientation is context, not verification evidence.",
        }),
      ]),
      patchStrategy:
        "Prefer one coherent cross-cutting patch that covers all certified touch points along the relevant runtime/dependency path. ChryPck is specifically designed to make multi-file fixes tractable by exposing repository-wide structural and semantic orientation first, compressed objective-local relationships second, and exact source only where justified.",
      failurePolicy:
        "If ChryPck returns a semantic-bootstrap restart, policy, validation, transport, timeout or capability-gap result, follow that actual permitted next action and preserve any returned run_id/bootstrap_id. Do not claim ChryPck is unavailable merely because one call failed, and do not bypass the governed workflow with unrestricted repository tools.",
    }),
    capabilities: Object.freeze([
      Object.freeze({
        toolName: "chrypck_plan",
        label: "Bootstrap, analyze and plan governed repository work",
        description:
          "Start all governed repository work. On an uncached repository state it first runs a mandatory host-LLM Semantic Atlas bootstrap in bounded metadata chunks; each chunk must be interpreted with evidence_refs and submitted back through semantic_bootstrap before normal analysis continues. Once complete, it returns the Structural Atlas, Semantic Atlas and both coverage ledgers, projects dependency/runtime/symbol diagnostics, certifies the Patch Corridor and Context Pack, and optionally runs focused trace or bounded-event-trace analysis.",
        effect: "read",
        approval: "automatic",
        returns:
          "Either the next mandatory semantic_bootstrap metadata chunk, or after bootstrap completion a bounded run identifier, Repository Atlas, structural coverage ledger, Semantic Atlas, semantic coverage ledger, repository diagnostics, trace evidence when requested, certified change/context scope, architecture-review state when requested, and the next permitted action.",
        errorBehavior:
          "Returns structured bootstrap-restart, policy, analysis, timeout, or transport failure evidence. Fail-closed outcomes are authoritative and must not be bypassed with another repository capability.",
        programmaticEligible: false,
      }),
      Object.freeze({
        toolName: "chrypck_context",
        label: "Read certified repository context",
        description:
          "Read only server-certified Context Pack evidence for an existing ChryPck run after required semantic bootstrap/orientation and diagnostics identify exact touch points, optionally expanding one server-issued segment for implementation understanding or patch authoring.",
        effect: "read",
        approval: "automatic",
        returns:
          "The certified context index or one bounded server-issued exact-source context segment together with the run's next permitted action.",
        errorBehavior:
          "Returns structured run, bootstrap-state, policy, or transport failure evidence. Arbitrary repository paths are never accepted as a fallback.",
        programmaticEligible: false,
      }),
      Object.freeze({
        toolName: "chrypck_execute",
        label: "Execute governed repository change",
        description:
          "Execute the user-authorized coherent bounded cross-file patch or explicit approval of an already-issued architecture plan only after semantic bootstrap and normal planning complete, through staging, dependency-aware Change Propagation, broad validation, and atomic publication.",
        effect: "write",
        approval: "explicit-intent",
        returns:
          "The governed execution outcome, including publication state, propagation/validation evidence, semantic orientation reference, and the resulting permitted next action.",
        errorBehavior:
          "Returns structured bootstrap-state, policy, validation, conflict, timeout, or transport failure evidence. A failed or denied mutation must not be simulated, broadened, or retried through an unrestricted repository tool.",
        programmaticEligible: false,
      }),
      Object.freeze({
        toolName: "chrypck_result",
        label: "Read governed repository result",
        description:
          "Read the authoritative bounded state and outcome of an existing ChryPck run after semantic bootstrap/planning, tracing, execution, timeout, or failure.",
        effect: "read",
        approval: "automatic",
        returns:
          "Bounded run state, project profile, semantic orientation when available, diagnostics, propagation and validation evidence, telemetry, terminal status, publication state, and other authoritative result metadata.",
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

  if (manifest.connector.aliases.length === 0 || manifest.connector.aliases.some((alias) => !alias.trim())) {
    throw new Error("ChryPck governed connector manifest requires non-empty aliases.");
  }
  if (manifest.workflow.phases.length < 8) {
    throw new Error("ChryPck governed connector manifest requires the complete semantic-bootstrap-through-verification workflow.");
  }
  const phaseIds = new Set(manifest.workflow.phases.map(phase => phase.id));
  if (!phaseIds.has("semantic-bootstrap") || !phaseIds.has("repository-orientation")) {
    throw new Error("ChryPck governed connector manifest must publish semantic bootstrap and repository orientation phases.");
  }
  const surfaceIds = new Set(manifest.workflow.diagnosticSurfaces.map(surface => surface.id));
  if (!surfaceIds.has("semantic-atlas") || !surfaceIds.has("semantic-coverage-ledger")) {
    throw new Error("ChryPck governed connector manifest must publish Semantic Atlas orientation surfaces.");
  }
  const analysisKinds = new Set(manifest.workflow.analysisModes.map((mode) => mode.kind));
  if (!analysisKinds.has("trace") || !analysisKinds.has("bounded-event-trace")) {
    throw new Error("ChryPck governed connector manifest must publish both supported trace analysis modes.");
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
