import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Offline mode needs every compiled module in the service worker precache.
test("sw SHELL lists every compiled module", () => {
  const modules = readdirSync("src", { recursive: true })
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".d.ts") && path !== "sw.ts")
    .map((path) => `js/${path.slice(0, -3)}.js`)
    .sort();
  const sw = readFileSync("src/sw.ts", "utf8");
  const shell = [...sw.matchAll(/"(js\/[^"]+\.js)"/g)].map((m) => m[1] ?? "").sort();
  assert.deepEqual(shell, modules);
});
