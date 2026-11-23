import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GitHubRepository, branchStillCurrent } from "../src/data/github.js";

interface RecordedCall { method: string; url: string; headers: Record<string, string> }

type Handler = (method: string, url: string) => Response;

async function withFetch(handler: Handler, run: (calls: RecordedCall[]) => Promise<void>): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalRandom = Math.random;
  const calls: RecordedCall[] = [];
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, headers: (init?.headers ?? {}) as Record<string, string> });
    return Promise.resolve(handler(method, url));
  };
  Math.random = () => 0;
  try { await run(calls); }
  finally { globalThis.fetch = originalFetch; Math.random = originalRandom; }
}

const isRefs = (url: string): boolean => url.endsWith("/git/matching-refs/heads/data/");
const refsResponse = (...names: string[]): Response => new Response(JSON.stringify(names.map((n) => ({ ref: `refs/heads/${n}` }))), { status: 200 });
const fileResponse = (): Response => new Response(JSON.stringify({ content: btoa('{"version":1,"types":[],"items":[]}'), sha: "s1" }), { status: 200 });
const label = (c: RecordedCall): string => (isRefs(c.url) ? "REFS" : c.method);

describe("GitHubRepository.save", () => {
  test("waits before retrying on conflict and succeeds on the second PUT", async () => {
    let puts = 0;
    await withFetch((method, url) => {
      if (method === "PUT") { puts++; return new Response("{}", { status: puts === 1 ? 409 : 200 }); }
      if (isRefs(url)) return refsResponse("data/2026-11");
      return fileResponse();
    }, async (calls) => {
      const result = await new GitHubRepository().save("tok", (d) => { d.version = 2; }, "msg");
      assert.equal(result.branch, "data/2026-11");
      assert.equal(calls.filter((c) => c.method === "PUT").length, 2);
      assert.equal(calls.filter((c) => c.method === "GET" && c.url.includes("/contents/data/movies.json?ref=")).length, 2);
    });
  });

  test("warm cache: a save is 2 requests (GET + PUT), no branch resolve", async () => {
    await withFetch((method, url) => {
      if (method === "PUT") return new Response("{}", { status: 200 });
      if (isRefs(url)) return refsResponse("data/2099-01-05_2099-01-11");
      return fileResponse();
    }, async (calls) => {
      const repo = new GitHubRepository();
      await repo.save("tok", () => {}, "first");
      assert.equal(calls.length, 3); // cold: refs + GET + PUT
      calls.length = 0;
      const result = await repo.save("tok", () => {}, "second");
      assert.equal(result.branch, "data/2099-01-05_2099-01-11");
      assert.deepEqual(calls.map(label), ["GET", "PUT"]);
    });
  });

  test("load warms the cache and always re-resolves", async () => {
    await withFetch((method, url) => {
      if (method === "PUT") return new Response("{}", { status: 200 });
      if (isRefs(url)) return refsResponse("data/2099-01-05_2099-01-11");
      return fileResponse();
    }, async (calls) => {
      const repo = new GitHubRepository();
      await repo.load("tok");
      await repo.load("tok");
      assert.equal(calls.filter((c) => isRefs(c.url)).length, 2);
      calls.length = 0;
      await repo.save("tok", () => {}, "m");
      assert.deepEqual(calls.map(label), ["GET", "PUT"]);
    });
  });

  test("409 drops the cache: the retry re-resolves and uses the rotated branch", async () => {
    let refsCalls = 0;
    let puts = 0;
    await withFetch((method, url) => {
      if (isRefs(url)) { refsCalls++; return refsResponse(refsCalls === 1 ? "data/2099-01-05_2099-01-11" : "data/2099-01-12_2099-01-18"); }
      if (method === "PUT") { puts++; return new Response("{}", { status: puts === 1 ? 409 : 200 }); }
      return fileResponse();
    }, async (calls) => {
      const repo = new GitHubRepository();
      await repo.load("tok");
      calls.length = 0;
      const result = await repo.save("tok", () => {}, "m");
      assert.equal(result.branch, "data/2099-01-12_2099-01-18");
      assert.deepEqual(calls.map(label), ["GET", "PUT", "REFS", "GET", "PUT"]);
      assert.ok(calls[0]?.url.includes("ref=data%2F2099-01-05_2099-01-11"));
      assert.ok(calls[3]?.url.includes("ref=data%2F2099-01-12_2099-01-18"));
    });
  });

  test("404 on the contents GET drops the cache and re-resolves", async () => {
    let refsCalls = 0;
    let gets = 0;
    await withFetch((method, url) => {
      if (isRefs(url)) { refsCalls++; return refsResponse(refsCalls === 1 ? "data/2099-01-05_2099-01-11" : "data/2099-01-12_2099-01-18"); }
      if (method === "PUT") return new Response("{}", { status: 200 });
      gets++;
      return gets === 2 ? new Response("{}", { status: 404 }) : fileResponse();
    }, async (calls) => {
      const repo = new GitHubRepository();
      await repo.load("tok");
      calls.length = 0;
      const result = await repo.save("tok", () => {}, "m");
      assert.equal(result.branch, "data/2099-01-12_2099-01-18");
      assert.deepEqual(calls.map(label), ["GET", "REFS", "GET", "PUT"]);
    });
  });
});

describe("branch cache across the weekly rollover", () => {
  test("a weekly branch stays current through its Sunday only; other names are never reused", () => {
    assert.equal(branchStillCurrent("data/2026-11-16_2026-11-22", "2026-11-22"), true);
    assert.equal(branchStillCurrent("data/2026-11-16_2026-11-22", "2026-11-23"), false);
    assert.equal(branchStillCurrent("master", "2026-11-22"), false);
  });

  test("a cached branch whose week is over is re-resolved before saving", async () => {
    let refsCalls = 0;
    await withFetch((method, url) => {
      if (isRefs(url)) { refsCalls++; return refsResponse(refsCalls === 1 ? "data/2000-01-03_2000-01-09" : "data/2099-01-05_2099-01-11"); }
      if (method === "PUT") return new Response("{}", { status: 200 });
      return fileResponse();
    }, async (calls) => {
      const repo = new GitHubRepository();
      await repo.load("tok");
      calls.length = 0;
      const result = await repo.save("tok", () => {}, "m");
      assert.equal(result.branch, "data/2099-01-05_2099-01-11");
      assert.deepEqual(calls.map(label), ["REFS", "GET", "PUT"]);
    });
  });
});

describe("GitHubRepository.load without a token", () => {
  test("reads the public GitHub API without Authorization", async () => {
    await withFetch((_method, url) => (isRefs(url) ? refsResponse("data/2099-01-05_2099-01-11") : fileResponse()), async (calls) => {
      const loaded = await new GitHubRepository().load("");
      assert.equal(loaded.branch, "data/2099-01-05_2099-01-11");
      assert.equal(calls.length, 2);
      for (const call of calls) {
        assert.ok(call.url.startsWith("https://api.github.com/"));
        assert.equal(call.headers.Authorization, undefined);
      }
    });
  });

  test("falls back to the Pages copy when the API fails", async () => {
    await withFetch((_method, url) => {
      if (url === "data/movies.json") return new Response('{"version":1,"types":[],"items":[]}', { status: 200 });
      return new Response("{}", { status: 403 });
    }, async (calls) => {
      const loaded = await new GitHubRepository().load("");
      assert.equal(loaded.branch, null);
      assert.equal(calls.at(-1)?.url, "data/movies.json");
    });
  });

  test("with a token an API failure is not masked by the local copy", async () => {
    await withFetch(() => new Response("{}", { status: 500 }), async (calls) => {
      await assert.rejects(new GitHubRepository().load("tok"));
      assert.ok(!calls.some((c) => c.url === "data/movies.json"));
    });
  });
});
