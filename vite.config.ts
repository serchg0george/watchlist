import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { injectCsp } from "./tools/csp.ts";
import { injectCache, injectShell, shellFrom } from "./tools/sw-shell.ts";

function resolveBuildId(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim();
  } catch (error) {
    if (process.env.CI) throw error;
    return "dev";
  }
}

const buildId = resolveBuildId();

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
      const worker = injectCache(source, `watchlist-${buildId}`);
      writeFileSync(join(outDir, "sw.js"), injectShell(worker, shellFrom(files)));
    }
  };
}

// The site is published under /watchlist/ on GitHub Pages, so every emitted URL carries that base.
// Static files (manifest.json, icons/, style.css) live in public/ and are copied into dist/ as-is.
export default defineConfig({
  base: "/watchlist/",
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },
  plugins: [
    react(),
    serviceWorker(),
    {
      name: "watchlist-content-security-policy",
      apply: "build",
      transformIndexHtml: { order: "post", handler: injectCsp }
    }
  ],
  build: {
    outDir: "dist",
    manifest: true
  }
});
