import { useEffect, useState } from "react";
import { applyDocumentTheme, useApp, type App } from "@modelcontextprotocol/ext-apps/react";

/**
 * Minimal MCP App view lifecycle: connect to the host, follow its theme, and
 * expose the tool input and result. Open the view standalone with `?demo` to
 * render `demo` data without a host.
 */
export function useToolResult<T>(name: string, demo?: T) {
  const standalone = window.parent === window && new URLSearchParams(location.search).has("demo");
  const [result, setResult] = useState<T | null>(standalone && demo ? demo : null);
  const [error, setError] = useState<string | null>(null);
  const { app, isConnected } = useApp({
    appInfo: { name, version: "1.0.0" },
    capabilities: {},
    onAppCreated: (a) => {
      a.ontoolresult = (p) => {
        if (p.isError) setError((p.content?.[0] as { text?: string })?.text ?? "Tool failed");
        else setResult(p.structuredContent as T);
      };
      a.onhostcontextchanged = (ctx) => ctx.theme && applyDocumentTheme(ctx.theme);
    },
  });
  useEffect(() => {
    const theme = app?.getHostContext()?.theme;
    if (theme) applyDocumentTheme(theme);
  }, [app, isConnected]);
  return { app: app as App | null, result, setResult, error };
}
