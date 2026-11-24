import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const old = "data/2026-11-23_2026-11-29";
const current = "data/2026-11-30_2026-12-06";
const dataFile = "data/movies.json";
const script = resolve("scripts/rollover.sh").replaceAll("\\", "/");
const validator = resolve(".test-build/tools/validate-data.js").replaceAll("\\", "/");
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^git_/i.test(key))),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
let skip: string | boolean = false;
try {
  execFileSync("bash", ["-c", "(gdate -d 2026-11-30 +%F || date -d 2026-11-30 +%F) 2>/dev/null"],
    { encoding: "utf8", env });
} catch {
  if (process.env.GITHUB_ACTIONS && process.env.RUNNER_OS === "Linux") throw new Error("CI requires bash and GNU date");
  skip = "rollover requires bash and GNU date -d (install coreutils on macOS)";
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid",
    "-c", "core.hooksPath=/dev/null", ...args], { cwd, env, encoding: "utf8", stdio: "pipe" }).trim();
}

function movies(first = "First", last = "Last"): string {
  const items = [first, "Middle", last].map((title, index) => ({ id: String(index), title, status: "planned" }));
  return JSON.stringify({ items }, null, 2) + "\n";
}

function fixture(root: string) {
  const origin = join(root, "origin.git");
  const seed = join(root, "seed");
  const runner = join(root, "runner");
  const output = join(root, "output");
  git(root, "init", "--bare", "--initial-branch=master", origin);
  git(root, "clone", origin, seed);
  mkdirSync(join(seed, "data"));
  writeFileSync(join(seed, dataFile), movies());
  writeFileSync(join(seed, "README.md"), "Unrelated file\n");
  git(seed, "add", ".");
  git(seed, "commit", "-m", "Seed fixture");
  git(seed, "push", "origin", "master");

  function edit(data: string, message = "Edit movie", author = "test <test@example.invalid>") {
    writeFileSync(join(seed, dataFile), data);
    git(seed, "add", dataFile);
    git(seed, "commit", "--author", author, "-m", message);
    git(seed, "push", "origin", "HEAD");
  }

  function run(overrides: Record<string, string> = {}) {
    // Clone after seeding the branches. Reuse this clone for the second bootstrap invocation.
    if (!readied) {
      git(root, "clone", origin, runner);
      readied = true;
    }
    writeFileSync(output, "");
    // The production script runs VALIDATOR by word splitting. Forward the absolute path
    // via a quoted variable on machines where the checkout path contains whitespace.
    writeFileSync(join(runner, "validate.sh"), 'exec node "$ROLLOVER_VALIDATOR" "$@"\n');
    const options = {
      cwd: runner, encoding: "utf8" as const, timeout: 30000,
      env: { ...env, TZ_NAME: "Europe/Sofia", NOW_OVERRIDE: "2026-11-30 01:00", LATE_WAIT: "0",
        BOOTSTRAP: "0", DRY_RUN: "0", GITHUB_OUTPUT: output, VALIDATOR: "true", ROLLOVER_VALIDATOR: validator, ...overrides },
    };
    return new Promise<{ ok: boolean; log: string; output: string }>((done) =>
      execFile("bash", [script], options, (error, stdout, stderr) => done({
        ok: !error, log: stdout + stderr + (error?.message ?? ""), output: readFileSync(output, "utf8").trim(),
      })));
  }

  let readied = false;
  return {
    edit, run,
    refs: () => git(origin, "show-ref", "--heads"),
    tip: (branch: string) => git(origin, "rev-parse", branch),
    read: (...args: string[]) => git(origin, ...args),
    checkout: (branch: string) => git(seed, "checkout", branch),
    week: (branch = old) => git(seed, "checkout", "-b", branch, "master"),
    pushWeek: (branch: string) => git(seed, "push", "origin", branch),
  };
}

type Fixture = ReturnType<typeof fixture>;
function scenario(name: string, check: (repo: Fixture) => Promise<void>) {
  test("rollover: " + name, { skip }, async () => {
    const root = mkdtempSync(join(tmpdir(), "watchlist-rollover-test-"));
    try { await check(fixture(root)); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });
}

scenario("an empty origin needs explicit bootstrap", async (repo) => {
  const before = repo.refs();
  const idle = await repo.run();
  assert.ok(idle.ok, idle.log);
  assert.equal(idle.output, "pushed=false");
  assert.equal(repo.refs(), before);
  const created = await repo.run({ BOOTSTRAP: "1" });
  assert.ok(created.ok, created.log);
  assert.equal(created.output, "pushed=true");
  assert.equal(repo.tip(current), repo.tip("master"));
});

scenario("an existing current week is a no-op", async (repo) => {
  repo.week(current);
  repo.pushWeek(current);
  const before = repo.refs();
  const result = await repo.run();
  assert.ok(result.ok, result.log);
  assert.equal(repo.refs(), before);
  assert.equal(result.output, "pushed=false");
});

scenario("squash two authors and preserve unrelated files and the old branch", async (repo) => {
  const master = repo.tip("master");
  repo.week();
  repo.edit(movies("A"), "First change\n\nCo-authored-by: X <x@example.invalid>", "Alice <a@example.invalid>");
  repo.edit(movies("A", "B"), "Second change\n\nCo-authored-by: X <x@example.invalid>\nCo-authored-by: github-actions[bot] <41898099+github-actions[bot]@users.noreply.github.com>", "Bob <b@example.invalid>");
  const oldTip = repo.tip(old);
  const result = await repo.run({ VALIDATOR: /\s/.test(validator) ? "bash validate.sh" : "node " + validator });
  assert.ok(result.ok, result.log);
  assert.equal(result.output, "pushed=true");
  assert.equal(repo.read("rev-list", "--parents", "-1", "master"), repo.tip("master") + " " + master);
  assert.equal(repo.read("diff", "--name-only", master, "master"), dataFile);
  assert.equal(repo.tip("master:" + dataFile), repo.tip(old + ":" + dataFile));
  const message = repo.read("log", "-1", "--format=%B", "master").split("\n");
  assert.equal(message[0], "Data 2026-11-23 – 2026-11-29 (2 changes)");
  assert.deepEqual(message.filter((line) => line.startsWith("Co-authored-by:")).sort(), [
    "Co-authored-by: Alice <a@example.invalid>", "Co-authored-by: Bob <b@example.invalid>", "Co-authored-by: X <x@example.invalid>",
  ]);
  assert.equal(repo.tip(current), repo.tip("master"));
  assert.equal(repo.tip(old), oldTip);
});

scenario("independent master and weekly edits survive the merge", async (repo) => {
  repo.week();
  repo.edit(movies("Weekly"));
  repo.checkout("master");
  repo.edit(movies("First", "Master"));
  const result = await repo.run();
  assert.ok(result.ok, result.log);
  assert.equal(repo.read("show", "master:" + dataFile), movies("Weekly", "Master").trim());
});

scenario("conflicting edits leave all refs untouched", async (repo) => {
  repo.week();
  repo.edit(movies("Weekly"));
  repo.checkout("master");
  repo.edit(movies("Master"));
  const before = repo.refs();
  const result = await repo.run();
  assert.equal(result.ok, false, result.log);
  assert.match(result.log, /merge data\/movies\.json by hand/);
  assert.equal(repo.refs(), before);
  assert.equal(result.output, "pushed=false");
});

scenario("validator rejection prevents every push", async (repo) => {
  repo.week();
  repo.edit(movies("Weekly"));
  const before = repo.refs();
  const result = await repo.run({ VALIDATOR: "false" });
  assert.equal(result.ok, false, result.log);
  assert.match(result.log, /Data validation failed/);
  assert.equal(repo.refs(), before);
  assert.equal(result.output, "pushed=false");
});

scenario("dry run leaves all refs untouched", async (repo) => {
  repo.week();
  repo.edit(movies("Weekly"));
  const before = repo.refs();
  const result = await repo.run({ DRY_RUN: "1" });
  assert.ok(result.ok, result.log);
  assert.equal(repo.refs(), before);
  assert.equal(result.output, "pushed=false");
});

scenario("a later branch prevents backwards rotation", async (repo) => {
  const future = "data/2026-12-07_2026-12-13";
  repo.week(future);
  repo.pushWeek(future);
  const before = repo.refs();
  const result = await repo.run();
  assert.equal(result.ok, false, result.log);
  assert.match(result.log, /refusing to go backwards/);
  assert.equal(repo.refs(), before);
});

scenario("carry a late write to the new week", async (repo) => {
  repo.week();
  repo.edit(movies("Weekly"));
  const finished = repo.run({ LATE_WAIT: "4" });
  try {
    const deadline = Date.now() + 12000;
    while (!repo.refs().includes("refs/heads/" + current)) {
      assert.ok(Date.now() < deadline, "timed out waiting for the new week");
      await new Promise((done) => setTimeout(done, 80));
    }
    repo.edit(movies("Weekly", "Late"));
  } finally {
    const result = await finished;
    assert.ok(result.ok, result.log);
  }
  assert.equal(repo.read("rev-list", "--parents", "-1", current), repo.tip(current) + " " + repo.tip("master"));
  assert.equal(repo.read("log", "-1", "--format=%s", current), "Carry late changes from " + old);
  assert.equal(repo.read("show", current + ":" + dataFile), movies("Weekly", "Late").trim());
  assert.equal(repo.read("show", "master:" + dataFile), movies("Weekly").trim());
});
