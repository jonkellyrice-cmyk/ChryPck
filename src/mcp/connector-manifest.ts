import { CHRYPCK_TOOL_NAMES } from "./tools.js";

export const GOVERNED_CONNECTOR_MANIFEST_SCHEMA = "governed-connector-manifest" as const;
export const GOVERNED_CONNECTOR_MANIFEST_VERSION = 10 as const;

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
    | "semantic-expansion"
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
    description: "Policy-enforced governed repository development. ChryPck builds an exhaustive hidden deterministic Repository Model immediately, incrementally maps only the objective-local semantic regions reached during navigation, projects sparse semantic orientation with explicit global and objective coverage, provides Trace and Dataflow Slice focused analysis, carries certified evidence through analysis lineage, independently certifies Patch Corridor and Context Pack, executes coherent bounded patches, validates broadly, and returns authoritative terminal evidence.",
    audience: "orchestrator",
    selectionMode: "workflow-bundle"
  }),
  transport: Object.freeze({ kind: "mcp", path: "/mcp", authentication: "bearer" }),
  workflow: Object.freeze({
    strategy: "semantic-orient-analyze-narrow-execute-validate",
    summary: "Build global deterministic structure immediately; when navigation reaches an unmapped objective-local region, interpret that one bounded metadata packet and cache it. Proceed when semantic coverage is objective-sufficient even if global coverage is partial. Then choose Trace for one causal runtime route or Dataflow Slice for value provenance/influence, carry certified evidence through analysis_handoff, independently certify Patch Corridor, expand only certified Context Pack segments, execute only with current authorization, and verify through the authoritative result. trace_handoff remains compatible.",
    diagnosticSurfaces: Object.freeze([
      Object.freeze({ id: "repository-atlas", purpose: "Provides a bounded compressed path tree over the whole immutable repository snapshot so the model knows the repository's global structural shape without receiving file contents." }),
      Object.freeze({ id: "coverage-ledger", purpose: "States how much of the repository was snapshotted, text-backed, modeled and structurally projected, including explicit Atlas truncation so omitted structure is never mistaken for nonexistent structure." }),
      Object.freeze({ id: "semantic-atlas", purpose: "Provides an evidence-backed semantic glossary of repository purpose, major subsystems/module groups, responsibilities, boundaries, upstream/downstream relationships and key flows. It is orientation evidence, not source or mutation authority." }),
      Object.freeze({ id: "semantic-coverage-ledger", purpose: "Separately reports global mapped/unmapped regions and objective-local sufficiency, plus synthesis state, active frontier, rejected claims and cache state. Global semantic completeness is not required for bounded work." }),
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
        when: "Use after objective-sufficient semantic orientation for bugs, runtime paths, handler chains, dependency paths, callback flows, state/effect paths, or any question that requires following behavior through the repository. If navigation reaches an unmapped semantic boundary, complete only that server-issued expansion. Trace is always bounded and evidence-backed. Omit sourceSymbol when ChryPck should resolve an evidence-supported entrypoint; provide sourceSymbol and optional targetEffect to narrow it. Trace returns a bounded path, blocker or terminal effect, exclusions and a path certificate when certifiable.",
        input: "analysis: { kind: 'trace', sourceSymbol?, targetEffect?, options? }"
      }),
      Object.freeze({
        kind: "dataflow-slice",
        when: "Use after objective-sufficient semantic orientation for value provenance, downstream influence, payload fields, call arguments/results, state flow or contract values. If navigation reaches an unmapped semantic boundary, complete only that server-issued expansion. Select an explicit criterion, direction and optional target. Evidence is bounded, exposes unresolved frontier and is persisted with a certificate when usable. Dataflow Slice is static value-flow evidence, not temporal runtime certainty or a second Trace mode.",
        input: "analysis: { kind: 'dataflow-slice', criterion, direction: 'forward' | 'backward' | 'bidirectional', target?, options? }"
      })
    ]),
    phases: Object.freeze([
      Object.freeze({ id: "semantic-expansion", toolNames: Object.freeze(["chrypck_plan"] as const), guidance: "ChryPck builds the global structural model without LLM bootstrap. When the current objective reaches an unmapped region, semantic_bootstrap.status='required' is returned with mode='lazy-objective-expansion' and at most one bounded region. Interpret only that region from its evidence_refs and resubmit once. ChryPck caches it and resumes work; never map unrelated regions merely to make the Atlas globally complete." }),
      Object.freeze({ id: "repository-orientation", toolNames: Object.freeze(["chrypck_plan"] as const), guidance: "Read repository_atlas + coverage for global structure and semantic_atlas + semantic_coverage for mapped meaning. OBJECTIVE_SUFFICIENT permits bounded work while global coverage remains partial. Unmapped meaning remains unknown, and navigation may request another one-region expansion later. Semantic interpretation is subordinate to deterministic diagnostics, native contracts, focused analysis and certified source." }),
      Object.freeze({ id: "general-analysis", toolNames: Object.freeze(["chrypck_plan"] as const), guidance: "Use dependency graph/watershed, symbol families, the canonical Effect / Runtime Atlas, integration surfaces, state namespaces, native contracts, the reconciled Contract Map, runtime probes and the initial Patch Corridor to narrow the objective. Treat native-conflict or unresolved runtime regions as blockers on affected claims. Effect / Runtime Atlas and Contract Map evidence can strengthen existing repository evidence but never grants mutation scope. effect-atlas and runtime-signals are compatibility projections only. Do not mistake omitted compressed evidence for absence." }),
      Object.freeze({ id: "focused-analysis", toolNames: Object.freeze(["chrypck_plan"] as const), guidance: "Choose exactly one focused mode. Use analysis.kind='trace' for one concrete causal runtime route. Use analysis.kind='dataflow-slice' for value provenance or downstream influence, with forward/backward/bidirectional direction and explicit criterion. Atlas maps possible runtime behavior; Trace certifies one route; Dataflow Slice certifies bounded static value flow. Each persists separately. A terminal focused-analysis run may expose only its server-certified objective-local Context Pack grants for read-only evidence expansion; this never grants arbitrary source or mutation authority." }),
      Object.freeze({ id: "trace-handoff", toolNames: Object.freeze(["chrypck_plan"] as const), guidance: "After a usable focused analysis, create a NEW normal plan using analysis_handoff {run_id, optional artifact_id}. Do not include analysis or architecture. ChryPck rejects unknown, mismatched, uncertified, cross-repository, cross-commit or cross-profile lineage. The new Patch Corridor must independently certify mutation scope. trace_handoff {run_id, certificate_id?} remains compatible for Trace clients." }),
      Object.freeze({ id: "certified-context", toolNames: Object.freeze(["chrypck_context"] as const), guidance: "Use chrypck_context on a READY normal-plan run or a terminal focused-analysis run that advertises context_available. Follow only the compact response context_grants and server-issued segment/continuation IDs. Expand the smallest evidence-bearing area, then resume reasoning or hand off to a new normal plan. These grants are read-only and never widen the Patch Corridor or mutation authority." }),
      Object.freeze({ id: "cross-cutting-patch", toolNames: Object.freeze(["chrypck_plan", "chrypck_context"] as const), guidance: "Synthesize the complete fix across the full certified runtime/dependency path. Use Semantic Atlas for intent, Structural Atlas for location, Contract Map for provider/consumer obligations, Effect / Runtime Atlas for entry/effect/observation obligations, Trace lineage for focused causal evidence, the current Patch Corridor for mutation scope, and Context Pack for exact implementation. Contract consumers and runtime observation/effect targets outside the corridor are verification targets, not automatically mutation-authorized files." }),
      Object.freeze({ id: "execute", toolNames: Object.freeze(["chrypck_execute"] as const), guidance: "Only after the current user turn authorizes mutation, submit the coherent typed authoring_intent or explicitly approve a server-issued architecture plan on a READY normal-plan run. ChryPck stages, propagates, validates and atomically publishes it; semantic or focused-analysis lineage never expands mutation authority by itself." }),
      Object.freeze({ id: "verify", toolNames: Object.freeze(["chrypck_result"] as const), guidance: "Always read chrypck_result after execution or failure. Focused-analysis runs expose their authoritative persisted Trace or Dataflow Slice artifact/certificate; normal plans expose accepted analysis_handoff lineage; mutation runs expose authoritative Contract Map and Effect / Runtime Atlas impact, propagation, validation targets and publication evidence." })
    ]),
    patchStrategy: "Prefer one coherent cross-cutting patch that covers all touch points certified by the current normal plan. ChryPck makes multi-file fixes tractable by exposing repository-wide structural/semantic orientation first, compressed diagnostics and the appropriate bounded focused analysis second, explicit certified analysis-to-plan lineage third, and exact source only after the new plan independently certifies the Patch Corridor.",
    failurePolicy: "If ChryPck returns a semantic-expansion continuation/restart, policy denial, focused-analysis certification gap, analysis_handoff mismatch, validation failure, transport error, timeout or capability-gap result, follow the actual permitted next action and preserve returned identifiers. Do not expand unrelated semantic regions, convert uncertified analysis into mutation scope, do not claim ChryPck is unavailable after one failed call, and do not bypass the governed workflow."
  }),
  capabilities: Object.freeze([
    Object.freeze({ toolName: "chrypck_plan", label: "Orient, analyze and plan governed repository work", description: "Start all governed repository work. Request response_mode=compact for agent loops: ChryPck keeps heavyweight artifacts server-side and returns a small control envelope with evidence handles and at most eight bounded context grants. Lazy semantic expansion maps only the objective-local frontier. Choose Trace for causal runtime evidence or Dataflow Slice for value provenance/influence; terminal focused analysis may expand its own certified read-only context.", effect: "read", approval: "automatic", returns: "By default, a compact control envelope containing run state, bounded semantic status, focused-analysis result, corridor summary, server-issued context grants and next action. response_mode=full is reserved for explicit diagnostics and may return the persisted atlas stack.", errorBehavior: "Returns structured semantic-expansion continuation/restart, policy, focused-analysis-certification, analysis-lineage, timeout or transport evidence. Fail-closed outcomes are authoritative and must not be bypassed.", programmaticEligible: false }),
    Object.freeze({ toolName: "chrypck_context", label: "Read certified repository context", description: "Expand only server-certified Context Pack evidence for a READY normal plan or terminal focused-analysis run. Omit segment_id for the bounded grant index; then request one server-issued segment or continuation. Analysis grants are read-only and never authorize arbitrary paths or mutation.", effect: "read", approval: "automatic", returns: "A bounded certified grant index, one exact-source segment, or one continuation chunk, with explicit read authority and next action.", errorBehavior: "Returns structured run, semantic-expansion, policy or transport failure evidence. Arbitrary repository paths and analysis-run source requests are never accepted as fallback.", programmaticEligible: false }),
    Object.freeze({ toolName: "chrypck_execute", label: "Execute governed repository change", description: "Execute the user-authorized coherent bounded cross-file patch or approve an issued architecture plan only on a READY normal-plan run with objective-sufficient semantic coverage and current Patch Corridor certification. Certified analysis lineage may inform that plan but cannot widen mutation authority.", effect: "write", approval: "explicit-intent", returns: "The governed execution outcome, including publication state, propagation/validation evidence, semantic orientation reference, accepted analysis lineage when present, and the resulting permitted next action.", errorBehavior: "Returns structured semantic-expansion, policy, validation, conflict, timeout or transport failure evidence. A failed or denied mutation must not be simulated, broadened or retried through an unrestricted repository tool.", programmaticEligible: false }),
    Object.freeze({ toolName: "chrypck_result", label: "Read governed repository result", description: "Read the authoritative state and outcome of an existing ChryPck run. Request response_mode=compact in agent loops; use full only for explicit artifact diagnostics.", effect: "read", approval: "automatic", returns: "By default, a compact terminal control envelope with state, analysis lineage, artifact handles, failure and next action. Full mode returns persisted diagnostic artifacts, propagation, validation and telemetry.", errorBehavior: "Returns structured run or transport failure evidence. Missing or failed run state must be reported rather than inferred.", programmaticEligible: false })
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
    throw new Error("ChryPck governed connector manifest requires the complete semantic-expansion-through-verification workflow including analysis handoff.");
  }
  const phaseIds = new Set(manifest.workflow.phases.map(phase => phase.id));
  if (!phaseIds.has("semantic-expansion") || !phaseIds.has("repository-orientation") || !phaseIds.has("trace-handoff")) {
    throw new Error("ChryPck governed connector manifest must publish lazy semantic expansion, repository orientation and analysis handoff phases.");
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
