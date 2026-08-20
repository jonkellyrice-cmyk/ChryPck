import { getChryPckGovernedConnectorManifest } from "../src/mcp/connector-manifest.js";

export function GET(): Response {
  return Response.json(getChryPckGovernedConnectorManifest(), {
    status: 200,
    headers: {
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
