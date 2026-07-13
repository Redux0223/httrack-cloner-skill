import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve("tests");
const input = join(root, "fixture/navigation-mirror");
const output = join(root, "fixture/navigation-output");
const runner = resolve("./scripts/run-pipeline.mjs");

test("uses TanStack Link for known routes and preserves ordinary anchor semantics", () => {
  rmSync(input, { recursive: true, force: true });
  rmSync(output, { recursive: true, force: true });
  cpSync(join(root, "fixture/mirror"), input, { recursive: true });

  const indexPath = join(input, "index.html");
  const source = readFileSync(indexPath, "utf8")
    .replace(
      '<a href="about.html">About</a>',
      '<a href="about.html?tab=team#bio">About</a>\n      <a href="missing.html">Missing</a>\n      <a href="https://docs.example.test/guide" target="_blank">Docs</a>\n      <a href="assets/hero.png" download>Download</a>',
    );
  writeFileSync(indexPath, source);

  const result = spawnSync(
    process.execPath,
    [runner, "--input", input, "--output", output, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const home = readFileSync(join(output, "src/pages/HomePage.tsx"), "utf8");
  const main = readFileSync(join(output, "src/main.tsx"), "utf8");
  assert.match(home, /import \{ Link \} from "@tanstack\/react-router"/);
  assert.match(home, /<Link to=\{"\/about"\} search=\{\{ "tab": "team" \}\} hash=\{"bio"\}>/);
  assert.match(home, /<a href=\{"\/missing\.html"\}>/);
  assert.match(home, /<a href=\{"https:\/\/docs\.example\.test\/guide"\} target=\{"_blank"\}>/);
  assert.match(home, /<a href=\{"\/assets\/hero\.png"\} download>/);
  assert.doesNotMatch(main, /addEventListener\("click"|pushState|popstate/);
});
