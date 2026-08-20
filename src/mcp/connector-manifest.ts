import { CHRYPCK_TOOL_NAMES } from "./tools.js";

export const GOVERNED_CONNECTOR_MANIFEST_SCHEMA = "governed-connector-manifest" as const;
export const GOVERNED_CONNECTOR_MANIFEST_VERSION = 5 as const;

export type GovernedConnectorManifestEffect = "read" | "write" | "destructive";
export type GovernedConnectorManifestApproval = "automatic" | "explicit-intent" | "always";

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
    | "analysis-lineage"
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
    | "trace-handoff"
    | "certified-context"
    | "cross-cutting-patch"
    | "execute"
    | "verify";
  readonly toolNames: readonly (typeof CHRYPCK_TOOL_NAMES)[number][];
  readonly guidance: string;
};

export type ChryPckAnalysisMode = {
  readonly kind: "trace";
  readonly when: string;
  readonly input: "analysis: { kind: 'trace', sourceSymbol?, targetEffect?, options? }";
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

export const CHRYPCK_GOVERNED_CONNECTOR_MANIFEST: ChryPckGovernedConnectorManifest = Object.freeze({
  schema: GOVERNED_CONNECTOR_MANIFEST_SCHEMA,
  schemaVersion: GOVERNED_CONNECTOR_MANIFEST_VERSION,
  connector: Object.freeze({
    id: "chrypck",
    label: "ChryPck",
    aliases: Object.freeze(["ChryPck", "Chry Pck", "ChryPck MCP", "CherryPick", "Cherry Pick", "Cherry-Pick"]),
    domain: "repository-development",
    description: "Policy-enforced governed repository development. ChryPck is designed to be the model's sole repository capability: it builds an exhaustive hidden Repository Model; requires bounded host-LLM Semantic Atlas bootstrap on uncached repository state; projects structural/semantic orientation and compressed dependency/runtime/symbol/state diagnostics; provides one canonical bounded evidence-backed Trace engine; persists Trace as authoritative analysis evidence; carries certified Trace evidence into a distinct normal plan through explicit analysis lineage; certifies a fresh Patch Corridor and Context Pack; executes coherent bounded cross-file patches; performs Change Propagation and broad validation; and returns authoritative terminal evidence.",
    audience: "orchestrator",
    selectionMode: "workflow-bundle"
  }),
  transport: Object.freeze({ kind: "mcp", path: "/mcp", authentication: "bearer" }),
  workflow: Object.freeze({
    strategy: "semantic-orient-analyze-narrow-execute-validate",
    summary: "Use ChryPck as a staged repository workflow. Complete mandatory semantic bootstrap first, orient with Structural and Semantic Atlases, narrow with compressed diagnostics, use canonical Trace when causality matters, hand a successful certified Trace into a separate normal plan through trace_handoff rather than paraphrasing it manually, let that new plan independently certify the Patch Corridor, expand only server-certified Context Pack segments, synthesize one coherent patch, execute only with current user mutation authorization, and verify through the authoritative result.",
    diagnosticSurfaces: Object.freeze([
      Object.freeze({ id: "repository-atlas", purpose: "Provides a bounded compressed path tree over the whole immutable repository snapshot so the model knows the repository's global structural shape without receiving file contents." }),
      Object.freeze({ id: "coverage-ledger", purpose: "States how much of the repository was snapshotted, text-backed, modeled and structurally projected, including explicit Atlas truncation so omitted structure is never mistaken for nonexistent structure." }),
      Object.freeze({ id: "semantic-atlas", purpose: "Provides an evidence-backed semantic glossary of repository purpose, major subsystems/module groups, responsibilities, boundaries, upstream/downstream relationships and key flows. It is orientation evidence, not source or mutation authority." }),
      Object.freeze({ id: "semantic-coverage-ledger", purpose: "States semantic-region coverage, synthesis state, rejected claims, bootstrap completion and cache state so omitted or uncertain semantic information is explicit." }),
      Object.freeze({ id: "dependency-graph", purpose: "Shows dependency relationships, fan-in/fan-out, unresolved local dependencies and cycles across the hidden Repository Model." }),
      Object.freeze({ id: "dependency-watershed", purpose: "Highlights high-leverage upstream/downstream dependency concentrations around repository behavior." }),
      Object.freeze({ id: "symbol-families", purpose: "Groups related declarations and implementations to reveal distributed conceptual surfaces without exposing source bodies." }),
      Object.freeze({ id: "effect-atlas", purpose: "Maps externally meaningful effects and the code sites that produce them." }),
      Object.freeze({ id: "integration-surfaces", purpose: "Identifies high-connectivity boundaries where subsystems, adapters, UI, runtime, or native APIs meet." }),
      Object.freeze({ id: "runtime-signals", purpose: "Projects event, callback, lifecycle and native-execution signal sites as compressed runtime evidence." }),
      Object.freeze({ id: "state-namespaces", purpose: "Shows state ownership and read/write/delete surfaces, including unresolved and multi-writer state." }),
      Object.freeze({ id: "native-contracts", purpose: "Projects authoritative framework/native-system entry points and contracts when a project profile provides them." }),
      Object.freeze({ id: "runtime-probes", purpose: "Provides bounded observational runtime-check plans when a project profile/configuration can support them." }),
      Object.freeze({ id: "analysis-lineage", purpose: "Carries an authoritative certified Trace artifact into a distinct normal plan through trace_handoff, bound to the same repository, immutable commit and project profile. It supplies bounded planning evidence only; the new Patch Corridor must still independently certify mutation scope." }),
      Object.freeze({ id: "patch-corridor", purpose: "Certifies the files and symbols the model may change for the admitted objective. Trace lineage may strengthen evidence but never authorizes files by itself." }),
      Object.freeze({ id: "context-pack", purpose: "Provides bounded exact-source expansion only for touch points certified by the current normal plan." }),
      Object.freeze({ id: "change-propagation", purpose: "Checks the staged change against direct/transitive consumers and exported-contract deltas before validation/publication." })
    ]),
    analysisModes: Object.freeze([
      Object.freeze({
        kind: "trace",
        when: "Use after semantic bootstrap/orientation for bugs, runtime paths, handler chains, dependency paths, callback flows, state/effect paths, or any question that requires following behavior through the repository. Trace is always bounded and evidence-backed. Omit sourceSymbol when ChryPck should resolve an evidence-supported entrypoint from the objective/certified corridor; provide sourceSymbol and optional targetEffect to narrow it. Trace returns a bounded path, first blocker or terminal effect when found, excluded/pruned branches, evidence records and a path certificate when a path can be certified. The Trace is persisted on its run and never falls back to an arbitrary graph node.",
        input: "analysis: { kind: 'trace', sourceSymbol?, targetEffect?, options? }"
      })
    ]),
    phases: Object.freeze([
      Object.freeze({ id: "semantic-bootstrap", toolNames: Object.freeze(["chrypck_plan"] as const), guidance: "On the first uncached plan for an immutable repository commit/profile, chrypck_plan returns semantic_bootstrap.status='required'. Interpret every region in the server-issued bounded metadata chunk using only evidence_refs from that region and resubmit through chrypck_plan.semantic_bootstrap until status='complete'. Do not continue repository work, request exact source, trace or execute while bootstrap remains required." }),
      Object.freeze({ id: "repository-orientation", toolNames: Object.freeze(["chrypck_plan"] as const), guidance: "After bootstrap completes, read repository_atlas + coverage for where things are and semantic_atlas + semantic_coverage for what major regions are for. Semantic interpretation is subordinate to Repository Model diagnostics, native contracts, Trace evidence and certified source." }),
      Object.freeze({ id: "general-analysis", toolNames: Object.freeze(["chrypck_plan"] as const), guidance: "Use dependency graph/watershed, symbol families, effect atlas, integration surfaces, runtime signals, state namespaces, native contracts, runtime probes and the initial Patch Corridor to narrow the objective. Do not mistake omitted compressed evidence for absence." }),
      Object.freeze({ id: "focused-analysis", toolNames: Object.freeze(["chrypck_plan"] as const), guidance: "Use analysis.kind='trace' for a concrete bug/runtime/dependency/state/effect question. Trace is the only trace mode: bounded, evidence-backed and certifiable. Let it auto-resolve an evidence-supported source when appropriate, or provide sourceSymbol/targetEffect plus hop/branch/file/symbol bounds when known. A useful Trace ends with a persisted artifact and certificate and normally returns create_normal_plan_with_trace_handoff." }),
      Object.freeze({ id: "trace-handoff", toolNames: Object.freeze(["chrypck_plan"] as const), guidance: "After a CERTIFIED or BLOCKED Trace returns create_normal_plan_with_trace_handoff, create a new normal chrypck_plan call with the same repository/base_ref and current objective plus trace_handoff {run_id, optional certificate_id}. Do not include analysis or architecture in that call. ChryPck rejects unknown, mismatched, uncertified, cross-repository, cross-commit or cross-profile lineage. The new run has a distinct identity and uses the certified Trace path only as bounded planning evidence; its Patch Corridor must independently certify mutation scope." }),
      Object.freeze({ id: "certified-context", toolNames: Object.freeze(["chrypck_context"] as const), guidance: "Use chrypck_context only on the READY normal-plan run after orientation and objective-local analysis/handoff identify exact touch points. Read the certified Context Pack index and only server-issued source segments needed to understand implementation or author the patch. A Trace run itself is not an exact-source run." }),
      Object.freeze({ id: "cross-cutting-patch", toolNames: Object.freeze(["chrypck_plan", "chrypck_context"] as const), guidance: "Synthesize the complete fix across the full certified runtime/dependency path. Use Semantic Atlas for intent, Structural Atlas for location, diagnostics/Trace lineage for relationships and causal evidence, the current Patch Corridor for mutation scope, and Context Pack for exact implementation. Include every necessary currently certified touch point in one coherent bounded authoring intent." }),
      Object.freeze({ id: "execute", toolNames: Object.freeze(["chrypck_execute"] as const), guidance: "Only after the current user turn authorizes mutation, submit the coherent typed authoring_intent or explicitly approve a server-issued architecture plan on a READY normal-plan run. ChryPck stages, propagates, validates and atomically publishes it; semantic/Trace/trace_handoff evidence never expands mutation authority by itself." }),
      Object.freeze({ id: "verify", toolNames: Object.freeze(["chrypck_result"] as const), guidance: "Always read chrypck_result after execution or failure. Trace runs expose their authoritative persisted Trace artifact/certificate; normal plans expose any accepted trace_handoff lineage; mutation runs expose authoritative propagation, validation and publication evidence." })
    ]),
    patchStrategy: "Prefer one coherent cross-cutting patch that covers all touch points certified by the current normal plan. ChryPck is designed to make multi-file fixes tractable by exposing repository-wide structural/semantic orientation first, compressed diagnostics and canonical bounded Trace second, explicit certified Trace-to-plan lineage third, and exact source only after the new plan independently certifies the Patch Corridor.",
    failurePolicy: "If ChryPck returns a semantic-bootstrap restart, policy denial, Trace certification gap, trace_handoff mismatch, validation failure, transport error, timeout or capability-gap result, follow the actual permitted next action and preserve any returned run_id/bootstrap_id/certificate_id. Do not manually convert uncertified Trace output into mutation scope, do not claim ChryPck is unavailable merely because one call failed, and do not bypass the governed workflow with unrestricted repository tools."
  }),
  capabilities: Object.freeze([
    Object.freeze({ toolName: "chrypck_plan", label: "Bootstrap, analyze and plan governed repository work", description: "Start all governed repository work. On an uncached repository state it first runs mandatory host-LLM Semantic Atlas bootstrap in bounded metadata chunks. Once complete, it returns Structural/Semantic orientation and compressed diagnostics, can run the single canonical bounded evidence-backed Trace, persists that Trace as an authoritative artifact, and accepts trace_handoff on a later distinct normal plan so certified Trace evidence can inform fresh Patch Corridor/Context Pack certification. Trace lineage is bound to repository + immutable commit + project profile and never directly grants mutation authority.", effect: "read", approval: "automatic", returns: "Either the next mandatory semantic_bootstrap chunk; a canonical Trace run with persisted evidence/certificate and next handoff action; or a normal plan with Repository/Semantic Atlases, diagnostics, accepted trace_handoff lineage when supplied, newly certified Patch Corridor/Context Pack scope, architecture-review state when requested, and the next permitted action.", errorBehavior: "Returns structured bootstrap-restart, policy, Trace-certification, trace-handoff-lineage, analysis, timeout or transport failure evidence. Fail-closed outcomes are authoritative and must not be bypassed with another repository capability.", programmaticEligible: false }),
    Object.freeze({ toolName: "chrypck_context", label: "Read certified repository context", description: "Read only server-certified Context Pack evidence for an existing READY normal-plan run after required semantic bootstrap/orientation and any Trace-to-plan handoff. Trace runs themselves do not expose arbitrary exact source; use trace_handoff to create a fresh normal plan first.", effect: "read", approval: "automatic", returns: "The certified context index or one bounded server-issued exact-source context segment together with the normal run's next permitted action.", errorBehavior: "Returns structured run, bootstrap-state, policy or transport failure evidence. Arbitrary repository paths and Trace-only source requests are never accepted as fallback.", programmaticEligible: false }),
    Object.freeze({ toolName: "chrypck_execute", label: "Execute governed repository change", description: "Execute the user-authorized coherent bounded cross-file patch or explicit approval of an already-issued architecture plan only on a READY normal-plan run after semantic bootstrap and current Patch Corridor certification. Trace/trace_handoff evidence may inform that plan but cannot widen mutation authority by itself.", effect: "write", approval: "explicit-intent", returns: "The governed execution outcome, including publication state, propagation/validation evidence, semantic orientation reference, accepted analysis lineage when present, and the resulting permitted next action.", errorBehavior: "Returns structured bootstrap-state, policy, validation, conflict, timeout or transport failure evidence. A failed or denied mutation must not be simulated, broadened or retried through an unrestricted repository tool.", programmaticEligible: false }),
    Object.freeze({ toolName: "chrypck_result", label: "Read governed repository result", description: "Read the authoritative bounded state and outcome of an existing ChryPck run after semantic bootstrap/planning, tracing, Trace handoff, execution, timeout or failure.", effect: "read", approval: "automatic", returns: "Bounded run state, project profile, persisted authoritative Trace artifact/certificate when the run is a Trace, accepted trace_handoff lineage when the run is a normal handoff plan, semantic orientation, diagnostics, propagation and validation evidence, telemetry, terminal status, publication state and other authoritative result metadata.", errorBehavior: "Returns structured run or transport failure evidence. Missing or failed run state must be reported rather than inferred.", programmaticEligible: false })
  ])
});

validateManifest(CHRYPCK_GOVERNED_CONNECTOR_MANIFEST);

export function getChryPckGovernedConnectorManifest(): ChryPckGovernedConnectorManifest {
  return CHRYPCK_GOVERNED_CONNECTOR_MANIFEST;
}

function validateManifest(manifest: ChryPckGovernedConnectorManifest): void {
  const manifestToolNames = manifest.capabilities.map(capability => capability.toolName).sort((left, right) => left.localeCompare(right));
  const runtimeToolNames = [...CHRYPCK_TOOL_NAMES].sort((left, right) => left.localeCompare(right));
  if (manifestToolNames.length !== runtimeToolNames.length || manifestToolNames.some((toolName, index) => toolName !== runtimeToolNames[index])) {
    throw new Error("ChryPck governed connector manifest must describe exactly the exported MCP tool surface.");
  }
  if (manifest.connector.aliases.length === 0 || manifest.connector.aliases.some(alias => !alias.trim())) {
    throw new Error("ChryPck governed connector manifest requires non-empty aliases.");
  }
  if (manifest.workflow.phases.length < 9) {
    throw new Error("ChryPck governed connector manifest requires the complete semantic-bootstrap-through-verification workflow including Trace handoff.");
  }
  const phaseIds = new Set(manifest.workflow.phases.map(phase => phase.id));
  if (!phaseIds.has("semantic-bootstrap") || !phaseIds.has("repository-orientation") || !phaseIds.has("trace-handoff")) {
    throw new Error("ChryPck governed connector manifest must publish semantic bootstrap, repository orientation and Trace handoff phases.");
  }
  const surfaceIds = new Set(manifest.workflow.diagnosticSurfaces.map(surface => surface.id));
  if (!surfaceIds.has("semantic-atlas") || !surfaceIds.has("semantic-coverage-ledger") || !surfaceIds.has("analysis-lineage")) {
    throw new Error("ChryPck governed connector manifest must publish Semantic Atlas and certified analysis-lineage surfaces.");
  }
  const analysisKinds = manifest.workflow.analysisModes.map(mode => mode.kind);
  if (analysisKinds.length !== 1 || analysisKinds[0] !== "trace") {
    throw new Error("ChryPck governed connector manifest must publish exactly one canonical trace analysis mode.");
  }
  for (const capability of manifest.capabilities) {
    if (!capability.label.trim() || !capability.description.trim() || !capability.returns.trim() || !capability.errorBehavior.trim()) {
      throw new Error(`ChryPck governed connector capability ${capability.toolName} is incomplete.`);
    }
    if (capability.effect !== "read" && capability.approval === "automatic") {
      throw new Error(`ChryPck governed connector capability ${capability.toolName} cannot mutate automatically.`);
    }
    if (capability.programmaticEligible && (capability.effect !== "read" || capability.approval !== "automatic")) {
      throw new Error(`ChryPck governed connector capability ${capability.toolName} is not eligible for programmatic execution.`);
    }
  }
}
