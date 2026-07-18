import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const evalRoot = resolve("tests");
const input = join(evalRoot, "fixture/sanitization-mirror");
const output = join(evalRoot, "fixture/sanitization-output");
const pipeline = resolve("./scripts/run-pipeline.mjs");
const verifier = resolve("./scripts/verify-no-external.mjs");

test("rewrites indirect remote request dependencies to an offline local route", () => {
  rmSync(input, { recursive: true, force: true });
  rmSync(output, { recursive: true, force: true });
  cpSync(join(evalRoot, "fixture/mirror"), input, { recursive: true });
  appendFileSync(
    join(input, "assets/site.js"),
    '\nconst apiBase = "https://api.example.test";\nconst submitEndpoint = `${apiBase}/v1/submit`;\nconst publicAnonKey = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.fixture-signature";\nconst encodedPayload = "AAAA//8EAAQ";\nfetch(submitEndpoint, { method: "POST", headers: { Authorization: `Bearer ${publicAnonKey}` } });\nfunction scopedPing() { const scopedBase = "https://scoped.example.test"; return fetch(`${scopedBase}/ping`); }\nfunction protocolPing() { const protocolBase = "//protocol.example.test"; return fetch(`${protocolBase}/ping`); }\nwindow.open("https://docs.example.test/guide", "_blank", "noopener");\n',
  );

  const conversion = spawnSync(
    process.execPath,
    [pipeline, "--input", input, "--output", output, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(conversion.status, 0, conversion.stderr || conversion.stdout);

  const runtime = readFileSync(join(output, "public/assets/site.js"), "utf8");
  assert.doesNotMatch(runtime, /https:\/\/api\.example\.test/);
  assert.doesNotMatch(runtime, /https:\/\/scoped\.example\.test/);
  assert.doesNotMatch(runtime, /\/\/protocol\.example\.test/);
  assert.doesNotMatch(runtime, /https:\/\/docs\.example\.test/);
  assert.doesNotMatch(runtime, /eyJhbGciOiJIUzI1NiJ9/);
  assert.match(runtime, /const apiBase = "\/__offline__\/api\.example\.test"/);
  assert.match(runtime, /AAAA\/\/8EAAQ/);

  const manifest = JSON.parse(readFileSync(join(output, "reports/conversion-manifest.json"), "utf8"));
  assert.ok(manifest.stubbedRemoteRequests.some((finding) => finding.url === "https://api.example.test/v1/submit"));
  assert.ok(manifest.stubbedRemoteRequests.some((finding) => finding.url === "https://scoped.example.test/ping"));
  assert.ok(manifest.stubbedRemoteRequests.some((finding) => finding.url === "//protocol.example.test/ping"));
  assert.ok(manifest.redactedCredentials.some((finding) => finding.kind === "jwt"));
  assert.ok(manifest.removedOutboundNavigations.some((finding) => finding.url === "https://docs.example.test/guide"));

  const verification = spawnSync(process.execPath, [verifier, "--project", output], { encoding: "utf8" });
  assert.equal(verification.status, 0, verification.stderr || verification.stdout);
});

test("writes back tracker-only template literal sanitization", () => {
  rmSync(input, { recursive: true, force: true });
  rmSync(output, { recursive: true, force: true });
  cpSync(join(evalRoot, "fixture/mirror"), input, { recursive: true });
  writeFileSync(
    join(input, "assets/tracker-only.js"),
    'export function loadTracker(id) { const script = document.createElement("script"); script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`; document.head.appendChild(script); }\n',
  );

  const conversion = spawnSync(
    process.execPath,
    [pipeline, "--input", input, "--output", output, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(conversion.status, 0, conversion.stderr || conversion.stdout);

  const runtime = readFileSync(join(output, "public/assets/tracker-only.js"), "utf8");
  assert.doesNotMatch(runtime, /googletagmanager/);
  assert.match(runtime, /script\.src = `#\$\{id\}`/);

  const manifest = JSON.parse(readFileSync(join(output, "reports/conversion-manifest.json"), "utf8"));
  assert.ok(manifest.removedRemoteLiterals.some((finding) => finding.file.endsWith("tracker-only.js")));
});

test("preserves standard XML and SVG namespace URIs during external dependency cleanup", () => {
  rmSync(input, { recursive: true, force: true });
  rmSync(output, { recursive: true, force: true });
  cpSync(join(evalRoot, "fixture/mirror"), input, { recursive: true });
  appendFileSync(
    join(input, "assets/site.js"),
    '\nsvg.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:xlink", "http://www.w3.org/1999/xlink");\n',
  );

  const conversion = spawnSync(
    process.execPath,
    [pipeline, "--input", input, "--output", output, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(conversion.status, 0, conversion.stderr || conversion.stdout);

  const runtime = readFileSync(join(output, "public/assets/site.js"), "utf8");
  assert.match(runtime, /http:\/\/www\.w3\.org\/2000\/xmlns\//);
  assert.match(runtime, /http:\/\/www\.w3\.org\/1999\/xlink/);
});

test("removes computed domain canonicalization redirects executed during script load", () => {
  rmSync(input, { recursive: true, force: true });
  rmSync(output, { recursive: true, force: true });
  cpSync(join(evalRoot, "fixture/mirror"), input, { recursive: true });
  appendFileSync(
    join(input, "assets/site.js"),
    [
      "",
      'if (window.DomainName && window.DomainName.indexOf(location.host) === -1) {',
      '  var newurl = location.href.replace(location.host, window.DomainName);',
      '  newurl += newurl.indexOf("?") > -1 ? "&from=" + location.host : "?from=" + location.host;',
      "  location.href = newurl;",
      "}",
      "function userNavigation(url) { window.location.href = url; }",
      "",
    ].join("\n"),
  );

  const conversion = spawnSync(
    process.execPath,
    [pipeline, "--input", input, "--output", output, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(conversion.status, 0, conversion.stderr || conversion.stdout);

  const runtime = readFileSync(join(output, "public/assets/site.js"), "utf8");
  assert.doesNotMatch(runtime, /location\.href\s*=\s*newurl/);
  assert.match(runtime, /void 0/);
  assert.match(runtime, /function userNavigation\(url\) \{ window\.location\.href = url; \}/);

  const manifest = JSON.parse(readFileSync(join(output, "reports/conversion-manifest.json"), "utf8"));
  assert.ok(manifest.removedOutboundNavigations.some((finding) => finding.kind === "automatic-location-assignment"));
});

test("localizes captured CDN base variables instead of turning module paths into hash URLs", () => {
  rmSync(input, { recursive: true, force: true });
  rmSync(output, { recursive: true, force: true });
  cpSync(join(evalRoot, "fixture/mirror"), input, { recursive: true });
  appendFileSync(
    join(input, "assets/site.js"),
    '\nwindow.ScriptCdn = "https://cdn.example.test/";\naddScript("skinp/modules/menu.js");\nloadStyleSheet("/share/site.css");\n',
  );

  const conversion = spawnSync(
    process.execPath,
    [pipeline, "--input", input, "--output", output, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(conversion.status, 0, conversion.stderr || conversion.stdout);

  const runtime = readFileSync(join(output, "public/assets/site.js"), "utf8");
  assert.match(runtime, /window\.ScriptCdn = "\/"/);
  assert.match(runtime, /loadStyleSheet\("share\/site\.css"\)/);
  assert.doesNotMatch(runtime, /ScriptCdn = "#"/);
});

test("normalizes CMS stylesheet loader paths when the CDN base is declared in another script", () => {
  rmSync(input, { recursive: true, force: true });
  rmSync(output, { recursive: true, force: true });
  cpSync(join(evalRoot, "fixture/mirror"), input, { recursive: true });
  appendFileSync(join(input, "assets/site.js"), '\nloadStyleSheet("/share/site.css");\n');

  const conversion = spawnSync(
    process.execPath,
    [pipeline, "--input", input, "--output", output, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(conversion.status, 0, conversion.stderr || conversion.stdout);

  const runtime = readFileSync(join(output, "public/assets/site.js"), "utf8");
  assert.match(runtime, /loadStyleSheet\("share\/site\.css"\)/);
});

test("localizes same-origin CMS script and stylesheet loader URLs", () => {
  rmSync(input, { recursive: true, force: true });
  rmSync(output, { recursive: true, force: true });
  cpSync(join(evalRoot, "fixture/mirror"), input, { recursive: true });
  appendFileSync(
    join(input, "assets/site.js"),
    '\naddScript("https://fixture.example/assets/module.js", function () {});\nloadStyleSheet("https://fixture.example/assets/module.css");\n',
  );

  const conversion = spawnSync(
    process.execPath,
    [pipeline, "--input", input, "--output", output, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(conversion.status, 0, conversion.stderr || conversion.stdout);

  const runtime = readFileSync(join(output, "public/assets/site.js"), "utf8");
  assert.match(runtime, /addScript\("assets\/module\.js"/);
  assert.match(runtime, /loadStyleSheet\("assets\/module\.css"\)/);
  assert.doesNotMatch(runtime, /addScript\("#"/);
});
