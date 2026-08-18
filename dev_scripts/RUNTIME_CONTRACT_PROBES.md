# Frame Conn Runtime Contract Probes

`runtime-contract-probes.mjs` is the live-validation companion to Frame Conn's static planning and architecture tools. It turns a clause-complete behavioral goal into a small, source-backed Foundry instrumentation bundle so a live test can produce structured evidence instead of relying only on console impressions.

The governing rule is: **observe proven runtime boundaries; never trigger gameplay or invent an observer merely to make a clause look covered.**

## Commands

Generate a probe bundle from a behavioral goal:

```bash
npm run runtime-probes -- --goal "offer Brace when hit, spend the reaction, halve damage, and restrict the next turn"
```

Include authoritative native Lancer source when available so the Runtime Signal Map can contribute native Flow/hook/effect evidence:

```bash
npm run runtime-probes -- \
  --goal "wire committed Scan through native Lancer execution" \
  --native-root /path/to/foundryvtt-lancer
```

Run the deterministic generator/harness self-test:

```bash
npm run runtime-probes:self-test
```

Useful optional inputs are `--corridor <report>`, `--runtime-map <report>`, `--catalog <catalog>`, `--id <bundle-id>`, and `--output-dir <directory>`. A supplied corridor must already have complete clause coverage.

## Generated bundle

Manual generation writes, by default:

```text
dev_scripts/runtime-probes/<goal-id>/
  probe-manifest.json
  foundry-runtime-probe.js
  RUNTIME_TEST_CHECKLIST.md
```

`probe-manifest.json` records the behavioral clauses, selected Runtime Signal Map evidence, reused Native Contract Catalog facts, probe definitions, and any obligation that could not be instrumented safely.

`foundry-runtime-probe.js` is a browser-console harness for a live Foundry test. It installs reversible observers and exposes `window.FrameConnRuntimeProbe`.

`RUNTIME_TEST_CHECKLIST.md` explains which player-facing behavior to perform and which obligations are automatic versus manual.

When GitHub FilePatcher is planning a patch with `planning_goal`, it generates this bundle under temporary runner storage only, prints the clause/probe coverage into the workflow log, and does not commit generated probe artifacts.

## Probe sources

The generator consumes three existing authorities:

1. **Clause-Aware Patch Corridor** — defines the behavioral obligations that must be tested.
2. **Runtime Signal Map** — provides source-backed runtime nodes such as DOM events, hooks, Flows, and effects.
3. **Native Contract Catalog** — supplies already-proven native Lancer Flow/API facts without rediscovering them.

A Runtime Contract Probe does not broaden a failed or incomplete corridor. If clause planning cannot certify the requested behavior, probe generation stops.

## Automatic observer kinds

Version 1 supports a deliberately small observer surface:

- **Foundry hook observers** — records a proven named hook when it fires.
- **Lancer Flow lifecycle observers** — records `lancer.preFlow.<FlowName>` and `lancer.postFlow.<FlowName>` for a source-backed Flow.
- **DOM event observers** — captures proven UI events and preserves a selector when the Runtime Signal Map can statically resolve one.
- **Global method observers** — currently used for reversible observation of `ChatMessage.create` when chat creation is a proven effect boundary.

Unsupported or ambiguous runtime boundaries become explicit manual checkpoints. The generator does not manufacture a hook name, selector, Flow, object path, or mutation method.

## Foundry usage

Run the generated `foundry-runtime-probe.js` in the browser developer console after Frame Conn and Lancer are loaded. The harness starts automatically and exposes:

```js
FrameConnRuntimeProbe.evaluate()
FrameConnRuntimeProbe.report()
FrameConnRuntimeProbe.mark("Brace prompt appeared", { actorId: actor.id })
FrameConnRuntimeProbe.snapshot("after Brace", { flags: actor.flags?.["lancer-frame-conn"] })
FrameConnRuntimeProbe.clear()
FrameConnRuntimeProbe.stop()
```

Perform the gameplay behavior normally. The probe should not click controls, spend actions, apply damage, mutate actor state, or execute a Flow on the player's behalf.

Every recorded event contains a sequence number, timestamp, probe identity, event kind/label, a compact combat snapshot, and a bounded payload.

`stop()` removes installed hook listeners, DOM listeners, and reversible method wrappers in reverse order. Always stop the probe after a test session.

## Reading the result

The clause evaluation uses three states:

- **OBSERVED** — at least one source-backed observer associated with the clause fired during the session.
- **NOT_OBSERVED** — the clause had automatic observers, but none fired during the session.
- **MANUAL** — static evidence could not justify safe automatic instrumentation, so the clause requires a deliberate human checkpoint.

`OBSERVED` is runtime-path evidence, not a blanket assertion that the entire game rule is correct. For example, observing `DamageRollFlow`, a chat-card click, and `damageCalc` proves those boundaries participated; it does not by itself prove the final HP value was mathematically correct. Use `.snapshot()` or a manual assertion to record postconditions that cannot be safely inferred from observer firing alone.

Likewise, `NOT_OBSERVED` is diagnostically useful but not automatically proof of a product defect: verify that the expected user scenario was actually performed and that the observer was available in the current Foundry/Lancer version.

## Safety and reversibility

Runtime Contract Probes are development instrumentation, not production behavior. Their safety posture is:

- observational by default;
- no automatic gameplay actions;
- no automatic document mutation;
- no invented runtime APIs;
- source-backed selectors/hooks/Flows only;
- bounded payload capture rather than unrestricted object serialization;
- explicit unavailable/manual states;
- reversible wrappers/listeners;
- generated artifacts kept temporary during normal GitHub planning.

If a live API cannot be wrapped safely or no source-backed observer exists, prefer `.mark()`/`.snapshot()` over adding speculative instrumentation.

## Relationship to the static stack

```text
behavioral goal
      ↓
Clause-Aware Patch Corridor
  what must be true?
      ↓
Integration Surface Atlas + Native Contract Catalog
  what authoritative native boundaries exist/already proved?
      ↓
Runtime Signal Map
  what causal runtime path is statically evidenced?
      ↓
Runtime Contract Probes
  what can we observe safely in a live Foundry session?
      ↓
structured live report
```

The static tools remain the architectural authorities. Runtime Contract Probes add empirical evidence that the expected live path actually fired and that cleanup occurred.

## Example: Brace

A Brace-shaped planning goal currently produces a multi-clause probe plan covering presentation, reaction/native execution, next-turn behavior, and the native damage boundary. Some postconditions may remain manual because firing an observer is not sufficient to prove a state value. That is intentional: **partial automatic evidence plus an explicit manual checkpoint is safer than false certainty.**
