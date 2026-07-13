import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const evalRoot = resolve("tests");
const input = join(evalRoot, "fixture/assets-mirror");
const output = join(evalRoot, "fixture/assets-output");
const pipeline = resolve("./scripts/run-pipeline.mjs");
const verifier = resolve("./scripts/verify-local-assets.mjs");

test("creates a hashed asset inventory and reports uncertain bundle sinks without blocking output", () => {
  rmSync(output, { recursive: true, force: true });
  rmSync(input, { recursive: true, force: true });
  cpSync(join(evalRoot, "fixture/mirror"), input, { recursive: true });
  cpSync(join(evalRoot, "fixture/origin/assets"), join(input, "assets"), { recursive: true });
  const conversion = spawnSync(
    process.execPath,
    [pipeline, "--input", input, "--output", output, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(conversion.status, 0, conversion.stderr || conversion.stdout);

  const clean = spawnSync(process.execPath, [verifier, "--project", output], { encoding: "utf8" });
  assert.equal(clean.status, 0, clean.stderr || clean.stdout);

  appendFileSync(
    join(output, "public/assets/site.js"),
    '\nconst missingModel = "/assets/models/missing.glb";\nconst image = new Image();\nimage.src = missingModel;\n',
  );
  const dirty = spawnSync(process.execPath, [verifier, "--project", output], { encoding: "utf8" });
  assert.equal(dirty.status, 0, dirty.stderr || dirty.stdout);
  assert.match(dirty.stderr + dirty.stdout, /diagnostic.*missing\.glb/i);

  const strict = spawnSync(
    process.execPath,
    [verifier, "--project", output, "--strict-runtime"],
    { encoding: "utf8" },
  );
  assert.equal(strict.status, 3, strict.stderr || strict.stdout);
  assert.match(strict.stderr + strict.stdout, /missing\.glb/);
});

test("ignores quoted JavaScript module-table keys that are not runtime asset sinks", () => {
  rmSync(output, { recursive: true, force: true });
  rmSync(input, { recursive: true, force: true });
  cpSync(join(evalRoot, "fixture/mirror"), input, { recursive: true });
  cpSync(join(evalRoot, "fixture/origin/assets"), join(input, "assets"), { recursive: true });
  const conversion = spawnSync(
    process.execPath,
    [pipeline, "--input", input, "--output", output, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(conversion.status, 0, conversion.stderr || conversion.stdout);

  appendFileSync(
    join(output, "public/assets/site.js"),
    `
const bundledModules = {
  "./backend/backend.js": function backendModule() {},
  "./node_modules/pako/lib/deflate.js": function pakoModule() {},
};
const optionalDevelopmentAsset = "assets/data/cssError.json";
void bundledModules;
void optionalDevelopmentAsset;
`,
  );

  const result = spawnSync(process.execPath, [verifier, "--project", output], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("tracks constant paths used by browser, worker, import, and loader sinks as diagnostics", () => {
  rmSync(output, { recursive: true, force: true });
  rmSync(input, { recursive: true, force: true });
  cpSync(join(evalRoot, "fixture/mirror"), input, { recursive: true });
  cpSync(join(evalRoot, "fixture/origin/assets"), join(input, "assets"), { recursive: true });
  const conversion = spawnSync(
    process.execPath,
    [pipeline, "--input", input, "--output", output, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(conversion.status, 0, conversion.stderr || conversion.stdout);

  appendFileSync(
    join(output, "public/assets/site.js"),
    `
const assetRoot = "/assets/runtime/";
const responsePath = assetRoot + "missing-data.json";
fetch(responsePath);
new Worker(new URL("./missing-worker.js", import.meta.url));
import("./missing-chunk.js");
video.setAttribute("poster", "/assets/runtime/missing-poster.jpg");
modelLoader.load("/assets/runtime/missing-model.glb");
new Audio("/assets/runtime/missing-audio.mp3");
window.ASSETS = ["/assets/runtime/missing-decoder.wasm"];
`,
  );

  const result = spawnSync(process.execPath, [verifier, "--project", output], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const expected of [
    "missing-data.json",
    "missing-worker.js",
    "missing-chunk.js",
    "missing-poster.jpg",
    "missing-model.glb",
    "missing-audio.mp3",
    "missing-decoder.wasm",
  ]) {
    assert.match(result.stderr + result.stdout, new RegExp(expected.replace(".", "\\.")));
  }
});

test("resolves Emscripten locateFile assets relative to the JavaScript file", () => {
  rmSync(output, { recursive: true, force: true });
  rmSync(input, { recursive: true, force: true });
  cpSync(join(evalRoot, "fixture/mirror"), input, { recursive: true });
  cpSync(join(evalRoot, "fixture/origin/assets"), join(input, "assets"), { recursive: true });
  const conversion = spawnSync(
    process.execPath,
    [pipeline, "--input", input, "--output", output, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(conversion.status, 0, conversion.stderr || conversion.stdout);

  writeFileSync(join(output, "public/assets/relative-runtime.wasm"), "fixture-wasm\n");
  appendFileSync(
    join(output, "public/assets/site.js"),
    `
let wasmBinaryFile = "relative-runtime.wasm";
function isDataURI(filename) { return filename.startsWith("data:application/octet-stream;base64,"); }
if (!isDataURI(wasmBinaryFile)) {
  wasmBinaryFile = locateFile(wasmBinaryFile);
}
fetch(wasmBinaryFile);
`,
  );

  const result = spawnSync(process.execPath, [verifier, "--project", output], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
