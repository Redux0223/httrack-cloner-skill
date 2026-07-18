#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs, readText, safeJson, writeText } from "./lib.mjs";

function first(values, fallback) {
  return Array.isArray(values) && values.length > 0 ? values[0] : fallback;
}

export function synthesizeProofProfile(contract, reactOwnedUi = {}) {
  const required = new Set(contract.requiredInteractionFamilies || []);
  const primary = contract.scenarios[0];
  const inventory = (reactOwnedUi.routes || []).find((route) => route.route === primary.route) || {};
  const hasFormSelector = Array.isArray(inventory.formSelectors) && inventory.formSelectors.length > 0;
  const hasMediaSelector = Array.isArray(inventory.mediaSelectors) && inventory.mediaSelectors.length > 0;
  const canvasSelector = first(inventory.canvasSelectors, null);
  const clickSelector = first(inventory.interactiveSelectors, canvasSelector || "body");
  const formSelector = first(inventory.formSelectors, 'input:not([type="hidden"]), textarea, select');
  const mediaSelector = first(inventory.mediaSelectors, "video, audio");
  const holdSelector = first(inventory.canvasSelectors, clickSelector || "body");
  const actions = [
    { type: "goto", route: primary.route },
    { type: "wait-for-network-idle", settleMs: 1500 },
    { type: "canonicalize-tabs", settleMs: 600 },
  ];

  if (required.has("touch")) actions.push({ type: "tap", selector: clickSelector });
  else if (required.has("click")) actions.push({ type: "click", selector: clickSelector });
  if (required.has("touch") || required.has("click")) actions.push({ type: "wait-for-time", ms: 300 });
  if (required.has("forms")) actions.push({
    type: "fill",
    selector: formSelector,
    value: "proof@example.test",
    ...(!hasFormSelector ? { optional: true } : {}),
  });
  if (required.has("media")) actions.push({
    type: "media-play",
    selector: mediaSelector,
    ...(!hasMediaSelector ? { optional: true } : {}),
  });
  if (required.has("pointer-drag")) actions.push({ type: "pointer-circle", selector: canvasSelector || clickSelector || "body", steps: 80 });
  if (required.has("scroll")) {
    actions.push(
      { type: "checkpoint", id: "before-scroll-flow", selector: "body" },
      { type: "wheel", deltaY: 720, repeat: 6, intervalMs: 80, align: "end" },
      { type: "wait-for-time", ms: 300 },
      { type: "checkpoint", id: "after-scroll-flow", selector: "body", requireChangeFrom: "before-scroll-flow" },
    );
  }
  if (required.has("press-and-hold")) {
    actions.push(
      { type: "checkpoint", id: "before-hold-gate", selector: "body" },
      { type: "pointer-hold", selector: holdSelector, durationMs: 1200 },
      { type: "wait-for-time", ms: 500 },
      { type: "checkpoint", id: "after-hold-gate", selector: "body", requireChangeFrom: "before-hold-gate" },
    );
  }
  if (required.has("keyboard")) actions.push({ type: "press", selector: "body", key: "Enter" });

  const scenarios = contract.scenarios.map((scenario, index) => index === 0
    ? { id: "generated-deep-flow", route: scenario.route, actions }
    : {
        id: `generated-route-${index}`,
        route: scenario.route,
        actions: [
          { type: "goto", route: scenario.route },
          { type: "wait-for-network-idle", settleMs: 1500 },
          { type: "canonicalize-tabs", settleMs: 600 },
        ],
      });
  return {
    schemaVersion: 1,
    generated: true,
    generatedFrom: "behavior-contracts+react-owned-ui",
    selectorSources: {
      click: clickSelector,
      form: formSelector,
      media: mediaSelector,
      canvas: canvasSelector,
      hold: holdSelector,
    },
    scenarios,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.contract || !args.output) {
    console.error("Usage: synthesize-proof-profile.mjs --contract PROOF_CONTRACT --output PROFILE [--ui REACT_OWNED_UI]");
    process.exit(2);
  }
  const contract = JSON.parse(readText(resolve(String(args.contract))));
  const ui = args.ui ? JSON.parse(readText(resolve(String(args.ui)))) : {};
  const profile = synthesizeProofProfile(contract, ui);
  writeText(resolve(String(args.output)), safeJson(profile));
  console.log(`Synthesized ${profile.scenarios.length} proof scenario(s).`);
}
