# Frame Conn Development Tool Suite Guide

This document is the operator guide for the repository's development-tool stack. It explains what each tool owns, how the tools fit together, the normal remote workflow, the two DSL authoring levels, and the recovery path when GitHub Actions or the remote patch path is unavailable.

The guiding principle is: **author intent narrowly, execute deterministically, validate broadly, and fail closed rather than guess.**

---

## 1. The suite at a glance

The development tools now live in one canonical `dev_scripts/` directory. The local and GitHub executors remain separate contracts within that directory:

```text
dev_scripts/
  filepatcher.py                  rich local FilePatcher / recovery executor
  filepatcher.json                local Python FilePatcher patch contract
  filepatcher-bootstrap.md        authoritative Python FilePatcher authoring contract
  PATCH_DSL.md                    Patch DSL syntax guide
  patch-dsl-compiler.mjs          DSL compiler for GitHub FilePatcher JSON
  patch-corridor-planner.mjs      goal -> likely patch corridor planner
  automatic-patch-staging.mjs     corridor -> dependency-ordered staged patch specs
  change-propagation-simulator.mjs exact staged transition -> temporal compatibility/risk report
  runtime-contract-probes.mjs      goal -> reversible Foundry runtime probe bundle
  domain-decomposer.mjs           file/domain evidence -> reviewable decomposition plan
  domain-decomposer-executor.mjs  approved plan -> dependency-closed FilePatcher extraction
  domain-decomposer-policy.json   LOC pressure + decomposition-resistant architecture policy
  repo-audit.mjs                  repository integrity + dependency watershed
  symbol-family-audit.mjs         symbol-family topology / ownership audit
  effect-atlas.mjs                side-effect ownership audit
  dependency_graph.py             detailed static dependency graph diagnostic
  backups/                        local Python FilePatcher backups
  patch-history/                  local Python FilePatcher patch history

  github-filepatcher.mjs          narrow remote/GitHub patch executor
  github-filepatcher.json         authoritative GitHub patch specification
  GITHUB_FILEPATCHER.md           GitHub FilePatcher-specific documentation
  path-mover.mjs                  relocation + relative-import rewrite executor
  path-mover.json                 declarative relocation plan

.github/workflows/
  github-filepatcher.yml          automatic remote patch workflow
```

The package scripts are:

```bash
# Executors
npm run patch
npm run github:patch

# Architecture diagnostics
npm run audit
npm run symbol-family-audit
npm run effect-atlas
npm run dependency-graph

# 1 — Integration Surface Atlas
npm run integration-atlas
npm run integration-atlas:self-test

# 2 — Runtime Signal Map
npm run runtime-signal-map
npm run runtime-signal-map:self-test

# 3 — Clause-Aware Patch Corridor
npm run patch-corridor
npm run patch-corridor:self-test

# 4 — Corridor Context Pack
npm run corridor-context
npm run corridor-context:self-test

# 5 — Native Contract Catalog
npm run native-contracts
npm run native-contracts:verify
npm run native-contracts:self-test

# 6 — Automatic Patch Staging
npm run patch-staging
npm run patch-staging:self-test

# 7 — Structural / Pattern-Aware DSL
npm run patch:dsl
npm run patch:dsl:check
npm run patch:dsl:self-test

# 8 — Change Propagation Simulator
npm run change-propagation -- --snapshot transition.json --output change-propagation-report.json
npm run change-propagation:self-test

# 9 — Runtime Contract Probes
npm run runtime-probes
npm run runtime-probes:self-test

# 10 — Domain Decomposer
npm run decompose
npm run decompose:self-test
npm run decompose:apply -- --dry-run
npm run decompose:apply -- --apply
npm run decompose:apply:self-test
```

---

## 2. Mental model

The normal remote path is:

```text
behavioral request
    ↓
Native Contract Catalog first
  reuse proven native facts when current
    ↓
Integration Surface Atlas + Runtime Signal Map when proof is missing/drifted
  discover legitimate native surfaces + trace causal runtime paths
    ↓
planning_goal
    ↓
Clause-Aware Patch Corridor
  every requested behavior gets an owner/path
    ↓
Automatic Patch Staging
  provider-before-consumer phases + exact scope locks
    ↓
Corridor Context Pack
  exact local source slices/imports/callers/exemplars
    ↓
Native Contract Catalog
  surface matching proven contracts for authoring
    ↓
Runtime Contract Probe plan
  live-observable clauses + explicit manual checkpoints
    ↓
Patch DSL / pattern-aware shorthand / raw schema-v2 JSON
    ↓
dev_scripts/github-filepatcher.json
    ↓
GitHub FilePatcher builds exact staged before/after transition
    ↓
Change Propagation Simulator
  contract deltas + intermediate obligations + compatibility + fan-out + verification targets
    ↓
GitHub FilePatcher dry-run + apply
    ↓
permanent developer-tool self-tests
    ↓
Repository Audit
    ↓
Symbol Family Audit
    ↓
Effect Atlas
    ↓
git diff validation
    ↓
github-actions[bot] commit
    ↓
live Foundry Runtime Contract Probe test when runtime-sensitive
```

The detailed dependency graph is a deeper manual diagnostic. It is not part of the automatic blocking gate.

The local Python FilePatcher is the richer fallback/recovery path and maintains its own backup/history facilities.

### The nine capability upgrades

The planning/authoring/runtime-validation stack now has nine explicit capabilities. They are designed as one evidence-reduction pipeline rather than nine unrelated utilities:

```text
1. Integration Surface Atlas
   authoritative native Lancer source -> legitimate integration surfaces

2. Runtime Signal Map
   native/Frame Conn surfaces -> statically evidenced runtime causal paths

3. Clause-Aware Patch Corridor
   behavioral goal -> clause coverage + owner families/files/symbols

4. Corridor Context Pack
   certified corridor -> exact source slices/imports/callers/exemplars

5. Native Contract Catalog
   proven native facts -> version/hash-backed reusable contracts

6. Automatic Patch Staging
   clause-complete corridor -> provider-before-consumer implementation phases

7. Expanded Pattern-Aware DSL
   proven local exemplar -> compact deterministic FilePatcher operations

8. Change Propagation Simulator
   exact proposed repository transition -> contract propagation + intermediate obligations + compatibility sequencing + behavioral amplification + targeted verification

9. Runtime Contract Probes
   behavioral clauses/runtime evidence -> reversible Foundry instrumentation + manual checkpoints
```

The workflow effect is equally important:

- native integration is discovered from authoritative source instead of memory;
- runtime paths are traced before implementation instead of inferred from names;
- a cross-cutting request must cover every behavioral clause before it can be high-confidence;
- patch authors can work from exact local context rather than repeatedly reopening whole files;
- already-proven native contracts are reused until evidence/version drift invalidates them;
- large patches can remain one end-to-end behavior while implementation is decomposed into dependency-safe stages;
- repetitive boilerplate is compressed only when a real local exemplar proves the shape;
- each authored stage is evaluated as a temporal transition before mutation, so breaking contract deltas, unsafe intermediate states, amplification risks, and load-bearing verification targets are surfaced before the repository advances;
- runtime-sensitive work can finish with structured Foundry evidence instead of informal console impressions.

A useful shorthand is:

```text
discover -> trace -> certify -> contextualize -> reuse proof -> stage -> author -> simulate transition -> observe live
```

---

# PART I — DIAGNOSTICS

## 3. Repository Audit — `repo-audit.mjs`

Run with:

```bash
npm run audit
```

This is the primary repository-integrity diagnostic. It checks structural correctness such as missing imports, case mismatches, missing named exports, duplicate feature IDs/providers, missing capabilities, registry membership, manifest entrypoints, circular JS dependencies, JSON validity, and related topology failures.

Its high-level view is the **dependency watershed**. Instead of dumping every import edge, it summarizes feature/domain streams, where they converge, and whether they reach the expected runtime outlets. Healthy topology is summarized; unhealthy topology is expanded.

Think of it as answering:

> Do the repository's major dependency streams connect to the correct composition rivers and runtime outlets?

A warning-only report can still pass. Errors are blocking.

---

## 4. Symbol Family Audit — `symbol-family-audit.mjs`

Run with:

```bash
npm run symbol-family-audit
```

This diagnostic groups large numbers of individual declarations/exports/imports/references into related **symbol families** so the codebase can be reasoned about in conceptual clusters rather than one symbol at a time.

It answers questions such as:

- Which symbols belong to the same conceptual subsystem?
- Which files own that family?
- Which families feed or consume it?
- Are symbols crossing architecture boundaries unexpectedly?
- Are there malformed, disconnected, or suspiciously orphaned family members?

The analyzer is deliberately conservative around Foundry's dynamic hooks, callbacks, reflection, and runtime globals. Proven structural failures should be treated differently from heuristic or informational orphan signals.

Healthy families are summarized. Unhealthy families receive detail.

---

## 5. Effect Atlas — `effect-atlas.mjs`

Run with:

```bash
npm run effect-atlas
```

The Effect Atlas maps side-effect-producing code and its ownership. It identifies effect families such as native execution, Foundry document mutation, hooks, notifications, settings, and application lifecycle behavior.

It answers:

> Where does this repository actually cause things to happen, and do those effects occur in the architectural layers that are allowed to own them?

The important distinction is between expected/delegated effects and suspicious/forbidden effects. A clean atlas should have no suspicious or forbidden effect sites.

This tool is especially useful before moving execution code, introducing a new adapter, or letting UI code reach toward native Foundry/Lancer effects.

---

## 6. Dependency Graph — `dependency_graph.py`

Run with:

```bash
npm run dependency-graph
```

This is the deeper static graph diagnostic. It scans source/module/style/template dependencies and produces `dev_scripts/dependency-graph-report.json`.

Use it when the compact dependency watershed is not enough and you need more detailed graph information, for example:

- tracing unexpected fan-in/fan-out;
- locating a concrete import path through several files;
- investigating dependency concentration;
- comparing low-level graph reality with the higher-level feature watershed.

This tool is intentionally **not** part of the automatic GitHub FilePatcher blocking gate. The normal gate uses the repository audit, symbol-family audit, and effect atlas; the dependency graph is a deeper investigative instrument.

---

# PART II — PATCH PLANNING AND AUTHORING

## 7. Integration Surface Atlas — `integration-surface-atlas.mjs`

Run against an authoritative native Lancer checkout with:

```bash
npm run integration-atlas -- --native-root /path/to/foundryvtt-lancer --query "damage attack flow"
```

Run its synthetic extraction test with:

```bash
npm run integration-atlas:self-test
```

The Integration Surface Atlas is the native-system discovery layer. It indexes the places where Frame Conn can legitimately meet Foundry Lancer: registered Flows and their ordered steps, Flow-step registries, native/Foundry hooks, `game.lancer.*` surfaces, chat-message controls, LancerActor/LancerItem/LancerToken entry points, document mutation boundaries, damage application boundaries, and explicit registries.

It answers:

> Where does native Lancer already expose the integration surface needed for this behavior?

This tool is not another Frame Conn topology audit. It scans authoritative native source and emits source/line evidence plus a version and SHA-256 source fingerprint. A generated report may be queried repeatedly without rescanning, but it must be regenerated when the authoritative native Lancer version changes. Search hits are candidates, not permission to invent or bypass native ownership.

See `dev_scripts/INTEGRATION_SURFACE_ATLAS.md` for the full contract.

---

## Runtime Signal Map — `runtime-signal-map.mjs`

Run against Frame Conn plus an authoritative native Lancer checkout with:

```bash
npm run runtime-signal-map -- --native-root /path/to/foundryvtt-lancer --query "attack damage chat"
```

Ask for an explicit causal path with:

```bash
npm run runtime-signal-map -- --report dev_scripts/runtime-signal-map-report.json --from "click .lancer-damage-apply" --to damageCalc
```

The Runtime Signal Map complements the Integration Surface Atlas. The Atlas answers **what native surfaces exist**; the signal map answers **how statically evidenced runtime signals travel between them**. It maps UI events, named handlers, direct calls, Flow construction, ordered Flow steps, Flow-step implementations, hooks, chat creation, damage application, and document mutation boundaries.

The mapper fails conservative: ambiguous call targets are omitted instead of guessed. Generated reports record source version/fingerprints and must be regenerated when authoritative native source changes. It is a planning/diagnostic tool, not live Foundry runtime proof.

See `dev_scripts/RUNTIME_SIGNAL_MAP.md` for the full contract.

---

## 8. Patch Corridor Planner — `patch-corridor-planner.mjs`

Run with:

```bash
npm run patch-corridor -- --goal "wire committed Scan through native execution"
```

The planner takes a behavioral goal and uses the current repository diagnostics to identify a likely **patch corridor**: the feature families, files, and symbols most likely to participate in the change.

It is now **clause-aware**. Before certifying a corridor it splits a behavioral goal into independently checkable clauses, detects the architectural concerns in each clause, resolves candidate owner families, and requires a statically known family path for every required obligation. The JSON report records each clause, its concern obligations, candidate owners, selected owner, path, and coverage status.

It helps answer both:

> Where should this change probably travel through the architecture?

and:

> Did the proposed corridor account for every distinct behavior the request actually requires?

A corridor cannot receive high confidence unless clause coverage is complete. If any clause has no deterministic owner/path, the planner writes the incomplete report and exits nonzero rather than silently certifying a partial implementation.

The planner consumes the repository audit, symbol-family audit, and effect atlas. It refuses to plan against unhealthy diagnostics. It also intentionally keeps dormant architecture out of the corridor unless the goal explicitly calls for it.

A corridor is guidance, not magical proof. If implementation discovers a real dependency outside the predicted corridor, expand the scope deliberately and explain why.

Run the deterministic clause-decomposition self-test with `npm run patch-corridor:self-test`. When `planning_goal` is present in `dev_scripts/github-filepatcher.json`, the GitHub FilePatcher runs this clause-aware planner before mutation and reports how many changed files are inside or outside the certified corridor.

---

## Automatic Patch Staging — `automatic-patch-staging.mjs`

Run directly from a behavioral goal with:

```bash
npm run patch-staging -- --goal "wire committed Scan through native execution and show the Scan choice in the UI"
```

Automatic Patch Staging takes a clause-complete Patch Corridor and the Symbol Family dependency graph and answers:

> In what dependency-safe phases should a large cross-cutting implementation be attempted?

The stager treats a family's `outgoingFamilies` as dependencies, reverses those edges into provider-before-consumer implementation order, condenses strongly connected components, and topologically layers the certified corridor. Dependency cycles are emitted as atomic groups instead of being given an invented internal order.

Its safe default is one generated FilePatcher spec per file. Skeleton specs contain no invented operations and use both `max_files_changed` and the new exact `policy.allowed_paths` lock. GitHub FilePatcher enforces `allowed_paths` before mutation. If an already-authored multi-file patch is supplied with `--patch`, the stager partitions its existing operations without changing them. Operations outside the certified corridor and ambiguous multi-file operations such as `replace_tree_text` are rejected.

When `planning_goal` is present, GitHub FilePatcher automatically runs the stager in report-only mode and reports whether the current patch crosses several dependency phases. The recommendation is advisory; the existing corridor certification and post-apply audits remain the blocking gates.

Run the deterministic topology/safety test with `npm run patch-staging:self-test`. See `dev_scripts/AUTOMATIC_PATCH_STAGING.md` for the complete contract and operator workflow.

---

## Corridor Context Pack — `corridor-context-pack.mjs`

Generate a compact authoring packet directly from a certified behavioral goal with:

```bash
npm run corridor-context -- --goal "show Brace after damage, spend the reaction, apply native Resistance, and restrict the next turn"
```

Or consume an existing Patch Corridor report with:

```bash
npm run corridor-context -- --corridor patch-corridor-report.json
```

The Context Pack is downstream of the clause-aware planner and cannot broaden its scope. For each planner-selected symbol it returns the exact source slice and line range, only imports actually referenced by that slice, lexical callers/consumers with source evidence, the clause/concern ownership reason that selected the family, and a nearby structural exemplar only when one candidate wins unambiguously. Missing or ambiguous symbol boundaries and exemplar ties are reported as omissions rather than guessed.

It answers:

> What exact source context do I need to author this certified patch without reopening whole files?

Run its deterministic self-test with `npm run corridor-context:self-test`. See `dev_scripts/CORRIDOR_CONTEXT_PACK.md` for the full contract.

---

## Native Contract Catalog — `native-contract-catalog.mjs`

The Native Contract Catalog persists already-proven native Lancer integration facts with upstream version, git commit, exact source paths/symbols/line ranges, complete-file SHA-256 hashes, exact evidence-slice hashes, and explicit Frame Conn ownership rules. It exists so a native API or boundary that has already been authoritatively traced does not need to be rediscovered on every future patch.

Query it with `npm run native-contracts -- --query "basic attack"`, inspect one entry with `--show <contract-id>`, and re-hash all persisted evidence against an authoritative native checkout with `npm run native-contracts:verify -- --native-root /path/to/foundryvtt-lancer`. `source-drift`, `contract-drift`, missing source, and native-version mismatch are verification failures rather than silent cache hits.

When FilePatcher receives a `planning_goal`, it now prints matching proven contracts after the Corridor Context Pack. The intended rule is **catalog first; rediscover only when no proven contract exists or the stored evidence has drifted**. Post-apply developer-tool validation also syntax-checks and self-tests the catalog tool and validates the committed catalog schema.

Run `npm run native-contracts:self-test` for the deterministic drift-detection test. See `dev_scripts/NATIVE_CONTRACT_CATALOG.md` for the complete contract and update discipline.

---

## Runtime Contract Probes — `runtime-contract-probes.mjs`

Generate a targeted live-test bundle with:

```bash
npm run runtime-probes -- --goal "offer Brace when hit, spend the reaction, halve damage, and restrict the next turn"
```

Runtime Contract Probes are the live-validation layer downstream of the clause-aware corridor, Runtime Signal Map, and Native Contract Catalog. They generate a machine-readable manifest, a reversible Foundry browser-console harness, and a short test checklist. The harness observes source-backed hooks, native Flow lifecycle boundaries, selector-aware DOM events, and selected reversible global effects such as `ChatMessage.create`; it does not trigger gameplay actions or mutate actor/combat state merely to satisfy a test.

Each behavioral clause is marked `instrumented` when the static tools can justify a safe observer, or becomes an explicit manual checkpoint when they cannot. In Foundry, `FrameConnRuntimeProbe.evaluate()` reports `OBSERVED`, `NOT_OBSERVED`, or `MANUAL`, while `.report()` returns the structured event evidence. Use `.mark()` and `.snapshot()` for postconditions that cannot be proven by observer firing alone, and always call `.stop()` to restore installed listeners/wrappers.

When `planning_goal` is present, GitHub FilePatcher automatically generates the probe bundle under temporary runner storage and prints probe coverage into the planning log; generated instrumentation is not committed. The permanent developer-tool gate syntax-checks the generator and runs `npm run runtime-probes:self-test`.

See `dev_scripts/RUNTIME_CONTRACT_PROBES.md` for the complete live-testing and safety contract.

---

## 8. DSL Level 1 — Structural Patch DSL

Compiler:

```text
dev_scripts/patch-dsl-compiler.mjs
```

Guide:

```text
dev_scripts/PATCH_DSL.md
```

Commands:

```bash
npm run patch:dsl:check
npm run patch:dsl
npm run patch:dsl:self-test
```

The Patch DSL is an authoring shorthand. It does **not** mutate source files. It compiles a concise textual patch description into ordinary schema-v2 `dev_scripts/github-filepatcher.json`, which remains the executable contract.

Core primitives include:

- `file <path>`
- `within <symbol>`
- `global`
- `replace`
- `before`
- `after`
- `delete`
- `create`
- `rewrite`
- `raw`

`within <symbol>` is particularly important: it narrows edits to a resolved top-level function, class, or simple binding and then emits an exact deterministic replacement for that symbol.

Use this level when you know **what exact code change** you want but do not want to hand-author verbose JSON.

---

## 9. DSL Level 2 — Pattern-aware shorthand

Pattern-aware shorthand sits inside the Patch DSL. It is the higher abstraction level for repetitive local shapes.

Current supported forms are:

- `clone-pattern ui-control`
- `clone-pattern object-entry`
- `clone-pattern switch-case`
- `clone-pattern feature-registration`
- `clone-pattern runtime-binding`
- `clone-pattern feature-api-member`
- `clone-pattern hook-handler`
- `clone-pattern flow-step`
- `clone-pattern actor-flag`

Example:

```text
file styles/ui_application/components/application-committed-plan.js
within renderCommittedPlan

clone-pattern ui-control after containing frame-conn-plan-execute
map
<<<
{
  "frame-conn-plan-execute": "frame-conn-plan-scan",
  "executeLabel": "scanLabel",
  "executeIcon": "scanIcon"
}
>>>
```

The rule is **exemplar-driven, never invention-driven**. The compiler copies a real structure that already exists inside the exact target symbol and applies only explicit substitutions.

Safety rules:

1. Pattern expansion is local to `within <symbol>`.
2. The exemplar must resolve unambiguously.
3. If several candidates exist, `containing <needle>` must reduce them to exactly one.
4. Every mapped source token must actually exist in the exemplar.
5. Unsupported or ambiguous shapes fail compilation.
6. Named semantic forms only recognize an already-present local structure; they do not create missing registry, API, hook, flow, binding, or actor-flag architecture.
7. Comma-delimited forms preserve the exemplar's local comma style; call-shaped forms clone the whole local call statement.
8. When the compiler cannot prove a pattern, fall back to explicit Level-1 DSL or `raw`.

This level exists to save tokens and reduce duplicated boilerplate without turning the tool into a speculative code generator. The permanent `patch:dsl:self-test` now exercises all nine supported pattern forms on deterministic fixtures.

---

# PART III — PATCH EXECUTORS

## 10. GitHub FilePatcher — `dev_scripts/github-filepatcher.mjs`

Run manually with:

```bash
npm run github:patch -- --dry-run
npm run github:patch
```

Its authoritative patch document is:

```text
dev_scripts/github-filepatcher.json
```

This is the preferred remote execution bridge. It supports a deliberately small operation surface, including exact text replacement, file creation/replacement, and controlled tree-wide text migration. It does not provide arbitrary shell execution.

Important safety behavior:

- all changes are planned before writing;
- exact occurrence counts prevent ambiguous replacements;
- optional SHA-256 preconditions reject stale source;
- protected paths are enforced;
- `max_files_changed` limits scope;
- partial write failure triggers rollback attempts;
- post-apply diagnostic failure triggers rollback before the patch is accepted.

After a real apply, the current gate performs:

```text
Patch DSL self-test
Integration Surface Atlas self-test
Runtime Signal Map self-test
Clause-Aware Patch Corridor self-test
Corridor Context Pack self-test
Native Contract Catalog self-test + committed catalog verification
Automatic Patch Staging self-test
Runtime Contract Probes self-test
developer-tool syntax checks
Repository Audit
Symbol Family Audit
Effect Atlas
```

If any blocking diagnostic fails, the source mutation is rolled back and the workflow fails.

---

## 11. Local Python FilePatcher — `dev_scripts/filepatcher.py`

Run with:

```bash
npm run patch -- --dry-run
npm run patch
```

Useful options include:

```bash
npm run patch -- --patch dev_scripts/another-patch.json
npm run patch -- --allow-dirty
npm run patch -- --reapply
```

Its authoritative authoring contract is `dev_scripts/filepatcher-bootstrap.md`. Do not infer features that are not documented there.

This is the richer local patcher and the preferred fallback when GitHub Actions or remote API writes are unavailable. It has broader preconditions/postconditions, richer validation, file move/remove support with explicit risk acceptance, and local backup/history facilities.

Its state directories are:

```text
dev_scripts/backups/
dev_scripts/patch-history/
```

Treat this tool as the controlled local recovery executor, not as a reason to bypass review. Dry-run first, inspect the intended scope, apply, then inspect Git state and diagnostics before committing.

---

# PART IV — NORMAL GITHUB WORKFLOW

## 12. Automatic workflow — `.github/workflows/github-filepatcher.yml`

The workflow triggers on a push to `main` that changes:

```text
dev_scripts/github-filepatcher.json
```

The current sequence is:

```text
1. Checkout repository
2. Setup Node 22
3. Read patch metadata / sanitize patch ID
4. Syntax-check GitHub FilePatcher
5. Dry-run GitHub FilePatcher
6. Apply GitHub FilePatcher
7. Detect whether files changed
8. git diff --check
9. Stage the patch result
10. Commit as github-actions[bot]
11. Push to main
```

The deeper diagnostic gate is owned by `github-filepatcher.mjs` itself during the apply step. This is intentional: running `npm run github:patch` locally should receive the same post-apply diagnostic protection instead of relying on GitHub Actions to provide it.

The workflow is serialized with `cancel-in-progress: false`, so one patch run is allowed to finish before another takes over.

### Preferred remote operating procedure

For a small localized change whose ownership/native contract is already known:

1. Inspect the exact current target source.
2. Author the smallest useful structural DSL, pattern-aware DSL, or raw JSON patch.
3. Keep `max_files_changed` narrow and use exact `policy.allowed_paths`; one file/one commit remains the safe default when practical.
4. Update only `dev_scripts/github-filepatcher.json`.
5. Confirm dry-run, apply, permanent self-tests, architectural audits, and the bot-created source commit.

For a cross-cutting, native-integration, or runtime-sensitive change:

1. Write the **complete behavior** into `planning_goal`.
2. Require clause-complete Patch Corridor coverage.
3. Inspect Automatic Patch Staging and preserve provider-before-consumer order; a single conceptual behavior may legitimately require several implementation commits.
4. Use the Corridor Context Pack for exact authoring slices.
5. Query the Native Contract Catalog before rediscovering native Lancer behavior.
6. Use the Integration Surface Atlas and Runtime Signal Map when a native contract is missing, ambiguous, or drifted.
7. Author each dependency-safe stage with exact scope locks.
8. Confirm the permanent trust gate and all architectural audits after every accepted stage.
9. After static implementation is complete, run the Runtime Contract Probe scenario in Foundry and resolve automatic plus manual checkpoints.
10. Call `FrameConnRuntimeProbe.stop()` after the live test and keep the structured report as runtime evidence.

Do not assume that a successful patch-spec commit means the source change happened. The source change is the later `github-actions[bot]` commit.

---

# PART V — FAILURE AND RECOVERY

## 13. If a patch itself fails

A failed dry-run is usually the best failure: no source was written. Typical causes are stale exact anchors, ambiguous occurrence counts, changed source, unsupported pattern inference, or scope-policy violations.

Procedure:

1. Read the failing step/log.
2. Re-fetch the exact current target file.
3. Repair the patch specification rather than weakening the safety rule.
4. Push a corrected patch spec.

If apply writes source and a post-apply diagnostic fails, GitHub FilePatcher attempts to restore the original mutation plan before exiting. Verify the failed run and repository state before proceeding.

---

## 14. If GitHub Actions does not cooperate

Examples include an Actions outage, a stuck runner, permissions problems, GitHub refusing a push, or remote tooling becoming unavailable. Do **not** respond by repeatedly force-writing source through random API calls. Move to the local recovery path.

### Safe local recovery procedure

1. Obtain a current local checkout of the repository.
2. Before editing, confirm the branch and repository state:

```bash
git status
git log -1 --oneline
```

3. Prefer a temporary recovery branch when practical:

```bash
git switch -c recovery/<short-purpose>
```

4. Preserve an external copy/ZIP of the checkout before any unusually risky repair if the repository state itself is in doubt. Git history is the primary recovery mechanism, but an out-of-repo copy protects against local mistakes.
5. Author a local Python FilePatcher patch using `dev_scripts/filepatcher-bootstrap.md`.
6. Dry-run it:

```bash
npm run patch -- --dry-run
```

7. Apply only after the dry-run is correct:

```bash
npm run patch
```

8. Inspect:

```bash
git status
git diff --check
git diff
```

9. Run the relevant diagnostics manually:

```bash
npm run audit
npm run symbol-family-audit
npm run effect-atlas
```

Use `npm run dependency-graph` when deeper dependency investigation is warranted.

10. Inspect `dev_scripts/backups/` and `dev_scripts/patch-history/` as additional recovery records when the local Python FilePatcher generated them.
11. Commit only after the diff and diagnostics are acceptable.
12. Push the recovery branch or commit when GitHub connectivity/permissions permit.

---

## 15. If the repository is already in a bad state

First determine whether the problem is committed history, uncommitted local state, or a failed patch attempt. Do not overwrite evidence before identifying which one it is.

Useful commands:

```bash
git status
git diff
git diff --cached
git log --oneline -10
```

Then choose the least destructive recovery source:

1. Git history / last known good commit.
2. Python FilePatcher backup artifacts.
3. Python FilePatcher patch-history records.
4. External pre-repair checkout/ZIP copy.

Avoid destructive Git commands such as forced resets unless the exact state being discarded is understood and intentionally preserved elsewhere.

If a source file was manually repaired, rerun all three blocking architectural diagnostics before treating the repository as healthy.

---

## 16. If the development tools themselves are broken

Tooling repairs deserve extra care because the patcher and diagnostics are part of the trust boundary.

Preferred order:

1. Use `node --check` / Python syntax checks on the affected tool.
2. Make one narrow repair at a time.
3. Run the affected tool's deterministic self-test.
4. Run the permanent tool self-test set:

```bash
npm run integration-atlas:self-test
npm run runtime-signal-map:self-test
npm run patch-corridor:self-test
npm run corridor-context:self-test
npm run native-contracts:self-test
npm run patch-staging:self-test
npm run patch:dsl:self-test
npm run runtime-probes:self-test
```

5. Run Repository Audit, Symbol Family Audit, and Effect Atlas.
6. Commit the repaired trust gate/tool.
7. Run an **independent no-op GitHub FilePatcher planning/apply proof from the already committed new gate**. A tool change is not fully proven merely because it passed under the older validator that was in memory while the change was being applied.

Do not weaken or remove a failing self-test merely to make the patch pipeline green. Fix the reason the test is failing or explicitly revise the contract if the intended behavior truly changed.

---

# PART VI — CHOOSING THE RIGHT TOOL

## 17. Decision guide

Use **Integration Surface Atlas** when the uncertainty is *what legitimate native Lancer integration point exists?*

Use **Runtime Signal Map** when the uncertainty is *how does the runtime signal travel from UI/event/Flow to effect?*

Use the **Clause-Aware Patch Corridor** when the uncertainty is *where the change belongs and whether every requested behavioral clause has an owner/path*.

Use **Corridor Context Pack** when the corridor is known but the author needs *exact source slices, imports, callers, and a safe local exemplar*.

Use **Native Contract Catalog** when the uncertainty is *whether this native fact was already proven and whether that proof is still current*.

Use **Automatic Patch Staging** when the uncertainty is *what provider-before-consumer order a cross-cutting patch should use*.

Use **Pattern-aware DSL** when the location is known and the desired change is a repeated local structural shape that already has a trustworthy exemplar.

Use **Structural Patch DSL** when the location is known but the change needs explicit text-level control.

Use **raw GitHub FilePatcher JSON** when the DSL cannot express the required supported operation cleanly.

Use **Runtime Contract Probes** when the uncertainty is *whether the expected runtime path actually fired in Foundry and which postconditions still need manual proof*.

Use the **GitHub FilePatcher** for normal remote execution.

Use the **Python FilePatcher** for richer local work, local backup/history, and recovery when GitHub cannot execute the normal path.

Use **Repository Audit** for high-level structural/dependency integrity.

Use **Symbol Family Audit** for symbol ownership/family topology.

Use **Effect Atlas** for side-effect ownership and architectural effect boundaries.

Use **Dependency Graph** when you need the lower-level dependency graph rather than the watershed summary.

---

## 18. Safety hierarchy

When there is uncertainty, prefer this order:

```text
prove exact local structure
    ↓
use narrow deterministic patch
    ↓
fail on ambiguity
    ↓
inspect current source again
    ↓
expand scope deliberately only when architecture requires it
```

Do not trade away determinism merely to avoid writing a few more explicit lines. The DSL exists to compress **known structure**, not to hide uncertainty.

Likewise, diagnostics are not substitutes for runtime testing inside Foundry. They protect the static architecture and known repository contracts; actual Lancer/Foundry behavior still needs runtime validation when a change touches execution semantics or UI behavior.

---

## 19. Quick reference

```bash
# Native discovery / tracing
npm run integration-atlas -- --native-root /path/to/foundryvtt-lancer --query "<query>"
npm run runtime-signal-map -- --native-root /path/to/foundryvtt-lancer --query "<query>"

# Planning / context / contract reuse / staging
npm run patch-corridor -- --goal "<behavioral goal>"
npm run corridor-context -- --goal "<behavioral goal>"
npm run native-contracts -- --query "<native concept>"
npm run patch-staging -- --goal "<behavioral goal>"

# DSL authoring
npm run patch:dsl:check
npm run patch:dsl
npm run patch:dsl:self-test

# GitHub patch executor
npm run github:patch -- --dry-run
npm run github:patch

# Rich local/recovery patch executor
npm run patch -- --dry-run
npm run patch

# Static diagnostics
npm run audit
npm run symbol-family-audit
npm run effect-atlas
npm run dependency-graph

# Live runtime validation
npm run runtime-probes -- --goal "<behavioral goal>"
```

The normal standard is simple: **small patch, deterministic executor, diagnostics pass, inspect the resulting commit, then continue.**
