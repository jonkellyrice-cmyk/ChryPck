# Frame Conn Runtime Signal Map

The Runtime Signal Map is a static causal-path tool for **event and execution flow**, not import topology.

It answers questions such as:

> What runtime sequence connects this click, hook, or native entry point to a Flow, chat output, damage application, or Foundry document mutation?

The intended mental model is:

```text
click
  -> handler
  -> native entry point
  -> Flow
  -> ordered Flow steps
  -> hook / chat output
  -> damage application
  -> document mutation
```

The map emits only statically evidenced edges. If a call target or event relationship is ambiguous, it is omitted rather than guessed.

## Commands

Generate a map from Frame Conn plus an authoritative native Lancer checkout:

```bash
npm run runtime-signal-map -- --native-root /path/to/foundryvtt-lancer
```

The generated report defaults to:

```text
dev_scripts/runtime-signal-map-report.json
```

Query behavior-oriented chains while scanning:

```bash
npm run runtime-signal-map -- \
  --native-root /path/to/foundryvtt-lancer \
  --query "attack damage chat"
```

Query an existing report without rescanning:

```bash
npm run runtime-signal-map -- \
  --report dev_scripts/runtime-signal-map-report.json \
  --query "brace attack difficulty"
```

Ask for an explicit path:

```bash
npm run runtime-signal-map -- \
  --report dev_scripts/runtime-signal-map-report.json \
  --from "click .lancer-damage-apply" \
  --to damageCalc
```

Control traversal size:

```bash
npm run runtime-signal-map -- --report <report> --query "damage" --max-depth 16 --limit 30
```

Run the synthetic extraction test:

```bash
npm run runtime-signal-map:self-test
```

## What it maps

The current mapper recognizes these runtime node families:

- callable functions and class methods;
- UI/DOM/jQuery events, preserving selectors when statically visible;
- Foundry/Lancer hooks;
- native Lancer Flow classes;
- ordered Flow step keys;
- side-effect boundaries such as `ChatMessage.create`, `damageCalc`, document updates, embedded-document mutations, settings writes, and notifications.

It recognizes these edge families:

- `static-call` — one statically resolved callable invokes another;
- `constructs-flow` — a callable constructs a concrete native Flow;
- `flow-start-step` — Flow execution enters its first declared step;
- `flow-step-order` — ordered progression between declared Flow steps;
- `flow-step-implementation` — a Flow-step registry key resolves to its implementation function;
- `emits-hook` — a callable emits a literal hook;
- `hook-listener` — a literal hook resolves to a named listener;
- `registers-event` — a callable binds a UI event;
- `event-handler` — a UI event resolves to its handler;
- `produces-effect` — a callable reaches an external-state/effect boundary;
- `cross-source-hook-name` — Frame Conn and native Lancer expose the same literal hook name.

## Example: native damage application

Against Lancer 3.1.3, the mapper can prove the native click path:

```text
click .lancer-damage-apply
  -> applyDamage
  -> damageCalc
```

It can separately prove the damage-roll/chat path:

```text
LancerActor.beginDamageFlow
  -> DamageRollFlow
  -> initDamageData
  -> setDamageTags
  -> setDamageTargets
  -> showDamageHUD
  -> rollReliable
  -> rollNormalDamage
  -> rollCritDamage
  -> applyOverkillHeat
  -> printDamageCard
  -> printDamageCard implementation
  -> renderTemplateStep
  -> createChatMessageStep
  -> ChatMessage.create
```

That distinction matters: rolling damage and **applying** damage are separate runtime chains connected through the rendered chat control and later player click.

## Safety posture

The map follows a stricter rule than ordinary source search:

1. A node means the corresponding source construct was statically observed.
2. An edge means the mapper found source evidence for that relationship.
3. Ambiguous call targets are omitted rather than arbitrarily selected.
4. Dynamic/reflection-heavy behavior may therefore appear as a gap. A gap is not automatically a bug.
5. The tool does not execute Foundry or Lancer code and does not claim live runtime proof.
6. Native source version and SHA-256 fingerprints are recorded in generated reports.
7. Regenerate the report when authoritative native Lancer source changes.

## Relationship to the Integration Surface Atlas

The two tools answer different questions:

```text
Integration Surface Atlas
  "What native integration surfaces exist?"

Runtime Signal Map
  "How do statically evidenced runtime signals travel between them?"
```

For a cross-cutting feature, use the Atlas first to locate likely native surfaces, then use the Runtime Signal Map to establish the causal path between trigger, execution, chat/effect, and mutation boundaries.

## Relationship to Frame Conn diagnostics

```text
Integration Surface Atlas  -> native extension surfaces
Runtime Signal Map          -> event/execution causality
Dependency Watershed        -> Frame Conn dependency topology
Symbol Family Tree          -> conceptual machinery/ownership
Effect Atlas                -> Frame Conn side-effect ownership
Patch Corridor              -> likely implementation corridor
```

The Runtime Signal Map is diagnostic/planning infrastructure. It is not itself a patch executor and it does not replace live Foundry runtime validation.
