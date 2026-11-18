import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GitHubRepository } from "../src/data/github.js";

interface RecordedCall { method: string; url: string }

describe("GitHubRepository.save", () => {
  test("waits before retrying on conflict and succeeds on the second PUT", async () => {
    const originalFetch = globalThis.fetch;
    const originalRandom = Math.random;
    const calls: RecordedCall[] = [];
    let puts = 0;

    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      if (method === "PUT") {
        puts++;
        return Promise.resolve(new Response(JSON.stringify({}), { status: puts === 1 ? 409 : 200 }));
      }
      if (url.endsWith("/git/matching-refs/heads/data/")) {
        return Promise.resolve(new Response(JSON.stringify([{ ref: "refs/heads/data/2026-11" }]), { status: 200 }));
      }
      if (url.includes("/contents/data/movies.json?ref=")) {
        const content = btoa('{"version":1,"types":[],"items":[]}');
        return Promise.resolve(new Response(JSON.stringify({ content, sha: "s1" }), { status: 200 }));
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    };
    Math.random = () => 0;

    try {
      const result = await new GitHubRepository().save("tok", (d) => { d.version = 2; }, "msg");
      assert.equal(result.branch, "data/2026-11");
      assert.equal(calls.filter((c) => c.method === "PUT").length, 2);
      assert.equal(calls.filter((c) => c.method === "GET" && c.url.includes("/contents/data/movies.json?ref=")).length, 2);
    } finally {
      globalThis.fetch = originalFetch;
      Math.random = originalRandom;
    }
  });
});
