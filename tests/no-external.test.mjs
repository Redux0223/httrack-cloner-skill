import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const evalRoot = resolve("tests");
const input = join(evalRoot, "fixture/mirror");
const output = join(evalRoot, "fixture/network-output");
const navigationOutput = join(evalRoot, "fixture/navigation-output");
const loopbackOutput = join(evalRoot, "fixture/loopback-output");
const pipeline = resolve("./scripts/run-pipeline.mjs");
const verifier = resolve("./scripts/verify-no-external.mjs");

test("passes local runtime files and blocks automatic remote requests", () => {
  rmSync(output, { recursive: true, force: true });
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
    '\nconst auditBase = "https://api.example.test";\nconst auditEndpoint = `${auditBase}/track`;\nfetch(auditEndpoint);\n',
  );
  const dirty = spawnSync(process.execPath, [verifier, "--project", output], { encoding: "utf8" });
  assert.equal(dirty.status, 3, dirty.stderr || dirty.stdout);
  assert.match(dirty.stderr + dirty.stdout, /api\.example\.test/);
});

test("blocks outbound navigation and unclassified remote literals in the strict profile", () => {
  rmSync(navigationOutput, { recursive: true, force: true });
  const conversion = spawnSync(
    process.execPath,
    [pipeline, "--input", input, "--output", navigationOutput, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(conversion.status, 0, conversion.stderr || conversion.stdout);

  appendFileSync(
    join(navigationOutput, "public/assets/site.js"),
    '\nwindow.open("//outside.example.test/", "_blank");\nconst remoteDocs = "//docs.example.test/";\n',
  );
  const dirty = spawnSync(process.execPath, [verifier, "--project", navigationOutput, "--strict"], { encoding: "utf8" });
  assert.equal(dirty.status, 3, dirty.stderr || dirty.stdout);
  assert.match(dirty.stderr + dirty.stdout, /outside\.example\.test|docs\.example\.test/);
});

test("does not classify loopback origin fallbacks as external dependencies", () => {
  rmSync(loopbackOutput, { recursive: true, force: true });
  const conversion = spawnSync(
    process.execPath,
    [pipeline, "--input", input, "--output", loopbackOutput, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(conversion.status, 0, conversion.stderr || conversion.stdout);

  appendFileSync(
    join(loopbackOutput, "public/assets/site.js"),
    [
      '',
      'const fallbackOrigin = "http://localhost";',
      'const ipv4Loopback = "http://127.23.45.67:4173";',
      'const ipv6Loopback = "http://[::1]:4173";',
      'const protocolRelativeLoopback = "//localhost:4173/preview";',
      '',
    ].join("\n"),
  );
  writeFileSync(
    join(loopbackOutput, "public/loopback.html"),
    '<link rel="stylesheet" href="http://localhost:4173/site.css"><img src="http://[::1]:4173/hero.png">',
  );
  writeFileSync(
    join(loopbackOutput, "public/loopback.css"),
    '.hero { background-image: url("http://127.0.0.1:4173/hero.png"); }',
  );
  const result = spawnSync(process.execPath, [verifier, "--project", loopbackOutput], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
