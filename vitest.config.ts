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
  test: { include: ["test/**/*.test.ts"], exclude: ["**/* 2.*", "node_modules/**"] },
});
