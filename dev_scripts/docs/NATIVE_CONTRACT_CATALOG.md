# Frame Conn Native Contract Catalog

The Native Contract Catalog persists **already-proven** facts about authoritative Foundry Lancer integration surfaces so future patches do not repeatedly rediscover the same native APIs, flow boundaries, and effect ownership.

It is intentionally evidence-backed. A catalog entry is not a guess, convenience alias, or recommendation. It is a statement that has already been traced to authoritative native source and recorded with enough provenance to detect drift later.

## Files

```text
dev_scripts/native-contract-catalog.json   persisted proven contracts
dev_scripts/native-contract-catalog.mjs    query + verification tool
```

## Core rule

Every contract must record:

- native system name and version;
- authoritative upstream git commit;
- contract kind and concise semantic statement;
- Frame Conn owner family and boundary rule;
- one or more source evidence records;
- exact native source path and symbol;
- evidence line range;
- SHA-256 of the complete native source file;
- SHA-256 of the exact evidence slice;
- a short explanation of what that evidence proves.

If the source changes, the verifier does not silently keep treating the old provenance as current.

## Commands

List the catalog:

```bash
npm run native-contracts
```

Search proven contracts:

```bash
npm run native-contracts -- --query "basic attack target"
npm run native-contracts -- --query "damage resistance brace"
```

Show one exact contract:

```bash
npm run native-contracts -- --show native.actor.basic-attack-entrypoint
```

Validate catalog structure without a native checkout:

```bash
npm run native-contracts:verify
```

Re-hash against an authoritative native Lancer checkout:

```bash
npm run native-contracts:verify -- --native-root /path/to/foundryvtt-lancer
```

Require source verification rather than allowing an offline schema-only check:

```bash
npm run native-contracts:verify -- --native-root /path/to/foundryvtt-lancer --require-source
```

Run the deterministic synthetic test:

```bash
npm run native-contracts:self-test
```

## Verification states

`verified` means both the complete source file hash and exact evidence-slice hash still match.

`source-drift` means the exact contract slice still matches but some other part of the native source file changed. The contract may still be semantically valid, but its original full-file provenance is stale and must be deliberately reviewed/re-recorded before being treated as current proof.

`contract-drift` means the exact evidence slice changed. The persisted contract must not be trusted until the native path is retraced and the catalog entry is updated.

`missing-source` means the recorded native source path no longer exists in the supplied checkout.

A native package-version mismatch is also a verification failure.

## Relationship to the other tools

The Integration Surface Atlas discovers **candidate native surfaces**.

The Runtime Signal Map proves **how a particular native signal travels**.

The Patch Corridor identifies **which Frame Conn architecture should participate**.

The Corridor Context Pack gives **the exact Frame Conn source slices needed for the patch**.

The Native Contract Catalog remembers **native facts that have already crossed the proof threshold**.

The intended lifecycle is:

```text
native question
    ↓
Integration Surface Atlas
    ↓
Runtime Signal Map / direct source trace
    ↓
contract proven
    ↓
Native Contract Catalog
    ↓
future patch queries catalog first
    ↓
rediscover native source only when no proven contract exists
or verification reports drift
```

## Boundary discipline

Catalog entries do not grant Frame Conn ownership over native mechanics. In most cases they do the opposite: they preserve the exact authoritative boundary that Frame Conn should delegate through.

For example, knowing that `LancerActor.beginBasicAttackFlow()` constructs and begins `BasicAttackFlow` means Frame Conn does not need to reconstruct the stock attack flow. Knowing that `LancerActor.damageCalc(..., { multiple: 0.5 })` represents native Resistance means Frame Conn should delegate through that native effect boundary instead of duplicating armor/resistance/document mutation logic.

## Updating contracts

Do not update hashes merely to make verification green. When a native source hash changes:

1. inspect the changed authoritative source;
2. re-trace the relevant native path;
3. confirm the semantic contract still holds;
4. update version/commit/hash/line evidence together;
5. keep the boundary statement aligned with what the new source actually proves.

If the contract no longer holds, replace or retire the entry rather than preserving a misleading API fact.
