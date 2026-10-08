import type { HostTool } from "./mcpHost";

/**
 * Turns an utterance into a tool call, using only what the server publishes
 * in tools/list (names, titles, descriptions and input schemas). No model
 * needed, so the host works offline and with any server.
 *
 * To use an LLM instead, implement `Router` and pass it to the app: give the
 * model the tool list and ask for `{ "tool": name, "arguments": {...} }`.
 */
export type Router = (utterance: string, tools: HostTool[]) => Promise<Route | null> | Route | null;

export interface Route {
  tool: HostTool;
  arguments: Record<string, unknown>;
  score: number;
}

const STOP = new Set(
  "a an the and or of to for in on at with my me i you your please can could would will show give get make tell use when user asks about this that what is are be it from".split(" "),
);
/** Everyday words people say, mapped to words tools tend to use. */
const SYNONYMS: Record<string, string[]> = {
  weather: ["forecast"],
  temperature: ["forecast"],
  rain: ["forecast"],
  todo: ["checklist", "list"],
  list: ["checklist"],
  tasks: ["checklist"],
  remind: ["reminder"],
  find: ["search"],
  look: ["search"],
};

const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "");
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/^alexa[,!\s]*/, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

function toolKeywords(t: HostTool): { strong: Set<string>; weak: Set<string> } {
  const strong = new Set([...words(t.name.replace(/_/g, " ")), ...words(t.title ?? "")].map(stem));
  const weak = new Set(words(t.description ?? "").filter((w) => w.length > 3).map(stem));
  return { strong, weak };
}

export function scoreTool(utterance: string, tool: HostTool): number {
  const { strong, weak } = toolKeywords(tool);
  let score = 0;
  for (const w of words(utterance)) {
    const literal = stem(w);
    const direct = strong.has(literal) ? 3 : weak.has(literal) ? 1 : 0;
    // Synonyms count, but less than the tool's own words, so "rain" can't outvote "checklist".
    const viaSynonym = (SYNONYMS[w] ?? []).map(stem).some((c) => strong.has(c)) ? 2 : 0;
    score += Math.max(direct, viaSynonym);
  }
  return score;
}

const PLACE_FIELD = /^(city|location|place|destination|where|town|country)$/i;
const TEXT_FIELD = /^(title|name|topic|query|question|text|subject|prompt)$/i;
const LIST_FIELD = /^(items|tasks|entries|list)$/i;

/** Extracts arguments for the tool's input schema from the utterance. */
export function extractArguments(utterance: string, tool: HostTool): Record<string, unknown> {
  const props = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  const text = utterance.replace(/^alexa[,!\s]*/i, "").trim();
  const args: Record<string, unknown> = {};

  for (const [name, schema] of Object.entries(props)) {
    const type = schema.type;
    if ((type === "number" || type === "integer") && /\d/.test(text)) {
      const n = text.match(/(\d+)\s*(?:-|\s)?(?:day|days|items|minutes|hours)?/i);
      if (n) args[name] = Number(n[1]);
    } else if (type === "array" && LIST_FIELD.test(name)) {
      const m = text.match(/\bwith\s+(.+)$/i);
      if (m) args[name] = m[1].split(/,\s*|\s+and\s+/i).map((s) => s.trim().replace(/[.?!]$/, "")).filter(Boolean);
    } else if (type === "string" && PLACE_FIELD.test(name)) {
      const m = text.match(/\b(?:in|for|at|near|to)\s+([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*)*)/);
      if (m) args[name] = m[1];
    } else if (type === "string" && TEXT_FIELD.test(name)) {
      const m = text.match(/\b(?:for|about|called|named|titled|on)\s+(.+?)(?:\s+with\s+.+)?[.?!]?$/i);
      if (m) args[name] = m[1].trim();
    }
    if (args[name] === undefined && required.has(name) && type === "string") args[name] = text;
  }
  return args;
}

/** The built-in router: best keyword match among model-visible tools. */
export const keywordRouter: Router = (utterance, tools) => {
  let best: Route | null = null;
  for (const tool of tools.filter((t) => t.modelVisible)) {
    const score = scoreTool(utterance, tool);
    if (score >= 2 && (!best || score > best.score)) best = { tool, arguments: {}, score };
  }
  if (best) best.arguments = extractArguments(utterance, best.tool);
  return best;
};
