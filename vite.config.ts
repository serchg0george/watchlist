import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { injectShell, shellFrom } from "./tools/sw-shell.ts";

// sw.ts is compiled by `tsc -p tsconfig.sw.json` into .sw-build/ before `vite build`;
// after the bundle is written, the precache list of every emitted file is injected and sw.js lands in dist/.
function serviceWorker(): Plugin {
  let outDir = "dist";
  return {
    name: "watchlist-service-worker",
    apply: "build",
    configResolved(config) { outDir = config.build.outDir; },
    closeBundle() {
      const files = readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name).slice(outDir.length + 1));
      const source = readFileSync(".sw-build/sw.js", "utf8");
      writeFileSync(join(outDir, "sw.js"), injectShell(source, shellFrom(files)));
    }
  };
}

// The site is published under /watchlist/ on GitHub Pages, so every emitted URL carries that base.
// Static files (manifest.json, icons/, style.css) live in public/ and are copied into dist/ as-is.
export default defineConfig({
  base: "/watchlist/",
  plugins: [react(), serviceWorker()],
  build: {
    outDir: "dist",
    manifest: true
  }
});
