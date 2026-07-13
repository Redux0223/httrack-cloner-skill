import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyReproducible } from "../scripts/verify-reproducible.mjs";

function write(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, value);
}

test("rebuilds and serves a clean project copy before delivery", async () => {
  const project = mkdtempSync(join(tmpdir(), "repro-project-"));
  write(join(project, "package.json"), JSON.stringify({
    name: "repro-fixture",
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: { build: "node build.mjs", preview: "node preview.mjs" },
  }));
  write(join(project, "package-lock.json"), JSON.stringify({
    name: "repro-fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: "repro-fixture", version: "1.0.0" } },
  }));
  write(join(project, "build.mjs"), 'import { mkdirSync, writeFileSync } from "node:fs"; mkdirSync("dist", { recursive: true }); writeFileSync("dist/index.html", "<!doctype html><title>Ready</title><h1>Ready</h1>");');
  write(join(project, "preview.mjs"), 'import { createServer } from "node:http"; import { readFileSync } from "node:fs"; const index = process.argv.indexOf("--port"); const port = Number(process.argv[index + 1]); createServer((_req, res) => { res.writeHead(200, {"content-type":"text/html"}); res.end(readFileSync("dist/index.html")); }).listen(port, "127.0.0.1");');
  write(join(project, "src/main.ts"), "export const ready = true;");
  write(join(project, "node_modules/ignored.txt"), "ignore");
  write(join(project, ".cloner/secret.tmp"), "ignore");

  const reproducibility = await verifyReproducible({ project, routes: ["/"] });
  assert.equal(reproducibility.passed, true);
  assert.equal(reproducibility.routes[0].status, 200);
});
