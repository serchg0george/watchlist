import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CSP, injectCsp } from "../tools/csp.js";

const directives = new Map(CSP.split("; ").map((directive) => {
  const [name, ...sources] = directive.split(" ");
  return [name, sources] as const;
}));

test("production CSP restricts resources and script execution", () => {
  for (const name of ["default-src", "script-src", "style-src", "font-src", "manifest-src",
    "worker-src", "base-uri", "form-action"]) {
    assert.deepEqual(directives.get(name), ["'self'"], name);
  }
  assert.deepEqual(directives.get("object-src"), ["'none'"]);
  assert.deepEqual(directives.get("img-src"), ["'self'", "https://image.tmdb.org", "data:"]);
  assert.deepEqual(directives.get("connect-src"), ["'self'", "https://api.github.com", "https://api.themoviedb.org"]);
  assert.ok(!CSP.includes("'unsafe-inline'") && !CSP.includes("'unsafe-eval'"));
});

test("CSP permits the network origins used by GitHub and TMDB", () => {
  for (const file of ["src/config.ts", "src/tmdb.ts"]) {
    const source = readFileSync(file, "utf8");
    const urls = [...source.matchAll(/https?:\/\/[\w.-]+(?::\d+)?/g)];
    assert.ok(urls.length > 0, `No origins found in ${file}`);
    for (const [url] of urls) {
      const origin = new URL(url).origin;
      const name = origin === "https://image.tmdb.org" ? "img-src" : "connect-src";
      assert.ok(directives.get(name)?.includes(origin), `${name} must allow ${origin} from ${file}`);
    }
  }
});

test("CSP immediately follows charset and requires a charset declaration", () => {
  const html = readFileSync("index.html", "utf8");
  assert.match(injectCsp(html), /<meta charset="UTF-8">\s*<meta http-equiv="Content-Security-Policy"/);
  assert.throws(() => injectCsp("<head></head>"), /charset/);
});
