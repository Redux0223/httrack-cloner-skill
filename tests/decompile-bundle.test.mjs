import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixtureRoot = resolve("tests/fixture/decompile");
const runner = resolve("./scripts/decompile-bundle.mjs");

test("decompiles a captured business bundle into readable source with provenance", () => {
  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(fixtureRoot, { recursive: true });
  const input = join(fixtureRoot, "main-deadbeef.js");
  const output = join(fixtureRoot, "runtime-source.js");
  const report = join(fixtureRoot, "decompile-report.json");
  writeFileSync(input, "(()=>{const e='READY';window.__fixture={start(){return e}}})()", "utf8");

  const result = spawnSync(process.execPath, [
    runner,
    "--input", input,
    "--output", output,
    "--report", report,
  ], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const source = readFileSync(output, "utf8");
  assert.match(source, /READY/);
  assert.ok(source.split("\n").length > 3, "expected readable multiline output");
  const provenance = JSON.parse(readFileSync(report, "utf8"));
  assert.equal(provenance.input, "main-deadbeef.js");
  assert.equal(provenance.output, "runtime-source.js");
  assert.match(provenance.inputSha256, /^[a-f0-9]{64}$/);
  assert.match(provenance.outputSha256, /^[a-f0-9]{64}$/);
  assert.equal(provenance.sourceMapUsed, false);
});
