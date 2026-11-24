import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const WORKFLOWS_DIR = ".github/workflows";

function getWorkflowFiles(): { name: string; content: string }[] {
  const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  return files.map((file) => ({
    name: file,
    content: readFileSync(`${WORKFLOWS_DIR}/${file}`, "utf8"),
  }));
}

test("no workflow has a push trigger whose branches mention data/", () => {
  const workflows = getWorkflowFiles();
  for (const wf of workflows) {
    // Check if push: triggers mention data/
    // A push block can be:
    // push:
    //   branches: [...]
    // or push: ['...']
    const pushIndex = wf.content.indexOf("push:");
    if (pushIndex !== -1) {
      // Find the slice of lines under on: push
      const afterPush = wf.content.slice(pushIndex);
      // It continues until the next unindented top-level key or end of on block
      const lines = afterPush.split("\n");
      const pushLines: string[] = [lines[0]];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/^[a-zA-Z0-9_-]+:/)) {
          break; // Next top-level block
        }
        pushLines.push(line);
      }
      const pushBlock = pushLines.join("\n");
      assert.ok(
        !pushBlock.includes("data/"),
        `Workflow ${wf.name} has a push trigger mentioning data/: \n${pushBlock}`,
      );
    }
  }
});

test("deploy.yml checkout uses github.event.workflow_run.head_sha", () => {
  const deploy = readFileSync(`${WORKFLOWS_DIR}/deploy.yml`, "utf8");
  assert.ok(
    deploy.includes("github.event.workflow_run.head_sha"),
    "deploy.yml must checkout head_sha from workflow_run",
  );
});

test("every runs-on: job in every workflow has timeout-minutes", () => {
  const workflows = getWorkflowFiles();
  for (const wf of workflows) {
    const lines = wf.content.split("\n");
    let inJobs = false;
    let currentJob: string | null = null;
    let currentJobHasRunsOn = false;
    let currentJobHasTimeout = false;

    function checkCurrentJob() {
      if (currentJob && currentJobHasRunsOn) {
        assert.ok(
          currentJobHasTimeout,
          `Workflow ${wf.name}, job '${currentJob}' has 'runs-on' but lacks 'timeout-minutes'`,
        );
      }
    }

    for (const line of lines) {
      if (/^[a-zA-Z0-9_-]+:/.test(line)) {
        if (/^jobs:/.test(line)) {
          inJobs = true;
        } else {
          checkCurrentJob();
          inJobs = false;
          currentJob = null;
        }
        continue;
      }

      if (inJobs) {
        // Job identifier under jobs: (indented by 2 spaces)
        const jobMatch = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
        if (jobMatch) {
          checkCurrentJob();
          currentJob = jobMatch[1];
          currentJobHasRunsOn = false;
          currentJobHasTimeout = false;
          continue;
        }

        if (currentJob) {
          if (/^\s+runs-on:/.test(line)) {
            currentJobHasRunsOn = true;
          }
          if (/^\s+timeout-minutes:/.test(line)) {
            currentJobHasTimeout = true;
          }
        }
      }
    }
    checkCurrentJob();
  }
});

test("no workflow uses node-version: (only node-version-file: .nvmrc)", () => {
  const workflows = getWorkflowFiles();
  for (const wf of workflows) {
    const lines = wf.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      assert.ok(
        !/^\s*node-version:\s*/.test(line),
        `Workflow ${wf.name} line ${i + 1} uses 'node-version:' instead of 'node-version-file: .nvmrc'`,
      );
    }
  }
});
