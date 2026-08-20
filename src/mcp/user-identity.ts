// Simple, user-editable identity and repo preferences used by MCP tooling.
// Later this can be replaced by persistent per-user identity/repository preferences.

export const userHandle = "jonkellyrice-cmyk/";
export const commonRepos: string[] = [
  "Lancer-Frame-Conn"
];

export function resolveRepositorySlug(value: string, configuredHandle = userHandle): string {
  const normalized = value.trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");

  if (/^[^/\s]+\/[^/\s]+$/.test(normalized)) return normalized;

  if (/^[^/\s]+$/.test(normalized)) {
    const owner = configuredHandle.trim().replace(/^\/+|\/+$/g, "");
    if (!owner || owner.includes("/")) {
      throw new Error("Configured ChryPck user handle must contain exactly one GitHub owner name.");
    }
    return `${owner}/${normalized}`;
  }

  throw new Error(`Repository must be a bare repository slug or owner/name: ${value}`);
}
