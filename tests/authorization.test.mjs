import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve("tests");
const output = join(root, "fixture/authorization-output");
const runner = resolve("./scripts/run-pipeline.mjs");

test("generates an automatic authorization evidence inventory without a manual review queue", () => {
  rmSync(output, { recursive: true, force: true });
  const result = spawnSync(
    process.execPath,
    [runner, "--input", join(root, "fixture/mirror"), "--output", output, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(readFileSync(join(output, "reports/authorization-manifest.json"), "utf8"));
  assert.equal(report.sourceUrl, "https://fixture.example/");
  assert.equal(report.legalConclusion, false);
  assert.ok(["covered", "restricted", "unverified"].includes(report.decision));
  assert.ok(Array.isArray(report.basis));
  assert.ok(report.items.length > 0);
  assert.ok(report.items.every((item) => item.path && /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.ok(report.items.every((item) => ["covered", "restricted", "unverified"].includes(item.status)));
  assert.equal("manualReviewRequired" in report, false);
});
