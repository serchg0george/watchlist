import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SHELL_PLACEHOLDER, injectShell, shellFrom } from "../tools/sw-shell.js";

// Offline mode needs every built file in the service worker precache; the list is generated from dist/.
test("shellFrom precaches every emitted file plus the root and the deployed data", () => {
  const shell = shellFrom(["index.html", "assets/index-abc123.js", ".vite/manifest.json", "sw.js", "style.css", "icons/icon-192.png", "assets\\index-abc123.js.map"]);
  assert.deepEqual(shell, ["./", "assets/index-abc123.js", "icons/icon-192.png", "index.html", "style.css", "data/movies.json"]);
});

test("injectShell replaces the placeholder that sw.ts compiles to", () => {
  const sw = readFileSync("src/sw.ts", "utf8");
  assert.ok(sw.includes(SHELL_PLACEHOLDER), "src/sw.ts must keep the SHELL placeholder");
  const out = injectShell(`const SHELL = ${SHELL_PLACEHOLDER};`, ["./", "index.html"]);
  assert.equal(out, 'const SHELL = ["./","index.html"];');
  assert.throws(() => injectShell("const SHELL = [];", ["./"]));
});
