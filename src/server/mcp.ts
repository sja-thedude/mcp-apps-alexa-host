import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import forecastHtml from "../../dist/views/forecast.html";
import checklistHtml from "../../dist/views/checklist.html";

/**
 * A tiny demo MCP server so the host works out of the box. Each tool shows one
 * MCP Apps capability the host must support:
 *  - get_forecast: tool input → result, progress notifications, a follow-up message from the view
 *  - create_checklist / update_checklist: an interactive view calling an app-only tool,
 *    and model-context updates
 * Replace it with your own server, or point the host at any MCP URL.
 */

export interface Forecast {
  speech: string;
  city: string;
  days: Array<{ date: string; summary: "Sunny" | "Cloudy" | "Rain" | "Windy" | "Snow"; high: number; low: number; rainChance: number }>;
  note: string;
}

export interface Checklist {
  speech: string;
  title: string;
  items: Array<{ text: string; done: boolean }>;
  done: number;
}

const SUMMARIES = ["Sunny", "Cloudy", "Rain", "Windy", "Snow"] as const;

/** Deterministic demo data: the same city always gets the same forecast. */
export function demoForecast(city: string, days: number, start = new Date("2026-10-23T12:00:00Z")): Forecast {
  let seed = [...city.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 1000) / 1000;
  const base = 8 + Math.round(rand() * 20);
  const list = Array.from({ length: days }, (_, i) => {
    const d = new Date(start.getTime() + i * 86_400_000);
    const high = base + Math.round(rand() * 8 - 4);
    const summary = SUMMARIES[Math.floor(rand() * (high < 4 ? 5 : 4))];
    return { date: d.toISOString().slice(0, 10), summary, high, low: high - 5 - Math.round(rand() * 4), rainChance: summary === "Rain" ? 60 + Math.round(rand() * 35) : Math.round(rand() * 30) };
  });
  const today = list[0];
  return {
    speech: `In ${city} it's ${today.summary.toLowerCase()} today with a high of ${today.high} degrees. I've put the ${days}-day outlook on screen.`,
    city,
    days: list,
    note: "Demo data, generated deterministically from the city name.",
  };
}

export function summarizeChecklist(title: string, items: Checklist["items"]): Checklist {
  const done = items.filter((i) => i.done).length;
  const speech =
    items.length === 0
      ? `Your "${title}" checklist is empty.`
      : done === items.length
        ? `All ${items.length} items on "${title}" are done. Nice work!`
        : `"${title}" has ${items.length - done} of ${items.length} items left.`;
  return { speech, title, items, done };
}

function result<T extends { speech: string }>(data: T, resourceUri: string, status: [string, string]): CallToolResult {
  return {
    content: [{ type: "text", text: data.speech }],
    structuredContent: data as unknown as Record<string, unknown>,
    // Result-level UI metadata, as Alexa+ reads it; the tool definition declares it too.
    _meta: { ui: { resourceUri, invoking: status[0], invoked: status[1] } },
  };
}

async function progress(ctx: ServerContext | undefined, step: number, total: number, message: string) {
  const token = ctx?.mcpReq?._meta?.progressToken;
  if (token === undefined || !ctx) return;
  await ctx.mcpReq.notify({ method: "notifications/progress", params: { progressToken: token, progress: step, total, message } }).catch(() => {});
}

function view(server: McpServer, name: string, html: string): string {
  const uri = `ui://demo/${name}.html`;
  registerAppResource(server, `${name} view`, uri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html }],
  }));
  return uri;
}

export function createDemoServer(): McpServer {
  const server = new McpServer(
    { name: "alexa-host-demo", title: "Demo MCP server", version: "0.1.0" },
    { instructions: "Demo tools for mcp-apps-alexa-host: a weather-style forecast card and an interactive checklist." },
  );
  const forecastUri = view(server, "forecast", forecastHtml);
  const checklistUri = view(server, "checklist", checklistHtml);

  registerAppTool(
    server,
    "get_forecast",
    {
      title: "Get Forecast",
      description: "Show a weather-style forecast for a city (deterministic demo data). Use when the user asks about the weather or forecast somewhere.",
      inputSchema: z.object({
        city: z.string().describe("City name, e.g. 'Seattle'."),
        days: z.number().int().min(1).max(7).optional().describe("Number of days (1-7, default 5)."),
      }),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: forecastUri } },
    },
    async ({ city, days }, ctx) => {
      await progress(ctx, 1, 2, `Looking up ${city}`);
      const f = demoForecast(city.trim() || "Seattle", days ?? 5);
      await progress(ctx, 2, 2, "Building the outlook");
      return result(f, forecastUri, ["Checking the forecast…", "Forecast ready"]);
    },
  );

  registerAppTool(
    server,
    "create_checklist",
    {
      title: "Create Checklist",
      description: "Create an interactive checklist the user can tick off on screen. Use when the user wants a list, to-do list or checklist.",
      inputSchema: z.object({
        title: z.string().describe("Checklist title, e.g. 'Packing for Seattle'."),
        items: z.array(z.string()).max(20).optional().describe("Items to start with."),
      }),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: checklistUri } },
    },
    async ({ title, items }) => {
      const start = (items?.length ? items : ["First thing", "Second thing", "Third thing"]).map((text) => ({ text, done: false }));
      return result(summarizeChecklist(title, start), checklistUri, ["Creating your checklist…", "Checklist ready"]);
    },
  );

  registerAppTool(
    server,
    "update_checklist",
    {
      title: "Update Checklist",
      description: "Recalculate a checklist after the user ticks items. Called by the checklist view.",
      inputSchema: z.object({
        title: z.string(),
        items: z.array(z.object({ text: z.string(), done: z.boolean() })).max(50),
      }),
      annotations: { readOnlyHint: true },
      // Callable by the view only; hidden from the model.
      _meta: { ui: { resourceUri: checklistUri, visibility: ["app"] } },
    },
    async ({ title, items }) => result(summarizeChecklist(title, items), checklistUri, ["Updating…", "Updated"]),
  );

  return server;
}
