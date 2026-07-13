import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const evalRoot = resolve("tests");
const input = join(evalRoot, "fixture/mirror");
const output = join(evalRoot, "fixture/output");
const classificationInput = join(evalRoot, "fixture/classification-mirror");
const classificationOutput = join(evalRoot, "fixture/classification-output");
const jsxInput = join(evalRoot, "fixture/jsx-attributes-mirror");
const jsxOutput = join(evalRoot, "fixture/jsx-attributes-output");
const errorInput = join(evalRoot, "fixture/error-document-mirror");
const errorOutput = join(evalRoot, "fixture/error-document-output");
const runner = resolve("./scripts/run-pipeline.mjs");
const offlineRules = join(evalRoot, "fixture/offline-rules.json");

test("converts an HTTrack-style mirror into a local React project", () => {
  rmSync(output, { recursive: true, force: true });

  const result = spawnSync(
    process.execPath,
    [runner, "--input", input, "--output", output, "--source-url", "https://fixture.example/", "--offline-rules", offlineRules],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const packageJson = JSON.parse(readFileSync(join(output, "package.json"), "utf8"));
  assert.ok(packageJson.dependencies.react);
  assert.ok(packageJson.dependencies["@tanstack/react-router"]);
  assert.ok(packageJson.devDependencies.vite);

  const rootRoute = readFileSync(join(output, "src/routes/__root.tsx"), "utf8");
  const homeRoute = readFileSync(join(output, "src/routes/index.tsx"), "utf8");
  const aboutRoute = readFileSync(join(output, "src/routes/about.tsx"), "utf8");
  const mainSource = readFileSync(join(output, "src/main.tsx"), "utf8");
  const homeSource = readFileSync(join(output, "src/pages/HomePage.tsx"), "utf8");
  const networkPolicy = readFileSync(join(output, "src/runtime/network-policy.ts"), "utf8");
  const indexSource = readFileSync(join(output, "index.html"), "utf8");
  assert.match(rootRoute, /createRootRoute/);
  assert.match(homeRoute, /createFileRoute\("\/"\)/);
  assert.match(aboutRoute, /createFileRoute\("\/about"\)/);
  assert.match(mainSource, /RouterProvider/);
  assert.doesNotMatch(mainSource, /useState|popstate|pushState|LegacyScripts/);
  assert.match(homeSource, /import React,/);
  assert.match(homeSource, /useLocalRuntimeAdapter/);
  assert.match(homeSource, /data-local-runtime-adapter/);
  assert.match(homeSource, /\/assets\/site[.]js/);
  assert.doesNotMatch(mainSource, /StrictMode/);
  assert.match(mainSource, /network-policy/);
  assert.match(indexSource, /Content-Security-Policy/);
  assert.match(indexSource, /connect-src 'self'/);
  assert.match(networkPolicy, /input instanceof Request/);
  assert.doesNotMatch(networkPolicy, /init instanceof Request/);

  assert.ok(existsSync(join(output, "public/assets/site.js")));
  assert.ok(existsSync(join(output, "public/assets/hero.png")));
  assert.equal(existsSync(join(output, "public/about.html")), false);

  const css = readFileSync(join(output, "src/styles/source.css"), "utf8");
  assert.match(css, /fixture\.woff2/);
  assert.match(css, /noise\.png/);

  const manifest = JSON.parse(readFileSync(join(output, "reports/conversion-manifest.json"), "utf8"));
  assert.deepEqual(manifest.routes.sort(), ["/", "/about"]);
  assert.equal(manifest.runtimeExternalReferences.length, 0);
  assert.ok(manifest.removedTrackers.length >= 1);

  const compliance = JSON.parse(readFileSync(join(output, "reports/compliance-review.json"), "utf8"));
  assert.equal(compliance.automatedChecks.noAutomaticExternalRequests, true);
  assert.equal(compliance.legalConclusion, false);
  assert.equal("manualReviewRequired" in compliance, false);

  const authorization = JSON.parse(readFileSync(join(output, "reports/authorization-manifest.json"), "utf8"));
  assert.equal(authorization.legalConclusion, false);
  assert.equal("manualReviewRequired" in authorization, false);
});

test("classifies misleading script extensions and preserves inert data scripts", () => {
  rmSync(classificationInput, { recursive: true, force: true });
  rmSync(classificationOutput, { recursive: true, force: true });
  cpSync(input, classificationInput, { recursive: true });
  writeFileSync(join(classificationInput, "assets/fallback.js"), "<!doctype html><html><body>SPA fallback</body></html>\n");
  writeFileSync(join(classificationInput, "assets/payload.js"), '{"enabled":true,"items":[1,2,3]}\n');
  appendFileSync(
    join(classificationInput, "index.html"),
    '\n<script id="bootstrap-data" type="application/json">{"feature":"fixture"}</script>\n',
  );

  const result = spawnSync(
    process.execPath,
    [runner, "--input", classificationInput, "--output", classificationOutput, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const homeSource = readFileSync(join(classificationOutput, "src/pages/HomePage.tsx"), "utf8");
  assert.match(homeSource, /type=\{"application\/json"\}/);
  assert.match(homeSource, /bootstrap-data/);
  assert.match(homeSource, /feature/);

  assert.equal(existsSync(join(classificationOutput, "public/assets/fallback.js")), false);
  assert.ok(existsSync(join(classificationOutput, "reports/quarantine/assets/fallback.js.html")));
  assert.ok(existsSync(join(classificationOutput, "public/assets/payload.js")));

  const manifest = JSON.parse(readFileSync(join(classificationOutput, "reports/conversion-manifest.json"), "utf8"));
  assert.equal(manifest.runtimeParseErrors.length, 0);
  assert.ok(manifest.runtimeAssetClassifications.some((entry) => entry.file.endsWith("fallback.js") && entry.classification === "html" && entry.action === "quarantined"));
  assert.ok(manifest.runtimeAssetClassifications.some((entry) => entry.file.endsWith("payload.js") && entry.classification === "json" && entry.action === "preserved-data"));
  assert.equal(manifest.legacyScripts.some((entry) => entry.src.includes("bootstrap-data")), false);

  const inspection = JSON.parse(readFileSync(join(classificationOutput, "reports/site-inspection.json"), "utf8"));
  const behavior = JSON.parse(readFileSync(join(classificationOutput, "reports/behavior-contracts.json"), "utf8"));
  assert.ok(inspection.scripts.some((entry) => entry.path.endsWith("payload.js") && entry.classification === "inert-data"));
  assert.ok(behavior.files.some((entry) => entry.file.endsWith("payload.js") && entry.detectedLanguage === "json" && !entry.parseError));
  assert.equal(behavior.summary.parseErrorFiles, 0);
});

test("emits type-safe React attributes from captured HTML", () => {
  rmSync(jsxInput, { recursive: true, force: true });
  rmSync(jsxOutput, { recursive: true, force: true });
  cpSync(input, jsxInput, { recursive: true });
  appendFileSync(
    join(jsxInput, "index.html"),
    '<video autoplay playsinline muted style="--delay: 1; object-fit: cover"></video><img class="" data-empty>',
  );

  const result = spawnSync(
    process.execPath,
    [runner, "--input", jsxInput, "--output", jsxOutput, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const homeSource = readFileSync(join(jsxOutput, "src/pages/HomePage.tsx"), "utf8");
  assert.match(homeSource, /autoPlay playsInline muted/);
  assert.match(homeSource, /style=\{\{ "--delay": "1", objectFit: "cover" \} as React\.CSSProperties\}/);
  assert.match(homeSource, /className=\{""\}/);
  assert.match(homeSource, /data-empty=\{""\}/);
});

test("does not turn captured error responses for assets into application routes", () => {
  rmSync(errorInput, { recursive: true, force: true });
  rmSync(errorOutput, { recursive: true, force: true });
  cpSync(input, errorInput, { recursive: true });
  mkdirSync(join(errorInput, "src/css/fonts"), { recursive: true });
  writeFileSync(join(errorInput, "src/css/fonts/Geist.html"), `<!doctype html><html><head>
    <title>Fixture - Error</title>
    <link rel="canonical" href="https://fixture.example/error">
  </head><body class="template--error"><main>Not Found</main></body></html>`);
  appendFileSync(join(errorInput, "assets/site.css"), '\n@font-face { font-family: "Broken"; src: url("/src/css/fonts/Geist.html"); }\n');

  const result = spawnSync(
    process.execPath,
    [runner, "--input", errorInput, "--output", errorOutput, "--source-url", "https://fixture.example/"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const manifest = JSON.parse(readFileSync(join(errorOutput, "reports/conversion-manifest.json"), "utf8"));
  assert.ok(!manifest.routes.includes("/src/css/fonts/Geist"));
  assert.ok(manifest.ignoredErrorDocuments.some((entry) => entry.siteRelative === "src/css/fonts/Geist.html"));
  assert.doesNotMatch(readFileSync(join(errorOutput, "src/styles/source.css"), "utf8"), /Geist\.html/);
});
