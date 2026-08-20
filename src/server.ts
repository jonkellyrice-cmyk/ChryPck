import { createServer, type ServerResponse } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { getChryPckGovernedConnectorManifest } from "./mcp/connector-manifest.js";
import { buildHealthPayload, evaluateMcpAccess, getChryPckMcpRuntime } from "./mcp/http-runtime.js";

const runtime = getChryPckMcpRuntime();
const nodeHandler = toNodeHandler(runtime.handler);

function reject(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: message }));
}

const httpServer = createServer((req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (requestUrl.pathname === "/healthz" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(buildHealthPayload(runtime)));
    return;
  }

  if (requestUrl.pathname === "/connector-manifest" && req.method === "GET") {
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300, stale-while-revalidate=3600"
    });
    res.end(JSON.stringify(getChryPckGovernedConnectorManifest()));
    return;
  }

  if (requestUrl.pathname !== "/mcp") {
    reject(res, 404, "Not found.");
    return;
  }

  const denial = evaluateMcpAccess(
    {
      host: String(req.headers.host ?? ""),
      origin: String(req.headers.origin ?? ""),
      authorization: String(req.headers.authorization ?? "")
    },
    runtime.config
  );

  if (denial) {
    reject(res, denial.status, denial.message);
    return;
  }

  void nodeHandler(req, res);
});

httpServer.listen(runtime.config.port, runtime.config.host, () => {
  console.error(`ChryPck listening on http://${runtime.config.host}:${runtime.config.port}/mcp`);
  if (!runtime.config.mcpBearerToken && !["127.0.0.1", "localhost", "::1"].includes(runtime.config.host)) {
    console.error("WARNING: MCP_BEARER_TOKEN is not configured on a non-loopback bind.");
  }
});

async function shutdown(signal: string) {
  console.error(`ChryPck received ${signal}; shutting down.`);
  await runtime.handler.close();
  httpServer.close(() => process.exit(0));
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
