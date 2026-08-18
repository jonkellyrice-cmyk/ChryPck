export interface ChryPckConfig {
  readonly githubToken: string;
  readonly githubApiVersion: string;
  readonly allowedRepositories: ReadonlySet<string>;
  readonly defaultTargetRef: string;
  readonly host: string;
  readonly port: number;
  readonly publicHost: string | null;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly mcpBearerToken: string | null;
  readonly maxTextFileBytes: number;
  readonly maxRepositoryFiles: number;
  readonly maxMutationFileBytes: number;
}

function requireNonEmpty(env: NodeJS.ProcessEnv, key: string): string {
  const value = String(env[key] ?? "").trim();
  if (!value) throw new Error(`ChryPck requires ${key}.`);
  return value;
}

function csv(value: string | undefined): string[] {
  return String(value ?? "").split(",").map(entry => entry.trim()).filter(Boolean);
}

function positiveInteger(value: string | undefined, fallback: number, key: string): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${key} must be a positive integer.`);
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ChryPckConfig {
  const repositories = csv(env.ALLOWED_REPOSITORIES);
  if (repositories.length === 0) throw new Error("ChryPck requires at least one ALLOWED_REPOSITORIES entry.");
  const defaultTargetRef = String(env.CHRYPCK_DEFAULT_TARGET_REF ?? "").trim() || "main";
  if (defaultTargetRef === "HEAD") throw new Error("CHRYPCK_DEFAULT_TARGET_REF must be an explicit mutable branch name.");
  return Object.freeze({
    githubToken: requireNonEmpty(env, "GITHUB_TOKEN"),
    githubApiVersion: String(env.GITHUB_API_VERSION ?? "2026-03-10").trim(),
    allowedRepositories: new Set(repositories),
    defaultTargetRef,
    host: String(env.HOST ?? "127.0.0.1").trim(),
    port: positiveInteger(env.PORT, 3000, "PORT"),
    publicHost: String(env.MCP_PUBLIC_HOST ?? "").trim().toLowerCase() || null,
    allowedOrigins: new Set(csv(env.MCP_ALLOWED_ORIGINS)),
    mcpBearerToken: String(env.MCP_BEARER_TOKEN ?? "").trim() || null,
    maxTextFileBytes: positiveInteger(env.CHRYPCK_MAX_TEXT_FILE_BYTES, 524288, "CHRYPCK_MAX_TEXT_FILE_BYTES"),
    maxRepositoryFiles: positiveInteger(env.CHRYPCK_MAX_REPOSITORY_FILES, 12000, "CHRYPCK_MAX_REPOSITORY_FILES"),
    maxMutationFileBytes: positiveInteger(env.CHRYPCK_MAX_MUTATION_FILE_BYTES, 1048576, "CHRYPCK_MAX_MUTATION_FILE_BYTES")
  });
}
