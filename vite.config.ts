import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The host app. `npm run dev:host` proxies /mcp to `wrangler dev` on :8787.
export default defineConfig({
  root: "src/host",
  publicDir: "../../public",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../../dist/host", emptyOutDir: true },
  server: { port: 5173, proxy: { "/mcp": "http://localhost:8787" } },
});
