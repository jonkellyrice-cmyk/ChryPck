import { evaluateMcpAccess, getChryPckMcpRuntime } from "../src/mcp/http-runtime.js";

function serverError(error: unknown): Response {
  return Response.json(
    { error: error instanceof Error ? error.message : "ChryPck MCP initialization failed." },
    { status: 500 }
  );
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const runtime = getChryPckMcpRuntime();
      const denial = evaluateMcpAccess(
        {
          host: request.headers.get("host") ?? new URL(request.url).host,
          origin: request.headers.get("origin") ?? "",
          authorization: request.headers.get("authorization") ?? ""
        },
        runtime.config
      );

      if (denial) {
        return Response.json({ error: denial.message }, { status: denial.status });
      }

      return await runtime.handler.fetch(request);
    } catch (error) {
      return serverError(error);
    }
  }
};
