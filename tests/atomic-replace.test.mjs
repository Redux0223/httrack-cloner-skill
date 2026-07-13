import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const script = resolve("./scripts/atomic-replace.mjs");

test("atomically replaces a React source file from a prepared input file", () => {
  const run = mkdtempSync(join(tmpdir(), "cloner-atomic-replace-"));
  const target = join(run, "react/src/pages/HomePage.tsx");
  const input = join(run, ".cloner/candidate.tsx");
  mkdirSync(join(target, ".."), { recursive: true });
  mkdirSync(join(input, ".."), { recursive: true });
  writeFileSync(target, "old\n");
  writeFileSync(input, "export default function HomePage(){ return <main>Captured</main>; }\n");

  const result = spawnSync(process.execPath, [script, "--run", run, "--target", target, "--input", input], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(readFileSync(target, "utf8"), /Captured/);
});

test("refuses targets outside the current run React source and config surface", () => {
  const run = mkdtempSync(join(tmpdir(), "cloner-atomic-replace-reject-"));
  const input = join(run, ".cloner/candidate.txt");
  mkdirSync(join(input, ".."), { recursive: true });
  writeFileSync(input, "unsafe\n");
  const result = spawnSync(process.execPath, [script, "--run", run, "--target", join(run, "mirror/index.html"), "--input", input], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /target-not-allowed/);
});
