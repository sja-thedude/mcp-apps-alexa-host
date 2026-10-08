import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../shared/theme.css";
import type { Checklist } from "../../server/mcp";
import { useToolResult } from "../shared/useToolResult";

const DEMO: Checklist = { speech: "", title: "Packing for Seattle", done: 1, items: [{ text: "Rain jacket", done: true }, { text: "Umbrella", done: false }, { text: "Laptop charger", done: false }] };

function ChecklistView() {
  const { app, result, setResult, error } = useToolResult<Checklist>("checklist", DEMO);
  const [busy, setBusy] = useState(false);
  if (error) return <p className="p-4 text-sm" role="alert">{error}</p>;
  if (!result) return <p className="p-4 text-sm text-muted" aria-busy="true">Loading checklist…</p>;

  async function toggle(index: number) {
    if (!result) return;
    const items = result.items.map((it, i) => (i === index ? { ...it, done: !it.done } : it));
    setResult({ ...result, items, done: items.filter((i) => i.done).length });
    if (!app) return;
    setBusy(true);
    try {
      // View → server: an app-only tool recalculates the summary.
      const res = await app.callServerTool({ name: "update_checklist", arguments: { title: result.title, items } });
      const next = res.structuredContent as unknown as Checklist;
      setResult(next);
      // Keep the assistant informed for follow-up questions.
      await app.updateModelContext({ content: [{ type: "text", text: next.speech }] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">{result.title}</h1>
        <span className="text-sm text-muted" aria-live="polite">
          {result.done}/{result.items.length} done{busy ? " · saving" : ""}
        </span>
      </div>
      <ul className="grid gap-1.5">
        {result.items.map((it, i) => (
          <li key={i}>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
              <input type="checkbox" checked={it.done} onChange={() => void toggle(i)} className="h-4 w-4 accent-[var(--accent)]" />
              <span className={it.done ? "text-muted line-through" : ""}>{it.text}</span>
            </label>
          </li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<ChecklistView />);
