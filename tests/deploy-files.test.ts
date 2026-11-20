import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// Deploy Pages publishes dist/ (Vite output + sw.js) plus data/; every runtime file must end up there.
test("deploy.yml publishes dist/ and every runtime file is built into it", () => {
  const deploy = readFileSync(".github/workflows/deploy.yml", "utf8");
  assert.match(deploy, /^\s*cp -R dist\/\. _site\/$/m, "deploy.yml must copy dist/ into _site/");
  assert.match(deploy, /^\s*cp data\/movies\.json _site\/data\/$/m, "deploy.yml must publish data/movies.json");

  // Static files reach dist/ through Vite's publicDir; sw.js is compiled into dist/ by tsc; /src/* is bundled.
  const builtByTsc = new Set(["sw.js"]);
  const html = [...readFileSync("index.html", "utf8").matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((m) => m[1] ?? "").filter((p) => !p.startsWith("http") && !p.startsWith("#") && !p.startsWith("/src/"));
  const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8")) as { icons?: { src: string }[] };
  const required = [...html, ...(manifest.icons ?? []).map((icon) => icon.src)];

  assert.deepEqual(required.filter((p) => !builtByTsc.has(p) && !existsSync(`public/${p}`)), []);
});
