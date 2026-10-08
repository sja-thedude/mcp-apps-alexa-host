import { useEffect, useRef, useState } from "react";
import { AppBridge, PostMessageTransport, type McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallResult, McpHost } from "./mcpHost";

const HOST_INFO = { name: "mcp-apps-alexa-host", title: "Alexa+-style MCP Apps host", version: "0.1.0" };
const HOST_CAPABILITIES: McpUiHostCapabilities = {
  openLinks: {},
  serverTools: {},
  message: { text: {} },
  updateModelContext: { text: {} },
  logging: {},
  sandbox: { permissions: { microphone: {} } },
};

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is { type: "text"; text: string } => c?.type === "text")
    .map((c) => c.text)
    .join("\n");
}

/**
 * Renders an MCP App view in a sandboxed iframe and bridges it to the host:
 * tool input/result delivery, view → server tool calls, follow-up messages,
 * model-context updates, links, theme and auto-resize.
 */
export function AppFrame({
  host,
  uri,
  toolName,
  args,
  result,
  theme,
  onMessage,
  onContext,
}: {
  host: McpHost;
  uri: string;
  toolName: string;
  args: Record<string, unknown>;
  result: CallResult | null;
  theme: "light" | "dark";
  onMessage: (text: string) => void;
  onContext: (text: string) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const readyRef = useRef(false);
  const resultRef = useRef(result);
  const sentResultRef = useRef(false);
  const [height, setHeight] = useState(360);
  const [loadError, setLoadError] = useState<string | null>(null);
  const callbacks = useRef({ onMessage, onContext });
  callbacks.current = { onMessage, onContext };
  resultRef.current = result;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    let disposed = false;
    readyRef.current = false;
    sentResultRef.current = false;

    const bridge = new AppBridge(null, HOST_INFO, HOST_CAPABILITIES, {
      hostContext: {
        theme,
        displayMode: "inline",
        availableDisplayModes: ["inline"],
        platform: "web",
        locale: navigator.language,
        toolInfo: { tool: { name: toolName, inputSchema: { type: "object" } } },
      },
    });
    bridgeRef.current = bridge;

    bridge.oncalltool = async (params) => (await host.callTool(params.name, params.arguments ?? {}, "view")) as never;
    bridge.onmessage = async (params) => {
      const text = textOf(params.content);
      if (text) callbacks.current.onMessage(text);
      return {};
    };
    bridge.onupdatemodelcontext = async (params) => {
      const text = textOf(params.content);
      if (text) callbacks.current.onContext(text);
      return {};
    };
    bridge.onopenlink = async ({ url }) => {
      window.open(url, "_blank", "noopener,noreferrer");
      return {};
    };
    bridge.onsizechange = ({ height: h }) => {
      if (typeof h === "number" && h > 0) setHeight(Math.min(Math.ceil(h), 4000));
    };
    bridge.oninitialized = () => {
      readyRef.current = true;
      void bridge.sendToolInput({ arguments: args });
      if (resultRef.current && !sentResultRef.current) {
        sentResultRef.current = true;
        void bridge.sendToolResult(resultRef.current as never);
      }
    };

    (async () => {
      try {
        await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
        const html = await host.readUi(uri);
        if (!disposed) iframe.srcdoc = html;
      } catch (err) {
        if (!disposed) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      disposed = true;
      readyRef.current = false;
      bridgeRef.current = null;
      void bridge.close().catch(() => {});
    };
    // The frame is created once per tool call; args are fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, host]);

  useEffect(() => {
    if (result && readyRef.current && !sentResultRef.current && bridgeRef.current) {
      sentResultRef.current = true;
      void bridgeRef.current.sendToolResult(result as never);
    }
  }, [result]);

  useEffect(() => {
    if (readyRef.current) void bridgeRef.current?.sendHostContextChange({ theme });
  }, [theme]);

  if (loadError) {
    return <div className="rounded-2xl border border-line bg-bad-soft p-4 text-sm text-bad">Couldn't load the view: {loadError}</div>;
  }

  return (
    <iframe
      ref={iframeRef}
      title={`${toolName} view`}
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
      allow="microphone; clipboard-write"
      className="block w-full rounded-2xl border border-line bg-bg transition-[height] duration-300"
      style={{ height }}
    />
  );
}
