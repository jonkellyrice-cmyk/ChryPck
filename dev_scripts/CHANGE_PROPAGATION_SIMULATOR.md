# Frame Conn Change Propagation Simulator

The Change Propagation Simulator adds a temporal planning layer to the Frame Conn developer toolchain. Existing tools describe where a change belongs, what currently depends on it, which native facts are proven, and which source context matters. The simulator asks a different question:

> If this proposed one-file stage becomes the next repository state, what becomes newly required, invalid, amplified, or especially important to verify before the following stage?

It is advisory. It does not write implementation code and does not mutate the repository.

## Authoritative input

GitHub FilePatcher builds the complete mutation plan in memory first. Before any write, the bridge gives the simulator the exact staged transition:

```text
current file contents
        ↓
GitHub FilePatcher mutation planner
        ↓
exact before / after snapshot
        ↓
Change Propagation Simulator
        ↓
transition report
        ↓
FilePatcher mutation + permanent gates
```

The simulator therefore does not reinterpret Patch DSL or FilePatcher operations. The proposed `after` state is the same staged state that FilePatcher would write.

Frame Conn's `dev_scripts/backups/` and `dev_scripts/patch-history/` trees are excluded from live consumer discovery so historical/recovery copies cannot masquerade as current dependents.

## 1. Contract-delta propagation

The simulator compares supported contract shapes before and after the stage and classifies changes including:

- Zod schema field added or removed;
- optional → required and required → optional;
- default introduced or removed;
- schema field type changed;
- enum member added or removed;
- union widened or narrowed, including union → singleton transitions;
- interface member added, removed, or changed;
- exported function return type changed.

Breaking deltas are correlated with live repository consumers using bounded lexical evidence. Interface implementations receive stronger evidence through `implements` detection. Consumer evidence is diagnostic; static compilation/runtime proof remains authoritative.

## 2. Intermediate-state obligations

For the proposed stage specifically, the report derives obligations that should remain true between commits, including:

- TypeScript compilation when a typed contract participates;
- interface implementation conformance;
- existing schema construction/parse sites remaining valid;
- persistence compatibility across old/new row shapes;
- serialization round trips;
- import/export resolution;
- established integration invariants remaining satisfiable.

These are transition obligations, not merely properties of the eventual final architecture.

## 3. Compatibility strategies

The simulator may recommend sequencing patterns but never authors the implementation. Examples:

```text
introduce optional
→ populate consumers
→ make required

retain default
→ populate explicit values
→ remove default

add compatible/optional interface member
→ update implementations
→ require member

add nullable persistence column
→ teach adapter
→ backfill/populate
→ strengthen NOT NULL
```

Variant removal and return-shape changes receive equivalent migrate-before-tighten guidance.

## 4. Behavioral fan-out prediction

The simulator looks for bounded amplification signals rather than claiming to prove arbitrary runtime behavior. Current signals include collection/payload fan-out and scheduling-selection changes.

Planner/decomposer changes that introduce additional splitting, flattening, or newline-joined decomposition payloads are flagged for task-cardinality risk. Scheduler/orchestration selection changes are flagged for ordering, claim, lease, and gating risk. Generic fan-out changes receive a lower-confidence amplification warning.

## 5. Stage verification targeting

Verification recommendations are derived from the proposed transition:

- contract/type shape → `typecheck`;
- schema shape → representative construction/parse probe;
- interface change → implementation-conformance probe;
- persistence/migration change → old/new round-trip probe;
- Planner/decomposer payload change → task-count/decomposition probe;
- scheduler/worker selection change → concurrency/claim/lease probe;
- package/build configuration change → build;
- every stage → integration invariants.

These are evidence targets, not claims that Frame Conn necessarily exposes a package script with each exact name. The repository's committed FilePatcher gates and explicit Foundry runtime probes remain authoritative.

## Automatic GitHub FilePatcher integration

Every GitHub FilePatcher mutation with at least one changed file runs the simulator after FilePatcher has built the exact staged mutation plan and before disk mutation. The bridge logs a compressed summary containing:

- breaking contract-delta count;
- immediately affected consumer count;
- high-severity fan-out risk count;
- verification-target count;
- a compatibility-stage warning when the proposed transition is not likely safe standalone.

Automatic bridge integration is advisory. It does not invoke strict mode and does not outrank FilePatcher policy, developer-tool self-tests, Repository Audit, Symbol Family Audit, Effect Atlas, native-contract proof, or explicit author judgment.

The simulator itself is included in the bridge's permanent `node --check` set and deterministic self-test gate.

## CLI

Run against an explicit transition snapshot:

```bash
npm run change-propagation -- --snapshot transition.json --output change-propagation-report.json
```

Use strict mode when a caller deliberately wants an unsafe-standalone assessment to return a nonzero status:

```bash
npm run change-propagation -- --snapshot transition.json --strict
```

Run the deterministic self-test:

```bash
npm run change-propagation:self-test
```

## Relationship to the Frame Conn toolchain

```text
Behavioral goal
      ↓
Patch Corridor
  WHERE may behavior change?
      ↓
Corridor Context Pack + Native Contract Catalog
  WHAT exact current source/native facts matter?
      ↓
Automatic Patch Staging
  WHAT provider/consumer order exists?
      ↓
Patch DSL / authored one-file FilePatcher stage
      ↓
Change Propagation Simulator
  IS this next repository state safe, and what must remain true?
      ↓
GitHub FilePatcher
  APPLY the one transition
      ↓
Permanent static gates + targeted Runtime Contract Probes
  DID the predicted transition hold?
```

The simulator is intentionally a compact temporal transition report, not another repository-wide architecture graph.
