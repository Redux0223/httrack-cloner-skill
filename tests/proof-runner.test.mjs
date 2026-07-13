import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyProofProfile, buildProofContract } from "../scripts/generate-proof-contract.mjs";
import { compareScreenshotSequences, runProof } from "../scripts/run-proof.mjs";
import { PNG } from "../scripts/node_modules/pngjs/lib/png.js";

async function serve(html) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolvePromise) => server.close(resolvePromise)),
  };
}

test("passes matching source and local pages and fails a deterministic mismatch", async () => {
  const source = await serve('<!doctype html><html><head><title>Fixture</title></head><body><main><h1>Hello</h1></main></body></html>');
  const matching = await serve('<!doctype html><html><head><title>Fixture</title></head><body><main><h1>Hello</h1></main></body></html>');
  const mismatching = await serve('<!doctype html><html><head><title>Fixture</title></head><body><main><h1>Different</h1></main></body></html>');

  try {
    const passing = await runProof({
      contract: buildProofContract({ sourceUrl: source.url, localUrl: matching.url, routes: ["/"], behaviorSummary: {} }),
      outputDir: mkdtempSync(join(tmpdir(), "proof-pass-")),
    });
    assert.equal(passing.passed, true);

    const failing = await runProof({
      contract: buildProofContract({ sourceUrl: source.url, localUrl: mismatching.url, routes: ["/"], behaviorSummary: {} }),
      outputDir: mkdtempSync(join(tmpdir(), "proof-fail-")),
    });
    assert.equal(failing.passed, false);
    assert.ok(failing.scenarios[0].findings.some((finding) => finding.code === "visible-text-mismatch"));
  } finally {
    await source.close();
    await matching.close();
    await mismatching.close();
  }
});

test("continues proof when a page never reaches network idle", async () => {
  const servers = [];
  const start = async () => {
    const openResponses = new Set();
    const server = createServer((request, response) => {
      if (request.url === "/stream") {
        openResponses.add(response);
        response.on("close", () => openResponses.delete(response));
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write("data: ready\n\n");
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<!doctype html><html><head><title>Streaming</title></head><body><main>Ready</main><script>fetch("/stream")</script></body></html>');
    });
    await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
    servers.push({ server, openResponses });
    return `http://127.0.0.1:${server.address().port}/`;
  };
  const sourceUrl = await start();
  const localUrl = await start();

  try {
    const contract = buildProofContract({ sourceUrl, localUrl, routes: ["/"], behaviorSummary: {} });
    contract.environments = [contract.environments[0]];
    contract.scenarios[0].actions = [
      { type: "goto", route: "/" },
      { type: "wait-for-network-idle", timeoutMs: 100 },
    ];
    const result = await runProof({ contract, outputDir: mkdtempSync(join(tmpdir(), "proof-network-busy-")) });
    assert.equal(result.passed, true, JSON.stringify(result.scenarios[0]?.findings));
  } finally {
    for (const { server, openResponses } of servers) {
      for (const response of openResponses) response.destroy();
      server.closeAllConnections();
      await new Promise((resolvePromise) => server.close(resolvePromise));
    }
  }
});

test("normalizes the headless WebGL renderer for source compatibility checks", async () => {
  const html = `<!doctype html><html><head><title>GPU</title></head><body><main id="root"></main><script>
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const debug = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : '';
    root.innerHTML = gl && !/swiftshader/i.test(renderer) ? '<p id="ready">Ready</p>' : '<p id="unsupported">Unsupported</p>';
  </script></body></html>`;
  const source = await serve(html);
  const local = await serve(html);

  try {
    const contract = buildProofContract({ sourceUrl: source.url, localUrl: local.url, routes: ["/"], behaviorSummary: {} });
    contract.environments = [contract.environments[0]];
    contract.scenarios[0].actions = [
      { type: "goto", route: "/" },
      { type: "wait-for-selector", selector: "#ready", state: "visible", timeoutMs: 3000 },
    ];
    const result = await runProof({ contract, outputDir: mkdtempSync(join(tmpdir(), "proof-webgl-renderer-")) });
    assert.equal(result.passed, true, JSON.stringify(result.scenarios[0]?.findings));
  } finally {
    await source.close();
    await local.close();
  }
});

test("executes scenario actions and ignores hidden implementation DOM", async () => {
  const source = await serve(`<!doctype html><html><head><title>Fixture</title></head><body>
    <div role="region"><button id="reveal">Reveal</button><p id="result" hidden>Ready</p></div>
    <div style="display:none">Source internals</div>
  </body></html><script>document.querySelector('#reveal').onclick=()=>document.querySelector('#result').hidden=false</script>`);
  const local = await serve(`<!doctype html><html><head><title>Fixture</title></head><body>
    <div class="react-root"><div role="region"><button id="reveal">Reveal</button><p id="result" hidden>Ready</p></div></div>
    <form style="opacity:0"><button>Local internals</button></form>
  </body></html><script>document.querySelector('#reveal').onclick=()=>document.querySelector('#result').hidden=false</script>`);

  try {
    const contract = buildProofContract({ sourceUrl: source.url, localUrl: local.url, routes: ["/"], behaviorSummary: {} });
    contract.environments = [contract.environments[0]];
    contract.scenarios[0].actions = [
      { type: "goto", route: "/" },
      { type: "click", selector: "#reveal" },
      { type: "wait-for-selector", selector: "#result", state: "visible" },
    ];
    const result = await runProof({ contract, outputDir: mkdtempSync(join(tmpdir(), "proof-actions-")) });
    assert.equal(result.passed, true, JSON.stringify(result.scenarios[0]?.findings));
    assert.match(result.scenarios[0].source.visibleText, /Ready/);
    assert.doesNotMatch(result.scenarios[0].source.visibleText, /Source internals/);
    assert.doesNotMatch(result.scenarios[0].local.visibleText, /Local internals/);
  } finally {
    await source.close();
    await local.close();
  }
});

test("canvas click actions target the visible top layer at the canvas center", async () => {
  const html = `<!doctype html><html><head><title>Canvas Loader</title></head><body>
    <canvas id="scene" width="400" height="240" style="width:400px;height:240px"></canvas>
    <button id="loader" style="position:absolute;left:0;top:0;width:400px;height:240px">Enter</button>
    <p id="state">loading</p>
    <script>loader.onclick=()=>{state.textContent='entered';loader.remove()}</script>
  </body></html>`;
  const source = await serve(html);
  const local = await serve(html);

  try {
    const contract = buildProofContract({ sourceUrl: source.url, localUrl: local.url, routes: ["/"], behaviorSummary: {} });
    contract.environments = [contract.environments[0]];
    contract.scenarios[0].actions = [
      { type: "goto", route: "/" },
      { type: "click", selector: "canvas" },
      { type: "wait-for-selector", selector: "#state", state: "visible" },
    ];
    const result = await runProof({ contract, outputDir: mkdtempSync(join(tmpdir(), "proof-canvas-loader-")) });
    assert.equal(result.passed, true, JSON.stringify(result.scenarios[0]?.findings));
    assert.match(result.scenarios[0].source.visibleText, /entered/);
  } finally {
    await source.close();
    await local.close();
  }
});

test("executes tap and media actions across desktop and mobile environments", async () => {
  const html = `<!doctype html><html><head><title>Media</title></head><body>
    <main><button id="start">Start</button><video id="clip"></video><p id="state">idle</p></main>
    <script>
      HTMLMediaElement.prototype.play = function () { this.dataset.played = 'true'; state.textContent = 'playing'; return Promise.resolve(); };
      start.addEventListener('click', () => { state.textContent = 'started'; });
    </script>
  </body></html>`;
  const source = await serve(html);
  const local = await serve(html);

  try {
    const contract = applyProofProfile(buildProofContract({
      sourceUrl: source.url,
      localUrl: local.url,
      routes: ["/"],
      behaviorSummary: { interactionFamilies: ["click", "media", "touch"] },
    }), {
      scenarios: [{
        id: "media-touch",
        route: "/",
        actions: [
          { type: "goto", route: "/" },
          { type: "tap", selector: "#start" },
          { type: "media-play", selector: "#clip" },
          { type: "checkpoint", id: "playing", selector: "#state" },
        ],
      }],
    });
    const result = await runProof({ contract, outputDir: mkdtempSync(join(tmpdir(), "proof-media-touch-")) });
    assert.equal(result.passed, true, JSON.stringify(result.scenarios.flatMap((scenario) => scenario.findings)));
  } finally {
    await source.close();
    await local.close();
  }
});

test("verifies state progression across a press-and-hold gate", async () => {
  const workingHtml = `<!doctype html><html><head><title>Hold</title></head><body>
    <main><button id="gate">Hold</button><p id="stage">before</p></main>
    <script>
      let timer;
      gate.addEventListener('pointerdown', () => { timer = setTimeout(() => { stage.textContent = 'after'; }, 80); });
      gate.addEventListener('pointerup', () => clearTimeout(timer));
    </script>
  </body></html>`;
  const brokenHtml = `<!doctype html><html><head><title>Hold</title></head><body>
    <main><button id="gate">Hold</button><p id="stage">before</p></main>
  </body></html>`;
  const source = await serve(workingHtml);
  const matching = await serve(workingHtml);
  const broken = await serve(brokenHtml);

  try {
    const makeContract = (localUrl) => applyProofProfile(buildProofContract({
      sourceUrl: source.url,
      localUrl,
      routes: ["/"],
      behaviorSummary: { interactionFamilies: ["press-and-hold"] },
    }), {
      scenarios: [{
        id: "hold-gate",
        route: "/",
        actions: [
          { type: "goto", route: "/" },
          { type: "checkpoint", id: "before-gate", selector: "#stage" },
          { type: "pointer-hold", selector: "#gate", durationMs: 120 },
          { type: "checkpoint", id: "after-gate", selector: "#stage", requireChangeFrom: "before-gate" },
        ],
      }],
    });

    const passing = await runProof({ contract: makeContract(matching.url), outputDir: mkdtempSync(join(tmpdir(), "proof-hold-pass-")) });
    assert.equal(passing.passed, true, JSON.stringify(passing.scenarios[0]?.findings));

    const failing = await runProof({ contract: makeContract(broken.url), outputDir: mkdtempSync(join(tmpdir(), "proof-hold-fail-")) });
    assert.equal(failing.passed, false);
    assert.ok(failing.scenarios[0].findings.some((finding) => ["checkpoint-visible-text-mismatch", "checkpoint-target-text-mismatch", "state-progression-missing"].includes(finding.code)));
  } finally {
    await source.close();
    await matching.close();
    await broken.close();
  }
});

test("detects a local scroll lock during a measured scroll flow", async () => {
  const source = await serve(`<!doctype html><html><head><title>Scroll</title><style>html,body{margin:0}.spacer{height:3000px}</style></head><body><main><div class="spacer">Depth</div></main></body></html>`);
  const local = await serve(`<!doctype html><html><head><title>Scroll</title><style>html,body{margin:0;height:100%;overflow:hidden}.spacer{height:3000px}</style></head><body><main><div class="spacer">Depth</div></main></body></html>`);

  try {
    const contract = applyProofProfile(buildProofContract({
      sourceUrl: source.url,
      localUrl: local.url,
      routes: ["/"],
      behaviorSummary: { interactionFamilies: ["scroll"] },
    }), {
      scenarios: [{
        id: "scroll-depth",
        route: "/",
        actions: [
          { type: "goto", route: "/" },
          { type: "checkpoint", id: "before-scroll", selector: "body" },
          { type: "wheel", deltaY: 1200, repeat: 2 },
          { type: "wait-for-time", ms: 100 },
          { type: "checkpoint", id: "after-scroll", selector: "body", requireChangeFrom: "before-scroll" },
        ],
      }],
    });
    const result = await runProof({ contract, outputDir: mkdtempSync(join(tmpdir(), "proof-scroll-lock-")) });
    assert.equal(result.passed, false);
    assert.ok(result.scenarios.some((scenario) => scenario.findings.some((finding) => finding.code === "checkpoint-scroll-y-mismatch")));
  } finally {
    await source.close();
    await local.close();
  }
});

test("ignores hidden body text serialization differences at checkpoints", async () => {
  const source = await serve(`<!doctype html><html><head><title>Checkpoint</title></head><body class="ready">
    <main><h1>Hello</h1></main><span style="display:none">Hidden A</span>
  </body></html>`);
  const local = await serve(`<!doctype html><html><head><title>Checkpoint</title></head><body class="ready">
    <main><h1>Hello</h1></main><span style="display:none">HiddenA</span>
  </body></html>`);

  try {
    const contract = buildProofContract({ sourceUrl: source.url, localUrl: local.url, routes: ["/"], behaviorSummary: {} });
    contract.environments = [contract.environments[0]];
    contract.scenarios[0].actions = [{ type: "goto", route: "/" }, { type: "checkpoint", id: "ready", selector: "body" }];
    const result = await runProof({ contract, outputDir: mkdtempSync(join(tmpdir(), "proof-checkpoint-body-")) });
    assert.equal(result.passed, true, JSON.stringify(result.scenarios[0]?.findings));
  } finally {
    await source.close();
    await local.close();
  }
});

test("classifies checkpoint state differences by field", async () => {
  const source = await serve('<!doctype html><html><head><title>Checkpoint</title></head><body class="source"><main>Hello</main></body></html>');
  const local = await serve('<!doctype html><html><head><title>Checkpoint</title></head><body class="local"><main>Hello</main></body></html>');

  try {
    const contract = buildProofContract({ sourceUrl: source.url, localUrl: local.url, routes: ["/"], behaviorSummary: {} });
    contract.environments = [contract.environments[0]];
    contract.scenarios[0].actions = [{ type: "goto", route: "/" }, { type: "checkpoint", id: "ready", selector: "body" }];
    const result = await runProof({ contract, outputDir: mkdtempSync(join(tmpdir(), "proof-checkpoint-fields-")) });
    assert.equal(result.passed, false);
    assert.ok(result.scenarios[0].findings.some((finding) => finding.code === "checkpoint-body-class-mismatch"));
    assert.ok(!result.scenarios[0].findings.some((finding) => finding.code === "checkpoint-mismatch"));
  } finally {
    await source.close();
    await local.close();
  }
});

test("seeds random browser state identically for source and local captures", async () => {
  const html = `<!doctype html><html><head><title>Random</title></head><body><main></main><script>
    const value = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    document.body.style.background = '#' + value;
  </script></body></html>`;
  const source = await serve(html);
  const local = await serve(html);

  try {
    const contract = buildProofContract({ sourceUrl: source.url, localUrl: local.url, routes: ["/"], behaviorSummary: {} });
    contract.environments = [contract.environments[0]];
    const result = await runProof({ contract, outputDir: mkdtempSync(join(tmpdir(), "proof-seeded-random-")) });
    assert.equal(result.passed, true, JSON.stringify(result.scenarios[0]?.findings));
  } finally {
    await source.close();
    await local.close();
  }
});

test("aligns equivalent continuous animations across a bounded frame sequence", async () => {
  const page = (delay) => `<!doctype html><html><head><title>Animation</title><style>
    @keyframes proof-cycle {
      0% { background: rgb(0, 0, 0); }
      25% { background: rgb(255, 0, 0); }
      50% { background: rgb(0, 255, 0); }
      75% { background: rgb(0, 0, 255); }
      100% { background: rgb(0, 0, 0); }
    }
    html, body { width: 100%; height: 100%; margin: 0; }
    body { animation: proof-cycle 400ms steps(4, end) infinite; animation-delay: ${delay}ms; }
  </style></head><body><main></main></body></html>`;
  const source = await serve(page(0));
  const local = await serve(page(-100));

  try {
    const contract = buildProofContract({ sourceUrl: source.url, localUrl: local.url, routes: ["/"], behaviorSummary: {} });
    contract.environments = [contract.environments[0]];
    contract.determinism.animationFrameSamples = 6;
    contract.determinism.animationFrameIntervalMs = 50;
    const result = await runProof({ contract, outputDir: mkdtempSync(join(tmpdir(), "proof-animation-frames-")) });
    assert.equal(result.passed, true, JSON.stringify(result.scenarios[0]?.findings));
    assert.equal(result.scenarios[0].image.sampleCount, 6);
  } finally {
    await source.close();
    await local.close();
  }
});

test("compares stochastic animation sequences by their temporal mean", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "proof-temporal-mean-"));
  const sourcePatterns = [
    [0, 0, 255, 255],
    [0, 255, 0, 255],
    [255, 0, 255, 0],
    [255, 255, 0, 0],
  ];
  const localPatterns = [
    [0, 0, 0, 0],
    [255, 255, 255, 255],
    [0, 255, 255, 0],
    [255, 0, 0, 255],
  ];
  const writePattern = (pattern, name) => {
    const file = join(outputDir, name);
    const image = new PNG({ width: 4, height: 1 });
    pattern.forEach((value, index) => {
      image.data[index * 4] = value;
      image.data[index * 4 + 1] = value;
      image.data[index * 4 + 2] = value;
      image.data[index * 4 + 3] = 255;
    });
    writeFileSync(file, PNG.sync.write(image));
    return file;
  };
  const sourceFiles = sourcePatterns.map((pattern, index) => writePattern(pattern, `source-${index}.png`));
  const localFiles = localPatterns.map((pattern, index) => writePattern(pattern, `local-${index}.png`));

  const result = compareScreenshotSequences(
    sourceFiles,
    localFiles,
    join(outputDir, "source.png"),
    join(outputDir, "local.png"),
    join(outputDir, "diff.png"),
  );

  assert.equal(result.bestFrameMismatchRatio, 0.5);
  assert.equal(result.temporalMeanMismatchRatio, 0);
  assert.equal(result.mismatchRatio, 0);
  assert.equal(result.comparisonMode, "temporal-mean");
});
