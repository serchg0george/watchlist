import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Deploy Pages publishes only what the copy list names; every runtime file must be on it.
test("deploy.yml copies every runtime file", () => {
  const deploy = readFileSync(".github/workflows/deploy.yml", "utf8");
  const copied = [...deploy.matchAll(/^\s*cp (?:-R )?(.+?) _site\/\S*$/gm)].flatMap((m) => (m[1] ?? "").split(/\s+/));
  const covered = (p: string): boolean => copied.some((c) => p === c || p.startsWith(`${c}/`));

  const sw = readFileSync("src/sw.ts", "utf8");
  const shellText = sw.slice(sw.indexOf("const SHELL = ["), sw.indexOf("];", sw.indexOf("const SHELL = [")));
  const shell = [...shellText.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "").filter((p) => p !== "./" && !p.startsWith("js/"));
  const html = [...readFileSync("index.html", "utf8").matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((m) => m[1] ?? "").filter((p) => !p.startsWith("http") && !p.startsWith("#"));
  const manifest = JSON.parse(readFileSync("manifest.json", "utf8")) as { icons?: { src: string }[] };
  const required = [...shell, ...html, ...(manifest.icons ?? []).map((icon) => icon.src)];

  assert.ok(copied.length > 0, "no cp lines found in deploy.yml");
  assert.deepEqual(required.filter((p) => !covered(p)), []);
});
