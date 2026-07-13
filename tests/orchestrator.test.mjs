import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  DEFAULT_STAGES,
  buildProductionFirstProofFailureSummary,
  buildDeliveryManifest,
  evaluateComponentReconstruction,
  evaluateDeliveryManifestGate,
  evaluateEngineIsolation,
  evaluateLegacyElimination,
  evaluatePreOpenDeliveryGate,
  normalizeProofExecutionFailure,
  runStateMachine,
  summarizeConversionManifest,
} from "../scripts/orchestrate.mjs";

test("turns proof action exceptions into recoverable findings", () => {
  const finding = normalizeProofExecutionFailure(new Error("locator.click: Timeout 30000ms exceeded"));
  assert.equal(finding.code, "proof-execution-failed");
  assert.match(finding.error, /locator\.click/);
});

test("records proof execution failures without blocking a built project", () => {
  const summary = buildProductionFirstProofFailureSummary(
    new Error("browser closed during screenshot"),
    { thresholdFingerprint: "locked-thresholds" },
  );

  assert.equal(summary.passed, false);
  assert.equal(summary.deliveryAccepted, true);
  assert.equal(summary.acceptanceMode, "production-first");
  assert.equal(summary.executionFailed, true);
  assert.match(summary.parityDiagnostics[0].error, /browser closed/);
});

test("delivers a reproducible project while reporting proof execution as diagnostic", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-proof-diagnostic-"));
  writeJson(join(work, "proof", "proof-contract.json"), {
    thresholdsLocked: true,
    thresholdFingerprint: "locked-thresholds",
    environments: [{ id: "desktop" }],
    scenarios: [{ id: "home", route: "/", actions: [] }],
  });
  writeJson(
    join(work, "proof", "proof-summary.json"),
    buildProductionFirstProofFailureSummary(new Error("browser unavailable"), { thresholdFingerprint: "locked-thresholds" }),
  );
  writeJson(join(work, "react", "reports", "reproducibility.json"), {
    passed: true,
    commands: [{ command: "npm ci", status: 0 }, { command: "npm run build", status: 0 }],
    routes: [{ route: "/", status: 200, contentType: "text/html" }],
    previewUrl: "http://127.0.0.1:4176/",
  });

  const manifest = buildDeliveryManifest({
    project: join(work, "react"),
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: join(work, "proof", "proof-summary.json"),
    reproducibility: join(work, "react", "reports", "reproducibility.json"),
    browser: { passed: true, skipped: false, command: "open" },
  });

  assert.equal(manifest.passed, true);
  assert.equal(manifest.delivered, true);
  assert.equal(manifest.proofPassed, false);
  assert.equal(manifest.proofDiagnosticAccepted, true);
});

test("does not report production-first parity differences as proof passed", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-parity-diagnostic-"));
  writeValidDeliveryEvidence(work, { proofPassed: false });
  const proofFile = join(work, "proof", "proof-summary.json");
  const proof = JSON.parse(readFileSync(proofFile, "utf8"));
  writeJson(proofFile, { ...proof, deliveryAccepted: true, acceptanceMode: "production-first" });

  const manifest = buildDeliveryManifest({
    project: join(work, "react"),
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: proofFile,
    reproducibility: join(work, "react", "reports", "reproducibility.json"),
    browser: { passed: true, skipped: false, command: "open" },
  });

  assert.equal(manifest.passed, true);
  assert.equal(manifest.proofPassed, false);
  assert.equal(manifest.proofDiagnosticAccepted, true);
});

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function proofScenario(work, { id = "home", passed = true } = {}) {
  const sourceScreenshot = join(work, "proof", `${id}-source.png`);
  const localScreenshot = join(work, "proof", `${id}-local.png`);
  mkdirSync(dirname(sourceScreenshot), { recursive: true });
  writeFileSync(sourceScreenshot, "source-image");
  writeFileSync(localScreenshot, "local-image");
  const capture = (screenshot) => ({
    screenshot,
    actionTrace: { checkpoints: {}, findings: [] },
    requests: [],
    consoleErrors: [],
    pageErrors: [],
  });
  return {
    id,
    scenarioId: id,
    environment: "desktop",
    route: "/",
    passed,
    findings: passed ? [] : [{ code: "visual-mismatch" }],
    source: capture(sourceScreenshot),
    local: capture(localScreenshot),
    image: { dimensionsMatch: true, mismatchRatio: passed ? 0 : 1 },
  };
}

function writeValidDeliveryEvidence(work, { proofSummary = join(work, "proof", "proof-summary.json"), proofPassed = true } = {}) {
  writeJson(join(work, "proof", "proof-contract.json"), {
    thresholdsLocked: true,
    thresholdFingerprint: "locked-thresholds",
    environments: [{ id: "desktop" }],
    scenarios: [{ id: "home", route: "/", actions: [] }],
  });
  writeJson(proofSummary, {
    passed: proofPassed,
    thresholdFingerprint: "locked-thresholds",
    scenarios: [proofScenario(work, { passed: proofPassed })],
  });
  writeJson(join(work, "react", "reports", "reproducibility.json"), {
    passed: true,
    commands: [{ command: "npm ci", status: 0 }, { command: "npm run build", status: 0 }],
    routes: [{ route: "/", status: 200, contentType: "text/html" }],
    previewUrl: "http://127.0.0.1:4176/",
  });
}

test("keeps component and engine reconstruction stages honest", () => {
  const incompleteComponents = evaluateComponentReconstruction({
    summary: { emptyRoutes: 1 },
    routes: [{ route: "/", visibleElements: 0 }],
  });
  assert.equal(incompleteComponents.passed, false);
  assert.deepEqual(incompleteComponents.routes, ["/"]);

  assert.equal(evaluateComponentReconstruction({
    summary: { emptyRoutes: 0 },
    routes: [{ route: "/", visibleElements: 4 }],
  }).passed, true);

  assert.equal(evaluateComponentReconstruction({
    summary: { emptyRoutes: 0, canvasMounts: 0 },
    routes: [{ route: "/", visibleElements: 4 }],
  }, { canvas: 2 }).passed, true);

  assert.equal(evaluateEngineIsolation({ findings: [{ code: "business-bootstrap-bundle" }] }).passed, true);
  assert.equal(evaluateEngineIsolation({ findings: [{ code: "runtime-engine-present-but-unisolated" }] }).passed, false);
  assert.equal(evaluateEngineIsolation({
    businessBootstrapBundles: [{ file: "public/assets/app.js" }],
    findings: [{ code: "runtime-engine-present-but-unisolated" }],
  }).passed, true);
});

test("treats provenance reports as diagnostics after core reconstruction passes", () => {
  const result = evaluateLegacyElimination({
    architecture: { passed: true, findings: [] },
    content: { passed: false, unsupported: [{ text: "diagnostic copy" }] },
    publicAssets: { passed: false, uncaptured: [{ path: "generated-debug.json" }] },
    styles: { passed: false, modified: [{ path: "src/styles/source.css" }] },
    assets: { passed: true },
    network: { passed: true },
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.blockingFindings, []);
  assert.deepEqual(result.diagnostics.map((entry) => entry.code), [
    "content-provenance-diagnostic",
    "public-asset-provenance-diagnostic",
    "style-provenance-diagnostic",
  ]);
});

test("allows a local captured runtime adapter to reach browser proof", () => {
  const result = evaluateLegacyElimination({
    architecture: {
      passed: false,
      businessBootstrapBundles: [{ file: "public/assets/app.js" }],
      findings: [
        { code: "business-bootstrap-bundle" },
        { code: "captured-legacy-script-not-reconstructed" },
        { code: "runtime-engine-present-but-unisolated" },
      ],
    },
    content: { passed: true },
    publicAssets: { passed: true },
    styles: { passed: true },
    assets: { passed: true },
    network: { passed: true },
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.blockingFindings, []);
  assert.ok(result.diagnostics.some((entry) => entry.code === "architecture-migration-diagnostic"));
});

test("delivers the project and opens its preview without a package stage", () => {
  assert.deepEqual(DEFAULT_STAGES.slice(-4), ["REPRODUCIBILITY", "DELIVERY_MANIFEST", "OPEN_PREVIEW", "DELIVERED"]);
  assert.equal(DEFAULT_STAGES.includes("PACKAGE"), false);

  const work = mkdtempSync(join(tmpdir(), "cloner-delivery-happy-"));
  writeValidDeliveryEvidence(work);

  const manifest = buildDeliveryManifest({
    project: join(work, "react"),
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: join(work, "proof", "proof-summary.json"),
    reproducibility: join(work, "react", "reports", "reproducibility.json"),
    browser: { passed: true, skipped: false, command: "open" },
  });
  assert.equal(manifest.passed, true);
  assert.equal(manifest.project, join(work, "react"));
  assert.equal(manifest.previewUrl, "http://127.0.0.1:4176/");
  assert.equal("archive" in manifest, false);
  assert.deepEqual(manifest.browser, { passed: true, skipped: false, command: "open" });
});

test("delivery manifest records all delivery gates separately", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-delivery-fields-"));
  writeValidDeliveryEvidence(work);

  const manifest = buildDeliveryManifest({
    project: join(work, "react"),
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: join(work, "proof", "proof-summary.json"),
    reproducibility: join(work, "react", "reports", "reproducibility.json"),
    browser: { passed: true, skipped: false, command: "open" },
  });

  assert.equal(manifest.passed, true);
  assert.equal(manifest.proofPassed, true);
  assert.equal(manifest.reproducible, true);
  assert.equal(manifest.repairEvidenceSatisfied, true);
  assert.equal(manifest.browserOpened, true);
  assert.equal(manifest.delivered, true);
});

test("delivery manifest rejects bare passed booleans without proof artifacts", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-delivery-forged-"));
  writeJson(join(work, "proof", "proof-summary.json"), { passed: true });
  writeJson(join(work, "react", "reports", "reproducibility.json"), { passed: true });

  const manifest = buildDeliveryManifest({
    project: join(work, "react"),
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: join(work, "proof", "proof-summary.json"),
    reproducibility: join(work, "react", "reports", "reproducibility.json"),
    browser: { passed: true, skipped: false, command: "open" },
  });

  assert.equal(manifest.proofPassed, false);
  assert.equal(manifest.reproducible, false);
  assert.equal(manifest.passed, false);

  writeValidDeliveryEvidence(work);
  const missingProof = buildDeliveryManifest({
    project: join(work, "react"),
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: join(work, "proof", "missing-proof-summary.json"),
    reproducibility: join(work, "react", "reports", "reproducibility.json"),
    browser: { passed: true, skipped: false, command: "open" },
    proofPassed: true,
  });
  assert.equal(missingProof.proofPassed, false);
  assert.equal(missingProof.passed, false);
});

test("pre-open delivery gate passes before browser open and final manifest does not", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-delivery-preopen-"));
  writeValidDeliveryEvidence(work);

  const preOpen = evaluatePreOpenDeliveryGate({
    project: join(work, "react"),
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: join(work, "proof", "proof-summary.json"),
    reproducibility: join(work, "react", "reports", "reproducibility.json"),
  });
  const manifest = buildDeliveryManifest({
    project: join(work, "react"),
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: join(work, "proof", "proof-summary.json"),
    reproducibility: join(work, "react", "reports", "reproducibility.json"),
  });

  assert.equal(preOpen.passed, true);
  assert.equal(preOpen.delivered, false);
  assert.equal(preOpen.browserOpened, false);
  assert.equal(manifest.passed, false);
  assert.equal(manifest.repairEvidenceSatisfied, true);
});

test("delivery manifest blocks delivered status when parity proof did not pass", () => {
  const manifest = buildDeliveryManifest({
    project: "/tmp/project",
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: "/tmp/run/proof/proof-summary.json",
    reproducibility: "/tmp/project/reports/reproducibility.json",
    browser: { passed: true, skipped: false, command: "open" },
    proofPassed: false,
    reproducible: true,
    delivered: false,
  });

  assert.equal(manifest.proofPassed, false);
  assert.equal(manifest.browserOpened, true);
  assert.equal(manifest.delivered, false);
  assert.equal(manifest.passed, false);
});

test("delivery manifest blocks when repair evidence is missing after repeated parity proof failures", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-delivery-missing-evidence-"));
  mkdirSync(join(work, ".cloner"), { recursive: true });
  writeJson(join(work, ".cloner", "state.json"), {
    schemaVersion: 2,
    inputFingerprint: "capture-a",
    status: "REPAIR_LOOP",
    delivered: false,
    completed: {},
    history: [
      { stage: "PARITY_PROOF", event: "failed", at: "2026-01-01T00:00:00.000Z" },
      { stage: "PARITY_PROOF", event: "interrupted", at: "2026-01-01T00:01:00.000Z" },
    ],
  });

  const manifest = buildDeliveryManifest({
    project: join(work, "react"),
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: "/tmp/run/proof/proof-summary.json",
    reproducibility: "/tmp/project/reports/reproducibility.json",
    browser: { passed: true, skipped: false, command: "open" },
    proofPassed: true,
    reproducible: true,
    delivered: false,
  });

  assert.equal(manifest.passed, false);
  assert.equal(manifest.delivered, false);
});

test("legacy state terminal events require repair evidence even without consecutive counters", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-delivery-legacy-repair-"));
  writeJson(join(work, "proof", "proof-summary.json"), { passed: true });
  writeJson(join(work, "react", "reports", "reproducibility.json"), { passed: true });
  writeJson(join(work, ".cloner", "state.json"), {
    schemaVersion: 2,
    history: [
      { stage: "PARITY_PROOF", event: "failed" },
      { stage: "PARITY_PROOF", event: "interrupted" },
    ],
  });

  const gate = evaluatePreOpenDeliveryGate({
    project: join(work, "react"),
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: join(work, "proof", "proof-summary.json"),
    reproducibility: join(work, "react", "reports", "reproducibility.json"),
  });

  assert.equal(gate.proofPassed, false);
  assert.equal(gate.repairEvidenceSatisfied, false);
  assert.equal(gate.passed, false);
});

test("delivery manifest rejects a newer nested failed proof summary", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-delivery-proof-"));
  writeJson(join(work, "proof", "proof-summary.json"), { passed: true });
  writeJson(join(work, "proof", "rerun", "deep", "proof-summary.json"), { passed: false });
  writeJson(join(work, "react", "reports", "reproducibility.json"), { passed: true });

  const manifest = buildDeliveryManifest({
    project: join(work, "react"),
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: join(work, "proof", "proof-summary.json"),
    reproducibility: join(work, "react", "reports", "reproducibility.json"),
    browser: { passed: true, skipped: false, command: "open" },
  });

  assert.equal(manifest.proofPassed, false);
  assert.equal(manifest.delivered, false);
  assert.equal(manifest.passed, false);
});

test("delivery manifest blocks when trace shows repeated parity-proof failures and repair evidence is missing", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-delivery-trace-"));
  writeJson(join(work, "proof", "proof-summary.json"), { passed: true });
  writeJson(join(work, "react", "reports", "reproducibility.json"), { passed: true });
  writeJson(join(work, ".cloner", "state.json"), {
    schemaVersion: 2,
    inputFingerprint: "capture-a",
    status: "REPAIR_LOOP",
    delivered: false,
    completed: {},
    history: [
      { stage: "PARITY_PROOF", event: "failed", at: "2026-01-01T00:00:00.000Z" },
      { stage: "PARITY_PROOF", event: "interrupted", at: "2026-01-01T00:01:00.000Z" },
    ],
  });
  writeJson(join(work, ".cloner", "trace-summary.json"), {
    schemaVersion: 1,
    failedGates: [
      { stage: "PARITY_PROOF", consecutiveFailures: 2 },
    ],
  });

  const manifest = buildDeliveryManifest({
    project: join(work, "react"),
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: join(work, "proof", "proof-summary.json"),
    reproducibility: join(work, "react", "reports", "reproducibility.json"),
    browser: { passed: true, skipped: false, command: "open" },
  });

  assert.equal(manifest.proofPassed, false);
  assert.equal(manifest.delivered, false);
  assert.equal(manifest.passed, false);
});

test("delivery manifest accepts repeated parity-proof attempts only when .cloner repair history exists", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-delivery-repair-history-"));
  writeValidDeliveryEvidence(work);
  writeJson(join(work, ".cloner", "trace-summary.json"), {
    schemaVersion: 1,
    failedGates: [{ stage: "PARITY_PROOF", consecutiveFailures: 2 }],
  });
  writeJson(join(work, ".cloner", "repair-history.json"), { attempts: [{ stage: "PARITY_PROOF" }] });

  const gate = evaluateDeliveryManifestGate({
    project: join(work, "react"),
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: join(work, "proof", "proof-summary.json"),
    reproducibility: join(work, "react", "reports", "reproducibility.json"),
    browser: { passed: true, skipped: false, command: "open" },
  });

  assert.equal(gate.repairEvidenceSatisfied, true);
  assert.equal(gate.passed, true);
  assert.equal(gate.delivered, true);
});

test("deep failed proof remains authoritative over a newer shallow passing proof until same-depth proof passes", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-delivery-proof-authority-"));
  writeValidDeliveryEvidence(work);
  writeJson(join(work, "proof", "rerun", "deep", "proof-summary.json"), {
    passed: false,
    thresholdFingerprint: "locked-thresholds",
    scenarios: [proofScenario(work, { id: "deep", passed: false })],
  });

  const shallowPass = buildDeliveryManifest({
    project: join(work, "react"),
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: join(work, "proof", "proof-summary.json"),
    reproducibility: join(work, "react", "reports", "reproducibility.json"),
    browser: { passed: true, skipped: false, command: "open" },
  });

  assert.equal(shallowPass.proofPassed, false);
  assert.equal(shallowPass.passed, false);

  writeJson(join(work, "proof", "rerun", "deep", "proof-summary.json"), {
    passed: true,
    thresholdFingerprint: "locked-thresholds",
    scenarios: [proofScenario(work, { id: "deep", passed: true })],
  });
  const deepPass = buildDeliveryManifest({
    project: join(work, "react"),
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: join(work, "proof", "rerun", "deep", "proof-summary.json"),
    reproducibility: join(work, "react", "reports", "reproducibility.json"),
    browser: { passed: true, skipped: false, command: "open" },
  });

  assert.equal(deepPass.proofPassed, true);
  assert.equal(deepPass.passed, true);
});

test("rewriting a shallow passing proof after a deep failure does not override deep authority", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-delivery-proof-rewrite-"));
  const shallowProof = join(work, "proof", "proof-summary.json");
  const deepProof = join(work, "proof", "rerun", "deep", "proof-summary.json");
  const reproducibility = join(work, "react", "reports", "reproducibility.json");
  writeJson(shallowProof, { passed: true });
  writeJson(deepProof, { passed: false });
  writeJson(reproducibility, { passed: true });

  const future = new Date(Date.now() + 2000);
  writeJson(shallowProof, { passed: true, rewritten: true });
  utimesSync(shallowProof, future, future);

  const manifest = buildDeliveryManifest({
    project: join(work, "react"),
    previewUrl: "http://127.0.0.1:4176/",
    proofSummary: shallowProof,
    reproducibility,
    browser: { passed: true, skipped: false, command: "open" },
  });

  assert.equal(manifest.proofPassed, false);
  assert.equal(manifest.passed, false);
});

test("delivered stage blocks when manifest says passed=false or delivered=false", async () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-delivered-stage-gate-"));
  writeJson(join(work, "react", "reports", "delivery-manifest.json"), {
    passed: false,
    delivered: false,
  });

  const result = await runStateMachine({
    stateFile: join(work, ".cloner", "state.json"),
    inputFingerprint: "capture-a",
    stages: ["DELIVERED"],
    runStage: async (stage) => {
      assert.equal(stage, "DELIVERED");
      const manifest = JSON.parse(readFileSync(join(work, "react", "reports", "delivery-manifest.json"), "utf8"));
      return manifest.passed && manifest.delivered
        ? { passed: true, artifacts: [] }
        : { passed: false, recoverable: true, findings: [{ code: "delivery-finalization-gate-failed", manifest }] };
    },
  });

  assert.equal(result.status, "REPAIR_LOOP");
  assert.equal(result.delivered, false);
});

test("summarizes conversion failures by stable machine-readable cause", () => {
  const summary = summarizeConversionManifest({
    runtimeExternalReferences: [
      { file: "public/app.js", kind: "property:src", url: "https://tracker.example/*" },
      { file: "public/fallback.js", error: "Unexpected token (1:0)" },
    ],
    runtimeAssetClassifications: [
      { file: "public/fallback.js", classification: "html", action: "quarantined" },
      { file: "public/data.js", classification: "json", action: "preserved-data" },
    ],
    legacyScripts: [{ route: "/", src: "/legacy/home.js" }],
  });

  assert.deepEqual(summary.unresolvedCountByCause, { "parse-error": 1, "remote-url": 1 });
  assert.equal(summary.legacyBootstrapCount, 1);
  assert.deepEqual(summary.scriptClassificationSummary, { html: 1, json: 1 });
});

test("persists completed stages and resumes after interruption", async () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-orchestrator-"));
  const stateFile = join(work, "state.json");
  const firstCalls = [];

  await assert.rejects(
    runStateMachine({
      stateFile,
      inputFingerprint: "capture-a",
      stages: ["CAPTURE", "BUILD", "DELIVERED"],
      runStage: async (stage) => {
        firstCalls.push(stage);
        if (stage === "BUILD") throw new Error("simulated interruption");
        return { passed: true, artifacts: [] };
      },
    }),
    /simulated interruption/,
  );
  assert.deepEqual(firstCalls, ["CAPTURE", "BUILD"]);

  const resumedCalls = [];
  const result = await runStateMachine({
    stateFile,
    inputFingerprint: "capture-a",
    stages: ["CAPTURE", "BUILD", "DELIVERED"],
    runStage: async (stage) => {
      resumedCalls.push(stage);
      return { passed: true, artifacts: [] };
    },
  });
  assert.deepEqual(resumedCalls, ["BUILD", "DELIVERED"]);
  assert.equal(result.status, "DELIVERED");
});

test("routes recoverable gate failures into the repair loop", async () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-repair-"));
  const stateFile = join(work, "state.json");
  const result = await runStateMachine({
    stateFile,
    inputFingerprint: "capture-a",
    stages: ["CAPTURE", "BUILD", "DELIVERED"],
    runStage: async (stage) => stage === "BUILD"
      ? { passed: false, recoverable: true, findings: [{ code: "build-failed" }] }
      : { passed: true },
  });
  assert.equal(result.status, "REPAIR_LOOP");
  assert.equal(result.delivered, false);
  assert.match(result.repair.failureSignature, /^[a-f0-9]{64}$/);
  assert.equal(result.repair.consecutiveFailures, 1);
  const trace = JSON.parse(readFileSync(join(work, "trace-summary.json"), "utf8"));
  assert.equal(trace.failedGates.length, 1);
  assert.equal(trace.failedGates[0].stage, "BUILD");
  assert.ok(trace.failedGates[0].durationMs >= 0);
});

test("writes deterministic repair actions for bootstrap-owned legacy failures", async () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-repair-actions-"));
  const stateFile = join(work, ".cloner", "state.json");
  const result = await runStateMachine({
    stateFile,
    inputFingerprint: "capture-a",
    stages: ["LEGACY_ELIMINATION", "DELIVERED"],
    runStage: async (stage) => stage === "LEGACY_ELIMINATION"
      ? {
          passed: false,
          recoverable: true,
          findings: [
            { code: "business-bootstrap-bundle" },
            { code: "captured-legacy-script-not-reconstructed" },
            { code: "bootstrap-owned-shell" },
            { code: "engine-runtime-placeholder" },
            { code: "captured-bootstrap-replacement-unproven" },
            { code: "local-assets-gate-failed" },
          ],
        }
      : { passed: true },
  });

  assert.equal(result.status, "REPAIR_LOOP");
  assert.deepEqual(
    result.repair.requiredActions.map((entry) => entry.actionCode),
    [
      "classify-and-reconstruct-bootstrap",
      "isolate-runtime-engine",
      "close-runtime-assets",
    ],
  );
  const nextActions = JSON.parse(readFileSync(join(work, ".cloner", "next-actions.json"), "utf8"));
  assert.equal(nextActions.failureSignature, result.repair.failureSignature);
  assert.equal(nextActions.requiredActions[0].requiredArtifacts.includes("reports/bootstrap-contract.json"), true);
  assert.match(nextActions.requiredActions[0].exitCondition, /legacyScripts/);
  assert.match(nextActions.requiredActions[0].procedure[0], /legacy-repair-preparation/);
  assert.match(nextActions.requiredActions[0].procedure.at(-1), /resume/);
});

test("marks repeated identical gate failures as non-convergent", async () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-repeat-"));
  const stateFile = join(work, "state.json");
  const run = () => runStateMachine({
    stateFile,
    inputFingerprint: "capture-a",
    stages: ["BUILD", "DELIVERED"],
    runStage: async (stage) => stage === "BUILD"
      ? { passed: false, recoverable: true, findings: [{ code: "build-failed", status: 2 }] }
      : { passed: true },
  });

  const first = await run();
  const second = await run();
  assert.equal(first.repair.consecutiveFailures, 1);
  assert.equal(second.repair.consecutiveFailures, 2);
  assert.equal(second.repair.nonConvergent, true);
  assert.equal(second.repair.previousFailureSignature, second.repair.failureSignature);

  const trace = JSON.parse(readFileSync(join(work, "trace-summary.json"), "utf8"));
  assert.equal(trace.repeatedFailures.length, 1);
  assert.equal(trace.repeatedFailures[0].consecutiveFailures, 2);
});

test("persists convergence metadata on failed stage history entries", async () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-failure-history-"));
  const stateFile = join(work, "state.json");
  const run = () => runStateMachine({
    stateFile,
    inputFingerprint: "capture-a",
    stages: ["ROUTE_RECONSTRUCTION", "DELIVERED"],
    runStage: async (stage) => stage === "ROUTE_RECONSTRUCTION"
      ? {
          passed: false,
          recoverable: true,
          findings: [{ code: "route-reconstruction-failed", status: 3, stderr: "Conversion produced 2 unresolved automatic external reference(s)." }],
        }
      : { passed: true },
  });

  await run();
  await run();

  const persisted = JSON.parse(readFileSync(stateFile, "utf8"));
  const failures = persisted.history.filter((entry) => entry.stage === "ROUTE_RECONSTRUCTION" && entry.event === "failed");
  assert.equal(failures.length, 2);
  assert.match(failures[0].failureSignature, /^[a-f0-9]{64}$/);
  assert.equal(failures[0].consecutiveFailures, 1);
  assert.equal(failures[0].nonConvergent, false);
  assert.equal(failures[1].failureSignature, failures[0].failureSignature);
  assert.equal(failures[1].previousFailureSignature, failures[0].failureSignature);
  assert.equal(failures[1].consecutiveFailures, 2);
  assert.equal(failures[1].nonConvergent, true);
});

test("reconstructs convergence counts when resuming a legacy trace", async () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-legacy-trace-"));
  const stateFile = join(work, "state.json");
  const finding = { code: "route-reconstruction-failed", status: 3 };
  writeFileSync(stateFile, JSON.stringify({
    schemaVersion: 1,
    inputFingerprint: "capture-a",
    status: "REPAIR_LOOP",
    delivered: false,
    completed: {},
    history: [
      { stage: "ROUTE_RECONSTRUCTION", event: "failed", at: "2026-01-01T00:00:00.000Z", recoverable: true, findings: [finding] },
      { stage: "ROUTE_RECONSTRUCTION", event: "failed", at: "2026-01-01T00:01:00.000Z", recoverable: true, findings: [finding] },
    ],
  }));

  const state = await runStateMachine({
    stateFile,
    inputFingerprint: "capture-a",
    stages: ["ROUTE_RECONSTRUCTION", "DELIVERED"],
    runStage: async stage => stage === "ROUTE_RECONSTRUCTION"
      ? { passed: false, recoverable: true, findings: [finding] }
      : { passed: true },
  });

  const failures = state.history.filter(entry => entry.event === "failed");
  assert.deepEqual(failures.map(entry => entry.consecutiveFailures), [1, 2, 3]);
  assert.deepEqual(failures.map(entry => entry.nonConvergent), [false, true, true]);
  assert.equal(failures[1].previousFailureSignature, failures[0].failureSignature);
  assert.equal(state.repair.consecutiveFailures, 3);
});

test("invalidates completed stages when the input fingerprint changes", async () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-fingerprint-"));
  const stateFile = join(work, "state.json");
  await runStateMachine({
    stateFile,
    inputFingerprint: "capture-a",
    stages: ["CAPTURE", "DELIVERED"],
    runStage: async () => ({ passed: true }),
  });

  const calls = [];
  await runStateMachine({
    stateFile,
    inputFingerprint: "capture-b",
    stages: ["CAPTURE", "DELIVERED"],
    runStage: async (stage) => {
      calls.push(stage);
      return { passed: true };
    },
  });
  assert.deepEqual(calls, ["CAPTURE", "DELIVERED"]);
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(state.inputFingerprint, "capture-b");
});

test("invalidates stale later stages when the delivery pipeline changes", async () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-stage-migration-"));
  const stateFile = join(work, "state.json");
  await runStateMachine({
    stateFile,
    inputFingerprint: "capture-a",
    stages: ["CAPTURE", "PACKAGE", "DELIVERED"],
    runStage: async () => ({ passed: true }),
  });

  const calls = [];
  const state = await runStateMachine({
    stateFile,
    inputFingerprint: "capture-a",
    stages: ["CAPTURE", "DELIVERY_MANIFEST", "OPEN_PREVIEW", "DELIVERED"],
    runStage: async (stage) => {
      calls.push(stage);
      return { passed: true };
    },
  });

  assert.deepEqual(calls, ["DELIVERY_MANIFEST", "OPEN_PREVIEW", "DELIVERED"]);
  assert.equal(state.status, "DELIVERED");
  assert.equal("PACKAGE" in state.completed, false);
});

test("persists removal of retired stages even when current stages are already complete", async () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-retired-stage-"));
  const stateFile = join(work, "state.json");
  await runStateMachine({
    stateFile,
    inputFingerprint: "capture-a",
    stages: ["CAPTURE", "PACKAGE", "DELIVERED"],
    runStage: async () => ({ passed: true }),
  });

  const calls = [];
  await runStateMachine({
    stateFile,
    inputFingerprint: "capture-a",
    stages: ["CAPTURE", "DELIVERED"],
    runStage: async (stage) => {
      calls.push(stage);
      return { passed: true };
    },
  });

  assert.deepEqual(calls, []);
  const persisted = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal("PACKAGE" in persisted.completed, false);
});

test("invalidates component and downstream gates when delivered source changes after validation", async () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-workspace-fingerprint-"));
  const stateFile = join(work, "state.json");
  let workspaceFingerprint = "source-a";
  let proofProfileFingerprint = "profile-a";
  const stages = ["COMPONENT_RECONSTRUCTION", "LEGACY_ELIMINATION", "BUILD", "PARITY_PROOF", "DELIVERED"];
  await runStateMachine({
    stateFile,
    inputFingerprint: "capture-a",
    stages,
    getWorkspaceFingerprint: () => workspaceFingerprint,
    getProofProfileFingerprint: () => proofProfileFingerprint,
    runStage: async () => ({ passed: true }),
  });

  workspaceFingerprint = "source-b";
  const calls = [];
  await runStateMachine({
    stateFile,
    inputFingerprint: "capture-a",
    stages,
    getWorkspaceFingerprint: () => workspaceFingerprint,
    getProofProfileFingerprint: () => proofProfileFingerprint,
    runStage: async (stage) => {
      calls.push(stage);
      return { passed: true };
    },
  });
  assert.deepEqual(calls, stages);
});

test("invalidates parity proof and delivery when only the proof profile changes", async () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-proof-profile-fingerprint-"));
  const stateFile = join(work, "state.json");
  let proofProfileFingerprint = "profile-a";
  const stages = ["COMPONENT_RECONSTRUCTION", "LEGACY_ELIMINATION", "BUILD", "PARITY_PROOF", "REPRODUCIBILITY", "DELIVERED"];
  const common = {
    stateFile,
    inputFingerprint: "capture-a",
    stages,
    getWorkspaceFingerprint: () => "source-a",
    getProofProfileFingerprint: () => proofProfileFingerprint,
  };
  await runStateMachine({ ...common, runStage: async () => ({ passed: true }) });

  proofProfileFingerprint = "profile-b";
  const calls = [];
  await runStateMachine({
    ...common,
    runStage: async (stage) => {
      calls.push(stage);
      return { passed: true };
    },
  });
  assert.deepEqual(calls, ["PARITY_PROOF", "REPRODUCIBILITY", "DELIVERED"]);
});
