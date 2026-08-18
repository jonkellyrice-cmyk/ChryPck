export interface GitHubRepositoryFileEntry {
  readonly path: string;
  readonly sha: string;
  readonly size: number;
}

export interface GitHubTextFile extends GitHubRepositoryFileEntry {
  readonly text: string;
}

export interface GitHubTransportClient {
  resolveCommit(repository: string, ref: string): Promise<string>;
  listFiles(repository: string, sha: string): Promise<readonly GitHubRepositoryFileEntry[]>;
  readTextFile(repository: string, path: string, sha: string): Promise<GitHubTextFile | null>;
  commitFiles(repository: string, baseSha: string, targetRef: string, message: string, changes: ReadonlyMap<string, string | null>): Promise<{ sha: string }>;
}

export class GitHubTransportError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly apiPath: string,
    message: string
  ) {
    super(message);
    this.name = "GitHubTransportError";
  }
}

interface GitHubCommitResponse { readonly sha: string; readonly tree?: { readonly sha: string }; }
interface GitHubTreeEntry { readonly path?: string; readonly mode?: string; readonly type?: string; readonly sha?: string; readonly size?: number; }
interface GitHubTreeResponse { readonly truncated?: boolean; readonly tree?: readonly GitHubTreeEntry[]; }
interface GitHubContentResponse { readonly type?: string; readonly sha?: string; readonly size?: number; readonly encoding?: string; readonly content?: string; }
interface GitHubBlobResponse { readonly sha: string; }
interface GitHubCreateTreeResponse { readonly sha: string; }
interface GitHubCreateCommitResponse { readonly sha: string; }

function encodeRepository(repository: string): string {
  return repository.split("/").map(encodeURIComponent).join("/");
}

function encodeRepositoryPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function branchName(targetRef: string): string {
  const raw = targetRef.trim();
  if (!raw || raw === "HEAD") throw new Error("Publishing requires an explicit branch ref; HEAD is not mutable authority.");
  if (raw.startsWith("refs/heads/")) return raw.slice("refs/heads/".length);
  if (raw.startsWith("heads/")) return raw.slice("heads/".length);
  if (raw.startsWith("refs/") || raw.startsWith("tags/")) throw new Error(`Publishing only supports branch refs: ${raw}`);
  return raw;
}

export class GitHubRestTransport implements GitHubTransportClient {
  private readonly baseUrl = "https://api.github.com";

  constructor(
    private readonly token: string,
    private readonly apiVersion: string,
    private readonly userAgent = "chrypck/0.1"
  ) {}

  private async response(apiPath: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Accept", headers.get("Accept") ?? "application/vnd.github+json");
    headers.set("Authorization", `Bearer ${this.token}`);
    headers.set("X-GitHub-Api-Version", this.apiVersion);
    headers.set("User-Agent", this.userAgent);
    if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(`${this.baseUrl}${apiPath}`, { ...init, headers, redirect: "follow" });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new GitHubTransportError(response.status, String(init.method ?? "GET").toUpperCase(), apiPath, body.slice(0, 1200) || `${response.status} ${response.statusText}`);
    }
    return response;
  }

  private async json<T>(apiPath: string, init: RequestInit = {}): Promise<T> {
    return await (await this.response(apiPath, init)).json() as T;
  }

  async resolveCommit(repository: string, ref: string): Promise<string> {
    const repo = encodeRepository(repository);
    const commit = await this.json<GitHubCommitResponse>(`/repos/${repo}/commits/${encodeURIComponent(ref)}`);
    if (!commit.sha) throw new Error(`GitHub did not return a commit SHA for ${repository}@${ref}.`);
    return commit.sha;
  }

  async listFiles(repository: string, sha: string): Promise<readonly GitHubRepositoryFileEntry[]> {
    const repo = encodeRepository(repository);
    const payload = await this.json<GitHubTreeResponse>(`/repos/${repo}/git/trees/${encodeURIComponent(sha)}?recursive=1`);
    if (payload.truncated) throw new Error(`GitHub recursive tree was truncated for ${repository}@${sha}; refusing an incomplete snapshot.`);
    return Object.freeze((payload.tree ?? [])
      .filter(entry => entry.type === "blob" && typeof entry.path === "string" && typeof entry.sha === "string")
      .map(entry => Object.freeze({ path: entry.path!, sha: entry.sha!, size: Number(entry.size ?? 0) }))
      .sort((left, right) => left.path.localeCompare(right.path)));
  }

  async readTextFile(repository: string, path: string, sha: string): Promise<GitHubTextFile | null> {
    const repo = encodeRepository(repository), filePath = encodeRepositoryPath(path);
    try {
      const file = await this.json<GitHubContentResponse>(`/repos/${repo}/contents/${filePath}?ref=${encodeURIComponent(sha)}`);
      if (file.type !== "file" || !file.sha) return null;
      const encoded = String(file.content ?? "").replace(/\s/g, "");
      const text = file.encoding === "base64" || encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
      return Object.freeze({ path, sha: file.sha, size: Number(file.size ?? Buffer.byteLength(text, "utf8")), text });
    } catch (error) {
      if (error instanceof GitHubTransportError && error.status === 404) return null;
      throw error;
    }
  }

  async commitFiles(repository: string, baseSha: string, targetRef: string, message: string, changes: ReadonlyMap<string, string | null>): Promise<{ sha: string }> {
    if (changes.size === 0) throw new Error("GitHub publication requires at least one changed path.");
    const branch = branchName(targetRef), current = await this.resolveCommit(repository, branch);
    if (current !== baseSha) throw new Error(`GitHub branch moved before publication. Expected ${baseSha}, found ${current}.`);
    const repo = encodeRepository(repository);
    const baseCommit = await this.json<GitHubCommitResponse>(`/repos/${repo}/git/commits/${encodeURIComponent(baseSha)}`);
    const baseTree = baseCommit.tree?.sha;
    if (!baseTree) throw new Error(`GitHub base commit ${baseSha} did not expose a tree SHA.`);

    const tree: Array<{ path: string; mode: "100644"; type: "blob"; sha: string | null }> = [];
    for (const [path, content] of [...changes].sort(([a], [b]) => a.localeCompare(b))) {
      if (content === null) {
        tree.push({ path, mode: "100644", type: "blob", sha: null });
        continue;
      }
      const blob = await this.json<GitHubBlobResponse>(`/repos/${repo}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content, encoding: "utf-8" })
      });
      tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    }

    const nextTree = await this.json<GitHubCreateTreeResponse>(`/repos/${repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTree, tree })
    });
    const commit = await this.json<GitHubCreateCommitResponse>(`/repos/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message, tree: nextTree.sha, parents: [baseSha] })
    });
    await this.response(`/repos/${repo}/git/refs/heads/${encodeRepositoryPath(branch)}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false })
    });
    return Object.freeze({ sha: commit.sha });
  }
}
