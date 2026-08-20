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
diagnostic projections/maps          (compressed/lossy; model-visible)
        ↓
Patch Corridor
        ↓
certified Context Pack                (bounded exact-source expansion)
        ↓
LLM-authored bounded intent
        ↓
Change Propagation → validation → atomic publication
```

The model does not receive arbitrary repository search/list/read primitives. If compressed evidence is insufficient, ChryPck returns a capability/abstraction gap or produces a newly justified certified context expansion; the model does not fall back to repository exploration.

Model-visible diagnostic surfaces include dependency graph/watershed, symbol families, effect atlas, integration surfaces, runtime signals, state namespaces, native-contract evidence, Patch Corridor, Context Pack, runtime probes, and Change Propagation results.

## Model-facing MCP surface

Exactly four MCP tools are exposed:

- `chrypck_plan` — snapshot internally, build the exhaustive model, run diagnostics, certify the Patch Corridor, and optionally produce a review-required architecture plan.
- `chrypck_context` — return only the certified Context Pack (optionally one server-issued segment).
- `chrypck_execute` — execute typed edits or an explicitly approved server-issued path-move plan through native mutation, propagation, validation, and atomic publication.
- `chrypck_result` — return bounded run state, telemetry, validation/propagation outcome, and terminal evidence.

There is no model-facing GitHub search, arbitrary file read, arbitrary GitHub write, shell, workflow-log reader, or workflow dispatcher.

## Governed connector manifest

ChryPck publishes a credential-free, versioned governed-connector manifest at `GET /connector-manifest`. The manifest is the service-owned description of its connector identity, MCP transport path, workflow-bundle behavior, and the effect, approval, return, and error contracts for all four public MCP tools.

The manifest deliberately does not contain deployment credentials, application-specific project scope, enabled state, or user authorization. A host orchestrator such as Lemonade owns those installation and governance decisions while ChryPck remains authoritative for what the service is and which capabilities it exposes.

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
 → diagnostics
 → Patch Corridor + Context Pack
 → optional deliberate architecture plan
 → typed mutation staging
 → Change Propagation
 → structural + isolated project validation
 → compare-and-swap repository publication
 → native telemetry/result
```

GitHub is an internal transport adapter with only snapshot/publish semantics at the native execution boundary.

## Project profiles

The core is repository-agnostic. Project profiles supply source-profile rules, optional analyzers, validation policy/commands, runtime-probe planning, and native-contract providers. A Frame Conn profile is included alongside the generic fallback profile.

## Configuration

Required deployment values:

```text
GITHUB_TOKEN
ALLOWED_REPOSITORIES
```

Common optional values are documented in `.env.example`, including the default target branch, repository/file bounds, HTTP binding, public host/origin constraints, and bearer authentication.

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
