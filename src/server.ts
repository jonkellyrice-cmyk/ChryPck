import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";

import { loadConfig } from "./config.js";
import { GitHubApiError, GitHubClient, type CommitStatus, type WorkflowJob, type WorkflowRun } from "./github.js";
import {
  ABSTRACTION_VIOLATION,
  GuardError,
  SourceGrantStore,
  assertAllowedRepository,
  extractFailureEvidence,
  extractGrantedPathsFromLog,
  normalizeRepositoryPath,
  validateToolchainRequest
} from "./policy.js";

const config = loadConfig();
const github = new GitHubClient(config.githubToken, config.githubApiVersion);
const sourceGrants = new SourceGrantStore(config.grantTtlMs);

function jsonToolResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {})
  };
}

function normalizeError(error: unknown): Record<string, unknown> {
  if (error instanceof GuardError) {
    return { code: error.code, message: error.message, ...error.details };
  }
  if (error instanceof GitHubApiError) {
    return {
      code: "GITHUB_API_ERROR",
      status: error.status,
      method: error.method,
      apiPath: error.apiPath,
      message: error.message
    };
  }
  return {
    code: "SMALL_MCP_ERROR",
    message: error instanceof Error ? error.message : String(error)
  };
}

async function toolBoundary<T>(operation: () => Promise<T>) {
  try {
    return jsonToolResult(await operation());
  } catch (error) {
    return jsonToolResult(normalizeError(error), true);
  }
}

function terminalState(statuses: readonly CommitStatus[]): "pending" | "success" | "failure" {
  const latest = new Map(statuses.map(status => [status.context, status.state]));
  const required = config.requiredStatusContexts.map(context => latest.get(context));
  if (required.some(state => state === "failure" || state === "error")) return "failure";
  if (required.every(state => state === "success")) return "success";
  return "pending";
}

function newestConfiguredWorkflow(runs: readonly WorkflowRun[]): WorkflowRun | null {
  const candidates = runs
    .filter(run => run.name === config.workflowName)
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  return candidates[0] ?? null;
}

async function collectRunEvidence(
  repository: string,
  requestCommitSha: string,
  run: WorkflowRun | null,
  state: "pending" | "success" | "failure"
) {
  if (!run) {
    return { jobs: [] as WorkflowJob[], grantedPaths: [] as string[], failureEvidence: [] as unknown[], grant: null };
  }

  const jobs = await github.listWorkflowJobs(repository, run.id);
  const completedJobs = jobs.filter(job => job.status === "completed").slice(0, 12);
  const grantedPaths = new Set<string>();
  const failureEvidence: Array<{ jobId: number; jobName: string; conclusion: string | null; lines: string[] }> = [];
  const evidenceJobs: number[] = [];

  for (const job of completedJobs) {
    const log = await github.getWorkflowJobLog(repository, job.id, config.maxJobLogCharacters);
    const paths = extractGrantedPathsFromLog(log);
    if (paths.length > 0) {
      evidenceJobs.push(job.id);
      for (const grantedPath of paths) grantedPaths.add(grantedPath);
    }

    if (state === "failure" && (job.conclusion === "failure" || job.conclusion === "cancelled" || job.conclusion === "timed_out")) {
      const lines = extractFailureEvidence(log);
      if (lines.length > 0) {
        failureEvidence.push({ jobId: job.id, jobName: job.name, conclusion: job.conclusion, lines });
      }
    }
  }

  const paths = [...grantedPaths].sort();
  const evidence = `workflow-run:${run.id}${evidenceJobs.length ? `;jobs:${evidenceJobs.join(",")}` : ""}`;
  const grant = sourceGrants.issue(repository, requestCommitSha, paths, evidence);
  return { jobs, grantedPaths: paths, failureEvidence, grant };
}

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "small-mcp", version: "0.1.0" });

  server.registerTool(
    "toolchain_submit_request",
    {
      title: "Submit Toolchain Request",
      description:
        "Submit a planning-only schema-v2 request to the repository's one configured toolchain request path. " +
        "This is Small MCP's only GitHub write capability. The request must contain a Scope Lock and operations must be exactly [].",
      inputSchema: z.object({
        repository: z.string().min(3),
        request: z.record(z.string(), z.unknown()),
        commit_message: z.string().trim().min(1).max(160).optional()
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ repository, request, commit_message }) => toolBoundary(async () => {
      const allowedRepository = assertAllowedRepository(repository, config.allowedRepositories);
      const validated = validateToolchainRequest(request);
      const serialized = `${JSON.stringify(validated, null, 2)}\n`;
      const result = await github.upsertTextFile(
        allowedRepository,
        config.requestPath,
        serialized,
        commit_message ?? `Stage governed toolchain request: ${validated.id}`
      );
      sourceGrants.invalidateRepository(allowedRepository);
      return {
        state: result.unchanged ? "UNCHANGED" : "SUBMITTED",
        repository: allowedRepository,
        request_path: config.requestPath,
        request_id: validated.id,
        request_commit_sha: result.commitSha,
        content_sha: result.contentSha,
        mutation_authority: "repository-toolchain",
        direct_source_mutation_permitted: false
      };
    })
  );

  server.registerTool(
    "toolchain_inspect_run",
    {
      title: "Inspect Toolchain Run",
      description:
        "Inspect canonical status/workflow evidence for one exact request commit. " +
        "Returns bounded failure evidence and derives server-side source grants from toolchain output; it never returns unrestricted raw job logs.",
      inputSchema: z.object({
        repository: z.string().min(3),
        request_commit_sha: z.string().regex(/^[0-9a-f]{40,64}$/i)
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ repository, request_commit_sha }) => toolBoundary(async () => {
      const allowedRepository = assertAllowedRepository(repository, config.allowedRepositories);
      const combined = await github.getCombinedStatus(allowedRepository, request_commit_sha);
      const state = terminalState(combined.statuses);
      const runs = await github.listWorkflowRunsForCommit(allowedRepository, request_commit_sha);
      const run = newestConfiguredWorkflow(runs);
      const evidence = await collectRunEvidence(allowedRepository, request_commit_sha, run, state);

      return {
        state: state.toUpperCase(),
        terminal: state !== "pending",
        repository: allowedRepository,
        request_commit_sha,
        required_status_contexts: config.requiredStatusContexts,
        statuses: combined.statuses.map(status => ({
          context: status.context,
          state: status.state,
          description: status.description ?? null,
          target_url: status.target_url ?? null
        })),
        workflow: run
          ? { id: run.id, name: run.name, status: run.status, conclusion: run.conclusion, url: run.html_url }
          : null,
        failure_evidence: evidence.failureEvidence,
        source_access_grant: evidence.grant
          ? {
              paths: evidence.grantedPaths,
              evidence: evidence.grant.evidence,
              expires_at: new Date(evidence.grant.expiresAt).toISOString()
            }
          : null,
        permitted_next_action:
          state === "failure"
            ? "revise_request_from_failure_evidence"
            : state === "success" && evidence.grantedPaths.length > 0
              ? "read_only_explicitly_granted_source_if_needed"
              : state === "success"
                ? "terminal_stop"
                : "inspect_same_request_commit_again"
      };
    })
  );

  server.registerTool(
    "toolchain_read_granted_file",
    {
      title: "Read Granted Source File",
      description:
        "Read one exact file at one exact request commit SHA only after toolchain_inspect_run derived a still-valid grant for that path. " +
        "There is no repository search, directory listing, guessed path access, or moving-ref read.",
      inputSchema: z.object({
        repository: z.string().min(3),
        request_commit_sha: z.string().regex(/^[0-9a-f]{40,64}$/i),
        path: z.string().min(1)
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ repository, request_commit_sha, path }) => toolBoundary(async () => {
      const allowedRepository = assertAllowedRepository(repository, config.allowedRepositories);
      const repositoryPath = normalizeRepositoryPath(path);
      const grant = sourceGrants.require(allowedRepository, request_commit_sha, repositoryPath);
      const file = await github.getTextFile(allowedRepository, repositoryPath, request_commit_sha);
      if (!file) {
        throw new GuardError("ABSTRACTION_GAP", "Granted path does not exist at the granted request commit.", {
          repository: allowedRepository,
          requestCommitSha: request_commit_sha,
          path: repositoryPath
        });
      }
      if (file.size > config.maxGrantedFileBytes) {
        throw new GuardError(ABSTRACTION_VIOLATION, "Granted file exceeds the configured read-size ceiling.", {
          path: repositoryPath,
          size: file.size,
          maxBytes: config.maxGrantedFileBytes
        });
      }
      return {
        state: "ALLOW",
        repository: allowedRepository,
        request_commit_sha,
        path: repositoryPath,
        evidence: grant.evidence,
        content_sha: file.sha,
        content: file.text
      };
    })
  );

  return server;
}

const handler = createMcpHandler(buildMcpServer, { responseMode: "json" });
const nodeHandler = toNodeHandler(handler);

function constantTimeTokenMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function reject(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: message }));
}

function authorizeHttp(req: IncomingMessage, res: ServerResponse): boolean {
  if (config.publicHost) {
    const incomingHost = String(req.headers.host ?? "").toLowerCase();
    const hostname = incomingHost.split(":")[0] ?? incomingHost;
    if (incomingHost !== config.publicHost && hostname !== config.publicHost) {
      reject(res, 403, "Host is not allowed.");
      return false;
    }
  }

  const origin = String(req.headers.origin ?? "").trim();
  if (origin && config.allowedOrigins.size > 0 && !config.allowedOrigins.has(origin)) {
    reject(res, 403, "Origin is not allowed.");
    return false;
  }

  if (config.mcpBearerToken) {
    const authorization = String(req.headers.authorization ?? "");
    const expected = `Bearer ${config.mcpBearerToken}`;
    if (!constantTimeTokenMatch(authorization, expected)) {
      reject(res, 401, "Bearer authorization is required.");
      return false;
    }
  }
  return true;
}

const httpServer = createServer((req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (requestUrl.pathname === "/healthz" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "small-mcp", version: "0.1.0" }));
    return;
  }

  if (requestUrl.pathname !== "/mcp") {
    reject(res, 404, "Not found.");
    return;
  }

  if (!authorizeHttp(req, res)) return;
  void nodeHandler(req, res);
});

httpServer.listen(config.port, config.host, () => {
  console.error(`Small MCP listening on http://${config.host}:${config.port}/mcp`);
  if (!config.mcpBearerToken && config.host !== "127.0.0.1" && config.host !== "localhost" && config.host !== "::1") {
    console.error("WARNING: MCP_BEARER_TOKEN is not configured on a non-loopback bind. Put an authenticated proxy/OAuth layer in front before production use.");
  }
});

async function shutdown(signal: string) {
  console.error(`Small MCP received ${signal}; shutting down.`);
  await handler.close();
  httpServer.close(() => process.exit(0));
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
