export const DEFAULT_SOURCE_EXTENSIONS = [
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts",
  ".css", ".scss", ".html", ".hbs", ".handlebars", ".json"
] as const;

export const DEFAULT_IGNORED_DIRECTORIES = [
  ".git", ".github", ".next", ".pytest_cache", "__pycache__", "node_modules",
  "dist", "build", "coverage", "backups", "patch-history"
] as const;

export const DEFAULT_RUNTIME_MANIFESTS = ["module.json", "system.json"] as const;

export interface RepositorySourceProfile {
  readonly sourceExtensions: ReadonlySet<string>;
  readonly ignoredDirectories: ReadonlySet<string>;
  readonly ignoredFiles: ReadonlySet<string>;
  readonly runtimeManifests: ReadonlySet<string>;
  readonly sourceRoots: readonly string[];
}

export interface RepositorySourceProfileInput {
  sourceExtensions?: readonly string[];
  ignoredDirectories?: readonly string[];
  ignoredFiles?: readonly string[];
  runtimeManifests?: readonly string[];
  sourceRoots?: readonly string[];
}

function normalizedSet(values: readonly string[]): ReadonlySet<string> {
  return new Set(values.map(value => value.trim().toLowerCase()).filter(Boolean));
}

export function createRepositorySourceProfile(input: RepositorySourceProfileInput = {}): RepositorySourceProfile {
  return Object.freeze({
    sourceExtensions: normalizedSet(input.sourceExtensions ?? DEFAULT_SOURCE_EXTENSIONS),
    ignoredDirectories: normalizedSet(input.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES),
    ignoredFiles: normalizedSet(input.ignoredFiles ?? []),
    runtimeManifests: normalizedSet(input.runtimeManifests ?? DEFAULT_RUNTIME_MANIFESTS),
    sourceRoots: Object.freeze([...(input.sourceRoots ?? [])].map(value => normalizeRepositoryPath(value)).filter(Boolean))
  });
}

export function normalizeRepositoryPath(value: string): string {
  const raw = String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return "";
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

export function repositoryExtension(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index).toLowerCase() : "";
}

export function isProfileSourcePath(profile: RepositorySourceProfile, repositoryPath: string): boolean {
  const normalized = normalizeRepositoryPath(repositoryPath);
  if (!normalized) return false;
  const parts = normalized.split("/");
  if (parts.some(part => profile.ignoredDirectories.has(part.toLowerCase()))) return false;
  const fileName = parts.at(-1)?.toLowerCase() ?? "";
  if (profile.ignoredFiles.has(fileName)) return false;
  if (profile.sourceRoots.length > 0 && !profile.sourceRoots.some(root => normalized === root || normalized.startsWith(`${root}/`))) {
    return false;
  }
  if (profile.runtimeManifests.has(fileName)) return true;
  return profile.sourceExtensions.has(repositoryExtension(normalized));
}
