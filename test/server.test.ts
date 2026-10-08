import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { createDemoServer, demoForecast, summarizeChecklist, type Checklist, type Forecast } from "../src/server/mcp";
import worker from "../src/server/index";

async function connect() {
  const [c, s] = InMemoryTransport.createLinkedPair();
  await createDemoServer().connect(s);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(c);
  return client;
}

describe("demo MCP server", () => {
  it("advertises tools with MCP Apps views, one of them app-only", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["get_forecast", "create_checklist", "update_checklist"]);
    const ui = (t: (typeof tools)[number]) => (t._meta as { ui: { resourceUri: string; visibility?: string[] } }).ui;
    expect(ui(tools[0]).resourceUri).toBe("ui://demo/forecast.html");
    expect(ui(tools[2]).visibility).toEqual(["app"]);
    const { resources } = await client.listResources();
    for (const r of resources) {
      const html = ((await client.readResource({ uri: r.uri })).contents[0] as { text: string }).text;
      expect(r.mimeType).toBe("text/html;profile=mcp-app");
      expect(html).toMatch(/^<!doctype html>/i);
    }
  });

  it("returns spoken text, structured content and result-level UI metadata, with progress", async () => {
    const client = await connect();
    const progress: string[] = [];
    const res = await client.callTool({ name: "get_forecast", arguments: { city: "Seattle", days: 3 } }, { onprogress: (p) => progress.push(p.message ?? "") });
    const f = res.structuredContent as unknown as Forecast;
    expect(f.days).toHaveLength(3);
    expect((res.content as Array<{ text: string }>)[0].text).toMatch(/^In Seattle/);
    expect(res._meta).toMatchObject({ ui: { resourceUri: "ui://demo/forecast.html", invoked: "Forecast ready" } });
    expect(progress).toEqual(["Looking up Seattle", "Building the outlook"]);
  });

  it("lets a view update a checklist through the app-only tool", async () => {
    const client = await connect();
    const created = (await client.callTool({ name: "create_checklist", arguments: { title: "Trip", items: ["a", "b"] } })).structuredContent as unknown as Checklist;
    expect(created.done).toBe(0);
    const updated = (await client.callTool({ name: "update_checklist", arguments: { title: "Trip", items: [{ text: "a", done: true }, { text: "b", done: true }] } }))
      .structuredContent as unknown as Checklist;
    expect(updated.done).toBe(2);
    expect(updated.speech).toMatch(/All 2 items/);
  });

  it("is deterministic", () => {
    expect(demoForecast("Lisbon", 5)).toEqual(demoForecast("Lisbon", 5));
    expect(summarizeChecklist("x", []).speech).toMatch(/empty/);
  });
});

describe("worker", () => {
  const env = { ASSETS: { fetch: async () => new Response("host") } as unknown as Fetcher };
  it("serves MCP over Streamable HTTP with CORS for any origin", async () => {
    const res = await worker.fetch(
      new Request("https://x.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.text()).toContain('"protocolVersion":"2025-11-25"');
    expect((await worker.fetch(new Request("https://x.test/mcp", { method: "OPTIONS" }), env)).status).toBe(204);
    expect(await (await worker.fetch(new Request("https://x.test/"), env)).text()).toBe("host");
  });
});
