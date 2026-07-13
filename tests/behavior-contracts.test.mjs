import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { analyzeBehavior } from "../scripts/runtime-analysis.mjs";

test("inventories browser behavior and lifecycle cleanup requirements", () => {
  const report = analyzeBehavior(`
    const canvas = document.querySelector("#webgl");
    window.addEventListener("pointermove", onMove);
    const frame = requestAnimationFrame(render);
    const timer = setInterval(tick, 1000);
    const observer = new ResizeObserver(resize);
    localStorage.setItem("stage", "2");
    history.pushState({}, "", "/about");
    document.querySelector("form").requestSubmit();
    document.querySelector("video").play();
    canvas.getContext("webgl2");
    const worker = new Worker("/worker.js");
  `);

  assert.ok(report.events.some((item) => item.event === "pointermove"));
  assert.equal(report.animationFrames.length, 1);
  assert.equal(report.timers.length, 1);
  assert.equal(report.observers.length, 1);
  assert.equal(report.storage.length, 1);
  assert.equal(report.history.length, 1);
  assert.equal(report.forms.length, 1);
  assert.equal(report.media.length, 1);
  assert.equal(report.canvas.length, 1);
  assert.equal(report.workers.length, 1);
  assert.ok(report.domSelectors.some((item) => item.selector === "#webgl"));
  assert.ok(report.cleanupRequirements.some((item) => item.operation === "removeEventListener"));
  assert.ok(report.cleanupRequirements.some((item) => item.operation === "cancelAnimationFrame"));
  assert.ok(report.cleanupRequirements.some((item) => item.operation === "disconnect"));
  assert.ok(report.cleanupRequirements.some((item) => item.operation === "terminate"));
});

test("derives proof interaction families from captured behavior", () => {
  const report = analyzeBehavior(`
    window.addEventListener("wheel", onWheel);
    button.addEventListener("click", onClick);
    button.addEventListener("pointerdown", beginHold);
    button.addEventListener("pointerup", cancelHold);
    window.addEventListener("pointermove", onDrag);
    form.addEventListener("submit", onSubmit);
    const holdFrame = requestAnimationFrame(updateHold);
  `);

  assert.ok(report.interactionFamilies.includes("scroll"));
  assert.ok(report.interactionFamilies.includes("click"));
  assert.ok(report.interactionFamilies.includes("pointer-drag"));
  assert.ok(report.interactionFamilies.includes("press-and-hold"));
  assert.ok(report.interactionFamilies.includes("forms"));
});

test("writes site inspection and behavior contracts for a converted mirror", () => {
  const root = resolve("tests");
  const output = join(root, "fixture/behavior-output");
  rmSync(output, { recursive: true, force: true });
  const result = spawnSync(
    process.execPath,
    [
      resolve("./scripts/run-pipeline.mjs"),
      "--input",
      join(root, "fixture/mirror"),
      "--output",
      output,
      "--source-url",
      "https://fixture.example/",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const inspection = JSON.parse(readFileSync(join(output, "reports/site-inspection.json"), "utf8"));
  const contracts = JSON.parse(readFileSync(join(output, "reports/behavior-contracts.json"), "utf8"));
  assert.deepEqual(inspection.routes.sort(), ["/", "/about"]);
  assert.ok(inspection.scripts.some((item) => item.path === "public/assets/site.js"));
  assert.ok(contracts.files.some((item) => item.file === "public/assets/site.js"));
  assert.ok(contracts.summary.events >= 1);
  assert.ok(Array.isArray(contracts.summary.interactionFamilies));
});
