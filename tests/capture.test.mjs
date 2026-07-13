import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import test from "node:test";

const evalRoot = resolve("tests");
const origin = join(evalRoot, "fixture/capture-origin");
const output = join(evalRoot, "fixture/capture-output");
const capture = resolve("./scripts/capture-site.mjs");

test("captures a site with HTTrack and fills dynamic asset gaps", async (t) => {
  rmSync(origin, { recursive: true, force: true });
  rmSync(output, { recursive: true, force: true });
  cpSync(join(evalRoot, "fixture/mirror"), origin, { recursive: true });
  mkdirSync(join(origin, "assets"), { recursive: true });
  cpSync(join(evalRoot, "fixture/origin/assets"), join(origin, "assets"), { recursive: true });

  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const file = join(origin, pathname === "/" ? "index.html" : pathname);
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end("not found");
      return;
    }
    response.setHeader("content-type", extname(file) === ".html" ? "text/html" : "application/octet-stream");
    response.end(readFileSync(file));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => server.close());
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;

  const result = await new Promise((resolveRun) => {
    const child = spawn(process.execPath, [capture, "--url", url, "--output", output, "--ignore-robots", "--authorized"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(join(output, "capture-report.json"), "utf8"));
  assert.match(report.engine, /^HTTrack 3[.]49-\d+$/);
  assert.ok(existsSync(join(report.siteRoot, "index.html")));
  assert.ok(existsSync(join(report.siteRoot, "assets/models/test.glb")));
  assert.ok(existsSync(join(report.siteRoot, "assets/constructed.123.js")));
  assert.ok(existsSync(report.inventoryFile));
  const inventory = JSON.parse(readFileSync(report.inventoryFile, "utf8"));
  const model = inventory.files.find((file) => file.path === "assets/models/test.glb");
  assert.equal(model.sha256.length, 64);
  assert.ok(model.bytes > 0);
});

test("refuses to run HTTrack without explicit authorization", () => {
  const result = spawnSync(
    process.execPath,
    [capture, "--url", "http://127.0.0.1:9/", "--output", join(evalRoot, "fixture/unauthorized-output")],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr + result.stdout, /authorized/i);
});
