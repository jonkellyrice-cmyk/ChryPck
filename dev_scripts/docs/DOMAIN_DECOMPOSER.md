# Frame Conn Domain Decomposer

The Domain Decomposer is a two-phase architectural refactoring tool for reducing reasoning pressure without treating lines of code as architecture.

Its governing rule is:

> **Size identifies pressure. Architecture identifies seams. Cohesion justifies extraction. Existing ownership determines destination. The approved plan controls execution. Behavior must remain unchanged.**

## Why it exists

Large files are not automatically bad, but they can become difficult for both humans and LLMs to reason over precisely. Roughly 300–500 lines is often a comfortable precision range, while 800+ lines is a useful warning signal. LOC is therefore only one input alongside semantic and architectural evidence.

A 1,200-line single-domain implementation may be retained. A 450-line file with several cleanly separable domains may be a better decomposition candidate. Composition roots, registries, facades, and package spines are explicitly recognized as roles where domain multiplicity may be intentional.

## Files and commands

```text
dev_scripts/
  domain-decomposer.mjs
  domain-decomposer-executor.mjs
  domain-decomposer-policy.json
  domain-decomposer-plan.json              generated/reviewed plan
  domain-decomposer-generated-patch.json   generated execution patch
  DOMAIN_DECOMPOSER.md
```

```bash
# Planning
npm run decompose
npm run decompose -- --file scripts/some-large-file.js
npm run decompose -- --root scripts/dm_features/sitreps
npm run decompose:self-test

# Execution of an approved plan
npm run decompose:apply -- --dry-run
npm run decompose:apply -- --apply
npm run decompose:apply:self-test
```

The planner writes `domain-decomposer-report.json` plus the editable `dev_scripts/domain-decomposer-plan.json`. The executor compiles an approved plan into `dev_scripts/domain-decomposer-generated-patch.json` and hands it to the existing GitHub FilePatcher.

## Planning model

For each file the planner evaluates:

- LOC pressure;
- top-level symbols;
- semantic domain groups derived from symbols and section headings;
- internal versus cross-domain symbol references;
- side-effect families;
- explicit decomposition-resistant roles from policy;
- supporting evidence from Symbol Family Audit, Effect Atlas, Runtime Authority Audit, and State Namespace Atlas.

The report exposes independent dimensions rather than hiding the decision behind one magic score:

```text
SIZE PRESSURE
DOMAIN MULTIPLICITY
EFFECT MULTIPLICITY
COHESION
COUPLING RISK
ARCHITECTURAL ROLE
```

The result is `HIGH`, `MEDIUM`, `LOW`, or `FORBIDDEN` decomposition desirability. `FORBIDDEN` means automated size/domain heuristics may not split the file. `scripts/runtime-orchestrator.js` is protected this way by default because its domain multiplicity is intentional application-wide convergence.

## Domain seams

A proposed unit is a symbol set with a semantic identity, target file, coupling evidence, effect evidence, and seam confidence. It is not merely a line range.

The architectural actions are conceptually:

- `extract` — same domain, new child module;
- `relocate` — responsibility belongs to another feature family;
- `reuse` — replace duplicate behavior with an existing service;
- `delete` — obsolete shell or duplicate responsibility;
- `retain` — keep in the original spine.

Executor v1 deliberately auto-executes only `extract` and `retain`. `relocate`, `reuse`, and `delete` must be resolved with the existing migration/refactor tools because they change ownership contracts beyond mechanical extraction.

## Retained spine

The original file should normally remain the public/composition entry point for its concept. The planner therefore records a retained spine instead of encouraging anonymous file fragmentation.

```text
foo-feature.js        public/feature/composition spine
foo-state.js          state ownership
foo-rules.js          pure domain behavior
foo-presentation.js   presentation model
foo-adapter.js        external boundary
```

## Recursive certification

A proposed child unit is marked `recursive_review_required` when it remains above the configured reasoning-pressure threshold and contains enough symbols to plausibly hide additional domains. This is advisory rather than blind recursion. Decomposition stops when a module is cohesive even if it remains moderately large.

## Review and approval

Planning and execution are intentionally separated. Generated plans start with:

```json
{
  "approved": false,
  "behavior_change_allowed": false
}
```

Every candidate also has an `execution.approved` flag. A human or LLM reviews and edits the proposed seams first. This is where a reviewer can reject a split, combine units, move shared constants, keep a facade intact, or mark work for relocation/reuse instead of extraction.

The executor never recomputes or silently changes the approved architecture.

## Execution safety

The executor fails closed unless all of the following hold:

1. behavior changes remain forbidden;
2. every planned symbol still exists;
3. no symbol belongs to multiple units;
4. extraction targets do not already exist;
5. extracted units do not reach back into private retained top-level symbols;
6. cross-unit references can be represented as explicit imports;
7. original exported symbols can be re-exported from the retained spine;
8. relative imports can be rewritten for the new file location;
9. source SHA-256 values are embedded as FilePatcher preconditions;
10. the compiled mutation passes the existing GitHub FilePatcher dry-run and validation path.

If a seam is not dependency-closed, execution stops and names the retained symbols that invalidate it. The plan must be revised rather than allowing the executor to manufacture a leaky or circular boundary.

## Behavior-preservation invariant

Decomposition is structural work:

```text
public contract      UNCHANGED
runtime effects      UNCHANGED
persistent state     UNCHANGED
native integration   UNCHANGED
behavior             UNCHANGED

call topology        REARRANGED
symbol ownership     IMPROVED
reasoning pressure   REDUCED where justified
```

Because execution compiles into the existing FilePatcher, the normal Change Propagation Simulator and permanent repository audits remain part of the mutation gate.

## Policy

`dev_scripts/domain-decomposer-policy.json` defines LOC pressure thresholds and decomposition-resistant roles.

Default pressure bands are:

```text
<= 500 lines   minimal
501–800        moderate
801–1200       high
> 1200         very high
```

These are signals only. The default policy explicitly protects `scripts/runtime-orchestrator.js`, registries, and thin feature-package spines from automatic decomposition.

## Recommended workflow

```text
candidate file(s)
      ↓
Domain Decomposer planner
      ↓
Symbol Family / Effect / Authority / Namespace evidence
      ↓
domain-decomposer-plan.json
      ↓
LLM + human architectural review
      ↓
approved plan
      ↓
Domain Decomposer executor --dry-run
      ↓
compiled FilePatcher transition
      ↓
Change Propagation + Repo/Symbol/Effect audits
      ↓
Domain Decomposer executor --apply
      ↓
normal runtime/live verification if runtime-sensitive
```

The Decomposer is an expert structural-refactoring layer over the existing toolchain, not a replacement for it.
