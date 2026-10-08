import { createRoot } from "react-dom/client";
import "../shared/theme.css";
import type { Forecast } from "../../server/mcp";
import { useToolResult } from "../shared/useToolResult";

const ICON: Record<string, string> = { Sunny: "☀️", Cloudy: "☁️", Rain: "🌧️", Windy: "💨", Snow: "❄️" };
const DEMO: Forecast = {
  speech: "",
  city: "Seattle",
  note: "Demo data.",
  days: [
    { date: "2026-10-23", summary: "Rain", high: 14, low: 8, rainChance: 80 },
    { date: "2026-10-24", summary: "Cloudy", high: 15, low: 9, rainChance: 20 },
    { date: "2026-10-25", summary: "Sunny", high: 17, low: 10, rainChance: 5 },
  ],
};

function ForecastView() {
  const { app, result, error } = useToolResult<Forecast>("forecast", DEMO);
  if (error) return <p className="p-4 text-sm" role="alert">{error}</p>;
  if (!result) return <p className="p-4 text-sm text-muted" aria-busy="true">Loading forecast…</p>;
  return (
    <main className="p-4">
      <h1 className="text-lg font-semibold">{result.city}</h1>
      <p className="mb-3 text-xs text-muted">{result.note}</p>
      <ol className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
        {result.days.map((d) => (
          <li key={d.date} className="rounded-xl border border-line bg-surface p-3 text-center">
            <div className="text-xs text-muted">{new Date(d.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>
            <div className="my-1 text-3xl" aria-hidden>{ICON[d.summary]}</div>
            <div className="text-sm font-medium">{d.summary}</div>
            <div className="text-sm">
              <span className="font-semibold">{d.high}°</span> <span className="text-muted">{d.low}°</span>
            </div>
            <div className="text-xs text-muted">{d.rainChance}% rain</div>
          </li>
        ))}
      </ol>
      {app && (
        <button
          type="button"
          className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm hover:border-accent"
          onClick={() => app.sendMessage({ role: "user", content: [{ type: "text", text: `Make a packing checklist for ${result.city}` }] })}
        >
          Make a packing checklist →
        </button>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<ForecastView />);
