# Frame Conn Corridor Context Pack

`dev_scripts/corridor-context-pack.mjs` turns a **certified clause-aware Patch Corridor** into a compact source packet for patch authoring.

It exists to eliminate the repeated workflow of reopening whole files after the planner has already identified the relevant architectural surface.

## What it answers

> What exact source context do I need to implement the certified corridor without rereading the repository?

The pack is deliberately downstream of the Patch Corridor. It does not discover new scope and it does not broaden the planner's result.

## Usage

Generate a corridor and pack in one command:

```bash
npm run corridor-context -- --goal "show Brace after damage, spend the reaction, apply native Resistance, and restrict the next turn"
```

Consume an existing certified corridor report:

```bash
npm run corridor-context -- --corridor patch-corridor-report.json
```

Choose an output path:

```bash
npm run corridor-context -- --goal "..." --output dev_scripts/brace-context-pack.json
```

Run the deterministic self-test:

```bash
npm run corridor-context:self-test
```

## Pack contents

For each planner-selected symbol, the JSON pack records:

- exact file path;
- architectural family;
- exact declaration kind and symbol name;
- exact start/end lines;
- exact source slice;
- only imports actually referenced by that slice;
- lexical caller/consumer references with file, line, enclosing symbol, and evidence;
- clause/concern ownership reasons inherited from the certified corridor;
- one nearby same-kind exemplar only when the structural ranking has a unique winner.

The pack also records omissions explicitly.

## Safety rules

### Certified corridor required

A context pack is generated only when:

```text
clauseCoverage.complete === true
```

If the Patch Corridor cannot certify every behavioral clause, the Context Pack refuses to run.

### No scope expansion

Only files and symbols already selected by the corridor are materialized. The Context Pack cannot add another family or file because it appears interesting.

### Exact symbol boundaries

A requested symbol must resolve exactly once in the selected file. Missing or ambiguous declarations are emitted as omissions instead of guessed slices.

### Relevant imports only

An import is included only when one of its locally bound names occurs inside the exact symbol slice.

### Caller evidence is lexical, not runtime proof

Caller records mean that repository source contains a non-import reference to the symbol. They are useful navigation evidence, but dynamic Foundry dispatch, reflection, hooks, and runtime globals can create edges static lexical scanning cannot prove.

Use the Runtime Signal Map when causal runtime proof is required.

### Exemplars fail closed

The tool considers nearby same-kind declarations and compares a small structural signature. It emits an exemplar only when there is a unique top candidate. A tied result is reported as `ambiguous`; no exemplar is fabricated.

## Relationship to the other tools

```text
Behavioral request
      ↓
Clause-Aware Patch Corridor
  certifies every obligation
      ↓
Corridor Context Pack
  materializes exact authoring context
      ↓
Patch DSL / pattern-aware DSL
      ↓
FilePatcher
```

For native-system questions, the Integration Surface Atlas and Runtime Signal Map remain complementary. The Context Pack is primarily about shrinking **Frame Conn source retrieval** after the architectural corridor has already been certified.
