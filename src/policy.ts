import path from "node:path";
import * as z from "zod/v4";

import {
  ABSTRACTION_OUTCOMES,
  createDefaultAbstractionLock,
  createSourceAccessGrant,
  type SourceAccessGrant as NativeSourceAccessGrant
} from "./core/policy/abstraction-lock.js";
import { PolicyError } from "./core/policy/errors.js";
import {
  assertScopeLock,
  type ScopeLock,
  type ScopeLockResult
} from "./core/policy/scope-lock.js";

export const ABSTRACTION_VIOLATION = ABSTRACTION_OUTCOMES.VIOLATION;
export const ABSTRACTION_GAP = ABSTRACTION_OUTCOMES.GAP;
export const SCOPE_VIOLATION = "SCOPE_VIOLATION" as const;

export { assertScopeLock } from "./core/policy/scope-lock.js";
export type { ScopeLock } from "./core/policy/scope-lock.js";

export type GuardErrorCode = typeof ABSTRACTION_VIOLATION | typeof ABSTRACTION_GAP | typeof SCOPE_VIOLATION;

export class GuardError extends Error {
  constructor(
    public readonly code: GuardErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "GuardError";
  }
}

const toolchainRequestSchema = z.object({
  schema_version: z.literal(2),
  id: z.string().trim().min(1),
  planning_goal: z.string().trim().min(1),
  scope_lock: z.record(z.string(), z.unknown()),
  operations: z.array(z.unknown()).length(0, "Small MCP only accepts planning-only requests with operations: [].")
}).passthrough();

export type ToolchainRequest = z.infer<typeof toolchainRequestSchema>;

function mapPolicyError(error: PolicyError): GuardError {
  const code: GuardErrorCode = error.code === SCOPE_VIOLATION
    ? SCOPE_VIOLATION
    : error.code === ABSTRACTION_GAP
      ? ABSTRACTION_GAP
      : ABSTRACTION_VIOLATION;
  return new GuardError(code, error.message, { ...error.details, nativePolicyCode: error.code });
}

export function validateToolchainRequest(value: unknown): ToolchainRequest {
  const parsed = toolchainRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new GuardError(
      ABSTRACTION_VIOLATION,
      "Toolchain request rejected by the Small MCP boundary.",
      { issues: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) }
    );
  }

  try {
    const scopeLock = assertScopeLock(parsed.data as Record<string, any>);
    createDefaultAbstractionLock(scopeLock);
  } catch (error) {
    if (error instanceof PolicyError) throw mapPolicyError(error);
    throw error;
  }

  return parsed.data;
}

export function assertAllowedRepository(repository: string, allowed: ReadonlySet<string>): string {
  const normalized = String(repository ?? "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw new GuardError(ABSTRACTION_VIOLATION, "Repository must be an explicit owner/name identifier.");
  }
  if (!allowed.has(normalized)) {
    throw new GuardError(
      ABSTRACTION_VIOLATION,
      "Repository is outside the Small MCP allowlist.",
      { repository: normalized }
    );
  }
  return normalized;
}

export function normalizeRepositoryPath(value: string): string {
  const raw = String(value ?? "").trim().replaceAll("\\", "/");
  if (!raw || raw.includes("\0") || raw.startsWith("/")) {
    throw new GuardError(ABSTRACTION_VIOLATION, "Repository path is invalid.");
  }

  const normalized = path.posix.normalize(raw).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new GuardError(ABSTRACTION_VIOLATION, "Repository path escapes the repository root.");
  }
  return normalized;
}

function stripLogDecoration(line: string): string {
  return line
    .replace(/\u001B\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/^\d{4}-\d{2}-\d{2}T\S+ /, "")
    .replace(/^##\[(?:error|warning|notice|debug|group|endgroup)\]\s*/i, "");
}

function maybeGrantPath(candidate: unknown, paths: Set<string>): void {
  if (typeof candidate !== "string") return;
  try {
    paths.add(normalizeRepositoryPath(candidate));
  } catch {
    // Toolchain evidence containing a malformed path does not become authority.
  }
}

export function extractGrantedPathsFromLog(rawLog: string): string[] {
  const granted = new Set<string>();
  const lines = String(rawLog ?? "").split(/\r?\n/).map(stripLogDecoration);
  let inTargetedSurface = false;

  for (const line of lines) {
    const trimmed = line.trim();

    const markerIndex = trimmed.indexOf("SOURCE_ACCESS_GRANT");
    if (markerIndex >= 0) {
      const jsonStart = trimmed.indexOf("{", markerIndex);
      if (jsonStart >= 0) {
        try {
          const payload = JSON.parse(trimmed.slice(jsonStart)) as { paths?: unknown[] };
          for (const candidate of payload.paths ?? []) maybeGrantPath(candidate, granted);
        } catch {
          // A malformed marker is ignored rather than guessed at.
        }
      }
    }

    if (trimmed === "Targeted patch surface:") {
      inTargetedSurface = true;
      continue;
    }

    if (!inTargetedSurface) continue;

    if (/^(Runtime convergence|Effect boundary candidates|Expected scope|Failure evidence|Change propagation|Validation):/i.test(trimmed)) {
      inTargetedSurface = false;
      continue;
    }

    const match = line.match(/^\s{2,}([^\s]+)\s+\[[^\]]+\]\s*$/);
    if (match?.[1]) maybeGrantPath(match[1], granted);
  }

  return [...granted].sort();
}

export function extractFailureEvidence(rawLog: string, maxLines = 120): string[] {
  const lines = String(rawLog ?? "").split(/\r?\n/).map(stripLogDecoration);
  const selected = new Set<number>();
  const signal = /(\[patch-corridor\]|\[github-filepatcher\]|\[failure-evidence\]|ABSTRACTION_|SCOPE_|refusing to certify|process completed with exit code|\bfailed\b|\bfailure\b|\berror\b)/i;

  for (let index = 0; index < lines.length; index += 1) {
    if (!signal.test(lines[index] ?? "")) continue;
    for (let offset = -1; offset <= 1; offset += 1) {
      const candidate = index + offset;
      if (candidate >= 0 && candidate < lines.length) selected.add(candidate);
    }
  }

  return [...selected]
    .sort((left, right) => left - right)
    .slice(-maxLines)
    .map(index => lines[index] ?? "")
    .filter(Boolean);
}

export interface SourceGrant {
  repository: string;
  requestCommitSha: string;
  paths: ReadonlySet<string>;
  evidence: string;
  issuedAt: number;
  expiresAt: number;
  nativeGrant: NativeSourceAccessGrant;
}

export class SourceGrantStore {
  private readonly grants = new Map<string, SourceGrant>();

  constructor(private readonly ttlMs: number) {}

  private key(repository: string, requestCommitSha: string): string {
    return `${repository}@${requestCommitSha}`;
  }

  issue(
    repository: string,
    requestCommitSha: string,
    paths: readonly string[],
    evidence: string,
    scopeLock?: ScopeLockResult | null
  ): SourceGrant | null {
    const normalizedPaths = [...new Set(paths.map(normalizeRepositoryPath))].sort();
    if (normalizedPaths.length === 0) return null;

    const native = createSourceAccessGrant({
      paths: normalizedPaths,
      issuedBy: "chrypck-source-grant-store",
      evidence,
      scopeLock
    });
    if (!native.allowed || !native.grant || !("paths" in native.grant)) {
      const code = native.outcome === ABSTRACTION_OUTCOMES.GAP ? ABSTRACTION_GAP : ABSTRACTION_VIOLATION;
      throw new GuardError(code, native.reason ?? "Native Abstraction Lock rejected the source grant.", { abstraction: native });
    }

    const issuedAt = Date.now();
    const nativeGrant = native.grant as NativeSourceAccessGrant;
    const grant: SourceGrant = Object.freeze({
      repository,
      requestCommitSha,
      paths: new Set(nativeGrant.paths),
      evidence,
      issuedAt,
      expiresAt: issuedAt + this.ttlMs,
      nativeGrant
    });
    this.grants.set(this.key(repository, requestCommitSha), grant);
    return grant;
  }

  require(repository: string, requestCommitSha: string, requestedPath: string): SourceGrant {
    const key = this.key(repository, requestCommitSha);
    const grant = this.grants.get(key);
    if (!grant) {
      throw new GuardError(
        ABSTRACTION_GAP,
        "No toolchain-derived source grant is active. Inspect the canonical toolchain run first.",
        { repository, requestCommitSha }
      );
    }
    if (grant.expiresAt <= Date.now()) {
      this.grants.delete(key);
      throw new GuardError(
        ABSTRACTION_GAP,
        "The toolchain-derived source grant expired. Re-inspect the canonical run to re-derive authority.",
        { repository, requestCommitSha }
      );
    }

    const normalizedPath = normalizeRepositoryPath(requestedPath);
    if (!grant.paths.has(normalizedPath)) {
      throw new GuardError(
        ABSTRACTION_VIOLATION,
        "Requested source path was not granted by higher-level toolchain evidence.",
        { path: normalizedPath, grantedPaths: [...grant.paths].sort(), evidence: grant.evidence }
      );
    }
    return grant;
  }

  invalidateRepository(repository: string): void {
    for (const [key, grant] of this.grants) {
      if (grant.repository === repository) this.grants.delete(key);
    }
  }
}
