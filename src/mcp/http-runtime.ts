import { timingSafeEqual } from "node:crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { loadConfig, type ChryPckConfig } from "../config.js";
import { GitHubRestTransport, GitHubTransportError } from "../adapters/github/client.js";
import { GitHubRepositoryAdapter } from "../adapters/github/repository-adapter.js";
import { PolicyError } from "../core/policy/errors.js";
import { NativeMcpService } from "./service.js";
import { createBuiltinProjectProfileRegistry } from "../project/builtin-profiles.js";
import type { ProjectProfileRegistry } from "../project/registry.js";

const editSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_file"), path: z.string().min(1), content: z.string() }),
  z.object({ type: z.literal("replace_file"), path: z.string().min(1), content: z.string() }),
  z.object({ type: z.literal("replace_exact"), path: z.string().min(1), search: z.string().min(1), replace: z.string(), expectedOccurrences: z.number().int().positive().optional() }),
  z.object({ type: z.literal("insert_before_exact"), path: z.string().min(1), anchor: z.string().min(1), content: z.string(), expectedOccurrences: z.number().int().positive().optional() }),
  z.object({ type: z.literal("insert_after_exact"), path: z.string().min(1), anchor: z.string().min(1), content: z.string(), expectedOccurrences: z.number().int().positive().optional() }),
  z.object({ type: z.literal("delete_exact"), path: z.string().min(1), search: z.string().min(1), expectedOccurrences: z.number().int().positive().optional() }),
  z.object({ type: z.literal("remove_file"), path: z.string().min(1) }),
  z.object({ type: z.literal("move_file"), from: z.string().min(1), to: z.string().min(1) })
]);

const architectureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("decompose"), paths: z.array(z.string().min(1)).optional() }),
  z.object({ kind: z.literal("move"), moves: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })).min(1) })
]);

const executeSchema = z.union([
  z.object({
    run_id: z.string().min(1),
    authoring_intent: z.object({
      id: z.string().trim().min(1),
      objective: z.string().trim().min(1),
      edits: z.array(editSchema).min(1)
    }),
    commit_message: z.string().trim().min(1).max(200).optional()
  }),
  z.object({
    run_id: z.string().min(1),
    architecture_approval: z.object({ plan_id: z.string().min(1) }),
    commit_message: z.string().trim().min(1).max(200).optional()
  })
]);

function jsonToolResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {})
  };
}

function normalizeError(error: unknown): Record<string, unknown> {
  if (error instanceof PolicyError) return { code: error.code, message: error.message, ...error.details };
  if (error instanceof GitHubTransportError) {
    return {
      code: "GITHUB_TRANSPORT_ERROR",
      status: error.status,
      method: error.method,
      apiPath: error.apiPath,
      message: error.message
    };
  }
  return { code: "CHRYPCK_ERROR", message: error instanceof Error ? error.message : String(error) };
}

async function toolBoundary<T>(operation: () => Promise<T> | T) {
  try {
    return jsonToolResult(await operation());
  } catch (error) {
    return jsonToolResult(normalizeError(error), true);
  }
}

export function registerChryPckTools(server: McpServer, nativeService: NativeMcpService): void {
  server.registerTool(
    "chrypck_plan",
    {
      title: "Plan Governed Change",
      description: "Build compressed diagnostic evidence and a certified corridor. Optional decompose/move modes produce review-required architectural plans without exposing arbitrary repository browsing.",
      inputSchema: z.object({
        repository: z.string().min(3),
        objective: z.string().trim().min(1),
        base_ref: z.string().trim().min(1).optional(),
        architecture: architectureSchema.optional()
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async input => toolBoundary(() => nativeService.plan(input))
  );

  server.registerTool(
    "chrypck_context",
    {
      title: "Read Certified Context",
      description: "Return only server-certified Context Pack source expansion; arbitrary repository paths are not accepted.",
      inputSchema: z.object({ run_id: z.string().min(1), segment_id: z.string().min(1).optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async input => toolBoundary(() => nativeService.context(input))
  );

  server.registerTool(
    "chrypck_execute",
    {
      title: "Execute Governed Change",
      description: "Execute typed bounded edits or an explicitly approved server-issued path-move plan through propagation, validation, and atomic publication.",
      inputSchema: executeSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async input => toolBoundary(() => nativeService.execute(input))
  );

  server.registerTool(
    "chrypck_result",
    {
      title: "Read Governed Result",
      description: "Return bounded native run state, project profile, architecture plan, telemetry, and terminal evidence.",
      inputSchema: z.object({ run_id: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async input => toolBoundary(() => nativeService.result(input))
  );
}

export function buildChryPckMcpServer(nativeService: NativeMcpService): McpServer {
  const server = new McpServer({ name: "chrypck", version: "1.0.0" });
  registerChryPckTools(server, nativeService);
  return server;
}

export interface ChryPckServiceRuntime {
  readonly config: ChryPckConfig;
  readonly projectProfiles: ProjectProfileRegistry;
  readonly nativeService: NativeMcpService;
}

export function createChryPckServiceRuntime(env: NodeJS.ProcessEnv = process.env): ChryPckServiceRuntime {
  const config = loadConfig(env);
  const transport = new GitHubRestTransport(config.githubToken, config.githubApiVersion);
  const repositoryAdapter = new GitHubRepositoryAdapter(transport, {
    maxTextFileBytes: config.maxTextFileBytes,
    maxRepositoryFiles: config.maxRepositoryFiles
  });
  const projectProfiles = createBuiltinProjectProfileRegistry();
  const nativeService = new NativeMcpService(repositoryAdapter, {
    allowedRepositories: config.allowedRepositories,
    defaultTargetRef: config.defaultTargetRef,
    maxMutationFileBytes: config.maxMutationFileBytes,
    projectProfiles
  });
  return { config, projectProfiles, nativeService };
}

let serviceRuntimeSingleton: ChryPckServiceRuntime | null = null;

export function getChryPckServiceRuntime(): ChryPckServiceRuntime {
  serviceRuntimeSingleton ??= createChryPckServiceRuntime();
  return serviceRuntimeSingleton;
}

export interface ChryPckMcpRuntime extends ChryPckServiceRuntime {
  readonly handler: ReturnType<typeof createMcpHandler>;
}

export function createChryPckMcpRuntime(env: NodeJS.ProcessEnv = process.env): ChryPckMcpRuntime {
  const serviceRuntime = createChryPckServiceRuntime(env);
  const handler = createMcpHandler(() => buildChryPckMcpServer(serviceRuntime.nativeService), { responseMode: "json" });
  return { ...serviceRuntime, handler };
}

let runtimeSingleton: ChryPckMcpRuntime | null = null;

export function getChryPckMcpRuntime(): ChryPckMcpRuntime {
  runtimeSingleton ??= createChryPckMcpRuntime();
  return runtimeSingleton;
}

export interface McpAccessHeaders {
  readonly host: string;
  readonly origin: string;
  readonly authorization: string;
}

export interface McpAccessDenial {
  readonly status: number;
  readonly message: string;
}

function constantTimeTokenMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function evaluateMcpAccess(headers: McpAccessHeaders, config: ChryPckConfig): McpAccessDenial | null {
  if (config.publicHost) {
    const incoming = headers.host.trim().toLowerCase();
    const hostname = incoming.split(":")[0] ?? incoming;
    if (incoming !== config.publicHost && hostname !== config.publicHost) {
      return { status: 403, message: "Host is not allowed." };
    }
  }

  const origin = headers.origin.trim();
  if (origin && config.allowedOrigins.size > 0 && !config.allowedOrigins.has(origin)) {
    return { status: 403, message: "Origin is not allowed." };
  }

  if (config.mcpBearerToken) {
    const expected = `Bearer ${config.mcpBearerToken}`;
    if (!constantTimeTokenMatch(headers.authorization, expected)) {
      return { status: 401, message: "Bearer authorization is required." };
    }
  }

  return null;
}

export function buildHealthPayload(runtime: ChryPckServiceRuntime) {
  return {
    ok: true,
    service: "chrypck",
    version: "1.0.0",
    execution: "native",
    repository_visibility: "diagnostic-projection-plus-certified-context",
    project_profiles: runtime.projectProfiles.list().map(profile => profile.id)
  };
}
