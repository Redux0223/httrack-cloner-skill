import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, cpSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import test from "node:test";

const evalRoot = resolve("tests");
const mirrorSource = join(evalRoot, "fixture/mirror");
const originRoot = join(evalRoot, "fixture/origin");
const workingMirror = join(evalRoot, "fixture/dynamic-mirror");
const externalOutput = join(evalRoot, "fixture/external-output");
const hints = join(evalRoot, "fixture/asset-hints.txt");
const script = resolve("./scripts/fetch-dynamic-assets.mjs");

const contentTypes = new Map([
  [".glb", "model/gltf-binary"],
  [".js", "text/javascript"],
]);

test("fetches source-origin assets referenced only inside downloaded bundles", async (t) => {
  rmSync(workingMirror, { recursive: true, force: true });
  cpSync(mirrorSource, workingMirror, { recursive: true });
  const expected = join(workingMirror, "assets/models/test.glb");
  const lazyChunk = join(workingMirror, "assets/lazy.js");
  const nestedAsset = join(workingMirror, "assets/nested.webp");
  const audioAsset = join(workingMirror, "assets/audio/test.mp3");
  const hintedAsset = join(workingMirror, "vendor/draco/draco_decoder.wasm");
  const shaderAsset = join(workingMirror, "assets/shaders/compiled.vs");
  appendFileSync(join(workingMirror, "assets/site.js"), '\nfetch("/assets/shaders/compiled.vs");\n');
  assert.equal(existsSync(expected), false);

  let dracoAttempts = 0;
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/vendor/draco/draco_decoder.wasm" && dracoAttempts++ === 0) {
      response.writeHead(503).end("retry");
      return;
    }
    if (pathname === "/assets/shaders/compiled.vs") {
      response.setHeader("content-type", "text/plain");
      response.end("{@}Fixture.vs{@}void main() {}\n");
      return;
    }
    const file = join(originRoot, pathname);
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end("not found");
      return;
    }
    response.setHeader("content-type", contentTypes.get(extname(file)) || "application/octet-stream");
    response.end(readFileSync(file));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => server.close());
  const address = server.address();

  const result = await new Promise((resolveRun) => {
    const child = spawn(
      process.execPath,
      [script, "--mirror", workingMirror, "--source-url", `http://127.0.0.1:${address.port}/`, "--hints", hints],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(readFileSync(expected, "utf8"), "fixture-glb\n");
  assert.equal(readFileSync(lazyChunk, "utf8"), 'export const prepare = () => "/assets/nested.webp";\n');
  assert.equal(readFileSync(nestedAsset, "utf8"), "fixture-nested-image\n");
  assert.equal(readFileSync(audioAsset, "utf8"), "fixture-audio\n");
  assert.equal(readFileSync(hintedAsset, "utf8"), "fixture-draco\n");
  assert.equal(readFileSync(shaderAsset, "utf8"), "{@}Fixture.vs{@}void main() {}\n");
});

test("localizes external stylesheets and lazy images used by captured HTML", async (t) => {
  rmSync(workingMirror, { recursive: true, force: true });
  rmSync(externalOutput, { recursive: true, force: true });
  cpSync(mirrorSource, workingMirror, { recursive: true });

  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/theme.css") {
      response.setHeader("content-type", "text/css");
      response.end('.external-hero{background-image:url("./nested.png");color:rgb(1,2,3)}\n');
      return;
    }
    if (pathname === "/hero.png" || pathname === "/nested.png") {
      response.setHeader("content-type", "image/png");
      response.end(`fixture-${pathname.slice(1)}\n`);
      return;
    }
    response.writeHead(404).end("not found");
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => server.close());
  const address = server.address();
  const cdn = `http://127.0.0.1:${address.port}`;
  appendFileSync(
    join(workingMirror, "index.html"),
    `\n<link rel="stylesheet" href="${cdn}/theme.css?theme=1&amp;variant=red"><main class="external-hero"><img src="/assets/hero.png" data-src="${cdn}/hero.png"></main>\n`,
  );

  const fetched = await new Promise((resolveRun) => {
    const child = spawn(
      process.execPath,
      [script, "--mirror", workingMirror, "--source-url", "https://fixture.example/"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });
  assert.equal(fetched.status, 0, fetched.stderr || fetched.stdout);

  const report = JSON.parse(readFileSync(join(workingMirror, "dynamic-assets-report.json"), "utf8"));
  const externalEntries = report.fetched.filter((entry) => entry.url.startsWith(cdn));
  assert.equal(externalEntries.length, 3);
  assert.ok(externalEntries.some((entry) => entry.url === `${cdn}/theme.css?theme=1&variant=red`));
  assert.ok(externalEntries.every((entry) => !entry.url.includes("&amp;")));
  assert.ok(externalEntries.every((entry) => entry.path.startsWith("_external/")));
  assert.ok(externalEntries.every((entry) => existsSync(join(workingMirror, entry.path))));

  const converted = await new Promise((resolveRun) => {
    const child = spawn(
      process.execPath,
      [resolve("./scripts/run-pipeline.mjs"), "--input", workingMirror, "--output", externalOutput, "--source-url", "https://fixture.example/"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });
  assert.equal(converted.status, 0, converted.stderr || converted.stdout);

  const css = readFileSync(join(externalOutput, "src/styles/source.css"), "utf8");
  const home = readFileSync(join(externalOutput, "src/pages/HomePage.tsx"), "utf8");
  const networkPolicy = readFileSync(join(externalOutput, "src/runtime/network-policy.ts"), "utf8");
  assert.match(css, /external-hero/);
  assert.match(css, /\/_external\/.+nested\.png/);
  const publicExternalCss = readFileSync(join(externalOutput, externalEntries.find((entry) => entry.url.includes("theme.css")).path.replace(/^_external\//, "public/_external/")), "utf8");
  assert.match(publicExternalCss, /\/_external\/.+nested\.png/);
  assert.match(home, /data-src=\{"\/_external\/.+hero\.png"\}/);
  assert.match(home, /src=\{"\/_external\/.+hero\.png"\}/);
  assert.doesNotMatch(home, /https?:\/\/127\.0\.0\.1/);
  assert.match(networkPolicy, /remoteAssetRoutes/);
  assert.match(networkPolicy, /patchUrlProperty/);
  assert.match(networkPolicy, /theme\.css\?theme=1&variant=red/);
});

test("rejects HTML fallback responses discovered as JavaScript assets", async (t) => {
  rmSync(workingMirror, { recursive: true, force: true });
  cpSync(mirrorSource, workingMirror, { recursive: true });
  appendFileSync(join(workingMirror, "assets/site.js"), '\nconst optionalChunk = "/assets/fallback.js";\n');

  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/assets/fallback.js") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end("<!doctype html><html><body>fallback</body></html>");
      return;
    }
    const file = join(originRoot, pathname);
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end("not found");
      return;
    }
    response.setHeader("content-type", contentTypes.get(extname(file)) || "application/octet-stream");
    response.end(readFileSync(file));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => server.close());
  const address = server.address();

  const result = await new Promise((resolveRun) => {
    const child = spawn(
      process.execPath,
      [script, "--mirror", workingMirror, "--source-url", `http://127.0.0.1:${address.port}/`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(join(workingMirror, "assets/fallback.js")), false);
  const report = JSON.parse(readFileSync(join(workingMirror, "dynamic-assets-report.json"), "utf8"));
  assert.equal(report.failed.length, 0);
  assert.ok(report.rejected.some((entry) => entry.path === "assets/fallback.js" && entry.classification === "html"));
});

test("does not truncate json asset references to a js extension", async (t) => {
  rmSync(workingMirror, { recursive: true, force: true });
  cpSync(mirrorSource, workingMirror, { recursive: true });
  appendFileSync(join(workingMirror, "assets/site.js"), '\nfetch("/assets/runtime/config.json");\n');

  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/assets/runtime/config.json") {
      response.setHeader("content-type", "application/json");
      response.end('{"ready":true}\n');
      return;
    }
    const file = join(originRoot, pathname);
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end("not found");
      return;
    }
    response.setHeader("content-type", contentTypes.get(extname(file)) || "application/octet-stream");
    response.end(readFileSync(file));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => server.close());
  const address = server.address();

  const result = await new Promise((resolveRun) => {
    const child = spawn(
      process.execPath,
      [script, "--mirror", workingMirror, "--source-url", `http://127.0.0.1:${address.port}/`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(readFileSync(join(workingMirror, "assets/runtime/config.json"), "utf8"), '{"ready":true}\n');
  const report = JSON.parse(readFileSync(join(workingMirror, "dynamic-assets-report.json"), "utf8"));
  assert.ok(report.fetched.some((entry) => entry.path === "assets/runtime/config.json"));
  assert.ok(!report.failed.some((entry) => entry.path === "assets/runtime/config.js"));
});

test("times out stalled dynamic asset requests and keeps producing a report", async (t) => {
  rmSync(workingMirror, { recursive: true, force: true });
  cpSync(mirrorSource, workingMirror, { recursive: true });
  appendFileSync(join(workingMirror, "assets/site.js"), '\nfetch("/assets/stalled.json");\n');

  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/assets/stalled.json") return;
    response.writeHead(404).end("not found");
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  const startedAt = Date.now();

  const result = await new Promise((resolveRun) => {
    const child = spawn(
      process.execPath,
      [
        script,
        "--mirror", workingMirror,
        "--source-url", `http://127.0.0.1:${address.port}/`,
        "--timeout-ms", "100",
        "--retries", "1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(Date.now() - startedAt < 10_000);
  const report = JSON.parse(readFileSync(join(workingMirror, "dynamic-assets-report.json"), "utf8"));
  assert.ok(report.failed.some((entry) => entry.path === "assets/stalled.json"));
});
