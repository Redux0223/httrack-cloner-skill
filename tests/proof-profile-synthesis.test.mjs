import assert from "node:assert/strict";
import test from "node:test";
import { applyProofProfile, buildProofContract } from "../scripts/generate-proof-contract.mjs";
import { synthesizeProofProfile } from "../scripts/synthesize-proof-profile.mjs";

test("synthesizes a valid profile covering every captured interaction family", () => {
  const contract = buildProofContract({
    sourceUrl: "https://fixture.example/",
    localUrl: "http://127.0.0.1:4176/",
    routes: ["/", "/about"],
    behaviorSummary: {
      interactionFamilies: [
        "click",
        "forms",
        "keyboard",
        "media",
        "navigation",
        "pointer-drag",
        "press-and-hold",
        "scroll",
        "touch",
      ],
    },
  });
  const profile = synthesizeProofProfile(contract, {
    routes: [{
      route: "/",
      interactiveSelectors: ["#start", "#email", "#clip"],
      formSelectors: ["#email"],
      mediaSelectors: ["#clip"],
      canvasSelectors: ["#scene"],
    }],
  });

  const profiled = applyProofProfile(contract, profile);
  const actions = profiled.scenarios[0].actions;
  assert.ok(actions.some((action) => action.type === "tap" && action.selector === "#start"));
  assert.ok(actions.some((action) => action.type === "fill" && action.selector === "#email"));
  assert.ok(actions.some((action) => action.type === "media-play" && action.selector === "#clip"));
  assert.ok(actions.some((action) => action.type === "pointer-circle" && action.selector === "#scene"));
  const wheelIndex = actions.findIndex((action) => action.type === "wheel");
  assert.equal(actions[wheelIndex - 1].type, "checkpoint");
  assert.equal(actions[wheelIndex + 2].requireChangeFrom, actions[wheelIndex - 1].id);
  const holdIndex = actions.findIndex((action) => action.type === "pointer-hold");
  assert.equal(actions[holdIndex - 1].type, "checkpoint");
  assert.equal(actions[holdIndex + 2].requireChangeFrom, actions[holdIndex - 1].id);
  assert.equal(profile.generated, true);
});

test("uses the captured canvas for click proof when the runtime exposes no DOM controls", () => {
  const contract = buildProofContract({
    sourceUrl: "https://fixture.example/",
    localUrl: "http://127.0.0.1:4176/",
    routes: ["/"],
    behaviorSummary: { interactionFamilies: ["click", "pointer-drag"] },
  });
  const profile = synthesizeProofProfile(contract, {
    routes: [{
      route: "/",
      interactiveSelectors: [],
      canvasSelectors: ["canvas.runtime-surface"],
    }],
  });

  assert.equal(profile.selectorSources.click, "canvas.runtime-surface");
  assert.ok(profile.scenarios[0].actions.some((action) =>
    action.type === "click" && action.selector === "canvas.runtime-surface"));
});

test("marks heuristic form and media actions optional when no matching React selector was captured", () => {
  const contract = buildProofContract({
    sourceUrl: "https://fixture.example/",
    localUrl: "http://127.0.0.1:4176/",
    routes: ["/"],
    behaviorSummary: { interactionFamilies: ["forms", "media"] },
  });
  const profile = synthesizeProofProfile(contract, { routes: [{ route: "/" }] });
  const actions = profile.scenarios[0].actions;

  assert.equal(actions.find((action) => action.type === "fill")?.optional, true);
  assert.equal(actions.find((action) => action.type === "media-play")?.optional, true);
});
