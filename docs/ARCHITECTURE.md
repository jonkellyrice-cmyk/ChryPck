# ChryPck Native Architecture

ChryPck is now the canonical execution engine. The imported `dev_scripts` workflow is retired.

## Hard information boundary

The repository adapter hydrates an immutable snapshot and the repository layer constructs an exhaustive `RepositoryModel`. That substrate is an internal mechanical representation and is not itself exposed as an MCP browsing surface.

The LLM receives only derived projections: diagnostic maps, Patch Corridor evidence, bounded native-contract/runtime-probe information, Change Propagation reports, terminal telemetry, and exact source contained in a certified Context Pack. There is no generic repository search/list/read tool.

```text
RepositoryAdapter.snapshot()
        ↓
RepositoryModel (hidden exhaustive substrate)
        ↓
Diagnostics (lossy/compressed projection)
        ↓
Patch Corridor
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

## Deliberate architecture tools

Domain decomposition and path movement are planning-heavy operations. They remain review-gated rather than becoming automatic side effects of normal patching. The decomposer emits an unapproved proposal and bounded new-path authority. The mover emits an unapproved exact move/import-rewrite plan which can later be approved by `plan_id`.

## Project profiles

Repository-independent policy/orchestration stays in core. Project-specific source rules, validation, extra analyzers, probes, and native-contract providers live behind `ProjectProfile`.
