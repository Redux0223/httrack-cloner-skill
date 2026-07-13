import assert from "node:assert/strict";
import test from "node:test";
import { applyProofProfile, buildProofContract } from "../scripts/generate-proof-contract.mjs";

test("creates deterministic source-local proof scenarios with locked thresholds", () => {
  const contract = buildProofContract({
    sourceUrl: "https://fixture.example/",
    localUrl: "http://127.0.0.1:4176/",
    routes: ["/", "/about"],
    behaviorSummary: { events: 2, forms: 1, canvas: 1 },
  });

  assert.deepEqual(contract.environments.map((environment) => environment.id), ["desktop", "mobile"]);
  assert.deepEqual(contract.environments[0].viewport, { width: 1440, height: 900 });
  assert.deepEqual(contract.environments[1].viewport, { width: 390, height: 844 });
  assert.equal(contract.environments[0].locale, "en-US");
  assert.equal(contract.environments[0].timezoneId, "UTC");
  assert.equal(contract.environments[0].reducedMotion, "reduce");
  assert.deepEqual(contract.scenarios.map((scenario) => scenario.route), ["/", "/about"]);
  assert.ok(contract.scenarios.every((scenario) => scenario.checkpoints.includes("visible-text")));
  assert.ok(contract.scenarios.every((scenario) => scenario.checkpoints.includes("network")));
  assert.ok(contract.scenarios[0].checkpoints.includes("canvas-nonblank"));
  assert.equal(contract.schemaVersion, 2);
  assert.equal(contract.determinism.randomSeed, 1597463007);
  assert.equal(contract.determinism.captureMode, "parallel");
  assert.equal(contract.determinism.animationFrameSamples, 1);
  assert.equal(contract.scenarios[0].animationFrameSamples, 10);
  assert.equal(contract.scenarios[1].animationFrameSamples, undefined);
  assert.equal(contract.thresholdsLocked, true);
  assert.match(contract.thresholdFingerprint, /^[a-f0-9]{64}$/);
});

test("applies site-specific actions without allowing threshold overrides", () => {
  const contract = buildProofContract({
    sourceUrl: "https://fixture.example/",
    localUrl: "http://127.0.0.1:4176/",
    routes: ["/"],
  });
  const profiled = applyProofProfile(contract, {
    environments: ["mobile"],
    thresholds: { screenshotMismatchRatio: 1 },
    scenarios: [{
      id: "home-ready",
      route: "/",
      actions: [
        { type: "wait-for-selector", selector: "#ready" },
        { type: "pointer-circle", selector: "canvas", steps: 80 },
      ],
    }],
  });

  assert.deepEqual(profiled.environments.map((environment) => environment.id), ["mobile"]);
  assert.deepEqual(profiled.scenarios[0].actions.map((action) => action.type), ["wait-for-selector", "pointer-circle"]);
  assert.equal(profiled.scenarios[0].id, "home-ready");
  assert.equal(profiled.thresholds.screenshotMismatchRatio, contract.thresholds.screenshotMismatchRatio);
  assert.equal(profiled.thresholdFingerprint, contract.thresholdFingerprint);
});

test("requires profiles to cover captured interaction families and bracket hold gates", () => {
  const contract = buildProofContract({
    sourceUrl: "https://fixture.example/",
    localUrl: "http://127.0.0.1:4176/",
    routes: ["/"],
    behaviorSummary: { interactionFamilies: ["scroll", "press-and-hold"] },
  });
  assert.equal(contract.dynamicProofRequired, true);
  assert.deepEqual(contract.requiredInteractionFamilies, ["press-and-hold", "scroll"]);

  assert.throws(() => applyProofProfile(contract, {
    scenarios: [{ id: "incomplete", route: "/", actions: [{ type: "wheel", deltaY: 800 }] }],
  }), /press-and-hold/);

  assert.throws(() => applyProofProfile(contract, {
    environments: ["desktop"],
    scenarios: [{
      id: "desktop-only",
      route: "/",
      actions: [
        { type: "checkpoint", id: "before-scroll", selector: "body" },
        { type: "wheel", deltaY: 800 },
        { type: "checkpoint", id: "after-scroll", selector: "body", requireChangeFrom: "before-scroll" },
        { type: "checkpoint", id: "before-hold", selector: "body" },
        { type: "pointer-hold", selector: "#gate", durationMs: 250 },
        { type: "checkpoint", id: "after-hold", selector: "body", requireChangeFrom: "before-hold" },
      ],
    }],
  }), /desktop and mobile/);

  assert.throws(() => applyProofProfile(buildProofContract({
    sourceUrl: "https://fixture.example/",
    localUrl: "http://127.0.0.1:4176/",
    routes: ["/"],
    behaviorSummary: { interactionFamilies: ["scroll"] },
  }), {
    scenarios: [{ id: "unmeasured-scroll", route: "/", actions: [{ type: "wheel", deltaY: 800 }] }],
  }), /wheel.*checkpoint/i);

  const profiled = applyProofProfile(contract, {
    scenarios: [{
      id: "deep-flow",
      route: "/",
      actions: [
        { type: "goto", route: "/" },
        { type: "checkpoint", id: "before-scroll", selector: "body" },
        { type: "wheel", deltaY: 800, repeat: 4 },
        { type: "checkpoint", id: "after-scroll", selector: "body", requireChangeFrom: "before-scroll" },
        { type: "checkpoint", id: "before-gate", selector: "body" },
        { type: "pointer-hold", selector: "#gate", durationMs: 250 },
        { type: "wait-for-selector", selector: "#gate", state: "hidden" },
        { type: "checkpoint", id: "after-gate", selector: "body", requireChangeFrom: "before-gate" },
      ],
    }],
  });
  assert.equal(profiled.scenarios[0].actions[5].type, "pointer-hold");
  assert.equal(profiled.scenarios[0].actions[6].type, "wait-for-selector");
});

test("supports media and touch interaction families in one desktop-mobile profile", () => {
  const contract = buildProofContract({
    sourceUrl: "https://fixture.example/",
    localUrl: "http://127.0.0.1:4176/",
    routes: ["/"],
    behaviorSummary: { interactionFamilies: ["click", "media", "touch"] },
  });

  const profiled = applyProofProfile(contract, {
    scenarios: [{
      id: "media-touch",
      route: "/",
      actions: [
        { type: "goto", route: "/" },
        { type: "tap", selector: "#start" },
        { type: "media-play", selector: "video" },
      ],
    }],
  });

  assert.deepEqual(profiled.scenarios[0].actions.map((action) => action.type), ["goto", "tap", "media-play"]);
});
