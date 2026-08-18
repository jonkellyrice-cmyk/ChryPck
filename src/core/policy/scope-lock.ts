import { createHash } from "node:crypto";

import { PolicyError } from "./errors.js";

export const SCOPE_LOCK_SCHEMA_VERSION = 1;
export const SCOPE_LOCK_KIND = "frame_conn_scope_lock";

export interface ScopeViolation {
  readonly code: string;
  readonly summary: string;
  readonly paths?: readonly string[];
}

export interface ScopeLockAuthority {
  readonly root: "original_user_instruction";
  readonly assistant_may_narrow_scope: true;
  readonly assistant_may_expand_scope: false;
  readonly obstacle_may_change_means_not_goal: true;
  readonly expansion_requires_new_explicit_user_authorization: true;
}

export interface ScopeLockResult {
  readonly schema_version: number;
  readonly kind: typeof SCOPE_LOCK_KIND;
  readonly state: "LOCKED" | "SCOPE_VIOLATION";
  readonly locked: boolean;
  readonly fingerprint: string | null;
  readonly objective_fingerprint?: string;
  readonly lock_id?: string | null;
  readonly original_user_instruction?: string;
  readonly authorized_deliverables?: readonly string[];
  readonly authorized_paths?: readonly string[];
  readonly forbidden_expansions?: readonly string[];
  readonly allow_capability_construction?: boolean;
  readonly authorized_capabilities?: readonly string[];
  readonly declared_paths?: readonly string[];
  readonly violations: readonly ScopeViolation[];
  readonly authority?: ScopeLockAuthority;
}

export interface ScopeLock extends ScopeLockResult {
  readonly state: "LOCKED";
  readonly locked: true;
  readonly fingerprint: string;
  readonly objective_fingerprint: string;
  readonly lock_id: string | null;
  readonly original_user_instruction: string;
  readonly authorized_deliverables: readonly string[];
  readonly authorized_paths: readonly string[];
  readonly forbidden_expansions: readonly string[];
  readonly allow_capability_construction: boolean;
  readonly authorized_capabilities: readonly string[];
  readonly declared_paths: readonly string[];
  readonly authority: ScopeLockAuthority;
}

export interface ScopeLockInput {
  readonly lockId?: string | null;
  readonly originalUserInstruction: string;
  readonly authorizedDeliverables: readonly string[];
  readonly authorizedPaths?: readonly string[];
  readonly forbiddenExpansions?: readonly string[];
  readonly allowCapabilityConstruction?: boolean;
  readonly authorizedCapabilities?: readonly string[];
}

export type ScopeLockRequest = Record<string, any>;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, stable(record[key])]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value)), "utf8").digest("hex");
}

function strings(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(entry => String(entry).trim()).filter(Boolean))];
}

export function normalizeScopeRepositoryPath(value: unknown): string {
  return String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

export function declaredPaths(request: ScopeLockRequest): string[] {
  const output: unknown[] = [];

  for (const operation of request?.operations ?? []) {
    for (const key of ["path", "from", "to"] as const) if (operation?.[key]) output.push(operation[key]);
    for (const root of operation?.roots ?? []) output.push(root);
  }
  for (const edit of request?.authoring_intent?.edits ?? []) if (edit?.path) output.push(edit.path);
  for (const move of request?.moves ?? []) {
    if (move?.from) output.push(move.from);
    if (move?.to) output.push(move.to);
  }
  for (const candidate of request?.candidates ?? []) {
    if (candidate?.source) output.push(candidate.source);
    for (const unit of candidate?.units ?? []) if (unit?.target) output.push(unit.target);
  }
  for (const allowed of request?.policy?.allowed_paths ?? []) output.push(allowed);

  return [...new Set(output.map(normalizeScopeRepositoryPath).filter(Boolean))].sort();
}

export function pathAuthorized(candidate: string, authorizedPaths: readonly string[]): boolean {
  return authorizedPaths.some(allowed => candidate === allowed || candidate.startsWith(`${allowed.replace(/\/$/, "")}/`));
}

export function buildScopeLock(request: ScopeLockRequest): ScopeLockResult {
  const source = request?.scope_lock;
  const violations: ScopeViolation[] = [];

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return {
      schema_version: SCOPE_LOCK_SCHEMA_VERSION,
      kind: SCOPE_LOCK_KIND,
      state: "SCOPE_VIOLATION",
      locked: false,
      fingerprint: null,
      violations: [{
        code: "SCOPE_LOCK_REQUIRED",
        summary: "Every canonical request requires an explicit scope_lock rooted in the user's instruction."
      }]
    };
  }

  const originalUserInstruction = String(source.original_user_instruction ?? "").trim();
  const authorizedDeliverables = strings(source.authorized_deliverables);
  const authorizedPaths = strings(source.authorized_paths).map(normalizeScopeRepositoryPath).sort();
  const forbiddenExpansions = strings(source.forbidden_expansions);
  const authorizedCapabilities = strings(source.authorized_capabilities).sort();

  if (!originalUserInstruction) {
    violations.push({
      code: "USER_OBJECTIVE_REQUIRED",
      summary: "scope_lock.original_user_instruction must preserve the user's objective verbatim."
    });
  }
  if (!authorizedDeliverables.length) {
    violations.push({
      code: "AUTHORIZED_DELIVERABLE_REQUIRED",
      summary: "Scope Lock requires at least one user-authorized deliverable."
    });
  }

  const requestDeclaredPaths = declaredPaths(request);
  if (!authorizedPaths.length && requestDeclaredPaths.length) {
    violations.push({
      code: "AUTHORIZED_PATHS_REQUIRED",
      summary: "Mutating requests must declare authorized_paths in Scope Lock."
    });
  }

  const outside = requestDeclaredPaths.filter(candidate => !pathAuthorized(candidate, authorizedPaths));
  if (outside.length) {
    violations.push({
      code: "PATH_SCOPE_EXPANSION",
      summary: "The request declares repository paths outside the immutable Scope Lock.",
      paths: outside
    });
  }

  const capabilityConstruction = source.allow_capability_construction === true;
  if (capabilityConstruction && !authorizedCapabilities.length) {
    violations.push({
      code: "CAPABILITY_AUTHORIZATION_REQUIRED",
      summary: "Capability construction requires explicit authorized_capabilities."
    });
  }

  const projection = {
    schema_version: SCOPE_LOCK_SCHEMA_VERSION,
    lock_id: String(source.lock_id ?? "").trim() || null,
    original_user_instruction: originalUserInstruction,
    authorized_deliverables: authorizedDeliverables,
    authorized_paths: authorizedPaths,
    forbidden_expansions: forbiddenExpansions,
    allow_capability_construction: capabilityConstruction,
    authorized_capabilities: authorizedCapabilities
  };

  return {
    schema_version: SCOPE_LOCK_SCHEMA_VERSION,
    kind: SCOPE_LOCK_KIND,
    state: violations.length ? "SCOPE_VIOLATION" : "LOCKED",
    locked: violations.length === 0,
    fingerprint: hash(projection),
    objective_fingerprint: hash(originalUserInstruction),
    ...projection,
    declared_paths: requestDeclaredPaths,
    violations,
    authority: {
      root: "original_user_instruction",
      assistant_may_narrow_scope: true,
      assistant_may_expand_scope: false,
      obstacle_may_change_means_not_goal: true,
      expansion_requires_new_explicit_user_authorization: true
    }
  };
}

export function assertScopeLock(request: ScopeLockRequest): ScopeLock {
  const lock = buildScopeLock(request);
  if (!lock.locked) {
    throw new PolicyError(
      "SCOPE_VIOLATION",
      `Scope Lock rejected request: ${lock.violations.map(item => item.code).join(", ")}`,
      { scopeLock: lock }
    );
  }
  return lock as ScopeLock;
}

export function createScopeLock(input: ScopeLockInput): ScopeLock {
  return assertScopeLock({
    scope_lock: {
      lock_id: input.lockId ?? null,
      original_user_instruction: input.originalUserInstruction,
      authorized_deliverables: input.authorizedDeliverables,
      authorized_paths: input.authorizedPaths ?? [],
      forbidden_expansions: input.forbiddenExpansions ?? [],
      allow_capability_construction: input.allowCapabilityConstruction === true,
      authorized_capabilities: input.authorizedCapabilities ?? []
    },
    operations: []
  });
}

export function assertPathInScope(lock: ScopeLockResult, path: string): void {
  const repositoryPath = normalizeScopeRepositoryPath(path);
  const authorizedPaths = lock.authorized_paths ?? [];
  if (authorizedPaths.length && !pathAuthorized(repositoryPath, authorizedPaths)) {
    throw new PolicyError("SCOPE_VIOLATION", "Path is outside the active Scope Lock.", {
      path: repositoryPath,
      lockId: lock.lock_id ?? null
    });
  }
}
