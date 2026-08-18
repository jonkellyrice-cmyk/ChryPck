import { buildHealthPayload, getChryPckMcpRuntime } from "../src/mcp/http-runtime.js";

export default {
  fetch(): Response {
    try {
      return Response.json(buildHealthPayload(getChryPckMcpRuntime()));
    } catch (error) {
      return Response.json(
        { ok: false, error: error instanceof Error ? error.message : "ChryPck initialization failed." },
        { status: 500 }
      );
    }
  }
};
