import { normalizeRepositoryPath, repositoryExtension } from "./source-profile.js";

export const MODULE_RESOLUTION_EXTENSIONS = [
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts",
  ".json", ".css", ".scss", ".html", ".hbs", ".handlebars"
] as const;

function dirname(repositoryPath: string): string {
  const normalized = normalizeRepositoryPath(repositoryPath);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function joinRepositoryPath(base: string, child: string): string {
  return normalizeRepositoryPath(base ? `${base}/${child}` : child);
}

export interface ImportResolution {
  readonly specifier: string;
  readonly resolvedPath: string | null;
  readonly external: boolean;
  readonly candidates: readonly string[];
}

export function candidateImportPaths(sourcePath: string, specifier: string): string[] {
  const raw = String(specifier ?? "").trim().split("#", 1)[0]?.split("?", 1)[0] ?? "";
  if (!raw || !raw.startsWith(".")) return [];
  const base = joinRepositoryPath(dirname(sourcePath), raw);
  if (!base) return [];
  if (repositoryExtension(base)) return [base];
  return [
    ...MODULE_RESOLUTION_EXTENSIONS.map(extension => `${base}${extension}`),
    ...MODULE_RESOLUTION_EXTENSIONS.map(extension => `${base}/index${extension}`)
  ];
}

export function resolveImportPath(sourcePath: string, specifier: string, repositoryPaths: ReadonlySet<string>): ImportResolution {
  const trimmed = String(specifier ?? "").trim();
  if (!trimmed) return { specifier: trimmed, resolvedPath: null, external: false, candidates: [] };
  if (!trimmed.startsWith(".")) {
    const normalized = trimmed.startsWith("/") ? normalizeRepositoryPath(trimmed) : "";
    if (normalized && repositoryPaths.has(normalized)) {
      return { specifier: trimmed, resolvedPath: normalized, external: false, candidates: [normalized] };
    }
    return { specifier: trimmed, resolvedPath: null, external: true, candidates: [] };
  }
  const candidates = candidateImportPaths(sourcePath, trimmed);
  return {
    specifier: trimmed,
    resolvedPath: candidates.find(candidate => repositoryPaths.has(candidate)) ?? null,
    external: false,
    candidates
  };
}
