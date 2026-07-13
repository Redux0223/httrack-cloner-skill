import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const bootstrapScript = resolve("./scripts/extract-bootstrap-contract.mjs");
const uiScript = resolve("./scripts/extract-react-owned-ui.mjs");

function write(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, value);
}

test("extracts a machine-readable legacy loader and bootstrap contract", () => {
  const project = mkdtempSync(join(tmpdir(), "cloner-bootstrap-contract-"));
  write(join(project, "reports/conversion-manifest.json"), JSON.stringify({
    legacyScripts: [{ route: "/", src: "/legacy/home.js", type: "text/javascript" }],
  }));
  write(join(project, "reports/behavior-contracts.json"), JSON.stringify({ summary: { canvas: 2, workers: 1 } }));
  write(join(project, "public/legacy/home.js"), `
    window.BUILD = "123";
    const target = "/assets/app." + window.BUILD + ".js";
    const script = document.createElement("script");
    script.src = target;
    document.head.appendChild(script);
  `);
  write(join(project, "public/assets/app.123.js"), "new Worker('/assets/worker.js'); document.createElement('canvas'); startExperience();");

  const result = spawnSync(process.execPath, [bootstrapScript, "--project", project], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const contract = JSON.parse(readFileSync(join(project, "reports/bootstrap-contract.json"), "utf8"));
  assert.equal(contract.legacyEntries[0].classification, "application-bootstrap-loader");
  assert.equal(contract.legacyEntries[0].dynamicScriptTargets[0].path, "assets/app.123.js");
  assert.equal(contract.legacyEntries[0].dynamicScriptTargets[0].exists, true);
  assert.ok(contract.bootstrapCandidates.some((entry) => entry.path === "assets/app.123.js"));
  assert.deepEqual(contract.runtimeEngineEvidence, { canvas: 2, workers: 1 });
  const classification = JSON.parse(readFileSync(join(project, "reports/legacy-classification.json"), "utf8"));
  assert.equal(classification.entries[0].classification, "application-bootstrap-loader");
});

test("inventories React-owned visible and interactive route UI through local imports", () => {
  const project = mkdtempSync(join(tmpdir(), "cloner-react-owned-ui-"));
  write(join(project, "reports/site-inspection.json"), JSON.stringify({
    pages: [{ route: "/", sourceFile: "src/pages/HomePage.tsx" }],
  }));
  write(join(project, "src/pages/HomePage.tsx"), `
    import { Experience } from "../features/Experience";
    const ignoredMarkup = "<section><button id='fake'>Fake</button></section>";
    export default function HomePage() { void ignoredMarkup; return <Experience />; }
  `);
  write(join(project, "src/features/Experience.tsx"), `
    export function Experience() {
      return <main><canvas id="scene" /><button id="enter">Enter</button><input id="email" /></main>;
    }
  `);

  const result = spawnSync(process.execPath, [uiScript, "--project", project], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(join(project, "reports/react-owned-ui.json"), "utf8"));
  assert.equal(report.routes[0].visibleElements, 4);
  assert.deepEqual(report.routes[0].canvasSelectors, ["#scene"]);
  assert.deepEqual(report.routes[0].interactiveSelectors, ["#enter", "#email"]);
  assert.equal(report.summary.emptyRoutes, 0);
});
