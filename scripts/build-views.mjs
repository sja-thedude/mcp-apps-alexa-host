// Builds each MCP App view in src/views/<name>/ into one self-contained
// dist/views/<name>.html, served by the demo server as a ui:// resource.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const root = resolve("src/views");
const out = resolve("dist/views");
mkdirSync(out, { recursive: true });
for (const name of readdirSync(root).filter((d) => existsSync(join(root, d, "index.html")))) {
  const tmp = join(out, `.tmp-${name}`);
  await build({ root: join(root, name), logLevel: "warn", plugins: [react(), tailwindcss(), viteSingleFile()], build: { outDir: tmp, emptyOutDir: true } });
  renameSync(join(tmp, "index.html"), join(out, `${name}.html`));
  rmSync(tmp, { recursive: true, force: true });
  console.log(`built views/${name}.html`);
}
