This document is the authoritative authoring interface for filepatcher.py.

Do NOT infer unsupported FilePatcher features.
Do NOT require access to filepatcher.py unless diagnosing FilePatcher itself.
When creating filepatcher.json, conform only to the contract documented here.

# FILEPATCHER AUTHORING CONTRACT

You are creating:

dev_scripts/filepatcher.json

It will be executed with:

npm run patch
npm run patch — —dry-run

The patcher stages all changes first, validates them, and only then commits them.
Generate valid JSON only when asked for the patch file.

## ROOT SCHEMA

Recommended schema:

{
  “schema_version”: 2,
  “id”: “unique-patch-id”,
  “name”: “Human readable patch name”,
  “description”: “What this patch does”,

  “backup”: true,
  “allow_noop”: false,

  “repository”: {
    “require_git”: true,
    “require_clean_targets”: true,
    “require_clean_repository”: false
  },

  “risk_acceptance”: {
    “overwrite_files”: false,
    “delete_files”: false,
    “move_files”: false,
    “change_dependencies”: false,
    “modify_package_manifest”: false
  },

  “preconditions”: [],
  “postconditions”: [],

  “dependency_changes”: [],

  “validation”: {
    “structural”: true,
    “scan_dependencies”: true,
    “commands”: []
  },

  “operations”: []
}

Only include optional fields when useful.

## SUPPORTED OPERATIONS

### replace

Safely replace an exact text block in an existing UTF-8 file.

{
  “operation”: “replace”,
  “file”: “repo/relative/path.ts”,
  “find”: “exact existing text”,
  “replace”: “replacement text”,
  “expected_matches”: 1
}

Rules:
- file must already exist
- `find` must be non-empty
- default `expected_matches` is 1
- the actual number of matches must equal `expected_matches`
- prefer this operation for ordinary edits

### delete

Delete an exact text block from an existing file.

{
  “operation”: “delete”,
  “file”: “repo/relative/path.ts”,
  “find”: “exact text to remove”,
  “expected_matches”: 1
}

### append

Append text to an existing file.

{
  “operation”: “append”,
  “file”: “repo/relative/path.ts”,
  “content”: “text”
}

### prepend

Prepend text to an existing file.

{
  “operation”: “prepend”,
  “file”: “repo/relative/path.ts”,
  “content”: “text”
}

### create

Create a new file. Refuses to overwrite an existing file.

{
  “operation”: “create”,
  “file”: “repo/relative/new-file.ts”,
  “content”: “complete file contents”,
  “must_not_exist”: true
}

### overwrite

Replace the complete contents of an existing file.

{
  “operation”: “overwrite”,
  “file”: “repo/relative/file.ts”,
  “content”: “complete replacement contents”
}

Using this operation requires:

“risk_acceptance”: {
  “overwrite_files”: true
}

Prefer `replace` over `overwrite` unless replacing the whole file is genuinely appropriate.

### write

Legacy whole-file write. Can create or replace.

Avoid unless specifically needed. Prefer `create` or `overwrite`.

### remove_file

Delete an existing file.

{
  “operation”: “remove_file”,
  “file”: “repo/relative/file.ts”
}

Requires:

“risk_acceptance”: {
  “delete_files”: true,
  “change_dependencies”: true
}

### move_file

Move/rename a file.

{
  “operation”: “move_file”,
  “from”: “old/path.ts”,
  “to”: “new/path.ts”
}

Optional:

“allow_overwrite”: false

Requires:

“risk_acceptance”: {
  “move_files”: true,
  “change_dependencies”: true
}

Old imports/references must also be updated by the patch.

## OPERATION SAFETY FIELDS

Available where applicable:

- `expected_matches`: exact required number of text matches
- `expected_sha256`: require exact current file hash
- `allow_noop`: permit operation to make no change
- `must_exist`: target must exist
- `must_not_exist`: target must not exist
- `allow_overwrite`: for move destination
- `update_references`: accepted metadata field; do not assume the patcher automatically rewrites references

Repository paths must:
- be relative to repository root
- never escape repository root
- not target protected paths unless explicitly allowed

## PRECONDITIONS / POSTCONDITIONS

Supported condition types:

### File existence

{
  “type”: “file_exists”,
  “file”: “path”
}

{
  “type”: “file_not_exists”,
  “file”: “path”
}

### Content

{
  “type”: “contains”,
  “file”: “path”,
  “text”: “required text”
}

{
  “type”: “not_contains”,
  “file”: “path”,
  “text”: “forbidden text”
}

### Exact file hash

{
  “type”: “sha256”,
  “file”: “path”,
  “value”: “<64 hex characters>”
}

### Syntax checks

{
  “type”: “json_valid”,
  “file”: “path.json”
}

{
  “type”: “python_valid”,
  “file”: “path.py”
}

Use preconditions when they materially protect against patching the wrong repository state.

Use postconditions for important architectural/result invariants.

## DEPENDENCY CHANGES

Use when symbols/files are intentionally replaced, deleted, or moved.

Delete:

{
  “action”: “delete”,
  “symbol”: “OldSymbol”,
  “from”: “src/old.ts”
}

Replace:

{
  “action”: “replace”,
  “symbol”: “OldSymbol”,
  “from”: “src/old.ts”,
  “replacement”: {
    “symbol”: “NewSymbol”,
    “file”: “src/new.ts”
  }
}

Move:

{
  “action”: “move”,
  “from”: “src/old.ts”
}

Declared dependency changes are validated against the staged repository.

## VALIDATION

Example:

{
  “validation”: {
    “structural”: true,
    “scan_dependencies”: true,
    “commands”: [
      [“npm”, “run”, “typecheck”],
      [“npm”, “test”]
    ],
    “timeout_seconds”: 600
  }
}

Validation commands run against a temporary copy containing the staged changes.

For TypeScript/JavaScript changes, include the repository’s relevant existing validation command when known.

Do not invent npm scripts that have not been confirmed to exist.

## RISK ACCEPTANCE

Risk declarations must exactly correspond to the patch.

Possible keys:

{
  “overwrite_files”: false,
  “delete_files”: false,
  “move_files”: false,
  “change_dependencies”: false,
  “modify_package_manifest”: false
}

Important:
- If a risk occurs, it MUST be true.
- If it does not occur, it MUST NOT be true.
- Stale/excess risk declarations cause patch failure.

`change_dependencies` becomes true when:
- dependency_changes are declared
- a file is removed
- a file is moved

`modify_package_manifest` becomes true when modifying:
- package.json
- package-lock.json
- npm-shrinkwrap.json
- pnpm-lock.yaml
- yarn.lock

## AUTHORING RULES

1. Prefer the smallest safe patch.
2. Prefer exact `replace` operations for existing files.
3. Use `expected_matches: 1` unless multiple identical replacements are intentional.
4. Use `create` for new files.
5. Avoid whole-file overwrite when a targeted replacement is sufficient.
6. Never assume `move_file` automatically updates imports.
7. When moving/deleting files, explicitly patch all affected imports/references.
8. Do not modify unrelated code.
9. Preserve existing formatting and architectural conventions.
10. Operations execute sequentially against staged state, so later operations see earlier changes.
11. A file removed or moved away cannot subsequently be targeted.
12. Do not create the same path twice.
13. Do not perform multiple whole-file writes to the same file.
14. JSON must be syntactically valid.
15. The `operations` array must be non-empty.

## DEFAULT PATCH STYLE

Unless the task requires otherwise:

{
  “schema_version”: 2,
  “id”: “...”,
  “name”: “...”,
  “description”: “...”,
  “backup”: true,
  “repository”: {
    “require_git”: true,
    “require_clean_targets”: true,
    “require_clean_repository”: false
  },
  “risk_acceptance”: {
    “overwrite_files”: false,
    “delete_files”: false,
    “move_files”: false,
    “change_dependencies”: false,
    “modify_package_manifest”: false
  },
  “preconditions”: [],
  “postconditions”: [],
  “validation”: {
    “structural”: true,
    “scan_dependencies”: true,
    “commands”: []
  },
  “operations”: []
}