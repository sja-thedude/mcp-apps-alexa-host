// Browser end-to-end check of the host against a running server.
// Usage: node scripts/e2e.mjs [baseUrl] [externalMcpUrl] [outDir]
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:8788";
const external = process.argv[3];
const outDir = process.argv[4] ?? ".";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("status").getByText(/tools · MCP/).waitFor({ timeout: 15000 });

// 1. Tool call → MCP App view, with a follow-up message sent from the view.
await page.getByRole("button", { name: /weather in Seattle/ }).click();
const forecast = page.frameLocator('iframe[title="get_forecast view"]');
await forecast.getByRole("heading", { name: "Seattle" }).waitFor({ timeout: 15000 });
await forecast.getByRole("button", { name: /packing checklist/ }).click();
const checklist = page.frameLocator('iframe[title="create_checklist view"]');
await checklist.getByText(/0\/3 done/).waitFor({ timeout: 15000 });
console.log("tool call → view → follow-up message: ok");

// 2. View → server: ticking an item calls the app-only update tool.
await checklist.getByRole("checkbox").first().check();
await checklist.getByText(/1\/3 done/).waitFor({ timeout: 10000 });
await page.getByText("Model context from views").waitFor({ timeout: 10000 });
console.log("view → app-only tool → model context: ok");
await page.screenshot({ path: `${outDir}/host-demo.png` });

// 3. Any server: point the host at another MCP server.
if (external) {
  await page.getByLabel("MCP server URL").fill(external);
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("status").getByText(/tools · MCP/).waitFor({ timeout: 20000 });
  console.log(`external server (${external}): ${await page.getByRole("status").first().textContent()}`);
  await page.waitForTimeout(1500);
  const staleReads = await page.getByLabel("Protocol").getByText(/ui:\/\/demo\//).count();
  if (staleReads) throw new Error(`${staleReads} stale view loads against the new server`);
  await page.screenshot({ path: `${outDir}/host-external.png` });
}

console.log(errors.length ? `errors: ${errors.join(" | ")}` : "no page errors");
if (errors.length) process.exitCode = 1;
await browser.close();
