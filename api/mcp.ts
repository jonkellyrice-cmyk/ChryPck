import { createMcpHandler } from "mcp-handler";
import {
  evaluateMcpAccess,
  getChryPckServiceRuntime,
  registerChryPckTools
} from "../src/mcp/http-runtime.js";

const handler = createMcpHandler(
  server => {
    const runtime = getChryPckServiceRuntime();
    registerChryPckTools(server, runtime.nativeService);
  },
  {
    serverInfo: { name: "chrypck", version: "1.0.0" }
  }
);

function serverError(error: unknown): Response {
  return Response.json(
    { error: error instanceof Error ? error.message : "ChryPck MCP initialization failed." },
    { status: 500 }
  );
}

async function vercelMcpHandler(request: Request): Promise<Response> {
  try {
    const runtime = getChryPckServiceRuntime();
    const denial = evaluateMcpAccess(
      {
        host: request.headers.get("host") ?? new URL(request.url).host,
        origin: request.headers.get("origin") ?? "",
        authorization: request.headers.get("authorization") ?? ""
      },
      runtime.config
    );
    if (denial) return Response.json({ error: denial.message }, { status: denial.status });
    return await handler(request);
  } catch (error) {
    return serverError(error);
  }
}

export { vercelMcpHandler as GET, vercelMcpHandler as POST, vercelMcpHandler as DELETE };
