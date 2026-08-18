import {
  ABSTRACTION_OUTCOMES,
  evaluateAbstractionAccess,
  type AbstractionLock,
  type DirectSourceSurface,
  type SourceAccessGrant,
  type ToolchainSurface
} from "./abstraction-lock.js";
import { PolicyError } from "./errors.js";
import { assertPathInScope, type ScopeLock } from "./scope-lock.js";

export interface SourceGrantBinding {
  readonly repository: string;
  readonly commitSha: string;
  readonly grant: SourceAccessGrant;
  readonly expiresAt?: number;
}

export interface AuthorizationContext {
  readonly repository: string;
  readonly commitSha: string;
  readonly scopeLock: ScopeLock;
  readonly abstractionLock: AbstractionLock;
  readonly sourceGrant: SourceGrantBinding | null;
}

function throwAccessFailure(result: ReturnType<typeof evaluateAbstractionAccess>): never {
  const code = result.outcome === ABSTRACTION_OUTCOMES.GAP ? "ABSTRACTION_GAP" : "ABSTRACTION_VIOLATION";
  throw new PolicyError(code, result.reason ?? "Abstraction Lock denied repository access.", { abstraction: result });
}

function activeGrant(context: AuthorizationContext): SourceAccessGrant | null {
  const binding = context.sourceGrant;
  if (!binding) return null;
  if (binding.repository !== context.repository || binding.commitSha !== context.commitSha) {
    throw new PolicyError("ABSTRACTION_VIOLATION", "Source grant belongs to a different repository snapshot.", {
      repository: context.repository,
      commitSha: context.commitSha
    });
  }
  if (binding.expiresAt !== undefined && binding.expiresAt <= Date.now()) {
    throw new PolicyError("ABSTRACTION_GAP", "Source-access grant has expired.", {
      repository: context.repository,
      commitSha: context.commitSha
    });
  }
  return binding.grant;
}

export function authorizeSurface(context: AuthorizationContext, surface: ToolchainSurface): void {
  const result = evaluateAbstractionAccess({ scopeLock: context.scopeLock, surface });
  if (!result.allowed) throwAccessFailure(result);
}

export function authorizeSourceRead(context: AuthorizationContext, surface: DirectSourceSurface, path: string): void {
  assertPathInScope(context.scopeLock, path);
  const result = evaluateAbstractionAccess({
    scopeLock: context.scopeLock,
    surface,
    path,
    grant: activeGrant(context)
  });
  if (!result.allowed) throwAccessFailure(result);
}

export function authorizeMutation(context: AuthorizationContext, path: string): void {
  assertPathInScope(context.scopeLock, path);
  authorizeSurface(context, "filepatcher");
}
