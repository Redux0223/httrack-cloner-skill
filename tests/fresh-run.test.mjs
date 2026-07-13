import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { allocateFreshRun, loadRunInvocation } from "../scripts/run-url.mjs";

test("allocates a unique fresh URL-only run with resumable provenance", () => {
  const runsRoot = mkdtempSync(join(tmpdir(), "cloner-fresh-runs-"));
  const first = allocateFreshRun({
    url: "https://santionispirits.com/",
    runsRoot,
    now: new Date("2026-07-12T12:34:56.000Z"),
    nonce: "aaaaaa",
  });
  const second = allocateFreshRun({
    url: "https://santionispirits.com/",
    runsRoot,
    now: new Date("2026-07-12T12:34:56.000Z"),
    nonce: "bbbbbb",
  });

  assert.notEqual(first.work, second.work);
  assert.equal(existsSync(join(first.work, ".cloner/invocation.json")), true);
  assert.equal(existsSync(join(first.work, "react")), false);
  const loaded = loadRunInvocation(first.work);
  assert.equal(loaded.url, "https://santionispirits.com/");
  assert.equal(loaded.fresh, true);
  assert.equal(loaded.work, first.work);
  assert.equal(existsSync(join(runsRoot, "current-santionispirits.com.json")), false);
});

test("refuses to resume a directory that was not allocated by the URL launcher", () => {
  const oldRun = mkdtempSync(join(tmpdir(), "cloner-old-run-"));
  assert.throws(() => loadRunInvocation(oldRun), /stale-run-reuse-forbidden/);
});

test("refuses a tampered fresh-run invocation", () => {
  const runsRoot = mkdtempSync(join(tmpdir(), "cloner-tampered-run-"));
  const invocation = allocateFreshRun({
    url: "https://santionispirits.com/",
    runsRoot,
    now: new Date("2026-07-12T12:34:56.000Z"),
    nonce: "cccccc",
  });
  const invocationFile = join(invocation.work, ".cloner/invocation.json");
  const tampered = JSON.parse(readFileSync(invocationFile, "utf8"));
  tampered.options.sourcePreview = "http://127.0.0.1:9999/";
  writeFileSync(invocationFile, JSON.stringify(tampered));

  assert.throws(() => loadRunInvocation(invocation.work), /stale-run-reuse-forbidden/);
});
