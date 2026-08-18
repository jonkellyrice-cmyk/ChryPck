import { createHash } from "node:crypto";

export interface ValidationCommandSpec {
  readonly id: string;
  readonly executable: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly required?: boolean;
}

export interface ValidationCommandPolicy {
  readonly allowedExecutables: ReadonlySet<string>;
  readonly maxCommands: number;
  readonly maxTimeoutMs: number;
  readonly defaultTimeoutMs: number;
}

export interface PlannedValidationCommand {
  readonly id: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly required: boolean;
}

export interface ValidationCommandPlan {
  readonly schemaVersion: 1;
  readonly commands: readonly PlannedValidationCommand[];
  readonly fingerprint: string;
}

function normalizeRelativeDirectory(value: string | undefined): string {
  const raw = String(value ?? ".").trim().replaceAll("\\", "/");
  if (!raw || raw === ".") return ".";
  if (raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) throw new Error(`Validation cwd must be repository-relative: ${raw}`);
  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new Error(`Validation cwd may not escape the repository: ${raw}`);
    if (part.includes("\0")) throw new Error("Validation cwd contains a null byte.");
    parts.push(part);
  }
  return parts.length ? parts.join("/") : ".";
}

function safeToken(value: string, label: string): string {
  if (value.includes("\0")) throw new Error(`${label} contains a null byte.`);
  if (/\r|\n/.test(value)) throw new Error(`${label} contains a line break.`);
  return value;
}

function fingerprint(commands: readonly PlannedValidationCommand[]): string {
  return createHash("sha256").update(JSON.stringify(commands)).digest("hex");
}

export function buildValidationCommandPlan(specs: readonly ValidationCommandSpec[], policy: ValidationCommandPolicy): ValidationCommandPlan {
  if (specs.length > policy.maxCommands) throw new Error(`Validation plan exceeds maxCommands (${policy.maxCommands}).`);
  const ids = new Set<string>();
  const commands = specs.map(spec => {
    const id = safeToken(spec.id.trim(), "Validation command id");
    if (!id) throw new Error("Validation command id is required.");
    if (ids.has(id)) throw new Error(`Duplicate validation command id: ${id}`);
    ids.add(id);
    const executable = safeToken(spec.executable.trim(), `Executable for ${id}`);
    if (!policy.allowedExecutables.has(executable)) throw new Error(`Executable is not allowed by validation policy: ${executable}`);
    const timeoutMs = spec.timeoutMs ?? policy.defaultTimeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > policy.maxTimeoutMs) {
      throw new Error(`Invalid timeout for ${id}: ${timeoutMs}`);
    }
    return Object.freeze({
      id,
      executable,
      args: Object.freeze([...(spec.args ?? [])].map((value, index) => safeToken(String(value), `Argument ${index} for ${id}`))),
      cwd: normalizeRelativeDirectory(spec.cwd),
      timeoutMs,
      required: spec.required !== false
    });
  });
  return Object.freeze({ schemaVersion: 1 as const, commands: Object.freeze(commands), fingerprint: fingerprint(commands) });
}
