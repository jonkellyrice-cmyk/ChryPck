export interface SmallMcpConfig {
  githubToken: string;
  githubApiVersion: string;
  allowedRepositories: ReadonlySet<string>;
  requestPath: string;
  workflowName: string;
  requiredStatusContexts: readonly string[];
  host: string;
  port: number;
  publicHost: string | null;
  allowedOrigins: ReadonlySet<string>;
  mcpBearerToken: string | null;
  grantTtlMs: number;
  maxGrantedFileBytes: number;
  maxJobLogCharacters: number;
}

function requireNonEmpty(env: NodeJS.ProcessEnv, key: string): string {
  const value = String(env[key] ?? "").trim();
  if (!value) throw new Error(`Small MCP requires ${key}.`);
  return value;
}

function csv(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean);
}

function positiveInteger(value: string | undefined, fallback: number, key: string): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SmallMcpConfig {
  const repositories = csv(env.ALLOWED_REPOSITORIES);
  if (repositories.length === 0) {
    throw new Error("Small MCP requires at least one ALLOWED_REPOSITORIES entry.");
  }

  const requiredStatusContexts = csv(env.TOOLCHAIN_REQUIRED_STATUS_CONTEXTS);
  if (requiredStatusContexts.length === 0) {
    throw new Error("Small MCP requires at least one TOOLCHAIN_REQUIRED_STATUS_CONTEXTS entry.");
  }

  const grantTtlSeconds = positiveInteger(env.GRANT_TTL_SECONDS, 3600, "GRANT_TTL_SECONDS");

  return Object.freeze({
    githubToken: requireNonEmpty(env, "GITHUB_TOKEN"),
    githubApiVersion: String(env.GITHUB_API_VERSION ?? "2026-03-10").trim(),
    allowedRepositories: new Set(repositories),
    requestPath: String(env.TOOLCHAIN_REQUEST_PATH ?? "dev_scripts/github-filepatcher.json").trim(),
    workflowName: String(env.TOOLCHAIN_WORKFLOW_NAME ?? "GitHub FilePatcher").trim(),
    requiredStatusContexts: Object.freeze(requiredStatusContexts),
    host: String(env.HOST ?? "127.0.0.1").trim(),
    port: positiveInteger(env.PORT, 3000, "PORT"),
    publicHost: String(env.MCP_PUBLIC_HOST ?? "").trim().toLowerCase() || null,
    allowedOrigins: new Set(csv(env.MCP_ALLOWED_ORIGINS)),
    mcpBearerToken: String(env.MCP_BEARER_TOKEN ?? "").trim() || null,
    grantTtlMs: grantTtlSeconds * 1000,
    maxGrantedFileBytes: positiveInteger(env.MAX_GRANTED_FILE_BYTES, 524288, "MAX_GRANTED_FILE_BYTES"),
    maxJobLogCharacters: positiveInteger(env.MAX_JOB_LOG_CHARACTERS, 2_000_000, "MAX_JOB_LOG_CHARACTERS")
  });
}
