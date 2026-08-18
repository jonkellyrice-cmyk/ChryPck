export class GitHubApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly method: string,
    public readonly apiPath: string,
    message: string
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

interface GitHubContentFile {
  type: "file";
  sha: string;
  size: number;
  content?: string;
  encoding?: string;
}

interface GitHubContentWriteResponse {
  content: { sha: string } | null;
  commit: { sha: string };
}

export interface CommitStatus {
  context: string;
  state: "error" | "failure" | "pending" | "success" | string;
  description?: string | null;
  target_url?: string | null;
}

export interface CombinedStatus {
  state: string;
  sha: string;
  total_count: number;
  statuses: CommitStatus[];
}

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  run_number: number;
  created_at: string;
  updated_at: string;
  head_sha: string;
}

export interface WorkflowJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

function encodeRepository(repository: string): string {
  return repository.split("/").map(encodeURIComponent).join("/");
}

function encodeContentPath(repositoryPath: string): string {
  return repositoryPath.split("/").map(encodeURIComponent).join("/");
}

export class GitHubClient {
  private readonly baseUrl = "https://api.github.com";

  constructor(
    private readonly token: string,
    private readonly apiVersion: string
  ) {}

  private async response(apiPath: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Accept", headers.get("Accept") ?? "application/vnd.github+json");
    headers.set("Authorization", `Bearer ${this.token}`);
    headers.set("X-GitHub-Api-Version", this.apiVersion);
    headers.set("User-Agent", "small-mcp/0.1");
    if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    const response = await fetch(`${this.baseUrl}${apiPath}`, { ...init, headers, redirect: "follow" });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new GitHubApiError(
        response.status,
        String(init.method ?? "GET").toUpperCase(),
        apiPath,
        body.slice(0, 1000) || `${response.status} ${response.statusText}`
      );
    }
    return response;
  }

  private async json<T>(apiPath: string, init: RequestInit = {}): Promise<T> {
    const response = await this.response(apiPath, init);
    return await response.json() as T;
  }

  async getTextFile(repository: string, repositoryPath: string, ref?: string): Promise<{ sha: string; size: number; text: string } | null> {
    const repo = encodeRepository(repository);
    const filePath = encodeContentPath(repositoryPath);
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    try {
      const file = await this.json<GitHubContentFile>(`/repos/${repo}/contents/${filePath}${query}`);
      if (file.type !== "file" || typeof file.sha !== "string") {
        throw new Error(`GitHub contents response for ${repositoryPath} was not a file.`);
      }
      const encoded = String(file.content ?? "").replace(/\s/g, "");
      const text = file.encoding === "base64" || encoded
        ? Buffer.from(encoded, "base64").toString("utf8")
        : "";
      return { sha: file.sha, size: Number(file.size ?? Buffer.byteLength(text)), text };
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) return null;
      throw error;
    }
  }

  async upsertTextFile(
    repository: string,
    repositoryPath: string,
    text: string,
    message: string
  ): Promise<{ commitSha: string | null; contentSha: string | null; unchanged: boolean }> {
    const existing = await this.getTextFile(repository, repositoryPath);
    if (existing?.text === text) {
      return { commitSha: null, contentSha: existing.sha, unchanged: true };
    }

    const body: Record<string, unknown> = {
      message,
      content: Buffer.from(text, "utf8").toString("base64")
    };
    if (existing?.sha) body.sha = existing.sha;

    const repo = encodeRepository(repository);
    const filePath = encodeContentPath(repositoryPath);
    const written = await this.json<GitHubContentWriteResponse>(`/repos/${repo}/contents/${filePath}`, {
      method: "PUT",
      body: JSON.stringify(body)
    });
    return {
      commitSha: written.commit.sha,
      contentSha: written.content?.sha ?? null,
      unchanged: false
    };
  }

  async getCombinedStatus(repository: string, ref: string): Promise<CombinedStatus> {
    const repo = encodeRepository(repository);
    return await this.json<CombinedStatus>(`/repos/${repo}/commits/${encodeURIComponent(ref)}/status`);
  }

  async listWorkflowRunsForCommit(repository: string, headSha: string): Promise<WorkflowRun[]> {
    const repo = encodeRepository(repository);
    const query = new URLSearchParams({ head_sha: headSha, per_page: "30" });
    const payload = await this.json<{ workflow_runs?: WorkflowRun[] }>(`/repos/${repo}/actions/runs?${query}`);
    return payload.workflow_runs ?? [];
  }

  async listWorkflowJobs(repository: string, runId: number): Promise<WorkflowJob[]> {
    const repo = encodeRepository(repository);
    const payload = await this.json<{ jobs?: WorkflowJob[] }>(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
    return payload.jobs ?? [];
  }

  async getWorkflowJobLog(repository: string, jobId: number, maxCharacters: number): Promise<string> {
    const repo = encodeRepository(repository);
    const response = await this.response(`/repos/${repo}/actions/jobs/${jobId}/logs`, {
      headers: { Accept: "text/plain" }
    });
    const text = await response.text();
    return text.length > maxCharacters ? text.slice(-maxCharacters) : text;
  }
}
