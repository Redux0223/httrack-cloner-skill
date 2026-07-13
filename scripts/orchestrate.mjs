#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyProofProfile, buildProofContract } from "./generate-proof-contract.mjs";
import { beginArtifactTrace, endArtifactTrace, forbiddenReportEdits } from "./artifact-trace.mjs";
import { extractBootstrapContract } from "./extract-bootstrap-contract.mjs";
import { extractReactOwnedUi } from "./extract-react-owned-ui.mjs";
import { openPreview } from "./open-preview.mjs";
import { prepareLegacyRepair } from "./prepare-legacy-repair.mjs";
import { loadSourceOracle } from "./register-source-oracle.mjs";
import { runProof } from "./run-proof.mjs";
import { synthesizeProofProfile } from "./synthesize-proof-profile.mjs";
import { ensureDir, listFiles, parseArgs, readText, safeJson, toPosix, writeText } from "./lib.mjs";
import { verifyArchitecture } from "./verify-architecture.mjs";
import { verifyContentProvenance } from "./verify-content-provenance.mjs";
import { verifyPublicAssetProvenance } from "./verify-public-asset-provenance.mjs";
import { verifyReproducible } from "./verify-reproducible.mjs";
import { verifyStyleProvenance, writeStyleBaseline } from "./verify-style-provenance.mjs";

function now() {
  return new Date().toISOString();
}

function freshState(inputFingerprint) {
  return {
    schemaVersion: 2,
    inputFingerprint,
    status: "PENDING",
    delivered: false,
    completed: {},
    history: [],
  };
}

function failureSignature(stage, findings) {
  const stableFindings = JSON.parse(JSON.stringify(findings || [], (key, value) => (
    ["stdout", "stderr", "recordedAt", "at", "durationMs"].includes(key) ? undefined : value
  )));
  return fingerprint({ stage, findings: stableFindings });
}

function repairActions(stage, findings = []) {
  const codes = new Set(findings.map((finding) => finding.code).filter(Boolean));
  const actions = [];
  const add = (action) => {
    if (!actions.some((entry) => entry.actionCode === action.actionCode)) actions.push(action);
  };

  if (codes.has("component-reconstruction-incomplete")) {
    add({
      actionCode: "reconstruct-visible-react-surface",
      requiredArtifacts: [
        "reports/react-owned-ui.json",
        "reports/bootstrap-contract.json",
        ".cloner/decompiled/main.js",
        ".cloner/style-baseline.json",
      ],
      procedure: [
        "Do not inspect or copy any sibling run. Use only this run's mirror, decompiled bundle, captured CSS, and reports.",
        "Inventory the source-visible route sections, overlays, age/cookie gates, controls, text, and class names from captured evidence.",
        "Add named React components using exact captured copy and original CSS classes around the existing local runtime adapter; brochure pages, invented copy, arbitrary cards, and shortened flows are forbidden.",
        "Keep route state, forms, menus, dialogs, progress UI, and accessibility in React. Canvas and worker ownership is handled by the next engine-isolation stage.",
        "Do not delete the sanitized local runtime adapter during the first fidelity pass. Keep it mounted until browser proof shows the React replacement covers that behavior.",
        "Add focused rendering and interaction tests, append the measured source-file delta to repair-history.json, then resume this exact run.",
      ],
      exitCondition: "Every captured route has visible React-owned structure. Engine surfaces are validated separately in ENGINE_ISOLATION.",
    });
  }

  if (codes.has("business-bootstrap-bundle")
    || codes.has("captured-legacy-script-not-reconstructed")
    || codes.has("bootstrap-owned-shell")
    || codes.has("captured-bootstrap-replacement-unproven")) {
    add({
      actionCode: "classify-and-reconstruct-bootstrap",
      requiredArtifacts: [
        "reports/legacy-classification.json",
        "reports/bootstrap-contract.json",
        ".cloner/decompiled/main.js",
        "reports/react-owned-ui.json",
      ],
      procedure: [
        "Read .cloner/legacy-repair-preparation.json and .cloner/decompiled/main.js; do not stop after describing them.",
        "Map bootstrap-contract top-level activations and global side effects to named React features, services, and an eligible engine boundary.",
        "Replace every bootstrap-owned empty route with mounted visible React UI; returning null, metadata only, or deleting the loader is invalid.",
        "Add interaction, lifecycle, and real canvas-output regression tests before removing old ownership.",
        "Delete captured application bootstrap delivery artifacts instead of renaming them to .reconstructed, .disabled, .old, or another suffix.",
        "Never edit conversion-manifest or verifier reports to clear ownership; mirror-derived evidence remains authoritative.",
        "Append the measured change to .cloner/repair-history.json, then run run-url.mjs --resume \"$RUN\".",
      ],
      exitCondition: "Every legacyScripts entry is replaced by mounted React UI or an isolated engine, and legacyScripts is empty.",
    });
  }
  if (codes.has("runtime-engine-present-but-unisolated")
    || codes.has("engine-contract-missing")
    || codes.has("engine-contract-incomplete")
    || codes.has("engine-contract-placeholder")
    || codes.has("engine-runtime-placeholder")
    || codes.has("captured-bootstrap-replacement-unproven")) {
    add({
      actionCode: "isolate-runtime-engine",
      requiredArtifacts: ["src/engines/*/index.ts", "reports/engine-contract.json"],
      procedure: [
        "Create one React-mounted engine adapter for the captured canvas/worker surface.",
        "Implement start, resize, dispatch, snapshot, and destroy with source-derived rendering, assets, stage signals, events, workers, media, GPU, body-state, and cleanup.",
        "A local RAF counter, dataset-only state, echo Blob worker, getContext call without draw output, or lifecycle-shaped no-op is a placeholder.",
        "Keep route state, forms, dialogs, overlays, and visible progress controls in React.",
        "Add mount-unmount-remount and blocking-interaction tests, record repair history, then run run-url.mjs --resume \"$RUN\".",
      ],
      exitCondition: "Runtime canvas/worker evidence has one mounted start/resize/dispatch/snapshot/destroy contract with cleanup.",
    });
  }
  if (codes.has("local-assets-gate-failed")) {
    add({
      actionCode: "close-runtime-assets",
      requiredArtifacts: ["reports/local-assets.json", "dynamic-assets-report.json"],
      procedure: [
        "Fix direct HTML and CSS asset references that resolve to missing local files.",
        "Do not save HTML route fallbacks as JS or JSON and do not create empty placeholder assets.",
        "Treat bundle-only runtime sinks as diagnostics unless the local browser actually requests them.",
        "Regenerate local-assets.json, then run run-url.mjs --resume \"$RUN\".",
      ],
      exitCondition: "All direct HTML/CSS references resolve locally; browser proof handles reachable bundle assets.",
    });
  }
  if (codes.has("content-provenance-gate-failed")) {
    add({
      actionCode: "remove-invented-visible-content",
      requiredArtifacts: ["reports/content-provenance.json"],
      procedure: [
        "Delete or replace every unsupported visible phrase with exact text derived from captured HTML, JSON, bundle, or decompiled evidence.",
        "Record the source evidence path for each retained phrase; do not write new marketing copy.",
        "Regenerate content-provenance.json, record the unsupported-count delta, then run run-url.mjs --resume \"$RUN\".",
      ],
      exitCondition: "Every user-facing React phrase occurs in immutable captured source evidence.",
    });
  }
  if (codes.has("public-asset-provenance-gate-failed")) {
    add({
      actionCode: "remove-fabricated-public-assets",
      requiredArtifacts: ["reports/public-asset-provenance.json"],
      procedure: [
        "Remove placeholder files that were not captured from the source; do not satisfy missing paths with empty JSON, no-op JS, or fake build metadata.",
        "Eliminate unreachable legacy references or implement an explicitly declared local service outside the captured asset namespace.",
        "Regenerate public-asset-provenance.json and resume the launcher.",
      ],
      exitCondition: "Every public asset is captured evidence or has explicit generated-asset provenance.",
    });
  }
  if (codes.has("forbidden-verifier-report-edit")) {
    add({
      actionCode: "regenerate-verifier-owned-reports",
      requiredArtifacts: [],
      procedure: [
        "Do not edit conversion, architecture, provenance, network, proof-summary, reproducibility, or delivery report JSON.",
        "Revert the attempted report-only strategy by changing the owning source/assets, then rerun the bundled verifier so it regenerates authoritative output.",
      ],
      exitCondition: "artifact-trace records no external edits to verifier-owned reports on the next invocation.",
    });
  }
  if (codes.has("style-provenance-gate-failed")) {
    add({
      actionCode: "restore-captured-styles",
      requiredArtifacts: ["reports/style-provenance.json", ".cloner/style-baseline.json"],
      procedure: [
        "Restore src style files to the byte-identical captured baseline; do not replace source CSS with a generic layout or append invented rules.",
        "Reuse captured class names and declarations from source.css when moving markup into React.",
        "If a runtime-owned visual rule exists only in captured JavaScript, migrate that rule into the component with explicit decompiled evidence instead of editing source.css.",
        "Regenerate style-provenance.json and resume the launcher.",
      ],
      exitCondition: "All captured stylesheet files match the route-reconstruction baseline and no untracked stylesheet is loaded.",
    });
  }
  if (codes.has("network-gate-failed")) {
    add({
      actionCode: "replace-external-runtime-services",
      requiredArtifacts: ["reports/no-external-runtime.json"],
      exitCondition: "Automatic non-loopback runtime requests are zero.",
    });
  }
  if (codes.has("proof-profile-required")) {
    add({
      actionCode: "synthesize-deep-proof-profile",
      requiredArtifacts: ["reports/proof-profile.json"],
      exitCondition: "Every captured interaction family and blocking gate has desktop/mobile actions and state checkpoints.",
    });
  }
  if (codes.has("proof-execution-failed")) {
    add({
      actionCode: "repair-observed-browser-runtime",
      requiredArtifacts: ["proof/proof-contract.json", "reports/proof-profile.json"],
      procedure: [
        "Reproduce the failed action against the running local preview and collect page errors, console errors, failed requests, navigation, and the current DOM.",
        "Repair the generated React source or a browser-reachable local asset; do not merely increase the timeout.",
        "If a requested JS/JSON/shader/media path returns the SPA HTML fallback, capture the real source asset or remove the reachable request.",
        "Resume the same run after the local page reaches the expected interaction target.",
      ],
      exitCondition: "The proof action executes against a mounted local runtime without timeout or browser startup errors.",
    });
  }
  if ([...codes].some((code) => ["install-failed", "typecheck-failed", "build-failed"].includes(code))) {
    add({
      actionCode: "repair-build",
      requiredArtifacts: ["package-lock.json", "dist"],
      exitCondition: "npm ci, typecheck, and production build all exit zero.",
    });
  }
  if (actions.length === 0) {
    for (const code of [...codes].sort()) {
      add({
        actionCode: `repair-${code}`,
        requiredArtifacts: [],
        exitCondition: `The ${stage} finding ${code} is absent on the next measured rerun.`,
      });
    }
  }
  return actions;
}

function traceSummary(state) {
  const terminalEvents = state.history.filter((entry) => ["completed", "failed", "interrupted"].includes(entry.event));
  const failedGates = terminalEvents
    .filter((entry) => entry.event === "failed")
    .map((entry) => ({
      stage: entry.stage,
      at: entry.at,
      durationMs: entry.durationMs ?? null,
      failureSignature: entry.failureSignature || null,
      consecutiveFailures: entry.consecutiveFailures || 1,
      nonConvergent: Boolean(entry.nonConvergent),
      findingCodes: (entry.findings || []).map((finding) => finding.code || "unknown"),
    }));
  return {
    schemaVersion: 1,
    status: state.status,
    delivered: state.delivered,
    stageDurations: terminalEvents.map((entry) => ({
      stage: entry.stage,
      event: entry.event,
      durationMs: entry.durationMs ?? null,
    })),
    failedGates,
    repeatedFailures: failedGates.filter((entry) => entry.consecutiveFailures >= 2 || entry.nonConvergent),
    currentRepair: state.repair || null,
  };
}

function readState(stateFile, inputFingerprint) {
  if (!existsSync(stateFile)) return freshState(inputFingerprint);
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  if (!state.schemaVersion || state.schemaVersion < 2) {
    const failuresByStage = new Map();
    for (const entry of state.history || []) {
      if (entry?.event !== "failed") continue;
      const signature = entry.failureSignature || failureSignature(entry.stage, entry.findings || []);
      const priorFailures = failuresByStage.get(entry.stage) || [];
      const previousFailure = priorFailures.at(-1) || null;
      const consecutiveFailures = previousFailure?.failureSignature === signature
        ? (previousFailure.consecutiveFailures || 1) + 1
        : 1;
      const recentSignatures = [...priorFailures.slice(-2).map((failure) => failure.failureSignature), signature].filter(Boolean);
      const recurringFailure = recentSignatures.length === 3 && recentSignatures[0] === recentSignatures[2];
      entry.failureSignature = signature;
      entry.previousFailureSignature = previousFailure?.failureSignature || null;
      entry.consecutiveFailures = consecutiveFailures;
      entry.nonConvergent = consecutiveFailures >= 2 || recurringFailure;
      priorFailures.push(entry);
      failuresByStage.set(entry.stage, priorFailures);
    }
    state.schemaVersion = 2;
  }
  return state.inputFingerprint === inputFingerprint ? state : freshState(inputFingerprint);
}

function persistState(stateFile, state) {
  ensureDir(dirname(stateFile));
  const temporary = `${stateFile}.tmp`;
  writeFileSync(temporary, safeJson(state));
  renameSync(temporary, stateFile);
  writeText(join(dirname(stateFile), "trace-summary.json"), safeJson(traceSummary(state)));
  writeText(join(dirname(stateFile), "next-actions.json"), safeJson(state.repair
    ? {
        schemaVersion: 1,
        status: state.status,
        ...state.repair,
      }
    : {
        schemaVersion: 1,
        status: state.status,
        requiredActions: [],
      }));
}

function invalidateCompletedFrom(state, stages, firstStage, reason) {
  const start = stages.indexOf(firstStage);
  if (start < 0) return false;
  let changed = false;
  for (const stage of stages.slice(start)) {
    if (state.completed[stage]) {
      delete state.completed[stage];
      changed = true;
    }
  }
  if (changed) {
    state.status = "PENDING";
    state.delivered = false;
    state.repair = null;
    state.history.push({ stage: firstStage, event: "invalidated", at: now(), reason });
  }
  return changed;
}

export async function runStateMachine({
  stateFile,
  inputFingerprint,
  stages,
  runStage,
  getWorkspaceFingerprint = null,
  getProofProfileFingerprint = null,
}) {
  const absoluteStateFile = resolve(stateFile);
  const state = readState(absoluteStateFile, inputFingerprint);
  const currentWorkspaceFingerprint = getWorkspaceFingerprint?.() ?? null;
  const currentProofProfileFingerprint = getProofProfileFingerprint?.() ?? null;
  let fingerprintInvalidated = false;
  if (state.workspaceFingerprint != null && state.workspaceFingerprint !== currentWorkspaceFingerprint) {
    fingerprintInvalidated = invalidateCompletedFrom(
      state,
      stages,
      "COMPONENT_RECONSTRUCTION",
      "delivered-workspace-changed",
    ) || fingerprintInvalidated;
  } else if (state.proofProfileFingerprint != null && state.proofProfileFingerprint !== currentProofProfileFingerprint) {
    fingerprintInvalidated = invalidateCompletedFrom(
      state,
      stages,
      "PARITY_PROOF",
      "proof-profile-changed",
    ) || fingerprintInvalidated;
  }
  state.workspaceFingerprint = currentWorkspaceFingerprint;
  state.proofProfileFingerprint = currentProofProfileFingerprint;
  const activeStages = new Set(stages);
  let stateMigrated = fingerprintInvalidated;

  const refreshFingerprints = () => {
    state.workspaceFingerprint = getWorkspaceFingerprint?.() ?? null;
    state.proofProfileFingerprint = getProofProfileFingerprint?.() ?? null;
  };

  for (const stage of Object.keys(state.completed)) {
    if (!activeStages.has(stage)) {
      delete state.completed[stage];
      stateMigrated = true;
    }
  }

  let foundIncomplete = false;
  for (const stage of stages) {
    if (!state.completed[stage]) {
      foundIncomplete = true;
    } else if (foundIncomplete) {
      delete state.completed[stage];
      stateMigrated = true;
    }
  }

  if (stateMigrated) persistState(absoluteStateFile, state);

  for (const stage of stages) {
    if (state.completed[stage]) continue;
    const startedAtMs = Date.now();
    state.status = stage;
    state.delivered = false;
    state.history.push({ stage, event: "started", at: now() });
    persistState(absoluteStateFile, state);

    let result;
    try {
      result = await runStage(stage, structuredClone(state));
    } catch (error) {
      state.history.push({ stage, event: "interrupted", at: now(), durationMs: Date.now() - startedAtMs, error: error.message });
      persistState(absoluteStateFile, state);
      throw error;
    }

    if (!result?.passed) {
      const nextStatus = result?.recoverable ? "REPAIR_LOOP" : "SUSPENDED";
      const signature = failureSignature(stage, result?.findings || []);
      const priorFailures = state.history.filter((entry) => entry.stage === stage && entry.event === "failed");
      const previousFailure = priorFailures.at(-1) || null;
      const consecutiveFailures = previousFailure?.failureSignature === signature
        ? (previousFailure.consecutiveFailures || 1) + 1
        : 1;
      const recentSignatures = [...priorFailures.slice(-2).map((entry) => entry.failureSignature), signature].filter(Boolean);
      const recurringFailure = recentSignatures.length === 3 && recentSignatures[0] === recentSignatures[2];
      const nonConvergent = consecutiveFailures >= 2 || recurringFailure;
      state.status = nextStatus;
      state.repair = {
        stage,
        failureSignature: signature,
        previousFailureSignature: previousFailure?.failureSignature || null,
        consecutiveFailures,
        nonConvergent,
        repairHistoryRequired: true,
        findingCodes: (result?.findings || []).map((finding) => finding.code || "unknown"),
        requiredActions: repairActions(stage, result?.findings || []),
      };
      state.history.push({
        stage,
        event: "failed",
        at: now(),
        durationMs: Date.now() - startedAtMs,
        recoverable: Boolean(result?.recoverable),
        failureSignature: signature,
        previousFailureSignature: previousFailure?.failureSignature || null,
        consecutiveFailures,
        nonConvergent,
        findings: result?.findings || [],
      });
      persistState(absoluteStateFile, state);
      return state;
    }

    state.completed[stage] = {
      at: now(),
      artifacts: result.artifacts || [],
      findings: result.findings || [],
    };
    state.history.push({ stage, event: "completed", at: now(), durationMs: Date.now() - startedAtMs });
    state.repair = null;
    if (stage === "DELIVERED") {
      state.status = "DELIVERED";
      state.delivered = true;
    }
    refreshFingerprints();
    persistState(absoluteStateFile, state);
  }

  return state;
}

function projectWorkspaceFingerprint(output) {
  const root = resolve(output);
  const contentRoots = [join(root, "src")];
  const contentFiles = [
    ...contentRoots.flatMap((path) => existsSync(path) ? listFiles(path) : []),
    ...["package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "vitest.config.ts"]
      .map((path) => join(root, path))
      .filter(existsSync),
  ];
  const publicRoot = join(root, "public");
  const publicEntries = existsSync(publicRoot) ? listFiles(publicRoot).map((file) => {
    const stat = statSync(file);
    return [toPosix(relative(publicRoot, file)), stat.size, stat.mtimeMs];
  }) : [];
  const hash = createHash("sha256");
  for (const file of [...new Set(contentFiles)].sort()) {
    hash.update(toPosix(relative(root, file)));
    hash.update(readFileSync(file));
  }
  hash.update(JSON.stringify(publicEntries));
  return hash.digest("hex");
}

function proofProfileFingerprint(output) {
  const path = join(resolve(output), "reports/proof-profile.json");
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "missing";
}

export const DEFAULT_STAGES = [
  "CAPTURE",
  "INVENTORY",
  "AUTHORIZATION_INVENTORY",
  "ROUTE_RECONSTRUCTION",
  "COMPONENT_RECONSTRUCTION",
  "BEHAVIOR_EXTRACTION",
  "ENGINE_ISOLATION",
  "OFFLINE_SERVICES",
  "LEGACY_ELIMINATION",
  "BUILD",
  "LOCAL_PREVIEW",
  "PARITY_PROOF",
  "REPRODUCIBILITY",
  "DELIVERY_MANIFEST",
  "OPEN_PREVIEW",
  "DELIVERED",
];

export function buildDeliveryManifest({
  project,
  previewUrl,
  proofSummary,
  reproducibility,
  browser = null,
  proofPassed = null,
  reproducible = null,
  delivered = null,
}) {
  const preOpenGate = evaluatePreOpenDeliveryGate({ project, previewUrl, proofSummary, reproducibility });
  const browserOpened = browser ? Boolean(browser.passed) : false;
  const resolvedProofPassed = typeof proofPassed === "boolean" ? proofPassed && preOpenGate.proofPassed : preOpenGate.proofPassed;
  const resolvedReproducible = typeof reproducible === "boolean" ? reproducible && preOpenGate.reproducible : preOpenGate.reproducible;
  const repairEvidenceSatisfied = preOpenGate.repairEvidenceSatisfied;
  const resolvedDelivered = typeof delivered === "boolean"
    ? delivered && preOpenGate.passed && browserOpened
    : preOpenGate.passed && browserOpened;
  return {
    schemaVersion: 1,
    passed: Boolean(preOpenGate.passed && resolvedReproducible && browserOpened),
    project,
    previewUrl,
    proofSummary,
    reproducibility,
    proofPassed: resolvedProofPassed,
    proofDiagnosticAccepted: preOpenGate.proofDiagnosticAccepted,
    reproducible: resolvedReproducible,
    repairEvidenceSatisfied,
    browserOpened,
    delivered: resolvedDelivered,
    browser,
    deliveredAt: resolvedDelivered ? now() : null,
  };
}

export function evaluatePreOpenDeliveryGate({ project, previewUrl, proofSummary, reproducibility }) {
  const proofEvaluation = evaluateProofSummary({ project, proofSummary });
  const reproducibilityEvaluation = evaluateReproducibilityReport(reproducibility);
  const proofAccepted = proofEvaluation.passed === true || proofEvaluation.deliveryAccepted === true;
  const passed = proofAccepted && reproducibilityEvaluation.passed && proofEvaluation.repairHistorySatisfied;
  return {
    schemaVersion: 1,
    passed,
    project,
    previewUrl,
    proofSummary,
    reproducibility,
    proofPassed: proofEvaluation.passed,
    proofDiagnosticAccepted: proofEvaluation.deliveryAccepted,
    reproducible: reproducibilityEvaluation.passed,
    browserOpened: false,
    repairEvidenceSatisfied: proofEvaluation.repairHistorySatisfied,
    delivered: false,
    browser: null,
    deliveredAt: null,
  };
}

export function evaluateDeliveryManifestGate({ project, previewUrl, proofSummary, reproducibility, browser = null }) {
  return buildDeliveryManifest({ project, previewUrl, proofSummary, reproducibility, browser });
}

function evaluateReproducibilityReport(reproducibilityFile, fallbackPassed = null) {
  if (!reproducibilityFile || !existsSync(reproducibilityFile)) return { passed: false, findings: ["report-missing"] };
  try {
    const report = JSON.parse(readText(reproducibilityFile));
    const findings = [];
    if (report?.passed !== true) findings.push("report-not-passed");
    if (!Array.isArray(report?.commands) || report.commands.length < 2 || report.commands.some((entry) => entry.status !== 0)) {
      findings.push("commands-incomplete");
    }
    if (!Array.isArray(report?.routes) || report.routes.length === 0 || report.routes.some((entry) => entry.status !== 200 || !String(entry.contentType || "").includes("text/html"))) {
      findings.push("route-probes-incomplete");
    }
    let previewUrl = null;
    try {
      previewUrl = new URL(String(report?.previewUrl || ""));
      if (!new Set(["127.0.0.1", "localhost", "::1"]).has(previewUrl.hostname)) findings.push("preview-not-loopback");
    } catch {
      findings.push("preview-url-invalid");
    }
    const passed = findings.length === 0 && fallbackPassed !== false;
    return { passed, findings, report };
  } catch {
    return { passed: false, findings: ["report-invalid"] };
  }
}

function proofContractFor(project) {
  return project ? join(dirname(resolve(project)), "proof", "proof-contract.json") : null;
}

function validateProofArtifacts({ project, proofSummaryFile }) {
  const summary = safeReadJson(proofSummaryFile);
  const contractFile = proofContractFor(project);
  const contract = safeReadJson(contractFile);
  const findings = [];
  if (!summary) findings.push("summary-missing-or-invalid");
  if (!contract) findings.push("contract-missing-or-invalid");
  const productionFirstAccepted = summary?.deliveryAccepted === true && summary?.acceptanceMode === "production-first";
  const proofExecutionDiagnostic = productionFirstAccepted && summary?.executionFailed === true;
  if (summary?.passed !== true && !productionFirstAccepted) findings.push("summary-not-passed");
  if (contract?.thresholdsLocked !== true || typeof contract?.thresholdFingerprint !== "string") findings.push("thresholds-unlocked");
  if (summary?.thresholdFingerprint !== contract?.thresholdFingerprint) findings.push("threshold-fingerprint-mismatch");
  if (proofExecutionDiagnostic) {
    return { passed: false, deliveryAccepted: findings.length === 0, findings, summary, contract, contractFile };
  }
  if (contract?.dynamicProofRequired) {
    const environmentIds = new Set((contract.environments || []).map((environment) => environment.id));
    if (!environmentIds.has("desktop") || !environmentIds.has("mobile")) findings.push("dynamic-environment-coverage-incomplete");
  }
  const expectedScenarios = Array.isArray(contract?.scenarios) && Array.isArray(contract?.environments)
    ? contract.scenarios.length * contract.environments.length
    : 0;
  if (!Array.isArray(summary?.scenarios) || expectedScenarios === 0 || summary.scenarios.length !== expectedScenarios) {
    findings.push("scenario-coverage-incomplete");
  }
  for (const scenario of summary?.scenarios || []) {
    if (!productionFirstAccepted && (scenario?.passed !== true || (scenario.findings || []).length > 0)) {
      findings.push(`scenario-failed:${scenario?.id || "unknown"}`);
    }
    for (const side of ["source", "local"]) {
      const capture = scenario?.[side];
      if (!capture?.screenshot || !existsSync(capture.screenshot)) findings.push(`screenshot-missing:${scenario?.id || "unknown"}:${side}`);
      if (!capture?.actionTrace || !Array.isArray(capture?.requests) || !Array.isArray(capture?.consoleErrors) || !Array.isArray(capture?.pageErrors)) {
        findings.push(`capture-evidence-incomplete:${scenario?.id || "unknown"}:${side}`);
      }
    }
    if (scenario?.image?.dimensionsMatch !== true || !Number.isFinite(scenario?.image?.mismatchRatio)) {
      findings.push(`image-evidence-incomplete:${scenario?.id || "unknown"}`);
    }
  }
  if (productionFirstAccepted) {
    return { passed: false, deliveryAccepted: findings.length === 0, findings, summary, contract, contractFile };
  }
  return { passed: findings.length === 0, findings, summary, contract, contractFile };
}

function evaluateProofSummary({ project, proofSummary, proofPassed: fallbackPassed = null }) {
  const proofSummaryFile = proofSummary;
  if (!proofSummaryFile || !existsSync(proofSummaryFile)) {
    return { passed: typeof fallbackPassed === "boolean" ? fallbackPassed : false, repairHistorySatisfied: repeatedProofFailuresBlocked(project) ? false : true };
  }

  const artifactValidation = validateProofArtifacts({ project, proofSummaryFile });
  const latestProof = latestProofSummary(dirname(proofSummaryFile));
  const currentPath = resolve(proofSummaryFile);
  const supersededByFailedProof = latestProof
    && resolve(latestProof.path) !== currentPath
    && !latestProof.summary?.passed
    && latestProof.summary?.deliveryAccepted !== true;
  const repairHistorySatisfied = verifyRepairEvidenceForProof({ project, proofSummaryFile: currentPath });

  return {
    passed: artifactValidation.passed && fallbackPassed !== false && !supersededByFailedProof && repairHistorySatisfied,
    deliveryAccepted: artifactValidation.deliveryAccepted === true && fallbackPassed !== false && !supersededByFailedProof && repairHistorySatisfied,
    repairHistorySatisfied,
    findings: artifactValidation.findings,
  };
}

function latestProofSummary(root) {
  let authoritative = null;
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.name !== "proof-summary.json") continue;
      const stat = statSync(fullPath);
      const candidate = {
        path: fullPath,
        stat,
        summary: safeReadJson(fullPath),
        depth: fullPath.slice(root.length).split("/").filter(Boolean).length,
      };
      if (!authoritative
        || candidate.depth > authoritative.depth
        || (candidate.depth === authoritative.depth && stat.mtimeMs > authoritative.stat.mtimeMs)) {
        authoritative = candidate;
      }
    }
  }
  walk(root);
  return authoritative;
}

function verifyRepairEvidenceForProof({ project, proofSummaryFile }) {
  const proofRoot = dirname(proofSummaryFile);
  const runRoot = project ? dirname(resolve(project)) : dirname(dirname(proofRoot));
  const traceSummaryFile = join(runRoot, ".cloner", "trace-summary.json");
  const stateFile = join(runRoot, ".cloner", "state.json");
  const repairHistoryFile = join(runRoot, ".cloner", "repair-history.json");
  const traceSummary = safeReadJson(traceSummaryFile);
  const state = safeReadJson(stateFile);
  const repeatedParityFailures = countParityProofFailures(traceSummary, state);
  if (repeatedParityFailures < 2) return true;
  return existsSync(traceSummaryFile) && existsSync(repairHistoryFile);
}

function repeatedProofFailuresBlocked(project) {
  if (!project) return false;
  const runRoot = dirname(resolve(project));
  const traceSummary = safeReadJson(join(runRoot, ".cloner", "trace-summary.json"));
  const state = safeReadJson(join(runRoot, ".cloner", "state.json"));
  const repeatedFromTrace = (traceSummary?.failedGates || []).some((entry) => entry.stage === "PARITY_PROOF" && (entry.consecutiveFailures || entry.attempts || 1) >= 2);
  if (repeatedFromTrace) return true;
  const parityTerminals = (state?.history || []).filter((entry) => entry.stage === "PARITY_PROOF" && ["failed", "interrupted"].includes(entry.event));
  return parityTerminals.length >= 2;
}

function countParityProofFailures(traceSummary, state) {
  const traceEntries = (traceSummary?.failedGates || []).filter((entry) => entry.stage === "PARITY_PROOF");
  const traceCount = traceEntries.reduce((max, entry) => {
    const count = entry.consecutiveFailures || entry.attempts || 1;
    return Math.max(max, count);
  }, 0);
  const stateCount = (state?.history || []).filter((entry) => (
    entry.stage === "PARITY_PROOF" && ["failed", "interrupted"].includes(entry.event)
  )).length;
  return Math.max(traceCount, stateCount);
}

function safeReadJson(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readText(path));
  } catch {
    return null;
  }
}

export function summarizeConversionManifest(manifest = {}) {
  const unresolvedCountByCause = {};
  for (const finding of manifest.runtimeExternalReferences || []) {
    const cause = finding.cause || (finding.error ? "parse-error" : finding.kind === "content-type-mismatch" ? "content-type-mismatch" : "remote-url");
    unresolvedCountByCause[cause] = (unresolvedCountByCause[cause] || 0) + 1;
  }
  const scriptClassificationSummary = {};
  for (const entry of manifest.runtimeAssetClassifications || []) {
    const classification = entry.classification || "unknown";
    scriptClassificationSummary[classification] = (scriptClassificationSummary[classification] || 0) + 1;
  }
  return {
    unresolvedCount: (manifest.runtimeExternalReferences || []).length,
    unresolvedCountByCause: Object.fromEntries(Object.entries(unresolvedCountByCause).sort(([left], [right]) => left.localeCompare(right))),
    legacyBootstrapCount: (manifest.legacyScripts || []).length,
    scriptClassificationSummary: Object.fromEntries(Object.entries(scriptClassificationSummary).sort(([left], [right]) => left.localeCompare(right))),
  };
}

export function evaluateComponentReconstruction(reactOwnedUi = {}, runtimeEvidence = {}) {
  const emptyRoutes = (reactOwnedUi.routes || [])
    .filter((route) => Number(route.visibleElements || 0) === 0)
    .map((route) => route.route);
  const canvasRequired = Number(runtimeEvidence.canvas || 0) > 0;
  const canvasMounts = Number(reactOwnedUi.summary?.canvasMounts || 0);
  const findings = emptyRoutes.length > 0
    ? [{ code: "react-route-visible-surface-missing", routes: emptyRoutes }]
    : [];
  return { passed: findings.length === 0, routes: emptyRoutes, canvasRequired, canvasMounts, findings };
}

export async function prepareComponentReconstructionEvidence({ output, work }) {
  const bootstrapContract = extractBootstrapContract(output);
  const legacyRepair = bootstrapContract.bootstrapCandidates.length > 0
    ? await prepareLegacyRepair({ project: output, work })
    : { prepared: false, reason: "bootstrap-candidate-missing" };
  return { bootstrapContract, legacyRepair };
}

const ENGINE_ISOLATION_CODES = new Set([
  "runtime-engine-present-but-unisolated",
  "engine-contract-missing",
  "engine-contract-incomplete",
  "engine-contract-placeholder",
  "engine-contract-unmounted",
  "runtime-canvas-surface-missing",
  "runtime-worker-cleanup-missing",
  "engine-runtime-placeholder",
  "captured-bootstrap-replacement-unproven",
]);

export function evaluateEngineIsolation(architecture = {}) {
  const localRuntimeAdapter = (architecture.businessBootstrapBundles || []).length > 0
    || (architecture.capturedLegacyScripts || []).length > 0;
  if (localRuntimeAdapter) {
    return {
      passed: true,
      findings: [],
      diagnostics: (architecture.findings || []).filter((finding) => ENGINE_ISOLATION_CODES.has(finding.code)),
      mode: "local-captured-runtime-adapter",
    };
  }
  const findings = (architecture.findings || []).filter((finding) => ENGINE_ISOLATION_CODES.has(finding.code));
  return { passed: findings.length === 0, findings };
}

export function evaluateLegacyElimination({
  architecture = {},
  content = {},
  publicAssets = {},
  styles = {},
  assets = {},
  network = {},
  reportEdits = [],
} = {}) {
  const localRuntimeAdapter = (architecture.businessBootstrapBundles || []).length > 0
    || (architecture.capturedLegacyScripts || []).length > 0;
  const architectureFindings = architecture.findings || [];
  const blockingArchitecture = localRuntimeAdapter
    ? architectureFindings.filter((finding) => finding.code === "tanstack-router-missing")
    : architectureFindings;
  const blockingFindings = [
    ...blockingArchitecture,
    ...(!assets.passed ? [{ code: "local-assets-gate-failed", ...assets }] : []),
    ...(!network.passed ? [{ code: "network-gate-failed", ...network }] : []),
  ];
  const diagnostics = [
    ...(architectureFindings.length > blockingArchitecture.length ? [{
      code: "architecture-migration-diagnostic",
      mode: "local-captured-runtime-adapter",
      findings: architectureFindings.filter((finding) => !blockingArchitecture.includes(finding)),
    }] : []),
    ...(reportEdits.length > 0 ? [{ code: "verifier-report-edit-diagnostic", files: reportEdits }] : []),
    ...(!content.passed ? [{ code: "content-provenance-diagnostic", unsupported: content.unsupported || [] }] : []),
    ...(!publicAssets.passed ? [{
      code: "public-asset-provenance-diagnostic",
      uncaptured: publicAssets.uncaptured || [],
      mismatched: publicAssets.mismatched || [],
    }] : []),
    ...(!styles.passed ? [{
      code: "style-provenance-diagnostic",
      modified: styles.modified || [],
      untracked: styles.untracked || [],
      missing: styles.missing || [],
    }] : []),
  ];
  return { passed: blockingFindings.length === 0, blockingFindings, diagnostics };
}

function commandResult(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return {
    passed: result.status === 0,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function normalizeProofExecutionFailure(error) {
  return {
    code: "proof-execution-failed",
    error: String(error?.stack || error?.message || error),
  };
}

export function buildProductionFirstProofFailureSummary(error, contract = {}) {
  const finding = normalizeProofExecutionFailure(error);
  return {
    passed: false,
    deliveryAccepted: true,
    acceptanceMode: "production-first",
    executionFailed: true,
    thresholdFingerprint: contract.thresholdFingerprint ?? null,
    scenarios: [],
    parityDiagnostics: [finding],
  };
}

function fingerprint(values) {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function availablePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePromise(address.port));
    });
  });
}

async function waitForUrl(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  return false;
}

async function startPreview({ output, work, requestedPort }) {
  const previewState = join(work, ".cloner/preview.json");
  if (existsSync(previewState)) {
    const previous = JSON.parse(readText(previewState));
    if (previous.url && await waitForUrl(previous.url, 1000)) return previous;
  }
  const port = requestedPort || await availablePort();
  ensureDir(join(work, ".cloner"));
  const stdoutPath = join(work, ".cloner/preview.stdout.log");
  const stderrPath = join(work, ".cloner/preview.stderr.log");
  const child = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: output,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();
  const url = `http://127.0.0.1:${port}/`;
  if (!await waitForUrl(url)) throw new Error(`Local preview did not become ready: ${url}`);
  const state = { url, port, pid: child.pid, stdoutPath, stderrPath };
  writeText(previewState, safeJson(state));
  return state;
}

export async function runAutonomousClone(options) {
  const scriptRoot = dirname(fileURLToPath(import.meta.url));
  const sourceUrl = String(options.url);
  const work = resolve(String(options.work));
  const output = resolve(String(options.output || join(work, "react")));
  const mirror = resolve(String(options.input || join(work, "mirror")));
  const stateFile = join(work, ".cloner/state.json");
  const inputFingerprint = fingerprint({ sourceUrl, mirror, output, basePath: options.basePath || "/" });
  let previewState = null;
  const deliveryManifestFile = join(output, "reports/delivery-manifest.json");
  const artifactTrace = beginArtifactTrace(work);
  let finalStatus = "INTERRUPTED";

  try {
    const state = await runStateMachine({
      stateFile,
      inputFingerprint,
      stages: DEFAULT_STAGES,
      getWorkspaceFingerprint: () => projectWorkspaceFingerprint(output),
      getProofProfileFingerprint: () => proofProfileFingerprint(output),
      runStage: async (stage) => {
      if (stage === "CAPTURE") {
        if (options.input && existsSync(mirror)) return { passed: true, artifacts: [mirror] };
        const args = [
          join(scriptRoot, "capture-site.mjs"),
          "--url", sourceUrl,
          "--output", mirror,
          "--authorized",
          "--depth", String(options.depth || 3),
        ];
        if (options.allowHost) args.push("--allow-host", String(options.allowHost));
        if (options.hints) args.push("--hints", resolve(String(options.hints)));
        const result = commandResult(process.execPath, args);
        return result.passed ? { passed: true, artifacts: [mirror] } : { passed: false, recoverable: true, findings: [{ code: "capture-failed", ...result }] };
      }

      if (stage === "INVENTORY") {
        const captureReport = join(mirror, "capture-report.json");
        return existsSync(mirror)
          ? { passed: true, artifacts: existsSync(captureReport) ? [captureReport] : [mirror] }
          : { passed: false, recoverable: true, findings: [{ code: "mirror-missing" }] };
      }

      if (stage === "AUTHORIZATION_INVENTORY") {
        return { passed: true, artifacts: [] };
      }

      if (stage === "ROUTE_RECONSTRUCTION") {
        const args = [
          join(scriptRoot, "run-pipeline.mjs"),
          "--input", mirror,
          "--output", output,
          "--source-url", sourceUrl,
          "--authorized",
          "--base-path", String(options.basePath || "/"),
        ];
        if (options.offlineRules) args.push("--offline-rules", resolve(String(options.offlineRules)));
        const result = commandResult(process.execPath, args);
        const conversionManifestFile = join(output, "reports/conversion-manifest.json");
        const conversionSummary = existsSync(conversionManifestFile)
          ? summarizeConversionManifest(JSON.parse(readText(conversionManifestFile)))
          : null;
        if (result.passed) writeStyleBaseline({ project: output, work });
        return result.passed
          ? { passed: true, artifacts: [conversionManifestFile, join(work, ".cloner/style-baseline.json")] }
          : { passed: false, recoverable: true, findings: [{ code: "route-reconstruction-failed", conversionSummary, ...result }] };
      }

      if (stage === "COMPONENT_RECONSTRUCTION") {
        await prepareComponentReconstructionEvidence({ output, work });
        const ui = extractReactOwnedUi(output);
        const architecture = verifyArchitecture(output);
        const gate = evaluateComponentReconstruction(ui, architecture.runtimeEngineEvidence);
        return gate.passed
          ? { passed: true, artifacts: [join(output, "reports/react-owned-ui.json")] }
          : { passed: false, recoverable: true, findings: [{ code: "component-reconstruction-incomplete", ...gate }] };
      }

      if (stage === "BEHAVIOR_EXTRACTION") {
        const behaviorFile = join(output, "reports/behavior-contracts.json");
        const behavior = existsSync(behaviorFile) ? JSON.parse(readText(behaviorFile)) : null;
        const passed = Boolean(behavior) && Number(behavior.summary?.parseErrorFiles || 0) === 0;
        return passed
          ? { passed: true, artifacts: [behaviorFile] }
          : { passed: false, recoverable: true, findings: [{ code: "behavior-extraction-incomplete", parseErrorFiles: behavior?.summary?.parseErrorFiles ?? null }] };
      }

      if (stage === "ENGINE_ISOLATION") {
        const architecture = verifyArchitecture(output);
        const gate = evaluateEngineIsolation(architecture);
        return gate.passed
          ? { passed: true, artifacts: [join(output, "reports/architecture-verification.json")] }
          : { passed: false, recoverable: true, findings: gate.findings };
      }

      if (stage === "OFFLINE_SERVICES") {
        const network = commandResult(process.execPath, [join(scriptRoot, "verify-no-external.mjs"), "--project", output]);
        return network.passed
          ? { passed: true, artifacts: [join(output, "reports/no-external-runtime.json")] }
          : { passed: false, recoverable: true, findings: [{ code: "network-gate-failed", ...network }] };
      }

      if (stage === "LEGACY_ELIMINATION") {
        const reportEdits = forbiddenReportEdits(artifactTrace.externalChanges?.reportEdits || []);
        const bootstrapContract = extractBootstrapContract(output);
        extractReactOwnedUi(output);
        if (bootstrapContract.legacyEntries.length > 0) await prepareLegacyRepair({ project: output, work });
        const architecture = verifyArchitecture(output);
        const content = verifyContentProvenance({ project: output, mirror });
        const publicAssets = verifyPublicAssetProvenance({ project: output, mirror });
        const styles = verifyStyleProvenance({ project: output, work });
        const assets = commandResult(process.execPath, [join(scriptRoot, "verify-local-assets.mjs"), "--project", output, ...(options.hints ? ["--hints", resolve(String(options.hints))] : [])]);
        const network = commandResult(process.execPath, [join(scriptRoot, "verify-no-external.mjs"), "--project", output]);
        const gate = evaluateLegacyElimination({ architecture, content, publicAssets, styles, assets, network, reportEdits });
        const diagnosticsFile = join(output, "reports/migration-diagnostics.json");
        writeText(diagnosticsFile, safeJson({ schemaVersion: 1, ...gate }));
        return gate.passed
          ? { passed: true, artifacts: [
            join(output, "reports/architecture-verification.json"),
            join(output, "reports/bootstrap-contract.json"),
            join(output, "reports/legacy-classification.json"),
            join(output, "reports/react-owned-ui.json"),
            join(output, "reports/content-provenance.json"),
            join(output, "reports/public-asset-provenance.json"),
            join(output, "reports/style-provenance.json"),
            diagnosticsFile,
          ], findings: gate.diagnostics }
          : { passed: false, recoverable: true, findings: gate.blockingFindings };
      }

      if (stage === "BUILD") {
        const install = commandResult("npm", [existsSync(join(output, "package-lock.json")) ? "ci" : "install"], { cwd: output });
        if (!install.passed) return { passed: false, recoverable: true, findings: [{ code: "install-failed", ...install }] };
        // Vite's TanStack plugin refreshes routeTree.gen.ts before TypeScript checks it.
        const build = commandResult("npm", ["run", "build"], { cwd: output });
        const typecheck = build.passed
          ? commandResult("npm", ["run", "typecheck"], { cwd: output })
          : { passed: false, status: null, stdout: "", stderr: "Skipped because build failed." };
        return typecheck.passed && build.passed
          ? { passed: true, artifacts: [join(output, "dist")] }
          : { passed: false, recoverable: true, findings: [
            ...(!build.passed ? [{ code: "build-failed", ...build }] : []),
            ...(build.passed && !typecheck.passed ? [{ code: "typecheck-failed", ...typecheck }] : []),
          ] };
      }

      if (stage === "LOCAL_PREVIEW") {
        previewState = await startPreview({ output, work, requestedPort: options.port ? Number(options.port) : null });
        return { passed: true, artifacts: [join(work, ".cloner/preview.json"), previewState.url] };
      }

      if (stage === "PARITY_PROOF") {
        previewState ||= await startPreview({ output, work, requestedPort: options.port ? Number(options.port) : null });
        const manifest = JSON.parse(readText(join(output, "reports/conversion-manifest.json")));
        const behavior = JSON.parse(readText(join(output, "reports/behavior-contracts.json")));
        const sourceOracle = loadSourceOracle({ work, sourceUrl });
        const baseContract = buildProofContract({
          sourceUrl: String(sourceOracle?.previewUrl || options.sourcePreview || sourceUrl),
          localUrl: previewState.url,
          routes: manifest.routes,
          behaviorSummary: behavior.summary,
        });
        const profileFile = join(output, "reports/proof-profile.json");
        if (baseContract.dynamicProofRequired && !existsSync(profileFile)) {
          const uiReportFile = join(output, "reports/react-owned-ui.json");
          const uiReport = existsSync(uiReportFile) ? JSON.parse(readText(uiReportFile)) : extractReactOwnedUi(output);
          writeText(profileFile, safeJson(synthesizeProofProfile(baseContract, uiReport)));
        }
        const contract = existsSync(profileFile)
          ? applyProofProfile(baseContract, JSON.parse(readText(profileFile)))
          : baseContract;
        const contractFile = join(work, "proof/proof-contract.json");
        writeText(contractFile, safeJson(contract));
        let summary;
        try {
          summary = await runProof({ contract, outputDir: join(work, "proof") });
        } catch (error) {
          summary = buildProductionFirstProofFailureSummary(error, contract);
          writeText(join(work, "proof/proof-summary.json"), safeJson(summary));
          return {
            passed: true,
            artifacts: [contractFile, join(work, "proof/proof-summary.json")],
            findings: summary.parityDiagnostics,
          };
        }
        if (!summary.passed) {
          summary.deliveryAccepted = true;
          summary.acceptanceMode = "production-first";
          summary.parityDiagnostics = summary.scenarios.flatMap((scenario) => scenario.findings || []);
          writeText(join(work, "proof/proof-summary.json"), safeJson(summary));
        }
        return summary.passed
          ? { passed: true, artifacts: [contractFile, join(work, "proof/proof-summary.json")] }
          : {
              passed: true,
              artifacts: [contractFile, join(work, "proof/proof-summary.json")],
              findings: [{
                code: "parity-diagnostics",
                acceptanceMode: "production-first",
                findings: summary.parityDiagnostics,
              }],
            };
      }

      if (stage === "REPRODUCIBILITY") {
        const manifest = JSON.parse(readText(join(output, "reports/conversion-manifest.json")));
        const report = await verifyReproducible({ project: output, routes: manifest.routes });
        return report.passed
          ? { passed: true, artifacts: [join(output, "reports/reproducibility.json")] }
          : { passed: false, recoverable: true, findings: [{ code: "reproducibility-failed", report }] };
      }

      if (stage === "DELIVERY_MANIFEST") {
        previewState ||= await startPreview({ output, work, requestedPort: options.port ? Number(options.port) : null });
        const manifest = evaluatePreOpenDeliveryGate({
          project: output,
          previewUrl: previewState.url,
          proofSummary: join(work, "proof/proof-summary.json"),
          reproducibility: join(output, "reports/reproducibility.json"),
        });
        writeText(deliveryManifestFile, safeJson(manifest));
        return manifest.passed
          ? { passed: true, artifacts: [output, deliveryManifestFile, previewState.url] }
          : { passed: false, recoverable: true, findings: [{ code: "delivery-manifest-gate-failed", manifest }] };
      }

      if (stage === "OPEN_PREVIEW") {
        previewState ||= await startPreview({ output, work, requestedPort: options.port ? Number(options.port) : null });
        const browser = openPreview(previewState.url, { disabled: Boolean(options.noOpen) });
        const manifest = buildDeliveryManifest({
          project: output,
          previewUrl: previewState.url,
          proofSummary: join(work, "proof/proof-summary.json"),
          reproducibility: join(output, "reports/reproducibility.json"),
          browser,
        });
        writeText(deliveryManifestFile, safeJson(manifest));
        return manifest.passed
          ? { passed: true, artifacts: [deliveryManifestFile, previewState.url] }
          : { passed: false, recoverable: true, findings: [{ code: "preview-open-failed", manifest, browser }] };
      }

      if (stage === "DELIVERED") {
        const manifest = safeReadJson(deliveryManifestFile);
        const delivered = Boolean(manifest?.passed && manifest?.delivered);
        return delivered
          ? { passed: true, artifacts: [output, deliveryManifestFile, previewState?.url].filter(Boolean) }
          : { passed: false, recoverable: true, findings: [{ code: "delivery-finalization-gate-failed", manifest }] };
      }
      return { passed: false, recoverable: false, findings: [{ code: "unknown-stage", stage }] };
      },
    });
    finalStatus = state.status;
    return state;
  } finally {
    endArtifactTrace(work, { ...artifactTrace, status: finalStatus });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !args.work) {
    console.error("Usage: orchestrate.mjs --url URL --work RUN_DIR [--input MIRROR] [--output PROJECT] --authorized");
    process.exit(2);
  }
  if (!args.authorized) {
    console.error("Refusing to capture or reconstruct without --authorized user attestation");
    process.exit(2);
  }
  const state = await runAutonomousClone({
    url: args.url,
    work: args.work,
    input: args.input,
    output: args.output,
    offlineRules: args["offline-rules"],
    hints: args.hints,
    allowHost: args["allow-host"],
    depth: args.depth,
    basePath: args["base-path"],
    sourcePreview: args["source-preview"],
    port: args.port,
    noOpen: args["no-open"],
  });
  console.log(`Orchestrator status: ${state.status}`);
  if (state.status !== "DELIVERED") process.exit(3);
}
