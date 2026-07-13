import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { ensureCleanDir } from "../scripts/lib.mjs";

const evalRoot = resolve("tests");
const input = join(evalRoot, "fixture/security-mirror");
const output = join(evalRoot, "fixture/security-output");
const outside = join(evalRoot, "fixture/outside-secret.txt");
const pipeline = resolve("./scripts/run-pipeline.mjs");

test("refuses to clean the current working directory", () => {
  assert.throws(() => ensureCleanDir(process.cwd()), /protected directory/i);
});

test("rejects symbolic links instead of copying files outside the mirror", () => {
  rmSync(input, { recursive: true, force: true });
  rmSync(output, { recursive: true, force: true });
  writeFileSync(outside, "do-not-copy\n");
  cpSync(join(evalRoot, "fixture/mirror"), input, { recursive: true });
  symlinkSync(outside, join(input, "assets/escape.txt"));

  const result = spawnSync(
    process.execPath,
    [pipeline, "--input", input, "--output", output, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );

  assert.notEqual(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr + result.stdout, /symbolic link/i);
});

test("rejects output directories that overlap the input mirror", () => {
  const overlapInput = join(evalRoot, "fixture/overlap-mirror");
  const overlapOutput = join(overlapInput, "react-output");
  rmSync(overlapInput, { recursive: true, force: true });
  cpSync(join(evalRoot, "fixture/mirror"), overlapInput, { recursive: true });

  const result = spawnSync(
    process.execPath,
    [pipeline, "--input", overlapInput, "--output", overlapOutput, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );

  assert.notEqual(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr + result.stdout, /must not overlap/i);
  assert.equal(existsSync(join(overlapInput, "index.html")), true);
});
