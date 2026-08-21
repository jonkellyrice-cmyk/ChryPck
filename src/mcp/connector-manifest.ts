import { CHRYPCK_TOOL_NAMES } from "./tools.js";

export const GOVERNED_CONNECTOR_MANIFEST_SCHEMA = "governed-connector-manifest" as const;
export const GOVERNED_CONNECTOR_MANIFEST_VERSION = 8 as const;

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
    | "effect-runtime-atlas"
    | "integration-surfaces"
    | "runtime-signals"
    | "state-namespaces"
    | "native-contracts"
    | "contract-map"
    | "dataflow-slice"
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
  readonly kind: "trace" | "dataflow-slice";
  readonly when: string;
  readonly input:
    | "analysis: { kind: 'trace', sourceSymbol?, targetEffect?, options? }"
    | "analysis: { kind: 'dataflow-slice', criterion, direction: 'forward' | 'backward' | 'bidirectional', target?, options? }";
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
    description: "Policy-enforced governed repository development. ChryPck builds an exhaustive hidden Repository Model; requires bounded Semantic Atlas bootstrap; projects structural/semantic orientation and compressed deterministic diagnostics; provides canonical Trace for one causal runtime route and Dataflow Slice for value provenance/influence; persists focused analysis as authoritative evidence; carries certified evidence into a distinct normal plan through analysis lineage; independently certifies a fresh Patch Corridor and Context Pack; executes coherent bounded patches; validates broadly; and returns authoritative terminal evidence.",
    audience: "orchestrator",
    selectionMode: "workflow-bundle"
  }),
  transport: Object.freeze({ kind: "mcp", path: "/mcp", authentication: "bearer" }),
  workflow: Object.freeze({
    strategy: "semantic-orient-analyze-narrow-execute-validate",
    summary: "Complete semantic bootstrap, orient with Structural/Semantic Atlases, narrow with deterministic maps, then choose focused analysis: Trace for one causal runtime route or Dataflow Slice for value provenance/influence. Hand certified analysis into a distinct normal plan through analysis_handoff, let that plan independently certify Patch Corridor, expand only certified Context Pack segments, execute only with current mutation authorization, and verify through the authoritative result. trace_handoff remains a compatibility input.",
    diagnosticSurfaces: Object.freeze([
      Object.freeze({ id: "repository-atlas", purpose: "Provides a bounded compressed path tree over the whole immutable repository snapshot so the model knows the repository's global structural shape without receiving file contents." }),
      Object.freeze({ id: "coverage-ledger", purpose: "States how much of the repository was snapshotted, text-backed, modeled and structurally projected, including explicit Atlas truncation so omitted structure is never mistaken for nonexistent structure." }),
      Object.freeze({ id: "semantic-atlas", purpose: "Provides an evidence-backed semantic glossary of repository purpose, major subsystems/module groups, responsibilities, boundaries, upstream/downstream relationships and key flows. It is orientation evidence, not source or mutation authority." }),
      Object.freeze({ id: "semantic-coverage-ledger", purpose: "States semantic-region coverage, synthesis state, rejected claims, bootstrap completion and cache state so omitted or uncertain semantic information is explicit." }),
      Object.freeze({ id: "dependency-graph", purpose: "Shows dependency relationships, fan-in/fan-out, unresolved local dependencies and cycles across the hidden Repository Model." }),
      Object.freeze({ id: "dependency-watershed", purpose: "Highlights high-leverage upstream/downstream dependency concentrations around repository behavior." }),
      Object.freeze({ id: "symbol-families", purpose: "Groups related declarations and implementations to reveal distributed conceptual surfaces without exposing source bodies." }),
      Object.freeze({ id: "effect-runtime-atlas", purpose: "Canonical bounded map of possible runtime behavior: entry points, operations, state access, integration boundaries, terminal effects and observation points, reconciled with Contract Map and native evidence. It guides Trace, planning and verification but never grants mutation scope." }),
      Object.freeze({ id: "effect-atlas", purpose: "Compatibility projection of effect families from the canonical Effect / Runtime Atlas. New workflows should use effect-runtime-atlas." }),
      Object.freeze({ id: "integration-surfaces", purpose: "Identifies high-connectivity boundaries where subsystems, adapters, UI, runtime, or native APIs meet." }),
      Object.freeze({ id: "runtime-signals", purpose: "Compatibility projection of runtime signals from the canonical Effect / Runtime Atlas. New workflows should use effect-runtime-atlas." }),
      Object.freeze({ id: "state-namespaces", purpose: "Shows state ownership and read/write/delete surfaces, including unresolved and multi-writer state." }),
      Object.freeze({ id: "native-contracts", purpose: "Projects authoritative framework/native-system entry points and contracts when a project profile provides them." }),
      Object.freeze({ id: "contract-map", purpose: "Maps repository and native contracts as bounded provider/consumer/value/failure evidence with repository-only, native-confirmed, native-supplemented and native-conflict reconciliation. It strengthens planning and validation but never grants mutation scope by itself." }),
      Object.freeze({ id: "dataflow-slice", purpose: "Focused bounded static value-flow evidence showing where a selected value originates, how it transforms, and where it may flow. Forward, backward and bidirectional slices expose explicit coverage, unresolved frontier and certification; they never grant mutation scope or arbitrary source access." }),
      Object.freeze({ id: "runtime-probes", purpose: "Provides bounded observational runtime-check plans when a project profile/configuration can support them." }),
      Object.freeze({ id: "analysis-lineage", purpose: "Carries an authoritative certified Trace or Dataflow Slice artifact into a distinct normal plan through analysis_handoff, bound to the same repository, immutable commit and project profile. It supplies bounded planning evidence only; the new Patch Corridor must still independently certify mutation scope. trace_handoff remains compatible for Trace clients." }),
      Object.freeze({ id: "patch-corridor", purpose: "Certifies the files and symbols the model may change for the admitted objective. Trace lineage may strengthen evidence but never authorizes files by itself." }),
      Object.freeze({ id: "context-pack", purpose: "Provides bounded exact-source expansion only for touch points certified by the current normal plan." }),
      Object.freeze({ id: "change-propagation", purpose: "Checks the staged change against direct/transitive consumers and exported-contract deltas before validation/publication." })
    ]),
    analysisModes: Object.freeze([
      Object.freeze({
        kind: "trace",
        when: "Use after semantic bootstrap/orientation for bugs, runtime paths, handler chains, dependency paths, callback flows, state/effect paths, or any question that requires following behavior through the repository. Trace is always bounded and evidence-backed. Omit sourceSymbol when ChryPck should resolve an evidence-supported entrypoint from the objective/certified corridor; provide sourceSymbol and optional targetEffect to narrow it. Trace returns a bounded path, first blocker or terminal effect when found, excluded/pruned branches, evidence records and a path certificate when a path can be certified. The Trace is persisted on its run and never falls back to an arbitrary graph node.",
        input: "analysis: { kind: 'trace', sourceSymbol?, targetEffect?, options? }"
      }),
      Object.freeze({
        kind: "dataflow-slice",
        when: "Use after semantic bootstrap/orientation for value provenance, downstream influence, payload fields, call arguments/results, state flow, contract values, or questions such as where did this value come from and where can it go. Select an explicit criterion, direction and optional target. Returned evidence is bounded, exposes unresolved frontier and is persisted with a certificate when usable. Dataflow Slice is static value-flow evidence, not temporal runtime certainty and not a second Trace mode.",
        input: "analysis: { kind: 'dataflow-slice', criterion, direction: 'forward' | 'backward' | 'bidirectional', target?, options? }"
      })
    ]),
    phases: Object.freeze([
      Object.freeze({ id: "semantic-bootstrap", toolNames: Object.freeze(["chrypck_plan"] as const), guidance: "On the first uncached plan for an immutable repository commit/profile, chrypck_plan returns semantic_bootstrap.status='required'. Interpret every region in the server-issued bounded metadata chunk using only evidence_refs from that region and resubmit through chrypck_plan.semantic_bootstrap until status='complete'. Do not continue repository work, request exact source, trace or execute while bootstrap remains required." }),
      Object.freeze({ id: "repository-orientation", toolNames: Object.freeze(["chrypck_plan"] as const), guidance: "After bootstrap completes, read repository_atlas + coverage for where things are and semantic_atlas + semantic_coverage for what major regions are for. Semantic interpretation is subordinate to Repository Model diagnostics, native contracts, Trace evidence and certified source." }),
      Object.freeze({ id: "general-analysis", toolNames: Object.freeze(["chrypck_plan"] as const), guidance: "Use dependency graph/watershed, symbol families, the canonical Effect / Runtime Atlas, integration surfaces, state namespaces, native contracts, the reconciled Contract Map, runtime probes and the initial Patch Corridor to narrow the objective. Treat native-conflict or unresolved runtime regions as blockers on affected claims. Effect / Runtime Atlas and Contract Map evidence can strengthen existing repository evidence but never grants mutation scope. effect-atlas and runtime-signals are compatibility projections only. Do not mistake omitted compressed evidence for absence." }),
      Object.freeze({ id: "focused-analysis", toolNames: Object.freeze(["chrypck_plan"] as const), guidance: "Choose exactly one focused mode. Use analysis.kind='trace' for one concrete causal runtime route. Use analysis.kind='dataflow-slice' for value provenance or downstream influence, with forward/backward/bidirectional direction and explicit criterion. Atlas maps possible runtime behavior; Trace certifies one route; Dataflow Slice certifies bounded static value flow. Each persists separately and neither grants source or mutation authority." }),
      Object.freeze({ id: "trace-handoff", toolNames: Object.freeze(["chrypck_plan"] as const), guidance: "After a usable focused analysis, create a NEW normal plan using analysis_handoff {run_id, optional artifact_id}. Do not include analysis or architecture. ChryPck rejects unknown, mismatched, uncertified, cross-repository, cross-commit or cross-profile lineage. The new Patch Corridor must independently certify mutation scope. trace_handoff {run_id, certificate_id?} remains compatible for Trace clients." }),
      Object.freeze({ id: "certified-context", toolNames: Object.freeze(["chrypck_context"] as const), guidance: "Use chrypck_context only on the READY normal-plan run after orientation and objective-local analysis/handoff identify exact touch points. Read the certified Context Pack index, including bounded Contract Map and Effect / Runtime Atlas roles, reconciliation and verification-target evidence, and only server-issued source segments needed to understand implementation or author the patch. A Trace run itself is not an exact-source run." }),
      Object.freeze({ id: "cross-cutting-patch", toolNames: Object.freeze(["chrypck_plan", "chrypck_context"] as const), guidance: "Synthesize the complete fix across the full certified runtime/dependency path. Use Semantic Atlas for intent, Structural Atlas for location, Contract Map for provider/consumer obligations, Effect / Runtime Atlas for entry/effect/observation obligations, Trace lineage for focused causal evidence, the current Patch Corridor for mutation scope, and Context Pack for exact implementation. Contract consumers and runtime observation/effect targets outside the corridor are verification targets, not automatically mutation-authorized files." }),
      Object.freeze({ id: "execute", toolNames: Object.freeze(["chrypck_execute"] as const), guidance: "Only after the current user turn authorizes mutation, submit the coherent typed authoring_intent or explicitly approve a server-issued architecture plan on a READY normal-plan run. ChryPck stages, propagates, validates and atomically publishes it; semantic or focused-analysis lineage never expands mutation authority by itself." }),
      Object.freeze({ id: "verify", toolNames: Object.freeze(["chrypck_result"] as const), guidance: "Always read chrypck_result after execution or failure. Focused-analysis runs expose their authoritative persisted Trace or Dataflow Slice artifact/certificate; normal plans expose accepted analysis_handoff lineage; mutation runs expose authoritative Contract Map and Effect / Runtime Atlas impact, propagation, validation targets and publication evidence." })
    ]),
    patchStrategy: "Prefer one coherent cross-cutting patch that covers all touch points certified by the current normal plan. ChryPck makes multi-file fixes tractable by exposing repository-wide structural/semantic orientation first, compressed diagnostics and the appropriate bounded focused analysis second, explicit certified analysis-to-plan lineage third, and exact source only after the new plan independently certifies the Patch Corridor.",
    failurePolicy: "If ChryPck returns a semantic-bootstrap restart, policy denial, focused-analysis certification gap, analysis_handoff mismatch, validation failure, transport error, timeout or capability-gap result, follow the actual permitted next action and preserve any returned run_id/bootstrap_id/artifact_id/certificate_id. Do not convert uncertified Trace or Dataflow Slice output into mutation scope, do not claim ChryPck is unavailable merely because one call failed, and do not bypass the governed workflow with unrestricted repository tools."
  }),
  capabilities: Object.freeze([
    Object.freeze({ toolName: "chrypck_plan", label: "Bootstrap, analyze and plan governed repository work", description: "Start all governed repository work. After mandatory bounded Semantic Atlas bootstrap, it returns Structural/Semantic orientation and compressed diagnostics. Choose canonical Trace for one causal runtime route or Dataflow Slice for bounded value provenance/influence. Each focused analysis persists as an authoritative artifact; analysis_handoff carries certified evidence into a later distinct normal plan for fresh Patch Corridor/Context Pack certification. trace_handoff remains compatible for Trace clients. Analysis lineage is repository-, commit- and profile-bound and never grants mutation authority.", effect: "read", approval: "automatic", returns: "Either the next mandatory semantic_bootstrap chunk; a focused Trace or Dataflow Slice run with persisted evidence/certificate and next handoff action; or a normal plan with Repository/Semantic Atlases, diagnostics, accepted analysis_handoff lineage when supplied, newly certified Patch Corridor/Context Pack scope, architecture-review state when requested, and the next permitted action.", errorBehavior: "Returns structured bootstrap-restart, policy, focused-analysis-certification, analysis-handoff-lineage, analysis, timeout or transport failure evidence. Fail-closed outcomes are authoritative and must not be bypassed with another repository capability.", programmaticEligible: false }),
    Object.freeze({ toolName: "chrypck_context", label: "Read certified repository context", description: "Read only server-certified Context Pack evidence for an existing READY normal-plan run after required semantic bootstrap/orientation and any focused-analysis handoff. Focused-analysis runs do not expose arbitrary exact source; use analysis_handoff to create a fresh normal plan first.", effect: "read", approval: "automatic", returns: "The certified context index or one bounded server-issued exact-source context segment together with the normal run's next permitted action.", errorBehavior: "Returns structured run, bootstrap-state, policy or transport failure evidence. Arbitrary repository paths and analysis-run source requests are never accepted as fallback.", programmaticEligible: false }),
    Object.freeze({ toolName: "chrypck_execute", label: "Execute governed repository change", description: "Execute the user-authorized coherent bounded cross-file patch or explicit approval of an already-issued architecture plan only on a READY normal-plan run after semantic bootstrap and current Patch Corridor certification. Certified focused-analysis lineage may inform that plan but cannot widen mutation authority by itself.", effect: "write", approval: "explicit-intent", returns: "The governed execution outcome, including publication state, propagation/validation evidence, semantic orientation reference, accepted analysis lineage when present, and the resulting permitted next action.", errorBehavior: "Returns structured bootstrap-state, policy, validation, conflict, timeout or transport failure evidence. A failed or denied mutation must not be simulated, broadened or retried through an unrestricted repository tool.", programmaticEligible: false }),
    Object.freeze({ toolName: "chrypck_result", label: "Read governed repository result", description: "Read the authoritative bounded state and outcome of an existing ChryPck run after semantic bootstrap/planning, focused analysis, analysis handoff, execution, timeout or failure.", effect: "read", approval: "automatic", returns: "Bounded run state, project profile, persisted authoritative Trace or Dataflow Slice artifact/certificate for a focused-analysis run, accepted analysis_handoff lineage for a normal handoff plan, semantic orientation, diagnostics, propagation and validation evidence, telemetry, terminal status, publication state and other authoritative result metadata.", errorBehavior: "Returns structured run or transport failure evidence. Missing or failed run state must be reported rather than inferred.", programmaticEligible: false })
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
  if (!surfaceIds.has("semantic-atlas") || !surfaceIds.has("semantic-coverage-ledger") || !surfaceIds.has("analysis-lineage") || !surfaceIds.has("contract-map") || !surfaceIds.has("effect-runtime-atlas") || !surfaceIds.has("dataflow-slice")) {
    throw new Error("ChryPck governed connector manifest must publish Semantic Atlas, Contract Map, Effect / Runtime Atlas, Dataflow Slice and certified analysis-lineage surfaces.");
  }
  const analysisKinds = manifest.workflow.analysisModes.map(mode => mode.kind);
  if (analysisKinds.length !== 2 || analysisKinds[0] !== "trace" || analysisKinds[1] !== "dataflow-slice") {
    throw new Error("ChryPck governed connector manifest must publish canonical Trace and Dataflow Slice focused-analysis modes.");
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
