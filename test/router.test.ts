import { describe, expect, it } from "vitest";
import { extractArguments, keywordRouter, scoreTool } from "../src/host/lib/router";
import type { HostTool } from "../src/host/lib/mcpHost";

const forecast: HostTool = {
  name: "get_forecast",
  title: "Get Forecast",
  description: "Show a weather-style forecast for a city.",
  modelVisible: true,
  inputSchema: { properties: { city: { type: "string" }, days: { type: "integer" } }, required: ["city"] },
};
const checklist: HostTool = {
  name: "create_checklist",
  title: "Create Checklist",
  description: "Create an interactive checklist the user can tick off.",
  modelVisible: true,
  inputSchema: { properties: { title: { type: "string" }, items: { type: "array" } }, required: ["title"] },
};
const hidden: HostTool = { ...checklist, name: "update_checklist", title: "Update Checklist", modelVisible: false };
const tools = [forecast, checklist, hidden];

describe("keyword router", () => {
  it("matches everyday words to tool vocabulary", () => {
    expect(scoreTool("what's the weather like", forecast)).toBeGreaterThan(scoreTool("what's the weather like", checklist));
  });

  it("routes and extracts schema arguments", async () => {
    expect(await keywordRouter("Alexa, what's the weather in New York for 3 days?", tools)).toMatchObject({
      tool: { name: "get_forecast" },
      arguments: { city: "New York", days: 3 },
    });
    expect(await keywordRouter("Make a packing checklist for Seattle with rain jacket, umbrella and charger", tools)).toMatchObject({
      tool: { name: "create_checklist" },
      arguments: { title: "Seattle", items: ["rain jacket", "umbrella", "charger"] },
    });
  });

  it("never routes to app-only tools and returns null when nothing matches", async () => {
    expect(await keywordRouter("update checklist", [hidden])).toBeNull();
    expect(await keywordRouter("sing me a song", tools)).toBeNull();
  });

  it("falls back to the whole utterance for a required text field", () => {
    expect(extractArguments("checklist groceries", checklist)).toEqual({ title: "checklist groceries" });
  });
});
