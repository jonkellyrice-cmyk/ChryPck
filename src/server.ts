import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";

import { loadConfig } from "./config.js";
import { GitHubRestTransport, GitHubTransportError } from "./adapters/github/client.js";
import { GitHubRepositoryAdapter } from "./adapters/github/repository-adapter.js";
import { PolicyError } from "./core/policy/errors.js";
import { NativeMcpService } from "./mcp/service.js";
import { createBuiltinProjectProfileRegistry } from "./project/builtin-profiles.js";

const config = loadConfig();
const transport = new GitHubRestTransport(config.githubToken, config.githubApiVersion);
const repositoryAdapter = new GitHubRepositoryAdapter(transport, { maxTextFileBytes: config.maxTextFileBytes, maxRepositoryFiles: config.maxRepositoryFiles });
const projectProfiles = createBuiltinProjectProfileRegistry();
const nativeService = new NativeMcpService(repositoryAdapter, {
  allowedRepositories: config.allowedRepositories,
  defaultTargetRef: config.defaultTargetRef,
  maxMutationFileBytes: config.maxMutationFileBytes,
  projectProfiles
});

function jsonToolResult(value: unknown, isError = false) { return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) }; }
function normalizeError(error: unknown): Record<string, unknown> {
  if (error instanceof PolicyError) return { code: error.code, message: error.message, ...error.details };
  if (error instanceof GitHubTransportError) return { code: "GITHUB_TRANSPORT_ERROR", status: error.status, method: error.method, apiPath: error.apiPath, message: error.message };
  return { code: "CHRYPCK_ERROR", message: error instanceof Error ? error.message : String(error) };
}
async function toolBoundary<T>(operation: () => Promise<T> | T) { try { return jsonToolResult(await operation()); } catch (error) { return jsonToolResult(normalizeError(error), true); } }

const authoringEditSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_file"), path: z.string().min(1), content: z.string() }),
  z.object({ type: z.literal("replace_file"), path: z.string().min(1), content: z.string() }),
  z.object({ type: z.literal("replace_exact"), path: z.string().min(1), search: z.string().min(1), replace: z.string(), expectedOccurrences: z.number().int().positive().optional() }),
  z.object({ type: z.literal("insert_before_exact"), path: z.string().min(1), anchor: z.string().min(1), content: z.string(), expectedOccurrences: z.number().int().positive().optional() }),
  z.object({ type: z.literal("insert_after_exact"), path: z.string().min(1), anchor: z.string().min(1), content: z.string(), expectedOccurrences: z.number().int().positive().optional() }),
  z.object({ type: z.literal("delete_exact"), path: z.string().min(1), search: z.string().min(1), expectedOccurrences: z.number().int().positive().optional() }),
  z.object({ type: z.literal("remove_file"), path: z.string().min(1) }),
  z.object({ type: z.literal("move_file"), from: z.string().min(1), to: z.string().min(1) })
]);

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "chrypck", version: "0.3.0" });
  server.registerTool("chrypck_plan", { title: "Plan Governed Change", description: "Create a native governed run, resolve its project profile, snapshot the repository, and return certified diagnostics/Patch Corridor evidence.", inputSchema: z.object({ repository: z.string().min(3), objective: z.string().trim().min(1), base_ref: z.string().trim().min(1).optional() }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async input => toolBoundary(() => nativeService.plan(input)));
  server.registerTool("chrypck_context", { title: "Read Certified Context", description: "Return only the certified Context Pack for a READY native run; arbitrary repository paths are not accepted.", inputSchema: z.object({ run_id: z.string().min(1), segment_id: z.string().min(1).optional() }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async input => toolBoundary(() => nativeService.context(input)));
  server.registerTool("chrypck_execute", { title: "Execute Governed Change", description: "Compile typed edits against certified context, apply the run's project profile, stage atomically, validate, and publish through the repository adapter.", inputSchema: z.object({ run_id: z.string().min(1), authoring_intent: z.object({ id: z.string().trim().min(1), objective: z.string().trim().min(1), edits: z.array(authoringEditSchema).min(1) }), commit_message: z.string().trim().min(1).max(200).optional() }), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } }, async input => toolBoundary(() => nativeService.execute(input)));
  server.registerTool("chrypck_result", { title: "Read Governed Result", description: "Return native run state, resolved project profile, bounded artifacts, telemetry, and terminal evidence.", inputSchema: z.object({ run_id: z.string().min(1) }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async input => toolBoundary(() => nativeService.result(input)));
  return server;
}

const handler = createMcpHandler(buildMcpServer, { responseMode: "json" });
const nodeHandler = toNodeHandler(handler);
function constantTimeTokenMatch(actual: string, expected: string): boolean { const actualBuffer = Buffer.from(actual), expectedBuffer = Buffer.from(expected); return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer); }
function reject(res: ServerResponse, status: number, message: string): void { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: message })); }
function authorizeHttp(req: IncomingMessage, res: ServerResponse): boolean {
  if (config.publicHost) { const incomingHost = String(req.headers.host ?? "").toLowerCase(), hostname = incomingHost.split(":")[0] ?? incomingHost; if (incomingHost !== config.publicHost && hostname !== config.publicHost) { reject(res, 403, "Host is not allowed."); return false; } }
  const origin = String(req.headers.origin ?? "").trim(); if (origin && config.allowedOrigins.size > 0 && !config.allowedOrigins.has(origin)) { reject(res, 403, "Origin is not allowed."); return false; }
  if (config.mcpBearerToken) { const authorization = String(req.headers.authorization ?? ""), expected = `Bearer ${config.mcpBearerToken}`; if (!constantTimeTokenMatch(authorization, expected)) { reject(res, 401, "Bearer authorization is required."); return false; } }
  return true;
}
const httpServer = createServer((req, res) => { const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`); if (requestUrl.pathname === "/healthz" && req.method === "GET") { res.writeHead(200, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ ok: true, service: "chrypck", version: "0.3.0", execution: "native", project_profiles: projectProfiles.list().map(profile => profile.id) })); return; } if (requestUrl.pathname !== "/mcp") { reject(res, 404, "Not found."); return; } if (!authorizeHttp(req, res)) return; void nodeHandler(req, res); });
httpServer.listen(config.port, config.host, () => { console.error(`ChryPck listening on http://${config.host}:${config.port}/mcp`); if (!config.mcpBearerToken && config.host !== "127.0.0.1" && config.host !== "localhost" && config.host !== "::1") console.error("WARNING: MCP_BEARER_TOKEN is not configured on a non-loopback bind."); });
async function shutdown(signal: string) { console.error(`ChryPck received ${signal}; shutting down.`); await handler.close(); httpServer.close(() => process.exit(0)); }
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
