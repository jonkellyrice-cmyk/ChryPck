# ChryPck

ChryPck is a policy-enforced MCP capability proxy for governed repository development.

Its central rule is: **author intent narrowly, execute deterministically, validate broadly, and fail closed rather than guess.** ChryPck is designed to be the model's only repository capability for a governed workflow; an unrestricted GitHub/filesystem/shell tool must not be exposed alongside it if hard enforcement is required.

## Repository visibility model

ChryPck deliberately separates what the service can know from what the LLM can see:

```text
immutable repository snapshot
        ↓
exhaustive Repository Model          (internal; not model-visible)
        ↓
Structural Repository Atlas          (where things are)
        ↓
lazy Semantic Atlas expansion        (what currently relevant things are for)
        ↓
diagnostic projections/maps          (compressed/lossy relationships)
        ↓
Effect / Runtime Atlas                (possible runtime behavior and effects)
        ↓
canonical Trace / Dataflow Slice      (optional focused analysis)
        ↓
certified analysis handoff            (optional analysis lineage)
        ↓
Patch Corridor                        (fresh mutation-scope certification)
        ↓
certified Context Pack                (bounded exact-source expansion)
        ↓
LLM-authored bounded intent
        ↓
Change Propagation → validation → atomic publication
```

The Structural Repository Atlas is a bounded whole-repository path/tree orientation layer with an explicit coverage ledger. The Semantic Atlas is a separate evidence-backed semantic glossary of repository purpose, subsystem/module-group responsibilities, responsibility boundaries, major upstream/downstream relationships, and key flows. Semantic claims carry evidence references and confidence; they are orientation evidence, never source authority or mutation authority.

The model does not receive arbitrary repository search/list/read primitives. If compressed evidence is insufficient, ChryPck returns a capability/abstraction gap or produces a newly justified certified context expansion; the model does not fall back to repository exploration.

Model-visible diagnostic surfaces include Structural Repository Atlas, Semantic Atlas, structural/semantic coverage ledgers, dependency graph/watershed, symbol families, the canonical Effect / Runtime Atlas, Contract Map, integration surfaces, state namespaces, native-contract evidence, runtime probes, canonical Trace, Dataflow Slice, analysis lineage, Patch Corridor, Context Pack, and Change Propagation results. `effect-atlas` and `runtime-signals` remain compatibility projections; new workflows use `effect-runtime-atlas`.

The Effect / Runtime Atlas maps possible behavior across entry points, operations, state access, integration boundaries, terminal effects and observation points. It reports explicit coverage, unresolved links and repository/native reconciliation. Trace consumes this topology to certify one focused causal route. Neither the Atlas nor Trace grants mutation authority: only the current normal plan's independently certified Patch Corridor does so.

## Lazy, objective-local Semantic Atlas expansion

ChryPck eagerly builds the inexpensive deterministic Repository Model and Structural Atlas across the immutable repository. It does **not** require the host LLM to semantically interpret the entire repository. When navigation reaches a relevant region that is not yet mapped, `chrypck_plan` returns at most one bounded request:

```text
semantic_bootstrap.status = "required"
semantic_bootstrap.mode = "lazy-objective-expansion"
semantic_bootstrap.current_chunk = <bounded server-issued metadata packet>
```

The `semantic_bootstrap` field name remains for client compatibility, but its behavior is demand-driven expansion. The connected host LLM:

1. Reads the single objective-local region in the current metadata chunk.
2. Describe the region's purpose, responsibilities, important non-ownership boundaries, and key flows only where supported by the supplied metadata.
3. Cite one or more server-issued `evidence_refs` for every semantic claim.
4. Call `chrypck_plan` again with `semantic_bootstrap { bootstrap_id, chunk_id, interpretations }`.
5. ChryPck validates and caches that region, then resumes the original task.

The Atlas may remain globally partial. `semantic_coverage.objective_sufficient = true` and `semantic_atlas.status = "OBJECTIVE_SUFFICIENT"` permit the current bounded task to proceed. Global and objective coverage are reported separately; unmapped meaning stays explicitly unknown. If later dependency, contract, runtime, Trace, Dataflow, forecast, or planning navigation reaches another unmapped boundary, ChryPck requests that one region then.

Incremental Semantic Atlas regions are cached by repository + immutable commit + project profile + semantic schema version and retained across objectives. Evidence fingerprints prevent stale region interpretations from being reused after their deterministic region evidence changes.

## Canonical Trace and certified Trace-to-plan handoff

ChryPck exposes one trace analysis mode: `analysis.kind = "trace"`. Trace is the bounded evidence-backed BEFT-derived engine. It can resolve an evidence-supported source from the objective or accept an explicit `sourceSymbol`, optional `targetEffect`, and bounded hop/branch/file/symbol controls. A useful Trace returns a bounded path, blocker or terminal effect when found, explicit excluded/pruned branches, evidence records, and a path certificate.

Trace is a read-only analysis run. Its result is persisted as an authoritative run artifact and is **not** itself a mutation plan. When ChryPck returns `create_normal_plan_with_trace_handoff`, the host creates a distinct normal `chrypck_plan` call with:

```text
trace_handoff: {
  run_id: <trace run id>,
  certificate_id?: <trace certificate id>
}
```

ChryPck accepts that lineage only when the stored Trace belongs to the same repository, immutable commit, and project profile and has a usable `CERTIFIED` or `BLOCKED` path certificate. Unknown, mismatched, forged, or uncertified Trace lineage fails closed.

Accepted Trace lineage is **planning evidence only**. The new normal plan still builds and independently certifies a fresh Patch Corridor. A file merely appearing in the Trace path is not automatically authorized for mutation or exact-source expansion. Context Pack remains limited to the files certified by the current normal plan.

## Dataflow Slice and generalized analysis handoff

`analysis.kind = "dataflow-slice"` answers value-flow questions that Trace does not: where a selected value originates, how it transforms, and where it may flow. It supports `forward`, `backward`, and `bidirectional` directions with an explicit criterion, optional target, and bounded node/edge/hop/file filters. It follows syntax-backed declarations, assignments, properties, arguments, parameters, returns, state access, contract crossings, integration boundaries, and effect sinks.

Dataflow Slice is static evidence, not temporal runtime certainty. Dynamic access, ambiguous bindings, unsupported syntax, policy filters, and traversal limits appear as explicit frontier or exclusion records. A result is `CERTIFIED`, `PARTIAL`, `UNABLE_TO_CERTIFY`, or `LIMITS_EXCEEDED`; CherryPick never replaces a missing criterion with an arbitrary graph node.

Usable Trace or Dataflow Slice evidence can be carried into a distinct normal plan with `analysis_handoff: { run_id, artifact_id? }`. `trace_handoff` remains accepted for compatibility. The handoff is bound to repository, immutable commit, project profile, artifact kind, and certificate. Analysis lineage strengthens planning evidence only: the destination plan must still independently certify Patch Corridor before mutation or exact-source expansion.

## Model-facing MCP surface

Exactly four MCP tools are exposed:

- `chrypck_plan` — begin all repository work; perform one objective-local semantic expansion only when needed, return structural/sparse-semantic orientation and diagnostics, optionally run Trace or Dataflow Slice, or create a fresh normal plan from certified `analysis_handoff` lineage.
- `chrypck_context` — return only the certified Context Pack for a READY normal plan, optionally one server-issued exact-source segment.
- `chrypck_execute` — execute typed edits or an explicitly approved server-issued path-move plan through native mutation, propagation, validation, and atomic publication.
- `chrypck_result` — return bounded authoritative run state, including persisted Trace/certificate or accepted Trace lineage where applicable, semantic orientation, telemetry, validation/propagation outcome, and terminal evidence.

There is no model-facing GitHub search, arbitrary file read, arbitrary GitHub write, shell, workflow-log reader, or workflow dispatcher.

## Governed connector manifest

ChryPck publishes a credential-free, versioned governed-connector manifest at `GET /connector-manifest`. The manifest describes its connector identity, MCP transport, lazy semantic expansion, focused analysis, certified analysis handoff, and all four public MCP tools.

The manifest deliberately does not contain deployment credentials, application-specific project scope, enabled state, or user authorization. A host orchestrator such as Lemonade owns those installation and governance decisions while ChryPck remains authoritative for what the service is and which capabilities it exposes.

## Normal repository workflow

```text
1. Structural Atlas + structural coverage immediately
2. one objective-local semantic expansion if the active region is unmapped
3. sparse Semantic Atlas + separate global/objective semantic coverage
4. general dependency/symbol/state/native-contract diagnostics plus Effect / Runtime Atlas
5. canonical Trace when causal/runtime investigation is useful
6. if focused analysis was used, create a distinct normal plan with certified analysis_handoff (trace_handoff remains compatible)
7. fresh Patch Corridor certification for the current normal plan
8. certified Context Pack exact-source expansion only where needed
9. one coherent cross-cutting patch across the currently certified path
10. user-authorized execute
11. Change Propagation + broad validation + atomic publication
12. authoritative result
```

Structural Atlas tells the model **where things are**. Semantic Atlas tells it **what major things are for**. Effect / Runtime Atlas tells it **what runtime behavior may occur and where effects can be observed**. Trace certifies one focused causal route; Dataflow Slice certifies bounded static value provenance or influence. Analysis handoff preserves either artifact across analysis and planning without granting mutation authority. Context Pack provides **exact implementation only where justified by the current certified plan**.

If those layers disagree, deterministic repository evidence, native contracts, Trace evidence, the current Patch Corridor, and certified source override semantic interpretation.

## Deliberate architecture operations

The Domain Decomposer and Path Mover remain intentionally less automatic than ordinary patch execution.

`chrypck_plan` can request `architecture.kind = "decompose"` to receive a compressed decomposition proposal derived from the hidden Repository Model. The proposal starts unapproved and authorizes only its proposed new target paths; the reviewed extraction is then supplied as ordinary bounded authoring intent.

`architecture.kind = "move"` produces a server-issued move plan plus dependency-derived import rewrites. After review, `chrypck_execute` may approve that exact `plan_id`; ChryPck executes the already-computed plan without recomputing or broadening it.

Analysis handoff is deliberately separate from architecture planning; an `analysis_handoff` normal plan cannot simultaneously request a new architecture operation. The compatibility `trace_handoff` input follows the same rule.

## Native execution spine

```text
plan
 → Scope Lock + Abstraction Lock
 → immutable snapshot
 → shared Repository Model
 → Structural Atlas
 → lazy one-region Semantic Atlas expansion when navigation requires it
 → diagnostics
 → optional canonical Trace artifact/certificate
 → optional certified Trace-to-plan lineage
 → fresh Patch Corridor + Context Pack
 → optional deliberate architecture plan
 → typed mutation staging
 → Change Propagation
 → structural + isolated project validation
 → compare-and-swap repository publication
 → native telemetry/result
```

GitHub is an internal transport adapter with only snapshot/publish semantics at the native execution boundary. ChryPck may read small repository documentation files such as README/architecture/docs Markdown into the immutable hidden snapshot solely to create bounded semantic evidence packets; those file bodies are not projected through the Semantic Atlas.

## Project profiles

The core is repository-agnostic. Project profiles supply source-profile rules, optional analyzers, validation policy/commands, runtime-probe planning, and native-contract providers. A Frame Conn profile is included alongside the generic fallback profile.

## Configuration

Required deployment values:

```text
GITHUB_TOKEN
ALLOWED_REPOSITORIES
```

Common optional values are documented in `.env.example`, including the default target branch, repository/file bounds, Semantic Atlas region/chunk/cache bounds, HTTP binding, public host/origin constraints, and bearer authentication.

## Development

```bash
npm install
npm run check
npm run dev
```

Endpoints:

```text
POST /mcp
GET  /healthz
GET  /connector-manifest
```

For a ChatGPT-connected deployment, expose `/mcp` through a stable HTTPS endpoint and configure authentication appropriate to that deployment. Do not expose a credentialed ChryPck instance publicly without authentication.
