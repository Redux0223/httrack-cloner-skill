import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve("tests/fixture");
const verifier = resolve("./scripts/verify-architecture.mjs");

function write(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, value);
}

test("fails projects that retain dynamic legacy bootstrap ownership", () => {
  const project = join(root, "architecture-bad");
  rmSync(project, { recursive: true, force: true });
  write(join(project, "package.json"), JSON.stringify({ dependencies: { "@tanstack/react-router": "1.170.17", react: "19.0.0" } }));
  write(join(project, "src/main.tsx"), 'function LegacyScripts(){const script=document.createElement("script");script.src="/assets/main-deadbeef.js";document.body.appendChild(script)}');
  write(join(project, "public/assets/main-deadbeef.js"), "window.addEventListener('click', () => {})");

  const result = spawnSync(process.execPath, [verifier, "--project", project], { encoding: "utf8" });
  assert.notEqual(result.status, 0, result.stdout || result.stderr);
  const report = JSON.parse(readFileSync(join(project, "reports/architecture-verification.json"), "utf8"));
  assert.equal(report.passed, false);
  assert.ok(report.businessBootstrapBundles.length >= 1);
  assert.ok(report.dynamicScriptInjection.length >= 1);
});

test("passes a TanStack React project with a complete isolated engine contract", () => {
  const project = join(root, "architecture-good");
  rmSync(project, { recursive: true, force: true });
  write(join(project, "package.json"), JSON.stringify({ dependencies: { "@tanstack/react-router": "1.170.17", react: "19.0.0" } }));
  write(join(project, "src/main.tsx"), "import { RouterProvider } from '@tanstack/react-router'; export { RouterProvider };");
  write(join(project, "src/routes/index.tsx"), `
    import { createFileRoute } from '@tanstack/react-router';
    import { useEffect, useRef } from 'react';
    import { createExperience } from '../engines/demo';
    export const Route = createFileRoute('/')({ component: Home });
    function Home() {
      const canvasRef = useRef(null);
      useEffect(() => { const engine = createExperience(canvasRef.current); engine.start(); return () => engine.destroy(); }, []);
      return <main><canvas ref={canvasRef}>Hello</canvas></main>;
    }
  `);
  write(join(project, "src/engines/demo/index.ts"), `
    export function createExperience(canvas) {
      let running = false;
      let viewport = { width: 0, height: 0 };
      return {
        async start() { running = true; const gl = canvas.getContext('webgl'); gl.clear(gl.COLOR_BUFFER_BIT); },
        resize(next) { viewport = next; },
        dispatch(event) { canvas.dataset.event = event; },
        snapshot() { return { running, viewport }; },
        destroy() { running = false; canvas.removeAttribute('data-event'); },
      };
    }
  `);

  const result = spawnSync(process.execPath, [verifier, "--project", project], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const report = JSON.parse(readFileSync(join(project, "reports/architecture-verification.json"), "utf8"));
  assert.equal(report.passed, true);
  assert.equal(report.tanstackRouter, true);
  assert.equal(report.engineContracts[0].passed, true);
});

test("fails placeholder or unmounted engine contracts for captured canvas and workers", () => {
  const project = join(root, "architecture-placeholder-engine-bad");
  rmSync(project, { recursive: true, force: true });
  write(join(project, "package.json"), JSON.stringify({ dependencies: { "@tanstack/react-router": "1.170.17", react: "19.0.0" } }));
  write(join(project, "src/main.tsx"), "import { RouterProvider } from '@tanstack/react-router'; export { RouterProvider };");
  write(join(project, "src/routes/index.tsx"), "import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/')({ component: () => <main>Invented content</main> });");
  write(join(project, "src/engines/demo/index.ts"), `
    export interface ExperienceContract {
      start(): void; resize(): void; dispatch(): void; snapshot(): object; destroy(): void;
    }
    export function createExperience() {
      return {
        start() {}, resize() {}, dispatch() {}, snapshot() { return { status: 'idle' }; }, destroy() {},
      };
    }
  `);
  write(join(project, "reports/behavior-contracts.json"), JSON.stringify({ summary: { canvas: 2, workers: 1 } }));

  const result = spawnSync(process.execPath, [verifier, "--project", project], { encoding: "utf8" });
  assert.notEqual(result.status, 0, result.stdout || result.stderr);
  const report = JSON.parse(readFileSync(join(project, "reports/architecture-verification.json"), "utf8"));
  assert.ok(report.findings.some((finding) => finding.code === "engine-contract-placeholder"));
  assert.ok(report.findings.some((finding) => finding.code === "engine-contract-unmounted"));
  assert.ok(report.findings.some((finding) => finding.code === "runtime-canvas-surface-missing"));
  assert.ok(report.findings.some((finding) => finding.code === "runtime-worker-cleanup-missing"));
});

test("fails an engine that appends visible page DOM outside its React mount", () => {
  const project = join(root, "architecture-engine-dom-bad");
  rmSync(project, { recursive: true, force: true });
  write(join(project, "package.json"), JSON.stringify({ dependencies: { "@tanstack/react-router": "1.170.17", react: "19.0.0" } }));
  write(join(project, "src/main.tsx"), "import { RouterProvider } from '@tanstack/react-router'; export { RouterProvider };");
  write(join(project, "src/routes/index.tsx"), "import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/')({ component: () => <main>Hello</main> });");
  write(join(project, "src/engines/demo/index.ts"), `
    export function createExperience() {
      const button = document.createElement('button');
      document.body.appendChild(button);
      return {
        async start() {}, resize() {}, dispatch() {}, snapshot() { return {}; }, destroy() {},
      };
    }
  `);

  const result = spawnSync(process.execPath, [verifier, "--project", project], { encoding: "utf8" });
  assert.notEqual(result.status, 0, result.stdout || result.stderr);
  const report = JSON.parse(readFileSync(join(project, "reports/architecture-verification.json"), "utf8"));
  assert.equal(report.reactOwnsVisibleDom, false);
  assert.ok(report.findings.some((finding) => finding.code === "visible-dom-owned-outside-react"));
});

test("fails generated scaffolds until captured behavior scripts are reconstructed", () => {
  const project = join(root, "architecture-generated");
  rmSync(project, { recursive: true, force: true });
  const conversion = spawnSync(
    process.execPath,
    [
      resolve("./scripts/run-pipeline.mjs"),
      "--input",
      join(resolve("tests"), "fixture/mirror"),
      "--output",
      project,
      "--source-url",
      "https://fixture.example/",
    ],
    { encoding: "utf8" },
  );
  assert.equal(conversion.status, 0, conversion.stderr || conversion.stdout);

  const result = spawnSync(process.execPath, [verifier, "--project", project], { encoding: "utf8" });
  assert.notEqual(result.status, 0, result.stdout || result.stderr);
  const report = JSON.parse(readFileSync(join(project, "reports/architecture-verification.json"), "utf8"));
  assert.ok(report.capturedLegacyScripts.length >= 1);
});

test("marks an empty React route with a legacy loader as a bootstrap-owned shell", () => {
  const project = join(root, "architecture-bootstrap-shell");
  rmSync(project, { recursive: true, force: true });
  write(join(project, "package.json"), JSON.stringify({ dependencies: { "@tanstack/react-router": "1.170.17", react: "19.0.0" } }));
  write(join(project, "src/main.tsx"), "import { RouterProvider } from '@tanstack/react-router'; export { RouterProvider };");
  write(join(project, "src/routes/index.tsx"), "import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/')({ component: HomePage }); function HomePage(){ return <><script type='application/json' /><noscript>{\"<p>Enable JavaScript</p>\"}</noscript></>; }");
  write(join(project, "reports/site-inspection.json"), JSON.stringify({ pages: [{ route: "/", sourceFile: "src/routes/index.tsx" }] }));
  write(join(project, "reports/conversion-manifest.json"), JSON.stringify({
    conversionMode: "react-structure-with-legacy-script-adapters",
    legacyScripts: [{ route: "/", src: "/legacy/HomePage-0.js", type: "text/javascript" }],
  }));

  const result = spawnSync(process.execPath, [verifier, "--project", project], { encoding: "utf8" });
  assert.notEqual(result.status, 0, result.stdout || result.stderr);
  const report = JSON.parse(readFileSync(join(project, "reports/architecture-verification.json"), "utf8"));
  assert.equal(report.reactOwnsVisibleDom, false);
  assert.ok(report.bootstrapOwnedShells.some((entry) => entry.route === "/"));
  assert.ok(report.findings.some((finding) => finding.code === "bootstrap-owned-shell"));
});

test("requires an engine contract when captured runtime evidence contains canvas or workers", () => {
  const project = join(root, "architecture-runtime-engine-bad");
  rmSync(project, { recursive: true, force: true });
  write(join(project, "package.json"), JSON.stringify({ dependencies: { "@tanstack/react-router": "1.170.17", react: "19.0.0" } }));
  write(join(project, "src/main.tsx"), "import { RouterProvider } from '@tanstack/react-router'; export { RouterProvider };");
  write(join(project, "src/routes/index.tsx"), "import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/')({ component: () => <main>Ready</main> });");
  write(join(project, "reports/behavior-contracts.json"), JSON.stringify({ summary: { canvas: 2, workers: 1 } }));

  const result = spawnSync(process.execPath, [verifier, "--project", project], { encoding: "utf8" });
  assert.notEqual(result.status, 0, result.stdout || result.stderr);
  const report = JSON.parse(readFileSync(join(project, "reports/architecture-verification.json"), "utf8"));
  assert.equal(report.runtimeEngineEvidence.canvas, 2);
  assert.equal(report.runtimeEngineEvidence.workers, 1);
  assert.ok(report.findings.some((finding) => finding.code === "runtime-engine-present-but-unisolated"));
});

test("does not trust behavior reports that hide captured canvas and worker evidence", () => {
  const work = join(root, "architecture-tampered-runtime");
  const project = join(work, "react");
  rmSync(work, { recursive: true, force: true });
  write(join(project, "package.json"), JSON.stringify({ dependencies: { "@tanstack/react-router": "1.170.17", react: "19.0.0" } }));
  write(join(project, "src/main.tsx"), "import { RouterProvider } from '@tanstack/react-router'; export { RouterProvider };");
  write(join(project, "src/routes/index.tsx"), "import { createFileRoute } from '@tanstack/react-router'; export const Route = createFileRoute('/')({ component: () => <main>Ready</main> });");
  write(join(project, "reports/behavior-contracts.json"), JSON.stringify({ summary: { canvas: 0, workers: 0 } }));
  write(join(project, "reports/conversion-manifest.json"), JSON.stringify({ legacyScripts: [] }));
  write(join(work, "mirror/example.com/assets/main.js"), `
    const canvas = document.createElement('canvas');
    canvas.getContext('webgl2');
    const worker = new Worker('/assets/render.worker.js');
    window.addEventListener('wheel', () => worker.postMessage('scroll'));
  `);

  const result = spawnSync(process.execPath, [verifier, "--project", project], { encoding: "utf8" });
  assert.notEqual(result.status, 0, result.stdout || result.stderr);
  const report = JSON.parse(readFileSync(join(project, "reports/architecture-verification.json"), "utf8"));
  assert.ok(report.runtimeEngineEvidence.canvas >= 1);
  assert.ok(report.runtimeEngineEvidence.workers >= 1);
  assert.ok(report.findings.some((finding) => finding.code === "runtime-engine-present-but-unisolated"));
});

test("rejects captured bootstrap bundles renamed with a non-JavaScript suffix", () => {
  const work = join(root, "architecture-renamed-bootstrap");
  const project = join(work, "react");
  rmSync(work, { recursive: true, force: true });
  write(join(project, "package.json"), JSON.stringify({ dependencies: { "@tanstack/react-router": "1.170.17", react: "19.0.0" } }));
  write(join(project, "src/main.tsx"), "import { RouterProvider } from '@tanstack/react-router'; export { RouterProvider };");
  write(join(project, "src/routes/index.tsx"), `
    import { createFileRoute } from '@tanstack/react-router';
    import { useEffect, useRef } from 'react';
    import { createExperience } from '../engines/demo';
    export const Route = createFileRoute('/')({ component: Home });
    function Home(){ const ref=useRef(null); useEffect(()=>{const engine=createExperience(ref.current);engine.start();return()=>engine.destroy()},[]); return <canvas ref={ref}/>; }
  `);
  write(join(project, "src/engines/demo/index.ts"), `
    export function createExperience(canvas) { return {
      start(){ const gl=canvas.getContext('webgl'); gl.clear(gl.COLOR_BUFFER_BIT); }, resize(){ canvas.width=1; },
      dispatch(event){ canvas.dataset.event=event.type; }, snapshot(){ return { ready:true }; }, destroy(){ canvas.remove(); }
    }; }
  `);
  write(join(project, "public/assets/js/app.123.js.reconstructed"), "document.createElement('canvas').getContext('webgl'); requestAnimationFrame(()=>{});");
  write(join(project, "reports/conversion-manifest.json"), JSON.stringify({ legacyScripts: [] }));

  const result = spawnSync(process.execPath, [verifier, "--project", project], { encoding: "utf8" });
  assert.notEqual(result.status, 0, result.stdout || result.stderr);
  const report = JSON.parse(readFileSync(join(project, "reports/architecture-verification.json"), "utf8"));
  assert.ok(report.businessBootstrapBundles.some((entry) => entry.file.endsWith("app.123.js.reconstructed")));
  assert.ok(report.findings.some((finding) => finding.code === "business-bootstrap-bundle"));
});

test("rejects lifecycle-shaped engines that never render captured canvas output", () => {
  const work = join(root, "architecture-fake-engine");
  const project = join(work, "react");
  rmSync(work, { recursive: true, force: true });
  write(join(project, "package.json"), JSON.stringify({ dependencies: { "@tanstack/react-router": "1.170.17", react: "19.0.0" } }));
  write(join(project, "src/main.tsx"), "import { RouterProvider } from '@tanstack/react-router'; export { RouterProvider };");
  write(join(project, "src/routes/index.tsx"), `
    import { createFileRoute } from '@tanstack/react-router';
    import { useEffect, useRef } from 'react';
    import { createExperience } from '../engines/demo';
    export const Route = createFileRoute('/')({ component: Home });
    function Home(){ const ref=useRef(null); useEffect(()=>{const engine=createExperience(ref.current);engine.start();return()=>engine.destroy()},[]); return <canvas ref={ref}/>; }
  `);
  write(join(project, "src/engines/demo/index.ts"), `
    export function createExperience(canvas) { let frame=0; return {
      start(){ canvas.getContext('webgl'); frame=requestAnimationFrame(()=>{}); }, resize(){ canvas.width=1; },
      dispatch(event){ canvas.dataset.event=event.type; }, snapshot(){ return { frame }; },
      destroy(){ cancelAnimationFrame(frame); canvas.removeAttribute('data-event'); }
    }; }
  `);
  write(join(work, "mirror/example.com/assets/app.123.js"), "const canvas=document.createElement('canvas'); const gl=canvas.getContext('webgl'); gl.clear(gl.COLOR_BUFFER_BIT); requestAnimationFrame(()=>{});");
  write(join(project, "reports/behavior-contracts.json"), JSON.stringify({ summary: { canvas: 1, workers: 0 } }));
  write(join(project, "reports/conversion-manifest.json"), JSON.stringify({ legacyScripts: [] }));

  const result = spawnSync(process.execPath, [verifier, "--project", project], { encoding: "utf8" });
  assert.notEqual(result.status, 0, result.stdout || result.stderr);
  const report = JSON.parse(readFileSync(join(project, "reports/architecture-verification.json"), "utf8"));
  assert.equal(report.runtimeRenderOutputPresent, false);
  assert.ok(report.findings.some((finding) => finding.code === "engine-runtime-placeholder"));
  assert.ok(report.findings.some((finding) => finding.code === "captured-bootstrap-replacement-unproven"));
});
