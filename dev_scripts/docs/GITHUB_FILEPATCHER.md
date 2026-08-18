# GitHub FilePatcher

`dev_scripts/github-filepatcher.mjs` is a small deterministic repository mutation tool designed for changes authored through GitHub rather than an interactive local checkout.

It exists because large direct source-file writes through API tooling can be fragile, difficult to review, or rejected by intermediary safety systems. Instead of asking a remote agent to rewrite arbitrary repository files directly, the agent writes a compact declarative patch to `dev_scripts/github-filepatcher.json`. GitHub Actions then checks out the repository, dry-runs the patch, applies it locally, validates the resulting diff, and commits the verified source change.

The separation between the local and GitHub executors is intentional even though both now live in the same development-tool directory:

```text
model proposes
      ↓
JSON constrains
      ↓
patcher decides
      ↓
runner executes
      ↓
validation proves
      ↓
Git records
```

## Relationship to the existing Python FilePatcher

Frame Conn keeps both FilePatcher executors under `dev_scripts/`:

```bash
npm run patch
npm run github:patch
```

The Python tool remains the richer local authoring/validation system and uses `dev_scripts/filepatcher.json`. The GitHub FilePatcher remains the compact remote-execution bridge and uses the distinct `dev_scripts/github-filepatcher.json` contract so the two execution modes cannot overwrite one another.

## Components

```text
dev_scripts/
  github-filepatcher.mjs   deterministic patch executor
  filepatcher.json         authoritative GitHub patch specification
  README.md                this document

.github/workflows/
  github-filepatcher.yml   automatic GitHub Actions runner

package.json
  github:patch             npm entry point
```

## Planning-aware toolchain

The GitHub FilePatcher now participates in a nine-capability evidence/planning/validation pipeline:

1. **Integration Surface Atlas** — discovers legitimate native Lancer integration surfaces from authoritative source.
2. **Runtime Signal Map** — traces statically evidenced UI/event/Flow/effect paths.
3. **Clause-Aware Patch Corridor** — certifies architecture ownership for every behavioral clause.
4. **Corridor Context Pack** — returns exact source slices/imports/callers/exemplars for authoring.
5. **Native Contract Catalog** — reuses version/hash-backed native facts and detects drift.
6. **Automatic Patch Staging** — decomposes cross-cutting work into dependency-safe phases with exact scope locks.
7. **Expanded Pattern-Aware DSL** — clones only proven local structural exemplars and compiles to ordinary FilePatcher JSON.
8. **Change Propagation Simulator** — compares FilePatcher's exact staged before/after state, classifies contract deltas, derives intermediate-state obligations and compatibility strategies, predicts bounded behavioral amplification, and targets the most load-bearing verification.
9. **Runtime Contract Probes** — generates reversible Foundry instrumentation plus explicit manual checkpoints for live testing.

The complete operator contract lives in `dev_scripts/DEVELOPMENT_TOOL_SUITE_GUIDE.md`.

### `planning_goal`

Schema v2 patches may carry the complete behavior as `planning_goal`:

```json
{
  "schema_version": 2,
  "id": "example",
  "description": "Implement an end-to-end behavior.",
  "planning_goal": "describe every behavior the finished patch must satisfy",
  "policy": {
    "max_files_changed": 1,
    "allowed_paths": ["exact/target/file.js"]
  },
  "operations": []
}
```

When present, FilePatcher uses this pre-mutation chain. Mutation planning itself happens first so every downstream tool can reason over the exact staged state that FilePatcher would write:

```text
mutation planning (in memory)
    ↓
planning_goal → Clause-Aware Patch Corridor
    ↓
Automatic Patch Staging
    ↓
Change Propagation Simulator
  exact staged before/after transition
    ↓
Corridor Context Pack
    ↓
Native Contract Catalog
    ↓
Runtime Contract Probes (temporary bundle)
```

For patches without `planning_goal`, the simulator still runs whenever the mutation plan contains at least one changed file. Automatic bridge use is advisory: unsafe-transition findings are logged as compatibility warnings, while FilePatcher policy and the permanent audits remain the blocking gates.

The Integration Surface Atlas and Runtime Signal Map are consulted when native proof is missing or drifted rather than rescanned automatically for every routine patch.

Planning-only patches with `operations: []` are first-class: they can prove clause coverage, expected scope, dependency phases, authoring context, native-contract reuse, and live-probe coverage without touching source.

## Supported operations

### replace_text

Exact replacement in an existing file:

```json
{
  "type": "replace_text",
  "path": "some/file.js",
  "search": "const oldValue = true;",
  "replace": "const newValue = true;",
  "expected_occurrences": 1
}
```

Without `expected_occurrences`, the search text must occur exactly once. Ambiguous replacement fails.

### create_file

```json
{
  "type": "create_file",
  "path": "some/new-file.js",
  "content": "export const example = true;\n"
}
```

Existing files are protected unless `overwrite: true` is explicitly supplied.

### replace_file

```json
{
  "type": "replace_file",
  "path": "some/existing-file.js",
  "content": "export const replacement = true;\n"
}
```

`create_file` and `replace_file` accept `encoding: "utf8"` or `encoding: "base64"`.

## Patch document

```json
{
  "schema_version": 2,
  "id": "short-descriptive-patch-id",
  "description": "Describe the intended repository change.",
  "planning_goal": "Optional complete behavioral goal for cross-cutting/runtime-sensitive work.",
  "policy": {
    "max_files_changed": 1,
    "allowed_paths": ["example.js"]
  },
  "operations": [
    {
      "type": "replace_text",
      "path": "example.js",
      "search": "old text",
      "replace": "new text",
      "expected_occurrences": 1
    }
  ]
}
```

Schema versions 1 and 2 are accepted; version 2 is recommended. `policy.max_files_changed` defaults to 1, which makes one-file/one-commit work the default rather than a convention.

## Safety properties

The executor rejects paths that escape the repository root or target the repository root itself. `.git`, `.github/workflows`, and `node_modules` are protected by default; additional protected paths can be added with `policy.protected_paths`.

All operations are planned in memory before any file is written. Multiple operations against one file see the staged result of the previous operation. The executor computes the final set of changed files and rejects the patch if it exceeds `policy.max_files_changed`. When `policy.allowed_paths` is present, every changed file must also belong to that exact allow-list; staged patch skeletons use this as a hard scope lock.

If the write phase fails partway through, the executor attempts to restore every file already written.

Operations may specify `expected_sha256`; a stale source file then causes the patch to fail instead of applying against unexpected content.

There is no arbitrary shell-command operation, delete operation, or move operation in the JSON DSL.

## Local use

Preview without changing files:

```bash
npm run github:patch -- --dry-run
```

Apply locally:

```bash
npm run github:patch
```

Dry-run and apply use the same planning logic; dry-run stops before the transaction writes to disk.

## GitHub Actions workflow

The workflow must live at:

```text
.github/workflows/github-filepatcher.yml
```

It triggers on pushes to `main` that change:

```text
dev_scripts/github-filepatcher.json
```

Execution order:

```text
push filepatcher.json
        ↓
checkout main
        ↓
validate patcher syntax
        ↓
dry-run
  ├─ exact staged mutation plan
  ├─ Change Propagation Simulator when files would change
  └─ planning_goal evidence pipeline when present
        ↓
apply
  ├─ exact staged mutation plan
  ├─ Change Propagation Simulator when files would change
  ├─ planning_goal evidence pipeline when present
  ├─ permanent developer-tool self-tests
  ├─ Repository Audit
  ├─ Symbol Family Audit
  └─ Effect Atlas
        ↓
detect tracked + untracked changes
        ↓
git diff --check
        ↓
stage
        ↓
commit as github-actions[bot]
        ↓
push verified patch
```

Change detection uses `git status --porcelain`, so `create_file` operations are detected even though newly created files are initially untracked.

The workflow is concurrency-serialized (`cancel-in-progress: false`) and requests `contents: write` because the verified result must be pushed back to the repository.

## Normal remote workflow

For a simple localized patch:

1. Inspect the exact current target source.
2. Author the narrowest supported DSL/JSON change.
3. Keep `policy.max_files_changed` at 1 and use exact `policy.allowed_paths` when practical.
4. Push only the patch specification.
5. Inspect the Change Propagation summary for breaking deltas, immediate consumers, fan-out risk, compatibility-stage warnings, and targeted verification.
6. Confirm dry-run, apply, permanent self-tests, architecture audits, diff validation, and the bot commit.

For cross-cutting/runtime-sensitive work:

1. Put the complete behavior in `planning_goal`.
2. Require clause-complete corridor coverage.
3. Inspect Automatic Patch Staging; keep dependency-safe provider-before-consumer order.
4. Author from the Corridor Context Pack rather than guessing surrounding structure.
5. Reuse Native Contract Catalog facts; rediscover with Atlas/Signal Map only when needed.
6. Stage broad work into narrow patches rather than forcing one giant mutation.
7. After static success, run the generated Runtime Contract Probe scenario in Foundry and resolve automatic plus manual checkpoints.

The remote author still performs only a small API write; deterministic code on the runner performs the real mutation and static validation.

## Neutral/no-op state

```json
{
  "schema_version": 2,
  "id": "ready",
  "description": "No-op placeholder. Replace operations with the next GitHub FilePatcher change.",
  "policy": {
    "max_files_changed": 1
  },
  "operations": []
}
```

## Permanent repository/tool validation

Frame Conn now has a committed trust gate inside `github-filepatcher.mjs`. A real apply validates the development tools themselves before running architectural audits. The current permanent set includes:

```text
Patch DSL self-test
Integration Surface Atlas self-test
Runtime Signal Map self-test
Clause-Aware Patch Corridor self-test
Corridor Context Pack self-test
Native Contract Catalog self-test + catalog verification
Automatic Patch Staging self-test
Runtime Contract Probes self-test
Change Propagation Simulator self-test
developer-tool syntax checks
Repository Audit
Symbol Family Audit
Effect Atlas
```

Blocking failure rolls the patch back rather than committing a source change.

When the patch modifies FilePatcher or any permanent validator/self-test, the accepting run may still be using the previously committed validator. After that tooling repair lands, run an **independent no-op patch from the committed new gate** before treating the trust-boundary change as proven. Do not weaken a failing self-test merely to obtain a green workflow.
