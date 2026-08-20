import { timingSafeEqual } from "node:crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { loadConfig, type ChryPckConfig } from "../config.js";
import { userHandle, commonRepos, resolveRepositorySlug } from "./user-identity.js";
import { GitHubRestTransport, GitHubTransportError } from "../adapters/github/client.js";
import { GitHubRepositoryAdapter } from "../adapters/github/repository-adapter.js";
import { PolicyError } from "../core/policy/errors.js";
import { NativeMcpService } from "./service.js";
import { createBuiltinProjectProfileRegistry } from "../project/builtin-profiles.js";
import type { ProjectProfileRegistry } from "../project/registry.js";

const repositoryPath = () => z.string().min(1).describe("Repository-relative path inside the certified change scope.");
const expectedOccurrences = () => z.number().int().positive().optional().describe("Optional exact match count used as an additional safety assertion before mutation.");

const editSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_file"),
    path: repositoryPath(),
    content: z.string().describe("Complete UTF-8 text for the new file.")
  }),
  z.object({
    type: z.literal("replace_file"),
    path: repositoryPath(),
    content: z.string().describe("Complete replacement UTF-8 text for the existing file.")
  }),
  z.object({
    type: z.literal("replace_exact"),
    path: repositoryPath(),
    search: z.string().min(1).describe("Exact existing text that must be matched."),
    replace: z.string().describe("Replacement text written in place of each certified exact match."),
    expectedOccurrences: expectedOccurrences()
  }),
  z.object({
    type: z.literal("insert_before_exact"),
    path: repositoryPath(),
    anchor: z.string().min(1).describe("Exact existing anchor text before which content is inserted."),
    content: z.string().describe("Text inserted immediately before the exact anchor."),
    expectedOccurrences: expectedOccurrences()
  }),
  z.object({
    type: z.literal("insert_after_exact"),
    path: repositoryPath(),
    anchor: z.string().min(1).describe("Exact existing anchor text after which content is inserted."),
    content: z.string().describe("Text inserted immediately after the exact anchor."),
    expectedOccurrences: expectedOccurrences()
  }),
  z.object({
    type: z.literal("delete_exact"),
    path: repositoryPath(),
    search: z.string().min(1).describe("Exact existing text to remove."),
    expectedOccurrences: expectedOccurrences()
  }),
  z.object({
    type: z.literal("remove_file"),
    path: repositoryPath()
  }),
  z.object({
    type: z.literal("move_file"),
    from: repositoryPath().describe("Existing repository-relative source path."),
    to: repositoryPath().describe("Repository-relative destination path authorized by the certified run.")
  })
]);

const architectureSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("decompose"),
    paths: z.array(repositoryPath()).optional().describe("Optional source paths to consider for a review-required decomposition plan.")
  }),
  z.object({
    kind: z.literal("move"),
    moves: z.array(z.object({
      from: repositoryPath().describe("Existing source path to move."),
      to: repositoryPath().describe("Proposed destination path; execution requires explicit architecture approval.")
    })).min(1).describe("Review-required path moves to plan; planning itself does not mutate the repository.")
  })
]);

const executeSchema = z.union([
  z.object({
    run_id: z.string().min(1).describe("Run identifier previously issued by chrypck_plan."),
    authoring_intent: z.object({
      id: z.string().trim().min(1).describe("Stable caller-supplied identifier for this bounded authoring intent."),
      objective: z.string().trim().min(1).describe("Exact user-authorized change objective for these edits."),
      edits: z.array(editSchema).min(1).describe("Typed edits constrained by the existing certified run and Patch Corridor.")
    }).describe("Use this mode for explicit typed bounded edits."),
    commit_message: z.string().trim().min(1).max(200).optional().describe("Optional commit message for the atomic publication." )
  }),
  z.object({
    run_id: z.string().min(1).describe("Run identifier previously issued by chrypck_plan."),
    architecture_approval: z.object({
      plan_id: z.string().min(1).describe("Server-issued architecture plan identifier being explicitly approved for execution.")
    }).describe("Use this mode only to approve an already-issued review-required architecture plan."),
    commit_message: z.string().trim().min(1).max(200).optional().describe("Optional commit message for the atomic publication.")
  })
]).describe("Execute exactly one mode: authoring_intent or architecture_approval. Never provide both.");

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
      description: "Start governed repository work. Use first for repository inspection or change. Returns run_id, a bounded whole-repository repository_atlas, an explicit coverage ledger, bounded diagnostics/certified corridor, context availability, architecture-review state, and permitted_next_action. Read the Atlas and coverage first for global orientation, then use the lossy diagnostics to narrow attention; omitted Atlas nodes are explicitly counted and must not be treated as nonexistent. Failures return a structured code and message.",
      inputSchema: z.object({
        repository: z.string().min(1).describe("Repository slug. For the configured ChryPck owner, prefer the bare repository name (for example LEMONade_ORC); owner/name and GitHub URLs remain accepted when needed."),
        objective: z.string().trim().min(1).describe("Exact user-authorized repository outcome to investigate or implement."),
        base_ref: z.string().trim().min(1).optional().describe("Existing branch/ref to inspect; server policy supplies the default when omitted."),
        architecture: architectureSchema.optional().describe("Optional read-only structural planning request. Move/decompose plans require later explicit execution/approval."),
        analysis: z.union([
          z.object({
            kind: z.literal("trace"),
            max_hops: z.number().int().positive().optional().describe("Optional maximum causal-trace depth."),
            max_branches: z.number().int().positive().optional().describe("Optional maximum trace branches to consider.")
          }),
          z.object({
            kind: z.literal("bounded-event-trace"),
            sourceSymbol: z.string().trim().min(1).describe("Known source symbol from which the bounded event-flow trace begins."),
            targetEffect: z.string().trim().min(1).optional().describe("Optional terminal effect the trace should try to certify."),
            options: z.object({
              fileGlobAllow: z.array(z.string()).optional().describe("Optional file-glob allowlist for this diagnostic trace."),
              fileGlobDeny: z.array(z.string()).optional().describe("Optional file-glob denylist for this diagnostic trace."),
              namespaceAllow: z.array(z.string()).optional().describe("Optional namespace allowlist."),
              namespaceDeny: z.array(z.string()).optional().describe("Optional namespace denylist."),
              symbolAllow: z.array(z.string()).optional().describe("Optional symbol allowlist."),
              symbolDeny: z.array(z.string()).optional().describe("Optional symbol denylist."),
              maxHops: z.number().int().positive().optional().describe("Optional maximum event-flow hops."),
              maxBranches: z.number().int().positive().optional().describe("Optional maximum branches to consider."),
              terminateOnFirstBlocker: z.boolean().optional().describe("Stop once the first certifiable blocker is found.")
            }).optional().describe("Optional bounded-event-trace scope controls.")
          })
        ]).optional().describe("Optional read-only diagnostic mode used during planning.")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async input => toolBoundary(() => nativeService.plan({ ...input, repository: resolveRepositorySlug(input.repository) }))
  );

  server.registerTool(
    "chrypck_context",
    {
      title: "Read Certified Context",
      description: "Read server-certified Context Pack evidence for an existing READY run. Omit segment_id for the certified index; provide one server-issued segment_id for one bounded source expansion. Never accepts arbitrary repository paths. Returns the next permitted action; failures return structured code/message data.",
      inputSchema: z.object({
        run_id: z.string().min(1).describe("Run identifier previously issued by chrypck_plan."),
        segment_id: z.string().min(1).optional().describe("Optional server-issued Context Pack segment or continuation identifier. Omit to read the certified index.")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async input => toolBoundary(() => nativeService.context(input))
  );

  server.registerTool(
    "chrypck_execute",
    {
      title: "Execute Governed Change",
      description: "Mutate an existing planned run using exactly one mode: typed bounded authoring_intent edits or explicit architecture_approval of a server-issued reviewed plan. ChryPck performs propagation, validation, and atomic publication. Failures return structured code/message data; policy failures are authoritative rather than transient retry signals.",
      inputSchema: executeSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async input => toolBoundary(() => nativeService.execute(input))
  );

  server.registerTool(
    "chrypck_result",
    {
      title: "Read Governed Result",
      description: "Read the authoritative bounded run state/outcome for an existing run, especially after execution or failure. Returns project profile, propagation/validation evidence, telemetry, terminal state, and other bounded native evidence. Failures return structured code/message data.",
      inputSchema: z.object({
        run_id: z.string().min(1).describe("Run identifier previously issued by chrypck_plan.")
      }),
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
    repository_visibility: "repository-atlas-plus-diagnostic-projection-plus-certified-context",
    user_handle: userHandle,
    common_repos: commonRepos,
    project_profiles: runtime.projectProfiles.list().map(profile => profile.id)
  };
}
