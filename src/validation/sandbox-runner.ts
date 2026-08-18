import type { PlannedValidationCommand } from "./command-plan.js";

export interface SandboxWorkspaceFile {
  readonly path: string;
  readonly content: string;
}

export interface SandboxResourceLimits {
  readonly memoryMb: number;
  readonly cpuCount: number;
  readonly pids: number;
}

export interface SandboxExecutionRequest {
  readonly imageRef: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly workspace: readonly SandboxWorkspaceFile[];
  readonly network: "none";
  readonly readOnlyRootFilesystem: true;
  readonly noNewPrivileges: true;
  readonly dropAllCapabilities: true;
  readonly environment: Readonly<Record<string, string>>;
  readonly limits: SandboxResourceLimits;
}

export interface SandboxExecutionResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface SandboxExecutor {
  execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>;
}

export interface SandboxRunnerPolicy {
  readonly imageRef: string;
  readonly limits: SandboxResourceLimits;
  readonly maxOutputBytes: number;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface SandboxCommandResult extends SandboxExecutionResult {
  readonly commandId: string;
  readonly outputTruncated: boolean;
}

export interface SandboxRunner {
  run(command: PlannedValidationCommand, workspace: readonly SandboxWorkspaceFile[]): Promise<SandboxCommandResult>;
}

function normalizeWorkspacePath(value: string): string {
  const raw = String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!raw || raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) throw new Error(`Sandbox workspace path must be repository-relative: ${raw}`);
  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new Error(`Sandbox workspace path escapes repository: ${raw}`);
    if (part.includes("\0")) throw new Error("Sandbox workspace path contains a null byte.");
    parts.push(part);
  }
  if (!parts.length) throw new Error("Sandbox workspace path is empty.");
  return parts.join("/");
}

function truncate(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return { value, truncated: false };
  return { value: buffer.subarray(0, Math.max(0, maxBytes)).toString("utf8"), truncated: true };
}

export class IsolatedSandboxRunner implements SandboxRunner {
  constructor(private readonly executor: SandboxExecutor, private readonly policy: SandboxRunnerPolicy) {
    if (!policy.imageRef.trim()) throw new Error("Sandbox imageRef is required.");
    if (policy.maxOutputBytes < 1) throw new Error("Sandbox maxOutputBytes must be positive.");
  }

  async run(command: PlannedValidationCommand, workspace: readonly SandboxWorkspaceFile[]): Promise<SandboxCommandResult> {
    const normalizedWorkspace = workspace.map(file => Object.freeze({ path: normalizeWorkspacePath(file.path), content: file.content }));
    const request: SandboxExecutionRequest = Object.freeze({
      imageRef: this.policy.imageRef,
      executable: command.executable,
      args: command.args,
      cwd: command.cwd,
      timeoutMs: command.timeoutMs,
      workspace: Object.freeze(normalizedWorkspace),
      network: "none" as const,
      readOnlyRootFilesystem: true as const,
      noNewPrivileges: true as const,
      dropAllCapabilities: true as const,
      environment: Object.freeze({ ...(this.policy.environment ?? {}) }),
      limits: Object.freeze({ ...this.policy.limits })
    });
    const result = await this.executor.execute(request);
    const stdout = truncate(result.stdout, this.policy.maxOutputBytes);
    const stderr = truncate(result.stderr, this.policy.maxOutputBytes);
    return Object.freeze({
      commandId: command.id,
      exitCode: result.exitCode,
      stdout: stdout.value,
      stderr: stderr.value,
      timedOut: result.timedOut,
      outputTruncated: stdout.truncated || stderr.truncated
    });
  }
}

export class DisabledSandboxRunner implements SandboxRunner {
  async run(command: PlannedValidationCommand, _workspace: readonly SandboxWorkspaceFile[]): Promise<SandboxCommandResult> {
    throw new Error(`Sandbox execution is disabled; cannot run validation command: ${command.id}`);
  }
}
