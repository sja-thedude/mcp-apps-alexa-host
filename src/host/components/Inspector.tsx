import { useState } from "react";
import type { McpHost, McpLogEntry } from "../lib/mcpHost";

const DIR_STYLE: Record<McpLogEntry["direction"], string> = {
  request: "text-accent",
  response: "text-good",
  error: "text-bad",
};

/** "Under the hood" panel: live MCP protocol traffic and server capabilities. */
export function Inspector({ host }: { host: McpHost }) {
  const [open, setOpen] = useState<number | null>(null);
  const log = [...host.log].reverse();
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="rounded-2xl border border-line bg-surface p-3 text-xs">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-display text-sm font-semibold">MCP server</span>
          <span className={`flex items-center gap-1.5 ${host.connected ? "text-good" : "text-warn"}`}>
            <span className={`h-2 w-2 rounded-full ${host.connected ? "bg-good" : "animate-pulse bg-warn"}`} />
            {host.connected ? "Connected" : "Connecting"}
          </span>
        </div>
        <dl className="grid grid-cols-[84px_1fr] gap-x-2 gap-y-1 text-muted">
          <dt className="text-faint">Server</dt>
          <dd className="truncate">{host.serverInfo ? `${host.serverInfo.name} v${host.serverInfo.version}` : "…"}</dd>
          <dt className="text-faint">Endpoint</dt>
          <dd className="truncate font-mono">{new URL(host.endpoint, location.href).href}</dd>
          <dt className="text-faint">Transport</dt>
          <dd>Streamable HTTP{host.protocolVersion ? ` · MCP ${host.protocolVersion}` : ""}</dd>
          <dt className="text-faint">Tools</dt>
          <dd className="flex flex-wrap gap-1">
            {host.tools.map((t) => (
              <span key={t.name} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg" title={t.description}>
                {t.name}
                {t.uiUri && <span className="ml-1 text-accent">UI</span>}
              </span>
            ))}
          </dd>
        </dl>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="font-display text-sm font-semibold">Protocol log</span>
          <span className="text-[11px] text-faint">JSON-RPC over HTTP</span>
        </div>
        <ol className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-[11px]" aria-live="polite">
          {log.length === 0 && <li className="p-2 text-faint">No traffic yet.</li>}
          {log.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setOpen(open === e.id ? null : e.id)}
                className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1 text-left hover:bg-surface-2"
                aria-expanded={open === e.id}
              >
                <span className={`w-3 shrink-0 ${DIR_STYLE[e.direction]}`}>{e.direction === "request" ? "→" : e.direction === "error" ? "✗" : "←"}</span>
                <span className="shrink-0 text-fg">{e.method}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{e.summary}</span>
                {e.ms !== undefined && <span className="shrink-0 text-faint">{e.ms}ms</span>}
              </button>
              {open === e.id && e.detail !== undefined && (
                <pre className="mx-2 mb-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-2 text-[10.5px] text-muted">
                  {JSON.stringify(e.detail, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
