# Frame Conn Integration Surface Atlas

The Integration Surface Atlas is a static discovery tool for the **authoritative native Foundry Lancer system**. It exists to answer a different question from the repository diagnostics:

> Where does native Lancer expose the Flow, hook, runtime API, chat control, document entry point, or mutation boundary needed for this behavior?

It does **not** execute native code, infer undocumented APIs, or decide that a surface is safe merely because it exists. It narrows native-system investigation to source-backed candidates with file/line evidence.

## Commands

Generate/query from an authoritative native Lancer checkout:

```bash
npm run integration-atlas -- --native-root /path/to/foundryvtt-lancer --query "damage attack flow"
```

Limit results:

```bash
npm run integration-atlas -- --native-root /path/to/foundryvtt-lancer --query "target hook" --limit 20
```

By default, regeneration writes a portable report to:

```text
dev_scripts/native-integration-surface-atlas.json
```

Once that report exists, query it without rescanning the native source:

```bash
npm run integration-atlas -- --query "damage attack flow"
```

Or query another saved report:

```bash
npm run integration-atlas -- --report /path/to/atlas.json --query "scan flow"
```

Run the synthetic extraction test:

```bash
npm run integration-atlas:self-test
```

## What it indexes

The current atlas recognizes these integration-surface families:

- **Flow definitions** and their statically declared ordered `steps`.
- **Flow registrations** in the native Flow registry.
- **Flow-step registrations** such as `flowSteps.set(...)`.
- The public **`lancer.registerFlows` extension hook**.
- Native and Foundry **hook emitters/listeners**, including dynamic Flow lifecycle hook names.
- **`game.lancer.*` runtime surfaces** referenced by native code.
- Integration-relevant **LancerActor/LancerItem/LancerToken methods**.
- Integration-relevant **exported native functions**.
- **Chat-message controls/event handlers** involved in native interaction.
- **Foundry document mutation boundaries**.
- **Embedded-document mutation boundaries**.
- The authoritative **`damageCalc` damage application boundary**.
- Explicit **Map-based registries**.

Each surface records its kind, name, source file, source line, tags, and a short structural description. Flow definitions additionally record their ordered native steps when those steps can be statically resolved.

## Portable report and freshness

A generated atlas report records:

- native version;
- number of scanned source files;
- a SHA-256 fingerprint of the scanned source set;
- atlas tool version.

This allows a generated report to be reused as a fast local/native integration index without keeping the complete native repository open during every patch-planning session.

**A saved atlas is evidence, not eternal truth.** If the installed/native Lancer version changes, regenerate it from that authoritative source before relying on it for a new integration. A report may be checked into the repository deliberately when we want a shared version-pinned native catalog, but regeneration from authoritative source remains the source of truth.

## Safety posture

The atlas follows the same fail-safe philosophy as the rest of the suite:

1. It reports only surfaces statically present in the scanned source.
2. It does not fabricate missing hooks, Flows, methods, or registries.
3. A search hit is a **candidate integration surface**, not permission to bypass Frame Conn architecture.
4. Native ownership still wins: prefer the native entry point/Flow/mutation path that already owns the behavior.
5. If several candidates exist, inspect the relevant source before selecting one.
6. If the native version/fingerprint is stale, regenerate the atlas rather than assuming compatibility.

## Relationship to the other tools

```text
Integration Surface Atlas
  Where can Frame Conn meet native Lancer?

Dependency Watershed
  Where does Frame Conn code flow?

Symbol Family Tree
  What Frame Conn machinery exists?

Effect Atlas
  Where does Frame Conn change state?

Patch Corridor
  Which Frame Conn path probably needs modification?
```

The atlas is deliberately orthogonal to those diagnostics. Its job is to remove native-system discovery friction, especially around Flows, hooks, chat actions, actor/item entry points, and authoritative mutation boundaries.
