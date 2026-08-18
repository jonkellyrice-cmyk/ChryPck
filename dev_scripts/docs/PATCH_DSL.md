# Frame Conn Patch DSL

`patch-dsl-compiler.mjs` is a small authoring shorthand for GitHub FilePatcher patches. It does **not** patch source code itself. It compiles `dev-scripts/filepatcher.dsl` into the normal schema-v2 `dev-scripts/filepatcher.json`, which remains the only executable patch contract.

## Commands

```bash
npm run patch:dsl:check   # parse/validate only
npm run patch:dsl         # compile DSL -> dev-scripts/filepatcher.json
npm run patch:dsl:self-test
npm run github:patch -- --dry-run
npm run github:patch
```

## Core syntax

```text
patch my-patch-id
description "Optional description"
goal "Optional Patch Corridor planning goal"
max-files 3

file scripts/example.js
within someTopLevelFunction
replace once
<<<
old expression
>>>
with
<<<
new expression
>>>

global
after once
<<<
anchor text
>>>
add
<<<

inserted text
>>>
```

`within <symbol>` scopes subsequent text edits to one top-level function, class, or simple binding. The compiler expands the whole symbol into an exact `replace_text` operation, so FilePatcher still executes a deterministic exact-text patch.

Use `global` to leave symbol scope.

## Edit primitives

- `replace once|all|optional` + block + `with` block
- `before once|all|optional` + block + `add` block
- `after once|all|optional` + block + `add` block
- `delete once|all|optional` + block
- `create <path>` + block
- `rewrite <path>` + block
- `raw` + block containing one native FilePatcher operation object

`once` is the default. `all` compiles the exact current occurrence count into `expected_occurrences`. `optional` emits no operation when the search is absent; otherwise it emits the exact count.

Blocks use `<<<` and `>>>` and preserve their contents exactly. For `before`/`after`, include a leading or trailing blank line in the `add` block when a newline is desired.

## Escape hatch

```text
raw
<<<
{
  "type": "replace_text",
  "path": "scripts/example.js",
  "search": "A",
  "replace": "B",
  "expected_occurrences": 2
}
>>>
```

The DSL intentionally has no loops, variables, functions, conditions, or hidden architectural macros. It compresses repetitive FilePatcher authoring; it does not replace FilePatcher semantics.

## Pattern-aware shorthand

For repetitive code shapes, prefer `clone-pattern` over reproducing local boilerplate. Pattern expansion is deliberately conservative:

- it only works inside `within <symbol>`;
- it copies an existing exemplar from that exact symbol;
- if more than one exemplar matches, compilation fails unless `containing <needle>` identifies exactly one;
- every token in the `map` block must exist in the exemplar;
- the compiler never invents a React/HTML/runtime/registry shape when it cannot prove one locally.

Supported shapes are:

- `ui-control` — clones one local `<button>...</button>` block, preserving the file's existing markup/JSX/template-string formatting;
- `object-entry` — clones one top-level property of an object-valued symbol and handles comma placement;
- `switch-case` — clones one local `case`/`default` block;
- `feature-registration` — clones a local bare array member whose identifier ends in `Feature`, preserving comma placement;
- `runtime-binding` — clones one local runtime-binding object member. It deliberately reuses the same structural object-entry parser rather than inventing a binding schema;
- `feature-api-member` — clones one direct member of the local feature definition's nested `api: { ... }` object;
- `hook-handler` — clones either one direct member of a local `hooks: { ... }` object or one local `Hooks.on(...)` / `Hooks.once(...)` call statement;
- `flow-step` — clones one local call statement using `installNativeFlowStepBefore`, `installNativeFlowStepAfter`, `insertNativeFlowStep`, or `appendNativeFlowStep`;
- `actor-flag` — clones one local `getFlag`, `setFlag`, or `unsetFlag` method-call statement.

The named forms are recognizers, not code generators. For example, `feature-api-member` does not create an `api` object if one is absent, `hook-handler` does not invent a Foundry hook installation style, and `flow-step` does not synthesize a native-flow contract. If the expected local shape is missing, compilation fails.

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

The generated edit reuses the exact existing button structure and formatting. If the target symbol has exactly one button, `containing ...` may be omitted.

Object/runtime patterns use the same mechanism:

```text
file scripts/feature_actions/action-execution-feature.js
within frameConnActionExecutionRuntimeBindings

clone-pattern runtime-binding after containing executeCanonicalAction
map
<<<
{
  "executeCanonicalAction": "executeNativeScan"
}
>>>
```

Feature API members can target the nested `api` surface without treating every object member in the feature definition as a candidate:

```text
file scripts/feature_actions/action-execution-feature.js
within frameConnActionExecutionFeature

clone-pattern feature-api-member after containing executeActionRoll
map
<<<
{
  "executeActionRoll": "executeScan",
  "frameConnExecuteActionRoll": "frameConnExecuteScan"
}
>>>
```

Call-shaped forms clone the complete local call statement. For example:

```text
file native_adapter/example-extension.js
within installExampleFlowExtensions

clone-pattern flow-step after containing existing-step
map
<<<
{
  "existing-step": "new-step",
  "existingStep": "newStep"
}
>>>
```

`feature-registration`, `feature-api-member`, `hook-handler`, and the other named forms still obey the exact same ambiguity rule: zero candidates or more than one candidate fails unless `containing <needle>` selects exactly one. Every `map` key must occur in the selected exemplar.

This is intentionally exemplar-driven rather than a generic code generator. If local structure is ambiguous or unsupported, use explicit `replace`/`before`/`after` or `raw`.
