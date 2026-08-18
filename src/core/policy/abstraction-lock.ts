import path from "node:path";

import type { ScopeLock, ScopeLockResult } from "./scope-lock.js";

export const ABSTRACTION_LOCK_SCHEMA_VERSION = 1;
export const ABSTRACTION_LOCK_KIND = "frame_conn_abstraction_lock";

export const ABSTRACTION_OUTCOMES = Object.freeze({
  ALLOW: "ALLOW",
  VIOLATION: "ABSTRACTION_VIOLATION",
  GAP: "ABSTRACTION_GAP"
} as const);

export type AbstractionOutcome = typeof ABSTRACTION_OUTCOMES[keyof typeof ABSTRACTION_OUTCOMES];

export const FRAME_CONN_TOOLCHAIN_SURFACES = Object.freeze([
  "symbol-families",
  "dependency-graph",
  "dependency-watershed",
  "integration-surface-atlas",
  "runtime-signal-map",
  "effect-atlas",
  "native-contract-catalog",
  "patch-corridor",
  "corridor-context",
  "patch-staging",
  "change-propagation",
  "filepatcher",
  "canonical-validation"
] as const);

export const TOOLCHAIN_SURFACES = FRAME_CONN_TOOLCHAIN_SURFACES;
export type ToolchainSurface = typeof FRAME_CONN_TOOLCHAIN_SURFACES[number];

export const DIRECT_SOURCE_SURFACES = Object.freeze([
  "github-search",
  "generic-repository-search",
  "direct-source-read",
  "ad-hoc-file-read",
  "guessed-file-read"
] as const);
export type DirectSourceSurface = typeof DIRECT_SOURCE_SURFACES[number];
const DIRECT_SOURCE_SURFACE_SET = new Set<string>(DIRECT_SOURCE_SURFACES);

export interface SourceAccessGrant {
  readonly schema_version: 1;
  readonly kind: "frame_conn_source_access_grant";
  readonly issued_by: string;
  readonly evidence: string;
  readonly paths: readonly string[];
}

export interface AbstractionAccessResult {
  readonly schema_version: number;
  readonly kind: typeof ABSTRACTION_LOCK_KIND;
  readonly outcome: AbstractionOutcome;
  readonly allowed: boolean;
  readonly reason?: string;
  readonly permitted_escalation?: string;
  readonly denied_paths?: readonly string[];
  readonly surface?: string;
  readonly path?: string;
  readonly authority?: string;
  readonly grant?: SourceAccessGrant | Readonly<{ issued_by: string; evidence: string }>;
}

export interface AbstractionLock {
  readonly schema_version: number;
  readonly kind: typeof ABSTRACTION_LOCK_KIND;
  readonly state: "LOCKED";
  readonly locked: true;
  readonly scope_lock_fingerprint: string | null;
  readonly repository_read_mode: "toolchain_abstraction_first";
  readonly direct_source_exploration: "grant_required";
  readonly generic_github_search: "denied_for_repository_investigation";
  readonly assistant_may_self_authorize_descent: false;
  readonly permitted_surfaces: readonly ToolchainSurface[];
}

export interface SourceAccessGrantInput {
  readonly paths?: readonly string[];
  readonly issuedBy?: string | null;
  readonly evidence?: string | null;
  readonly scopeLock?: ScopeLockResult | null;
}

export interface AbstractionAccessInput {
  readonly scopeLock?: ScopeLockResult | null;
  readonly surface?: string | null;
  readonly path?: string | null;
  readonly grant?: Partial<SourceAccessGrant> | null;
  readonly evidenceGap?: string | null;
  readonly permittedEscalation?: string | null;
}

export function normalizeAbstractionRepositoryPath(value: unknown): string | null {
  const raw = String(value ?? "").trim().replaceAll("\\", "/");
  if (!raw) return null;
  const normalized = path.posix.normalize(raw).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) return null;
  return normalized;
}

function uniquePaths(values: readonly unknown[] = []): string[] {
  return [...new Set(values.map(normalizeAbstractionRepositoryPath).filter((entry): entry is string => Boolean(entry)))].sort();
}

function scopeAuthorizedPaths(scopeLock?: ScopeLockResult | null): Set<string> {
  return new Set(uniquePaths(scopeLock?.authorized_paths ?? scopeLock?.declared_paths ?? []));
}

function pathIsInsideScope(repositoryPath: string, scopeLock?: ScopeLockResult | null): boolean {
  const authorized = scopeAuthorizedPaths(scopeLock);
  if (authorized.size === 0) return true;
  return authorized.has(repositoryPath);
}

function result(outcome: AbstractionOutcome, details: Omit<AbstractionAccessResult, "schema_version" | "kind" | "outcome" | "allowed"> = {}): AbstractionAccessResult {
  return {
    schema_version: ABSTRACTION_LOCK_SCHEMA_VERSION,
    kind: ABSTRACTION_LOCK_KIND,
    outcome,
    allowed: outcome === ABSTRACTION_OUTCOMES.ALLOW,
    ...details
  };
}

export function createSourceAccessGrant(input: SourceAccessGrantInput = {}): AbstractionAccessResult {
  const grantedPaths = uniquePaths(input.paths ?? []);
  const issuer = String(input.issuedBy ?? "").trim();
  const evidenceRef = String(input.evidence ?? "").trim();

  if (!issuer || !evidenceRef || grantedPaths.length === 0) {
    return result(ABSTRACTION_OUTCOMES.GAP, {
      reason: "source-access-grant-requires-paths-issuer-and-evidence",
      permitted_escalation: "return-to-higher-level-toolchain-evidence"
    });
  }

  const outsideScope = grantedPaths.filter(repositoryPath => !pathIsInsideScope(repositoryPath, input.scopeLock));
  if (outsideScope.length > 0) {
    return result(ABSTRACTION_OUTCOMES.VIOLATION, {
      reason: "source-access-grant-cannot-broaden-scope-lock",
      denied_paths: outsideScope
    });
  }

  return result(ABSTRACTION_OUTCOMES.ALLOW, {
    grant: {
      schema_version: 1,
      kind: "frame_conn_source_access_grant",
      issued_by: issuer,
      evidence: evidenceRef,
      paths: grantedPaths
    }
  });
}

export function evaluateAbstractionAccess(input: AbstractionAccessInput = {}): AbstractionAccessResult {
  const { scopeLock } = input;
  if (!scopeLock?.locked && scopeLock?.state !== "LOCKED") {
    return result(ABSTRACTION_OUTCOMES.GAP, {
      reason: "scope-lock-required-before-abstraction-lock",
      permitted_escalation: "establish-scope-lock"
    });
  }

  const requestedSurface = String(input.surface ?? "").trim().toLowerCase();
  if (!requestedSurface) {
    return result(ABSTRACTION_OUTCOMES.GAP, {
      reason: "repository-surface-not-declared",
      permitted_escalation: "declare-existing-toolchain-surface"
    });
  }

  if (input.evidenceGap) {
    return result(ABSTRACTION_OUTCOMES.GAP, {
      reason: String(input.evidenceGap),
      permitted_escalation: input.permittedEscalation
        ? String(input.permittedEscalation)
        : "return-to-higher-level-toolchain-evidence"
    });
  }

  if ((FRAME_CONN_TOOLCHAIN_SURFACES as readonly string[]).includes(requestedSurface)) {
    return result(ABSTRACTION_OUTCOMES.ALLOW, {
      surface: requestedSurface,
      authority: "established-toolchain-abstraction"
    });
  }

  if (!DIRECT_SOURCE_SURFACE_SET.has(requestedSurface)) {
    return result(ABSTRACTION_OUTCOMES.VIOLATION, {
      reason: "surface-not-authorized-by-abstraction-lock",
      surface: requestedSurface
    });
  }

  const repositoryPath = normalizeAbstractionRepositoryPath(input.path);
  if (!repositoryPath) {
    return result(ABSTRACTION_OUTCOMES.VIOLATION, {
      reason: "generic-or-guessed-source-exploration-denied",
      surface: requestedSurface
    });
  }

  if (!pathIsInsideScope(repositoryPath, scopeLock)) {
    return result(ABSTRACTION_OUTCOMES.VIOLATION, {
      reason: "requested-source-outside-scope-lock",
      path: repositoryPath
    });
  }

  const grantPaths = uniquePaths(input.grant?.paths ?? []);
  if (
    input.grant?.kind !== "frame_conn_source_access_grant" ||
    !input.grant?.issued_by ||
    !input.grant?.evidence ||
    !grantPaths.includes(repositoryPath)
  ) {
    return result(ABSTRACTION_OUTCOMES.VIOLATION, {
      reason: "lower-level-source-access-requires-higher-level-grant",
      path: repositoryPath,
      surface: requestedSurface
    });
  }

  return result(ABSTRACTION_OUTCOMES.ALLOW, {
    surface: requestedSurface,
    path: repositoryPath,
    authority: "bounded-source-access-grant",
    grant: {
      issued_by: input.grant.issued_by,
      evidence: input.grant.evidence
    }
  });
}

export function createDefaultAbstractionLock(scopeLock: ScopeLock): AbstractionLock;
export function createDefaultAbstractionLock(scopeLock?: ScopeLockResult | null): AbstractionLock | AbstractionAccessResult;
export function createDefaultAbstractionLock(scopeLock?: ScopeLockResult | null): AbstractionLock | AbstractionAccessResult {
  if (!scopeLock?.locked && scopeLock?.state !== "LOCKED") {
    return result(ABSTRACTION_OUTCOMES.GAP, {
      reason: "scope-lock-required-before-abstraction-lock",
      permitted_escalation: "establish-scope-lock"
    });
  }

  return {
    schema_version: ABSTRACTION_LOCK_SCHEMA_VERSION,
    kind: ABSTRACTION_LOCK_KIND,
    state: "LOCKED",
    locked: true,
    scope_lock_fingerprint: scopeLock.fingerprint ?? null,
    repository_read_mode: "toolchain_abstraction_first",
    direct_source_exploration: "grant_required",
    generic_github_search: "denied_for_repository_investigation",
    assistant_may_self_authorize_descent: false,
    permitted_surfaces: [...FRAME_CONN_TOOLCHAIN_SURFACES]
  };
}
