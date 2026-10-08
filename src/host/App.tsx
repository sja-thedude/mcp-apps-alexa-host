import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { McpHost, type CallResult } from "./lib/mcpHost";
import { AppFrame } from "./lib/AppFrame";
import { keywordRouter, type Router } from "./lib/router";
import { speak, stopSpeaking, useDictation } from "./lib/speech";
import { Inspector } from "./components/Inspector";
import { VoiceOrb, type OrbState } from "./components/VoiceOrb";

type Item =
  | { kind: "user"; id: number; text: string }
  | { kind: "assistant"; id: number; text: string }
  | { kind: "tool"; id: number; name: string; uri?: string; args: Record<string, unknown>; result: CallResult | null; progress?: string; error?: string };

type NewItem = Item extends infer T ? (T extends Item ? Omit<T, "id"> : never) : never;

const DEMO_PROMPTS = ["What's the weather in Seattle?", "Make a packing checklist for Seattle with rain jacket, umbrella and charger"];

function firstText(res: CallResult | null): string {
  return ((res?.content ?? []) as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text ?? "";
}

function initialServer(): string {
  return new URLSearchParams(location.search).get("server") || "/mcp";
}

/** An Alexa+-style conversation host for any Streamable HTTP MCP server. */
export function App({ router = keywordRouter }: { router?: Router }) {
  const [serverUrl, setServerUrl] = useState(initialServer);
  const [draftUrl, setDraftUrl] = useState(serverUrl);
  const host = useMemo(() => new McpHost(serverUrl), [serverUrl]);
  useSyncExternalStore(useCallback((fn) => host.subscribe(fn), [host]), () => host.log);

  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [orb, setOrb] = useState<OrbState>("idle");
  const [muted, setMuted] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">(() => (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  const [connError, setConnError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const seq = useRef(0);
  const busy = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setConnError(null);
    host.connect().catch((e) => setConnError(e instanceof Error ? e.message : String(e)));
  }, [host]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const lastId = items.at(-1)?.id;
  useEffect(() => {
    if (lastId !== undefined) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lastId]);

  const say = useCallback(
    (text: string) => {
      if (muted || !text) return;
      setOrb("speaking");
      speak(text, { onEnd: () => setOrb((o) => (o === "speaking" ? "idle" : o)) });
    },
    [muted],
  );
  const push = (item: NewItem) => {
    const id = ++seq.current;
    setItems((prev) => [...prev, { ...item, id } as Item]);
    return id;
  };
  const patch = (id: number, p: Partial<Extract<Item, { kind: "tool" }>>) =>
    setItems((prev) => prev.map((it) => (it.id === id && it.kind === "tool" ? { ...it, ...p } : it)));

  const handle = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy.current) return;
      busy.current = true;
      stopSpeaking();
      push({ kind: "user", text });
      setOrb("thinking");
      try {
        const route = await router(text, host.tools);
        if (!route) {
          const names = host.tools.filter((t) => t.modelVisible).map((t) => t.title ?? t.name);
          const reply = names.length ? `I couldn't match that to a tool. Try asking for: ${names.join(", ")}.` : "This server has no tools I can call.";
          push({ kind: "assistant", text: reply });
          say(reply);
          return;
        }
        const id = push({ kind: "tool", name: route.tool.name, uri: route.tool.uiUri, args: route.arguments, result: null });
        try {
          const res = await host.callTool(route.tool.name, route.arguments, "assistant", (message) => patch(id, { progress: message }));
          patch(id, { result: res, error: res.isError ? firstText(res) : undefined });
          say(firstText(res));
        } catch (e) {
          patch(id, { error: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        busy.current = false;
        setOrb((o) => (o === "thinking" ? "idle" : o));
      }
    },
    [host, router, say],
  );

  const dictation = useDictation({ onFinal: (t) => void handle(t) });
  useEffect(() => {
    if (dictation.listening) setOrb("listening");
    else setOrb((o) => (o === "listening" ? "idle" : o));
  }, [dictation.listening]);

  const visibleTools = host.tools.filter((t) => t.modelVisible);
  const isDemoServer = serverUrl === "/mcp";

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <div className="mr-2">
          <div className="text-base font-semibold leading-tight">MCP Apps host</div>
          <div className="text-xs text-muted">Alexa+-style · Streamable HTTP</div>
        </div>
        <form
          className="flex min-w-[240px] flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const url = draftUrl.trim() || "/mcp";
            const qs = new URLSearchParams(location.search);
            if (url === "/mcp") qs.delete("server");
            else qs.set("server", url);
            history.replaceState(null, "", `${location.pathname}${qs.size ? `?${qs}` : ""}`);
            // Clear in the same update so old views never render against the new server.
            setItems([]);
            setNotes([]);
            setServerUrl(url);
          }}
        >
          <label htmlFor="server" className="sr-only">
            MCP server URL
          </label>
          <input
            id="server"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            placeholder="https://your-server.example/mcp"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 font-mono text-xs outline-none focus:border-accent"
          />
          <button type="submit" className="h-9 rounded-lg border border-line bg-surface-2 px-3 text-xs font-medium hover:border-accent">
            Connect
          </button>
        </form>
        <span role="status" className={`rounded-full border border-line px-2.5 py-1 text-xs ${connError ? "text-red-400" : host.connected ? "text-good" : "text-muted"}`}>
          {connError ? "Offline" : host.connected ? `${visibleTools.length} tools · MCP ${host.protocolVersion ?? ""}` : "Connecting…"}
        </span>
        <button type="button" onClick={() => setMuted((m) => !m)} aria-pressed={muted} className="h-9 rounded-lg border border-line px-2 text-xs" aria-label={muted ? "Unmute voice replies" : "Mute voice replies"}>
          {muted ? "🔇" : "🔊"}
        </button>
        <button type="button" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} className="h-9 rounded-lg border border-line px-2 text-xs" aria-label="Toggle theme">
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-6">
              {connError && (
                <div role="alert" className="mb-4 rounded-xl border border-line bg-surface p-4 text-sm">
                  <div className="font-semibold">Couldn't connect to {serverUrl}</div>
                  <p className="mt-1 text-muted">{connError}. Check the URL, that the server speaks Streamable HTTP, and that it allows CORS from this origin.</p>
                  <button type="button" onClick={() => host.connect().then(() => setConnError(null), (e) => setConnError(String(e)))} className="mt-2 rounded-lg border border-line px-3 py-1 text-xs">
                    Try again
                  </button>
                </div>
              )}
              {items.length === 0 && !connError && (
                <section className="text-center">
                  <div className="orb orb-idle orb-hero relative mx-auto mb-4 h-20 w-20 rounded-full" aria-hidden>
                    <span className="orb-ring absolute inset-0 rounded-full" />
                    <span className="orb-core absolute inset-3 rounded-full" />
                  </div>
                  <h1 className="text-2xl font-bold">Talk to your MCP server</h1>
                  <p className="mx-auto mt-1 max-w-lg text-sm text-muted">
                    Ask by voice or text. Tool results render inline as MCP Apps views, and the protocol log shows every message.
                  </p>
                  <div className="mt-6 grid gap-2 sm:grid-cols-2">
                    {(isDemoServer ? DEMO_PROMPTS : visibleTools.slice(0, 6).map((t) => t.title ?? t.name)).map((p) => (
                      <button key={p} type="button" onClick={() => void handle(p)} className="rounded-xl border border-line bg-surface p-3 text-left text-sm hover:border-accent">
                        “{p}”
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <ol className="grid gap-4">
                {items.map((it) => (
                  <li key={it.id}>
                    {it.kind === "user" && (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl bg-surface-2 px-4 py-2">{it.text}</div>
                      </div>
                    )}
                    {it.kind === "assistant" && <p className="text-muted">{it.text}</p>}
                    {it.kind === "tool" && (
                      <div>
                        <div className="mb-1 flex items-center gap-2 font-mono text-xs text-muted">
                          <span>{it.name}</span>
                          {!it.result && !it.error && <span role="status">· {it.progress ?? "running"}…</span>}
                        </div>
                        {it.error && !it.result ? (
                          <div role="alert" className="rounded-xl border border-line bg-surface p-3 text-sm">
                            That tool didn't finish: {it.error}
                          </div>
                        ) : it.uri ? (
                          <AppFrame host={host} uri={it.uri} toolName={it.name} args={it.args} result={it.result} theme={theme} onMessage={(t) => void handle(t)} onContext={(t) => setNotes((n) => [...n.slice(-4), t])} />
                        ) : (
                          <pre className="whitespace-pre-wrap rounded-xl border border-line bg-surface p-3 text-sm">{firstText(it.result)}</pre>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              <div ref={endRef} />
            </div>
          </div>
          <form
            className="mx-auto flex w-full max-w-3xl items-center gap-2 border-t border-line px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              const t = input;
              setInput("");
              void handle(t);
            }}
          >
            <label htmlFor="ask" className="sr-only">
              Ask
            </label>
            <input
              id="ask"
              value={dictation.listening ? dictation.interim || input : input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={dictation.listening ? "Listening…" : "Ask something…"}
              className="h-11 min-w-0 flex-1 rounded-full border border-line bg-surface px-4 outline-none focus:border-accent"
              autoComplete="off"
            />
            <VoiceOrb
              state={orb}
              size={44}
              onClick={() => (orb === "speaking" ? (stopSpeaking(), setOrb("idle")) : dictation.listening ? dictation.stop() : dictation.start())}
            />
          </form>
          {dictation.error && <p className="pb-2 text-center text-xs text-muted">{dictation.error}</p>}
        </main>
        <aside className="hidden w-[360px] flex-col gap-3 overflow-y-auto border-l border-line p-4 lg:flex" aria-label="Protocol">
          <Inspector host={host} />
          {notes.length > 0 && (
            <div className="rounded-2xl border border-line bg-surface p-3 text-xs">
              <div className="mb-1 font-semibold">Model context from views</div>
              <ul className="space-y-1 text-muted">
                {notes.map((n, i) => (
                  <li key={i}>• {n}</li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
