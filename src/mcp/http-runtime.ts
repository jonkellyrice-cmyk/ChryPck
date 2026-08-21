import { createHash, timingSafeEqual } from "node:crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { loadConfig, type ChryPckConfig } from "../config.js";
import { userHandle, commonRepos, resolveRepositorySlug } from "./user-identity.js";
import { GitHubRestTransport, GitHubTransportError } from "../adapters/github/client.js";
import { GitHubRepositoryAdapter } from "../adapters/github/repository-adapter.js";
import { createRepositorySnapshotCache } from "../repository/snapshot-cache.js";
import { VercelBlobSemanticAtlasCache } from "../semantic/cache.js";
import { VercelBlobSemanticBootstrapSessionStore } from "../semantic/bootstrap.js";
import { PolicyError } from "../core/policy/errors.js";
import { NativeMcpService } from "./service.js";
import { createBuiltinProjectProfileRegistry } from "../project/builtin-profiles.js";
import type { ProjectProfileRegistry } from "../project/registry.js";

const repositoryPath = () => z.string().min(1).describe("Repository-relative path inside the certified change scope.");
const expectedOccurrences = () => z.number().int().positive().optional().describe("Optional exact match count used as an additional safety assertion before mutation.");

const editSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_file"), path: repositoryPath(), content: z.string().describe("Complete UTF-8 text for the new file.") }),
  z.object({ type: z.literal("replace_file"), path: repositoryPath(), content: z.string().describe("Complete replacement UTF-8 text for the existing file.") }),
  z.object({ type: z.literal("replace_exact"), path: repositoryPath(), search: z.string().min(1).describe("Exact existing text that must be matched."), replace: z.string().describe("Replacement text written in place of each certified exact match."), expectedOccurrences: expectedOccurrences() }),
  z.object({ type: z.literal("insert_before_exact"), path: repositoryPath(), anchor: z.string().min(1).describe("Exact existing anchor text before which content is inserted."), content: z.string().describe("Text inserted immediately before the exact anchor."), expectedOccurrences: expectedOccurrences() }),
  z.object({ type: z.literal("insert_after_exact"), path: repositoryPath(), anchor: z.string().min(1).describe("Exact existing anchor text after which content is inserted."), content: z.string().describe("Text inserted immediately after the exact anchor."), expectedOccurrences: expectedOccurrences() }),
  z.object({ type: z.literal("delete_exact"), path: repositoryPath(), search: z.string().min(1).describe("Exact existing text to remove."), expectedOccurrences: expectedOccurrences() }),
  z.object({ type: z.literal("remove_file"), path: repositoryPath() }),
  z.object({ type: z.literal("move_file"), from: repositoryPath().describe("Existing repository-relative source path."), to: repositoryPath().describe("Repository-relative destination path authorized by the certified run.") })
]);

const architectureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("decompose"), paths: z.array(repositoryPath()).optional().describe("Optional source paths to consider for a review-required decomposition plan.") }),
  z.object({ kind: z.literal("move"), moves: z.array(z.object({ from: repositoryPath().describe("Existing source path to move."), to: repositoryPath().describe("Proposed destination path; execution requires explicit architecture approval.") })).min(1).describe("Review-required path moves to plan; planning itself does not mutate the repository.") })
]);

const semanticClaimSchema = z.object({
  text: z.string().trim().min(1).max(600).describe("Concise architectural semantic claim grounded only in the supplied region metadata."),
  evidence_refs: z.array(z.string().trim().min(1)).min(1).describe("One or more evidence IDs from the same server-issued semantic region that support this claim.")
});

const semanticInterpretationSchema = z.object({
  region_id: z.string().trim().min(1).describe("Exact server-issued semantic region ID from the current objective-local expansion chunk."),
  name: z.string().trim().min(1).max(120).optional().describe("Optional clearer human-readable region name supported by the metadata."),
  purpose: semanticClaimSchema.optional().describe("What this repository/region exists to accomplish."),
  responsibilities: z.array(semanticClaimSchema).max(5).optional().describe("Primary responsibilities owned by this region."),
  does_not_own: z.array(semanticClaimSchema).max(4).optional().describe("Important responsibility boundaries only when supported by evidence."),
  key_flows: z.array(semanticClaimSchema).max(5).optional().describe("Important architectural/runtime flows through this region.")
});

const semanticBootstrapSchema = z.object({
  bootstrap_id: z.string().trim().min(1).describe("Server-issued semantic expansion identifier from the immediately preceding chrypck_plan response; field name is retained for compatibility."),
  chunk_id: z.string().trim().min(1).describe("Current server-issued semantic metadata chunk identifier."),
  interpretations: z.array(semanticInterpretationSchema).min(1).describe("Exactly one semantic interpretation for every region in the current chunk. ChryPck validates evidence references before accepting it.")
}).describe("Demand-driven host-LLM semantic expansion. Supply only when chrypck_plan returned semantic_bootstrap.status='required' with mode='lazy-objective-expansion'.");

const traceOptionsSchema = z.object({
  fileGlobAllow: z.array(z.string()).optional().describe("Optional file-glob allowlist for this bounded diagnostic trace."),
  fileGlobDeny: z.array(z.string()).optional().describe("Optional file-glob denylist for this bounded diagnostic trace."),
  symbolAllow: z.array(z.string()).optional().describe("Optional symbol allowlist for this bounded diagnostic trace."),
  symbolDeny: z.array(z.string()).optional().describe("Optional symbol denylist for this bounded diagnostic trace."),
  maxHops: z.number().int().positive().optional().describe("Optional maximum trace hops."),
  maxBranches: z.number().int().positive().optional().describe("Optional maximum branches considered per hop."),
  terminateOnFirstBlocker: z.boolean().optional().describe("Stop once the first evidence-backed blocker is found. Defaults to true."),
  certifyMode: z.enum(["strict", "relaxed"]).optional().describe("Reserved trace certification posture; strict remains the default behavior.")
}).optional().describe("Optional scope and traversal controls for the canonical bounded trace engine.");

const traceHandoffSchema = z.object({
  run_id: z.string().trim().min(1).describe("Authoritative prior ChryPck Trace run whose certified path evidence should inform this new normal plan."),
  certificate_id: z.string().trim().min(1).optional().describe("Optional Trace certificate ID copied from the prior Trace result. When supplied it must exactly match the stored authoritative certificate.")
}).describe("Certified Trace-to-plan lineage. Use only on a normal plan after Trace returns create_normal_plan_with_trace_handoff; do not combine with analysis or architecture.");

const dataflowCriterionSchema = z.object({
  symbol: z.string().trim().min(1).optional(),
  file: repositoryPath().optional(),
  value: z.string().trim().min(1).optional(),
  state: z.object({ namespace: z.string().trim().min(1), key: z.string().trim().min(1) }).optional(),
  contractId: z.string().trim().min(1).optional(),
  effectKind: z.string().trim().min(1).optional()
}).refine(value => Object.values(value).some(Boolean), "Dataflow criterion requires at least one selector.");

const dataflowOptionsSchema = z.object({
  maxNodes: z.number().int().positive().optional(), maxEdges: z.number().int().positive().optional(),
  maxHops: z.number().int().positive().optional(), maxFiles: z.number().int().positive().optional(),
  fileGlobAllow: z.array(z.string()).optional(), fileGlobDeny: z.array(z.string()).optional(),
  symbolAllow: z.array(z.string()).optional(), symbolDeny: z.array(z.string()).optional(),
  includeControlDependencies: z.boolean().optional()
}).optional();

const analysisHandoffSchema = z.object({
  run_id: z.string().trim().min(1).describe("Authoritative prior focused-analysis run."),
  artifact_id: z.string().trim().min(1).optional().describe("Optional certificate ID copied from the authoritative Trace or Dataflow Slice result.")
}).describe("Certified focused-analysis lineage for a distinct normal plan. It supplies evidence only and never mutation authority.");

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
    architecture_approval: z.object({ plan_id: z.string().min(1).describe("Server-issued architecture plan identifier being explicitly approved for execution.") }).describe("Use this mode only to approve an already-issued review-required architecture plan."),
    commit_message: z.string().trim().min(1).max(200).optional().describe("Optional commit message for the atomic publication.")
  })
]).describe("Execute exactly one mode: authoring_intent or architecture_approval. Never provide both.");

function jsonToolResult(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

function normalizeError(error: unknown): Record<string, unknown> {
  if (error instanceof PolicyError) return { code: error.code, message: error.message, ...error.details };
  if (error instanceof GitHubTransportError) return { code: "GITHUB_TRANSPORT_ERROR", status: error.status, method: error.method, apiPath: error.apiPath, message: error.message };
  return { code: "CHRYPCK_ERROR", message: error instanceof Error ? error.message : String(error) };
}

async function toolBoundary<T>(tool: string, input: unknown, operation: () => Promise<T> | T) {
  const started = Date.now();
  const inputRecord = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const objective = typeof inputRecord.objective === "string" ? inputRecord.objective : "";
  const metadata = {
    event: "chrypck.tool_call",
    tool,
    run_id: typeof inputRecord.run_id === "string" ? inputRecord.run_id : null,
    repository: typeof inputRecord.repository === "string" ? inputRecord.repository : null,
    objective_fingerprint: objective ? createHash("sha256").update(objective).digest("hex").slice(0, 16) : null
  };
  try {
    const value = await operation();
    const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
    console.info(JSON.stringify({ ...metadata, outcome: "success", duration_ms: Date.now() - started, state: record.state ?? null, permitted_next_action: record.permitted_next_action ?? null, progress_fingerprint: record.progress_fingerprint ?? null }));
    return jsonToolResult(value);
  }
  catch (error) {
    const normalized = normalizeError(error);
    console.error(JSON.stringify({ ...metadata, outcome: "error", duration_ms: Date.now() - started, error_code: normalized.code ?? "CHRYPCK_ERROR" }));
    return jsonToolResult(normalized, true);
  }
}

export function registerChryPckTools(server: McpServer, nativeService: NativeMcpService): void {
  server.registerTool(
    "chrypck_plan",
    {
      title: "Plan Governed Change",
      description: "Start governed repository work. Build global deterministic orientation immediately, lazily map at most one objective-local semantic frontier when needed, and proceed once semantic coverage is objective-sufficient rather than globally complete. Use Trace for one causal runtime route or Dataflow Slice for bounded value provenance/influence. Persist usable analysis for analysis_handoff; trace_handoff remains compatible. Semantic and analysis evidence never grants mutation authority or arbitrary source access.",
      inputSchema: z.object({
        repository: z.string().min(1).describe("Repository slug. For the configured ChryPck owner, prefer the bare repository name (for example LEMONADE_ORC); owner/name and GitHub URLs remain accepted when needed."),
        objective: z.string().trim().min(1).describe("Exact user-authorized repository outcome to investigate or implement. Keep it unchanged while completing a server-issued objective-local semantic expansion."),
        base_ref: z.string().trim().min(1).optional().describe("Existing branch/ref to inspect; server policy supplies the default when omitted."),
        architecture: architectureSchema.optional().describe("Optional read-only structural planning request. Move/decompose plans require later explicit execution/approval."),
        analysis: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("trace"), sourceSymbol: z.string().trim().min(1).optional(), targetEffect: z.string().trim().min(1).optional(), options: traceOptionsSchema }),
          z.object({ kind: z.literal("dataflow-slice"), criterion: dataflowCriterionSchema, direction: z.enum(["forward", "backward", "bidirectional"]), target: dataflowCriterionSchema.optional(), options: dataflowOptionsSchema })
        ]).optional().describe("Optional read-only focused analysis: Trace for one causal runtime route, or Dataflow Slice for value provenance/influence."),
        trace_handoff: traceHandoffSchema.optional(),
        analysis_handoff: analysisHandoffSchema.optional(),
        semantic_bootstrap: semanticBootstrapSchema.optional(),
        response_mode: z.enum(["compact", "full"]).default("compact").describe("Compact returns a small control envelope plus bounded context grants; full is reserved for explicit diagnostics.")
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async input => toolBoundary("chrypck_plan", input, () => nativeService.plan({ ...input, repository: resolveRepositorySlug(input.repository) }))
  );

  server.registerTool(
    "chrypck_context",
    {
      title: "Read Certified Context",
      description: "Expand one bounded read-only Context Pack grant by server-issued segment_id or by exact path/symbol already certified in this run. Direct target selection skips index navigation but never grants arbitrary paths or widens mutation authority. Responses include structured task/evidence sufficiency and continuation fields.",
      inputSchema: z.object({
        run_id: z.string().min(1).describe("Run identifier previously issued by chrypck_plan."),
        segment_id: z.string().min(1).optional().describe("Optional server-issued Context Pack segment or continuation identifier."),
        target: z.object({
          path: repositoryPath().describe("Exact path already present in this run's certified Context Pack."),
          symbol: z.string().trim().min(1).optional().describe("Optional exact symbol within the certified path.")
        }).optional().describe("Directly select an existing certified path/symbol when evidence has already narrowed the investigation. This never widens the Context Pack.")
      }).refine(value => !(value.segment_id && value.target), "Use segment_id or target, never both."),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async input => toolBoundary("chrypck_context", input, () => nativeService.context(input))
  );

  server.registerTool(
    "chrypck_execute",
    {
      title: "Execute Governed Change",
      description: "Mutate a READY normal-plan run with objective-sufficient semantic coverage using typed bounded authoring_intent or explicit architecture approval. Effect / Runtime Atlas, Contract Map and analysis lineage inform but never widen execution authority. ChryPck performs runtime/contract-aware propagation, validation and atomic publication.",
      inputSchema: executeSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async input => toolBoundary("chrypck_execute", input, () => nativeService.execute(input))
  );

  server.registerTool(
    "chrypck_result",
    {
      title: "Read Governed Result",
      description: "Read authoritative bounded run state. Normal plans expose deterministic evidence; Trace and Dataflow Slice runs retain their artifacts/certificates; execution results include propagation, validation targets, telemetry and publication state.",
      inputSchema: z.object({ run_id: z.string().min(1).describe("Run identifier previously issued by chrypck_plan."), response_mode: z.enum(["compact", "full"]).default("compact").describe("Compact omits persisted heavyweight artifacts and returns task state, evidence handles and next action.") }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async input => toolBoundary("chrypck_result", input, () => nativeService.result(input))
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
    maxRepositoryFiles: config.maxRepositoryFiles,
    snapshotCache: createRepositorySnapshotCache(env)
  });
  const projectProfiles = createBuiltinProjectProfileRegistry();
  const blobToken = String(env.BLOB_READ_WRITE_TOKEN ?? "").trim();
  const nativeService = new NativeMcpService(repositoryAdapter, {
    allowedRepositories: config.allowedRepositories,
    defaultTargetRef: config.defaultTargetRef,
    maxMutationFileBytes: config.maxMutationFileBytes,
    semanticMaxRegions: config.semanticMaxRegions,
    semanticRegionsPerChunk: config.semanticRegionsPerChunk,
    semanticCacheEntries: config.semanticCacheEntries,
    ...(blobToken ? { semanticAtlasCache: new VercelBlobSemanticAtlasCache(blobToken) } : {}),
    ...(blobToken ? { semanticBootstrapStore: new VercelBlobSemanticBootstrapSessionStore(blobToken) } : {}),
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

export interface McpAccessHeaders { readonly host: string; readonly origin: string; readonly authorization: string; }
export interface McpAccessDenial { readonly status: number; readonly message: string; }

function constantTimeTokenMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function evaluateMcpAccess(headers: McpAccessHeaders, config: ChryPckConfig): McpAccessDenial | null {
  if (config.publicHost) {
    const incoming = headers.host.trim().toLowerCase();
    const hostname = incoming.split(":")[0] ?? incoming;
    if (incoming !== config.publicHost && hostname !== config.publicHost) return { status: 403, message: "Host is not allowed." };
  }
  const origin = headers.origin.trim();
  if (origin && config.allowedOrigins.size > 0 && !config.allowedOrigins.has(origin)) return { status: 403, message: "Origin is not allowed." };
  if (config.mcpBearerToken) {
    const expected = `Bearer ${config.mcpBearerToken}`;
    if (!constantTimeTokenMatch(headers.authorization, expected)) return { status: 401, message: "Bearer authorization is required." };
  }
  return null;
}

export function buildHealthPayload(runtime: ChryPckServiceRuntime) {
  return {
    ok: true,
    service: "chrypck",
    version: "1.0.0",
    execution: "native",
    repository_visibility: "structural-atlas-plus-semantic-atlas-plus-diagnostic-projection-plus-certified-context",
    semantic_bootstrap: "host-llm-lazy-objective-local-expansion-compatible-field-name",
    trace_engine: "bounded-evidence-backed-beft-canonical-trace",
    trace_plan_handoff: "certified-analysis-lineage",
    user_handle: userHandle,
    common_repos: commonRepos,
    project_profiles: runtime.projectProfiles.list().map(profile => profile.id)
  };
}
