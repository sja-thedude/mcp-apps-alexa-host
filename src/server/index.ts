import { createMcpHandler, type McpHttpHandler } from "@modelcontextprotocol/server";
import { createDemoServer } from "./mcp";

interface Env {
  ASSETS: Fetcher;
}

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, authorization, mcp-session-id, mcp-protocol-version, mcp-method, mcp-name, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};

let mcp: McpHttpHandler | undefined;

/** Serves the demo MCP server at /mcp and the host app everywhere else. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      mcp ??= createMcpHandler(() => createDemoServer());
      const res = await mcp.fetch(request);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
