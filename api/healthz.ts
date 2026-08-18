function configured(name: string): boolean {
  return Boolean(String(process.env[name] ?? "").trim());
}

export function GET(): Response {
  const required = ["GITHUB_TOKEN", "ALLOWED_REPOSITORIES", "MCP_BEARER_TOKEN"];
  const missing = required.filter(name => !configured(name));
  return Response.json(
    {
      ok: missing.length === 0,
      service: "chrypck",
      version: "1.0.0",
      runtime: "vercel-node",
      configuration: missing.length === 0 ? "ready" : "missing",
      missing
    },
    { status: missing.length === 0 ? 200 : 500 }
  );
}
