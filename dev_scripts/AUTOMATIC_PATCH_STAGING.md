# Frame Conn Automatic Patch Staging

Automatic Patch Staging turns a certified Patch Corridor into a dependency-ordered implementation plan and, when requested, materializes narrowly scoped FilePatcher specifications. It exists for changes that are too cross-cutting to treat safely as one undifferentiated patch.

The governing rule is: **stage known dependencies, never invent implementation.**

## What it consumes

The stager consumes two existing authorities:

1. A clause-complete Patch Corridor report, which defines the certified families and files that may participate in the behavioral change.
2. The Symbol Family Audit dependency graph, which records cross-family dependencies through `outgoingFamilies`.

`outgoingFamilies` means that the current family depends on/imports the named family. Automatic Patch Staging reverses that relation for implementation ordering so providers are proposed before consumers.

## How phases are derived

The selected corridor is reduced to its family dependency graph. The stager then:

1. computes strongly connected components;
2. keeps every dependency cycle atomic rather than inventing an order inside it;
3. condenses those components into an acyclic graph;
4. reverses dependency edges into provider-to-consumer direction; and
5. topologically layers the result into implementation phases.

The first layer is labeled `Providers and foundations`, intermediate layers are `Dependency propagation`, and the final layer is `Consumers and composition`. A single-layer change is labeled `Atomic implementation`.

A reported `atomic-cycle` is deliberate. It means the static dependency graph cannot truthfully prove that one member should precede another, so the tool refuses to manufacture a false ordering.

## Generate an authoring plan

Run:

```bash
npm run patch-staging -- --goal "wire committed Scan through the authoritative native Lancer execution entrypoint and show the Scan choice in the Frame Conn UI"
```

By default, generated material is written under:

```text
dev_scripts/staged-patches/<goal-or-patch-slug>/
```

The directory contains `staging-plan.json` plus one FilePatcher JSON skeleton per proposed step. The safe default is one file per spec. A bounded override is available with `--max-files-per-spec N`, where N must be between 1 and 4.

Skeleton mode does **not** invent edit operations. It writes `operations: []` and locks the future patch to the proposed file with `policy.allowed_paths`. Author the actual edit afterward using the Patch DSL or explicit FilePatcher JSON.

Example skeleton:

```json
{
  "schema_version": 2,
  "id": "scan-phase-02-step-04",
  "planning_goal": "wire committed Scan through native execution",
  "policy": {
    "max_files_changed": 1,
    "allowed_paths": [
      "scripts/feature_actions/action-execution-feature.js"
    ]
  },
  "operations": []
}
```

`policy.allowed_paths` is enforced by GitHub FilePatcher before mutation. A generated one-file stage therefore cannot silently grow into an unrelated file change merely because `max_files_changed` is still satisfied.

## Partition an already-authored patch

If a multi-file FilePatcher specification already exists, partition its existing operations with:

```bash
npm run patch-staging -- --patch dev-scripts/filepatcher.json
```

The stager preserves those operations as authored and moves them into dependency-ordered stage specs. It does not rewrite, reinterpret, or synthesize replacement code.

Partitioning fails closed when an operation targets a file outside the certified corridor, when no symbol-family owner can be resolved, or when an operation does not have one deterministic file path. `replace_tree_text` is intentionally rejected because one tree operation can span multiple dependency families and cannot be truthfully split without changing its semantics. Split such a migration explicitly first.

## Reuse an existing corridor

To avoid rerunning corridor discovery, provide an existing report:

```bash
npm run patch-staging -- --corridor patch-corridor-report.json --goal "the same behavioral goal"
```

Use `--report-only` when you want the phase proposal and JSON report without materializing stage specs. Existing staged output is never overwritten unless `--overwrite` is supplied explicitly.

## Automatic FilePatcher integration

Whenever `dev-scripts/filepatcher.json` contains `planning_goal`, GitHub FilePatcher now asks Automatic Patch Staging for a report-only phase plan after the corridor is certified. It logs whether staging is recommended, how many dependency phases exist, and how many of those phases the current patch touches.

This integration is advisory rather than an unconditional blocker. If a justified patch spans several phases, FilePatcher warns rather than pretending the static graph can prove the patch is wrong. The normal corridor scope checks and post-apply audits remain authoritative safety gates.

## Safety contract

Automatic Patch Staging refuses to:

- stage a corridor whose behavioral clauses are incomplete;
- place an operation outside the certified corridor;
- invent operations for an author;
- guess how to split an ambiguous multi-file operation;
- manufacture an order inside a dependency cycle;
- overwrite existing staged specifications without explicit permission.

The default one-file specification plus `allowed_paths` is intentionally conservative. The purpose is not to maximize commit count; it is to make every intermediate change small enough that FilePatcher, the dependency audits, and a human reviewer can understand what has changed before proceeding downstream.

## Self-test

Run:

```bash
npm run patch-staging:self-test
```

The deterministic self-test proves provider-before-consumer ordering, atomic cycle handling, preservation of already-authored operations, exact `allowed_paths` locks, and rejection of an outside-corridor operation. The same self-test is part of GitHub FilePatcher's permanent post-apply developer-tool gate.
