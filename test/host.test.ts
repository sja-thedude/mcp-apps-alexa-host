import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpHost } from "../src/host/lib/mcpHost";
import { keywordRouter } from "../src/host/lib/router";
import worker from "../src/server/index";

const env = { ASSETS: { fetch: async () => new Response("host") } as unknown as Fetcher };

/** Routes the browser client's fetches into the Worker in-process (a real HTTP round trip, minus the network). */
beforeEach(() => {
  vi.stubGlobal("location", { href: "https://host.test/" });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => worker.fetch(new Request(input, init), env));
});
afterEach(() => vi.unstubAllGlobals());

describe("McpHost against the demo server over Streamable HTTP", () => {
  it("negotiates the 2026-07-28 protocol and discovers tools, views and visibility", async () => {
    const host = new McpHost("/mcp");
    await host.connect();
    expect(host.connected).toBe(true);
    expect(host.protocolVersion).toBe("2026-07-28");
    expect(host.serverInfo?.name).toBe("alexa-host-demo");
    expect(host.tools.map((t) => [t.name, t.modelVisible, t.uiUri])).toEqual([
      ["get_forecast", true, "ui://demo/forecast.html"],
      ["create_checklist", true, "ui://demo/checklist.html"],
      ["update_checklist", false, "ui://demo/checklist.html"],
    ]);
    expect(host.log.map((e) => e.method)).toEqual(expect.arrayContaining(["initialize", "tools/list"]));
  });

  it("calls tools with progress, loads views once, and logs everything", async () => {
    const host = new McpHost("/mcp");
    await host.connect();
    const progress: string[] = [];
    const res = await host.callTool("get_forecast", { city: "Lisbon", days: 2 }, "assistant", (m) => progress.push(m));
    expect((res.structuredContent as { days: unknown[] }).days).toHaveLength(2);
    expect(progress).toEqual(["Looking up Lisbon", "Building the outlook"]);
    const a = await host.readUi("ui://demo/forecast.html");
    const b = await host.readUi("ui://demo/forecast.html");
    expect(a).toBe(b);
    expect(a).toMatch(/^<!doctype html>/i);
    const methods = host.log.map((e) => e.method);
    expect(methods).toContain("notifications/progress");
    expect(host.log.filter((e) => e.method === "resources/read" && e.direction === "request").length).toBeLessThanOrEqual(2);
  });

  it("redacts long arguments in the protocol log", async () => {
    const host = new McpHost("/mcp");
    await host.connect();
    await host.callTool("create_checklist", { title: "x".repeat(500) });
    const entry = host.log.find((e) => e.method === "tools/call" && e.direction === "request");
    expect(JSON.stringify(entry?.detail)).toContain("(500 chars)");
  });

  it("connects lazily when a tool is called first, and only once", async () => {
    const host = new McpHost("/mcp");
    await Promise.all([host.callTool("get_forecast", { city: "Oslo" }), host.connect(), host.connect()]);
    expect(host.log.filter((e) => e.method === "initialize" && e.direction === "request")).toHaveLength(1);
  });

  it("reports unreachable servers and can retry", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const host = new McpHost("https://down.example/mcp");
    await expect(host.connect()).rejects.toThrow();
    expect(host.connected).toBe(false);
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => worker.fetch(new Request(input, init), env));
    await host.connect();
    expect(host.connected).toBe(true);
  });

  it("routes real utterances to the discovered tools end to end", async () => {
    const host = new McpHost("/mcp");
    await host.connect();
    const route = await keywordRouter("What's the forecast in Cape Town for 4 days?", host.tools);
    expect(route?.tool.name).toBe("get_forecast");
    const res = await host.callTool(route!.tool.name, route!.arguments);
    expect(res.structuredContent).toMatchObject({ city: "Cape Town" });
    expect((res.structuredContent as { days: unknown[] }).days).toHaveLength(4);
    expect(await keywordRouter("update checklist please", host.tools)).toMatchObject({ tool: { name: "create_checklist" } });
  });
});

describe("worker edge cases", () => {
  it("rejects requests without the Streamable HTTP Accept header", async () => {
    const res = await worker.fetch(
      new Request("https://x.test/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }),
      env,
    );
    expect(res.status).toBe(406);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("allows the 2026-07-28 per-request headers in CORS", async () => {
    const res = await worker.fetch(new Request("https://x.test/mcp", { method: "OPTIONS" }), env);
    for (const h of ["mcp-method", "mcp-name", "mcp-protocol-version", "mcp-session-id"]) expect(res.headers.get("access-control-allow-headers")).toContain(h);
  });
});
