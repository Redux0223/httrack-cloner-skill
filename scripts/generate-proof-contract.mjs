#!/usr/bin/env node
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs, readText, safeJson, writeText } from "./lib.mjs";

const DEFAULT_THRESHOLDS = Object.freeze({
  visibleText: "exact-normalized",
  routeAndTitle: "exact",
  missingAssets: 0,
  automaticExternalRequests: 0,
  consoleErrors: 0,
  pageErrors: 0,
  geometryMaxDeltaPx: 1,
  screenshotMismatchRatio: 0.01,
  canvasMinimumNonTransparentRatio: 0.001,
});

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const PROOF_ACTIONS = new Set([
  "goto",
  "wait-for-network-idle",
  "wait-for-time",
  "wait-for-selector",
  "click",
  "fill",
  "press",
  "wheel",
  "pointer-circle",
  "pointer-hold",
  "tap",
  "media-play",
  "canonicalize-tabs",
  "checkpoint",
]);

function validateAction(action) {
  if (!action || typeof action !== "object" || !PROOF_ACTIONS.has(action.type)) {
    throw new Error(`Unsupported proof action: ${action?.type || "missing"}`);
  }
  if (["wait-for-selector", "click", "fill", "press", "pointer-hold", "tap", "media-play"].includes(action.type) && typeof action.selector !== "string") {
    throw new Error(`Proof action ${action.type} requires a selector`);
  }
  if (action.type === "wait-for-time" && (!Number.isFinite(action.ms) || action.ms < 0)) {
    throw new Error("Proof action wait-for-time requires a non-negative ms value");
  }
  if (action.type === "pointer-circle" && action.steps !== undefined && (!Number.isInteger(action.steps) || action.steps < 4)) {
    throw new Error("Proof action pointer-circle requires at least four steps");
  }
  if (action.type === "pointer-hold" && (!Number.isFinite(action.durationMs) || action.durationMs <= 0)) {
    throw new Error("Proof action pointer-hold requires a positive durationMs value");
  }
  if (action.type === "wheel" && action.repeat !== undefined && (!Number.isInteger(action.repeat) || action.repeat < 1)) {
    throw new Error("Proof action wheel repeat must be a positive integer");
  }
  if (action.type === "wheel" && action.align !== undefined && !["start", "end"].includes(action.align)) {
    throw new Error("Proof action wheel align must be start or end");
  }
  if (action.type === "checkpoint" && (typeof action.id !== "string" || !action.id.trim())) {
    throw new Error("Proof action checkpoint requires an id");
  }
  return { ...action };
}

function actionFamilies(action) {
  if (action.type === "wheel") return ["scroll"];
  if (action.type === "click") return ["click"];
  if (action.type === "tap") return ["click", "touch"];
  if (action.type === "pointer-circle") return ["pointer-drag"];
  if (action.type === "pointer-hold") return ["press-and-hold"];
  if (action.type === "fill") return ["forms"];
  if (action.type === "press") return ["keyboard"];
  if (action.type === "goto") return ["navigation"];
  if (action.type === "media-play") return ["media"];
  return [];
}

function validateDeepActions(scenarios, requiredFamilies) {
  const covered = new Set(scenarios.flatMap((scenario) => scenario.actions.flatMap(actionFamilies)));
  const missing = requiredFamilies.filter((family) => !covered.has(family));
  if (missing.length > 0) throw new Error(`Proof profile does not cover interaction families: ${missing.join(", ")}`);

  const stabilizationActions = new Set(["wait-for-selector", "wait-for-time", "wait-for-network-idle"]);
  for (const scenario of scenarios) {
    const checkpoints = new Map(scenario.actions.filter((action) => action.type === "checkpoint").map((action) => [action.id, action]));
    for (let index = 0; index < scenario.actions.length; index += 1) {
      const action = scenario.actions[index];
      if (action.type === "wheel") {
        const before = scenario.actions[index - 1];
        let afterIndex = index + 1;
        while (stabilizationActions.has(scenario.actions[afterIndex]?.type)) afterIndex += 1;
        const after = scenario.actions[afterIndex];
        if (before?.type !== "checkpoint" || after?.type !== "checkpoint" || after.requireChangeFrom !== before.id) {
          throw new Error("Every wheel action must be bracketed by checkpoints with requireChangeFrom; only stabilization waits may precede the after checkpoint");
        }
        if (before.selector !== after.selector || !checkpoints.has(after.requireChangeFrom)) {
          throw new Error("Scroll checkpoints must observe the same selector");
        }
        continue;
      }
      if (action.type !== "pointer-hold") continue;
      const before = scenario.actions[index - 1];
      let afterIndex = index + 1;
      while (stabilizationActions.has(scenario.actions[afterIndex]?.type)) afterIndex += 1;
      const after = scenario.actions[afterIndex];
      if (before?.type !== "checkpoint" || after?.type !== "checkpoint" || after.requireChangeFrom !== before.id) {
        throw new Error("Every pointer-hold must be bracketed by checkpoints with requireChangeFrom; only stabilization waits may precede the after checkpoint");
      }
      if (before.selector !== after.selector || !checkpoints.has(after.requireChangeFrom)) {
        throw new Error("Hold-gate checkpoints must observe the same selector");
      }
    }
  }
}

export function buildProofContract({ sourceUrl, localUrl, routes, behaviorSummary = {} }) {
  const canvasRequired = Object.hasOwn(behaviorSummary, "visibleCanvasMounts")
    ? Number(behaviorSummary.visibleCanvasMounts || 0) > 0
    : Number(behaviorSummary.canvas || 0) > 0;
  const requiredInteractionFamilies = [...new Set(behaviorSummary.interactionFamilies || [])].sort();
  const animatedHome = Number(behaviorSummary.animationFrames || 0) > 0;
  const scenarios = [...routes]
    .sort((left, right) => left.localeCompare(right))
    .map((route, index) => ({
      id: index === 0 ? "home" : `route-${index}`,
      route,
      actions: [{ type: "goto", route }, { type: "wait-for-network-idle" }],
      checkpoints: [
        "route-title",
        "visible-text",
        "landmarks",
        "geometry",
        "computed-styles",
        "network",
        "console-errors",
        "screenshot",
        ...(canvasRequired && route === "/" ? ["canvas-nonblank"] : []),
      ],
      ...((canvasRequired || animatedHome) && route === "/" ? {
        animationFrameSamples: animatedHome ? 12 : 10,
        ...(animatedHome ? { animationFrameIntervalMs: 250 } : {}),
      } : {}),
    }));
  const thresholds = { ...DEFAULT_THRESHOLDS };
  return {
    schemaVersion: 2,
    sourceUrl,
    localUrl,
    environments: [
      {
        id: "desktop",
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        locale: "en-US",
        timezoneId: "UTC",
        colorScheme: "light",
        reducedMotion: "reduce",
        hasTouch: false,
        isMobile: false,
      },
      {
        id: "mobile",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        locale: "en-US",
        timezoneId: "UTC",
        colorScheme: "light",
        reducedMotion: "reduce",
        hasTouch: true,
        isMobile: true,
      },
    ],
    scenarios,
    requiredInteractionFamilies,
    dynamicProofRequired: requiredInteractionFamilies.length > 0,
    determinism: {
      randomSeed: 1597463007,
      captureMode: "parallel",
      animationFrameSamples: 1,
      animationFrameIntervalMs: 60,
    },
    thresholds,
    thresholdsLocked: true,
    thresholdFingerprint: fingerprint(thresholds),
  };
}

export function applyProofProfile(contract, profile = {}) {
  let environments = contract.environments;
  if (Array.isArray(profile.environments)) {
    const byId = new Map(contract.environments.map((environment) => [environment.id, environment]));
    environments = profile.environments.map((id) => {
      const environment = byId.get(id);
      if (!environment) throw new Error(`Unknown proof environment: ${id}`);
      return environment;
    });
    if (environments.length === 0) throw new Error("Proof profile must retain at least one environment");
  }

  let scenarios = contract.scenarios;
  if (Array.isArray(profile.scenarios)) {
    const byRoute = new Map(contract.scenarios.map((scenario) => [scenario.route, scenario]));
    const ids = new Set();
    scenarios = profile.scenarios.map((profileScenario, index) => {
      const base = byRoute.get(profileScenario.route);
      if (!base) throw new Error(`Proof profile references an unknown route: ${profileScenario.route}`);
      const id = String(profileScenario.id || `profile-${index}`);
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate proof scenario id: ${id}`);
      ids.add(id);
      return {
        ...base,
        id,
        actions: Array.isArray(profileScenario.actions) ? profileScenario.actions.map(validateAction) : base.actions,
      };
    });
    if (scenarios.length === 0) throw new Error("Proof profile must retain at least one scenario");
  }

  if (contract.dynamicProofRequired) {
    if (!Array.isArray(profile.scenarios)) throw new Error("Dynamic proof requires an explicit proof profile");
    const retainedEnvironments = new Set(environments.map((environment) => environment.id));
    const missingEnvironments = contract.environments.map((environment) => environment.id).filter((id) => !retainedEnvironments.has(id));
    if (missingEnvironments.length > 0) throw new Error("Dynamic proof must retain desktop and mobile environments");
    validateDeepActions(scenarios, contract.requiredInteractionFamilies || []);
  }

  return { ...contract, environments, scenarios };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !args.local || !args.routes || !args.output) {
    console.error("Usage: generate-proof-contract.mjs --source URL --local URL --routes ROUTES_JSON --output FILE [--behavior REPORT]");
    process.exit(2);
  }
  const routesValue = JSON.parse(readText(resolve(String(args.routes))));
  const routes = Array.isArray(routesValue) ? routesValue : routesValue.routes;
  const behavior = args.behavior ? JSON.parse(readText(resolve(String(args.behavior)))) : { summary: {} };
  writeText(resolve(String(args.output)), safeJson(buildProofContract({
    sourceUrl: String(args.source),
    localUrl: String(args.local),
    routes,
    behaviorSummary: behavior.summary || {},
  })));
}
