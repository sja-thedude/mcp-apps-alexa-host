import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";

/** Mirrors wrangler's `Text` rule so tests can import built views. */
const htmlAsText = (): Plugin => ({
  name: "html-as-text",
  enforce: "pre",
  load: (id) => (id.endsWith(".html") ? `export default ${JSON.stringify(readFileSync(id, "utf8"))};` : null),
});

export default defineConfig({
  plugins: [htmlAsText()],
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["**/* 2.*", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/server/**", "src/host/lib/mcpHost.ts", "src/host/lib/router.ts"],
      exclude: ["**/*.d.ts"],
      thresholds: { lines: 90, statements: 88, functions: 80, branches: 70 },
    },
  },
});
