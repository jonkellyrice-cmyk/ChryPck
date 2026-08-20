# ChryPck Native Architecture

ChryPck is now the canonical execution engine. The imported `dev_scripts` workflow is retired.

## Hard information boundary

The repository adapter hydrates an immutable snapshot and the repository layer constructs an exhaustive `RepositoryModel`. That substrate is an internal mechanical representation and is not itself exposed as an MCP browsing surface.

The LLM receives only derived projections: Structural/Semantic orientation, diagnostic maps, bounded Trace evidence, certified Trace-to-plan lineage, Patch Corridor evidence, bounded native-contract/runtime-probe information, Change Propagation reports, terminal telemetry, and exact source contained in a certified Context Pack. There is no generic repository search/list/read tool.

```text
RepositoryAdapter.snapshot()
        ↓
RepositoryModel (hidden exhaustive substrate)
        ↓
Structural + Semantic orientation
        ↓
Diagnostics (lossy/compressed projection)
        ↓
optional canonical Trace
        ↓
optional certified Trace handoff into a distinct normal plan
        ↓
Patch Corridor (fresh mutation-scope certification)
        ↓
Context Pack (bounded exact expansion)
        ↓
LLM intent
        ↓
Mutation → propagation → validation → RepositoryAdapter.publish()
```

`ABSTRACTION_GAP` is the escalation mechanism when evidence is insufficient. It is not permission to descend into arbitrary source browsing.

## Capability boundary

The model-facing surface is only `chrypck_plan`, `chrypck_context`, `chrypck_execute`, and `chrypck_result`. Internal repository transport, analyzers, planners, mutation primitives, validators, and telemetry are not separately exposed.

The hard guarantee requires ChryPck to be the sole repository capability available to the model. A separately exposed unrestricted GitHub/filesystem/shell integration would be an independent bypass ChryPck cannot intercept.

## Analysis lineage and authority boundary

Canonical Trace is an analytical run, not a mutation plan. A Trace result is persisted as a first-class run artifact together with its bounded path evidence and path certificate. When a host needs to turn that diagnosis into implementation planning, it creates a **new** normal `chrypck_plan` run and supplies `trace_handoff { run_id, certificate_id? }`.

The handoff is accepted only when the source Trace belongs to the same repository, immutable commit, and project profile and has a usable `CERTIFIED` or `BLOCKED` certificate. Unknown, mismatched, forged, or uncertified lineage fails closed.

Trace lineage supplies bounded planning evidence only. It does not transfer Scope Lock authority and does not automatically authorize every file on the Trace path. The destination normal plan independently certifies a fresh Patch Corridor for its current objective, and exact source remains limited to the Context Pack produced by that current corridor.

This intentionally separates:

```text
Trace bounds read-only investigation.
Trace handoff preserves certified analysis evidence.
Patch Corridor bounds mutation.
Context Pack bounds exact-source expansion.
```

Trace and normal planning also have distinct request identities even when the objective text is identical, so analysis and action remain auditable as separate stages.

## Deliberate architecture tools

Domain decomposition and path movement are planning-heavy operations. They remain review-gated rather than becoming automatic side effects of normal patching. The decomposer emits an unapproved proposal and bounded new-path authority. The mover emits an unapproved exact move/import-rewrite plan which can later be approved by `plan_id`.

Architecture planning is deliberately not combined with `trace_handoff`; the handoff creates a normal evidence-informed plan whose mutation corridor is independently certified before any separate architectural operation is considered.

## Project profiles

Repository-independent policy/orchestration stays in core. Project-specific source rules, validation, extra analyzers, probes, and native-contract providers live behind `ProjectProfile`.
