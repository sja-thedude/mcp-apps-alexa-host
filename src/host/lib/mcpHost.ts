import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";

export interface McpLogEntry {
  id: number;
  at: number;
  direction: "request" | "response" | "error";
  method: string;
  summary: string;
  detail?: unknown;
  ms?: number;
}

export interface HostTool {
  name: string;
  title?: string;
  description?: string;
  uiUri?: string;
  inputSchema?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
  /** False for app-only tools (`_meta.ui.visibility: ["app"]`), which only views may call. */
  modelVisible: boolean;
}

export type CallResult = Awaited<ReturnType<Client["callTool"]>>;

type Listener = () => void;

/**
 * Browser-side MCP host: connects to any MCP server over Streamable HTTP,
 * discovers tools and their UI resources, calls tools, and keeps a protocol log
 * for the inspector panel.
 */
export class McpHost {
  client = McpHost.newClient();
  tools: HostTool[] = [];
  serverInfo: { name: string; version: string; title?: string } | null = null;
  connected = false;
  protocolVersion: string | null = null;
  log: McpLogEntry[] = [];
  private uiCache = new Map<string, Promise<string>>();
  private listeners = new Set<Listener>();
  private seq = 0;

  constructor(readonly endpoint: string) {}

  // Probe with server/discover so the session runs the 2026-07-28 revision
  // (falls back to the 2025 handshake for older servers).
  private static newClient(): Client {
    return new Client({ name: "mcp-apps-alexa-host", version: "0.1.0" }, { versionNegotiation: { mode: "auto" } });
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private record(entry: Omit<McpLogEntry, "id" | "at">) {
    this.log = [...this.log.slice(-80), { ...entry, id: ++this.seq, at: Date.now() }];
    this.emit();
  }

  private connecting: Promise<void> | null = null;

  /** Connects (or reconnects after a failure) and discovers tools. */
  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    this.connecting ??= this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  /** Resolves once connected, connecting first if needed (cards can be clicked before the handshake ends). */
  private async ready(): Promise<void> {
    if (!this.connected) await this.connect();
  }

  private async doConnect(): Promise<void> {
    this.client = McpHost.newClient();
    const started = performance.now();
    this.record({ direction: "request", method: "initialize", summary: this.endpoint });
    await this.client.connect(new StreamableHTTPClientTransport(new URL(this.endpoint, location.href)));
    const info = this.client.getServerVersion();
    this.protocolVersion = this.client.getNegotiatedProtocolVersion() ?? null;
    this.serverInfo = info ? { name: info.name, version: info.version, title: info.title } : null;
    this.record({
      direction: "response",
      method: "initialize",
      summary: `${info?.title ?? info?.name} v${info?.version}`,
      ms: Math.round(performance.now() - started),
    });

    const t0 = performance.now();
    this.record({ direction: "request", method: "tools/list", summary: "" });
    const { tools } = await this.client.listTools();
    this.tools = tools.map((t) => {
      const visibility = (t._meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility;
      return {
        name: t.name,
        title: t.title,
        description: t.description,
        uiUri: getToolUiResourceUri(t),
        inputSchema: t.inputSchema as HostTool["inputSchema"],
        modelVisible: !visibility || visibility.includes("model"),
      };
    });
    this.record({
      direction: "response",
      method: "tools/list",
      summary: `${tools.length} tools`,
      detail: tools.map((t) => t.name),
      ms: Math.round(performance.now() - t0),
    });
    this.connected = true;
    this.emit();
    // Warm the UI resource cache so views open instantly.
    for (const uri of new Set(this.tools.map((t) => t.uiUri).filter(Boolean) as string[])) void this.readUi(uri);
  }

  tool(name: string): HostTool | undefined {
    return this.tools.find((t) => t.name === name);
  }

  readUi(uri: string): Promise<string> {
    let p = this.uiCache.get(uri);
    if (!p) {
      const t0 = performance.now();
      p = this.ready().then(() => {
        this.record({ direction: "request", method: "resources/read", summary: uri });
        return this.client.readResource({ uri });
      }).then((res) => {
        const item = res.contents[0] as { text?: string; blob?: string } | undefined;
        const html = item?.text ?? (item?.blob ? atob(item.blob) : "");
        this.record({
          direction: "response",
          method: "resources/read",
          summary: `${uri} · ${(html.length / 1024).toFixed(0)} KB`,
          ms: Math.round(performance.now() - t0),
        });
        return html;
      });
      p.catch(() => this.uiCache.delete(uri));
      this.uiCache.set(uri, p);
    }
    return p;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    source: "assistant" | "view" = "assistant",
    onProgress?: (message: string, progress: number, total?: number) => void,
  ): Promise<CallResult> {
    await this.ready();
    const t0 = performance.now();
    this.record({ direction: "request", method: "tools/call", summary: `${name}${source === "view" ? " (from view)" : ""}`, detail: redact(args) });
    try {
      const res = await this.client.callTool(
        { name, arguments: args },
        {
          resetTimeoutOnProgress: true,
          onprogress: (p) => {
            this.record({
              direction: "response",
              method: "notifications/progress",
              summary: `${name} · ${p.message ?? `${p.progress}/${p.total ?? "?"}`}`,
              ms: Math.round(performance.now() - t0),
            });
            onProgress?.(p.message ?? "", p.progress, p.total);
          },
        },
      );
      const ai = (res.structuredContent as { ai?: { provider?: string; model?: string } } | undefined)?.ai;
      this.record({
        direction: res.isError ? "error" : "response",
        method: "tools/call",
        summary: `${name}${ai?.provider ? ` · ${ai.provider}` : ""}${res.isError ? " · error" : ""}`,
        detail: res.isError ? res.content : { structuredContent: "…", ai },
        ms: Math.round(performance.now() - t0),
      });
      return res;
    } catch (err) {
      this.record({ direction: "error", method: "tools/call", summary: `${name} · ${err instanceof Error ? err.message : err}` });
      throw err;
    }
  }

  /** Records calls a view makes through the AppBridge's automatic forwarding. */
  noteViewCall(method: string, summary: string) {
    this.record({ direction: "request", method, summary: `${summary} (from view)` });
  }
}

/** Keeps long CV text and PDFs out of the inspector. */
function redact(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > 160) out[k] = `${v.slice(0, 60)}… (${v.length.toLocaleString()} chars)`;
    else out[k] = v;
  }
  return out;
}
