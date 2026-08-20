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
Semantic Atlas bootstrap             (what major things are for)
        ↓
diagnostic projections/maps          (compressed/lossy relationships)
        ↓
Patch Corridor
        ↓
certified Context Pack                (bounded exact-source expansion)
        ↓
LLM-authored bounded intent
        ↓
Change Propagation → validation → atomic publication
```

The Structural Repository Atlas is a bounded whole-repository path/tree orientation layer with an explicit coverage ledger. The Semantic Atlas is a separate evidence-backed semantic glossary of repository purpose, subsystem/module-group responsibilities, responsibility boundaries, major upstream/downstream relationships, and key flows. Semantic claims carry evidence references and confidence; they are orientation evidence, never source authority or mutation authority.

The model does not receive arbitrary repository search/list/read primitives. If compressed evidence is insufficient, ChryPck returns a capability/abstraction gap or produces a newly justified certified context expansion; the model does not fall back to repository exploration.

Model-visible diagnostic surfaces include Structural Repository Atlas, Semantic Atlas, structural/semantic coverage ledgers, dependency graph/watershed, symbol families, effect atlas, integration surfaces, runtime signals, state namespaces, native-contract evidence, Patch Corridor, Context Pack, runtime probes, and Change Propagation results.

## Mandatory first-pass Semantic Atlas bootstrap

For an uncached immutable repository commit/profile, the first `chrypck_plan` intentionally stops **before ordinary repository work** and returns:

```text
semantic_bootstrap.status = "required"
semantic_bootstrap.current_chunk = <bounded server-issued metadata packet>
```

The connected host LLM itself performs the semantic synthesis; ChryPck does not secretly call a second model provider. The host LLM must:

1. Read every semantic region in the current metadata chunk.
2. Describe the region's purpose, responsibilities, important non-ownership boundaries, and key flows only where supported by the supplied metadata.
3. Cite one or more server-issued `evidence_refs` for every semantic claim.
4. Call `chrypck_plan` again with `semantic_bootstrap { bootstrap_id, chunk_id, interpretations }`.
5. Repeat chunk by chunk until ChryPck returns `semantic_bootstrap.status = "complete"`.
6. Only then continue into general diagnostics, traces, certified source, patch synthesis, or execution.

ChryPck validates submitted evidence IDs, caps inferential confidence, rejects unsupported claims, and binds the bootstrap to the exact repository, immutable commit, and project profile. A lost in-memory bootstrap session fails safely by restarting the bounded semantic pass rather than guessing.

Completed Semantic Atlases are cached by repository + immutable commit + project profile + semantic schema version. The cache is deliberately abstracted from the semantic machinery; the initial implementation uses a bounded in-memory LRU so durable persistence can be added later without changing the MCP workflow.

## Model-facing MCP surface

Exactly four MCP tools are exposed:

- `chrypck_plan` — begin all repository work; perform mandatory chunked Semantic Atlas bootstrap when needed, then return Structural + Semantic orientation, diagnostics, certified Patch Corridor/Context Pack, and optional focused traces/architecture planning.
- `chrypck_context` — return only the certified Context Pack after bootstrap/planning, optionally one server-issued exact-source segment.
- `chrypck_execute` — execute typed edits or an explicitly approved server-issued path-move plan through native mutation, propagation, validation, and atomic publication.
- `chrypck_result` — return bounded run state, semantic orientation when available, telemetry, validation/propagation outcome, and terminal evidence.

There is no model-facing GitHub search, arbitrary file read, arbitrary GitHub write, shell, workflow-log reader, or workflow dispatcher.

## Governed connector manifest

ChryPck publishes a credential-free, versioned governed-connector manifest at `GET /connector-manifest`. The manifest is the service-owned description of its connector identity, MCP transport path, workflow-bundle behavior, all Structural/Semantic Atlas surfaces, mandatory semantic-bootstrap procedure, trace modes, and the effect, approval, return, and error contracts for all four public MCP tools.

The manifest deliberately does not contain deployment credentials, application-specific project scope, enabled state, or user authorization. A host orchestrator such as Lemonade owns those installation and governance decisions while ChryPck remains authoritative for what the service is and which capabilities it exposes.

## Normal repository workflow

```text
1. semantic bootstrap if required
2. Structural Atlas + structural coverage
3. Semantic Atlas + semantic coverage
4. general dependency/runtime/symbol/state/native-contract diagnostics
5. focused trace or bounded-event-trace when useful
6. certified Context Pack exact-source expansion only where needed
7. one coherent cross-cutting patch across the certified path
8. user-authorized execute
9. Change Propagation + broad validation + atomic publication
10. authoritative result
```

Structural Atlas tells the model **where things are**. Semantic Atlas tells it **what major things are for**. The hidden Repository Model and diagnostics tell it **how things are actually connected**. Context Pack provides **exact implementation only where justified**.

If those layers disagree, deterministic repository evidence, native contracts, traces, and certified source override semantic interpretation.

## Deliberate architecture operations

The Domain Decomposer and Path Mover remain intentionally less automatic than ordinary patch execution.

`chrypck_plan` can request `architecture.kind = "decompose"` to receive a compressed decomposition proposal derived from the hidden Repository Model. The proposal starts unapproved and authorizes only its proposed new target paths; the reviewed extraction is then supplied as ordinary bounded authoring intent.

`architecture.kind = "move"` produces a server-issued move plan plus dependency-derived import rewrites. After review, `chrypck_execute` may approve that exact `plan_id`; ChryPck executes the already-computed plan without recomputing or broadening it.

## Native execution spine

```text
plan
 → Scope Lock + Abstraction Lock
 → immutable snapshot
 → shared Repository Model
 → Structural Atlas
 → mandatory Semantic Atlas bootstrap if uncached
 → diagnostics
 → Patch Corridor + Context Pack
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
