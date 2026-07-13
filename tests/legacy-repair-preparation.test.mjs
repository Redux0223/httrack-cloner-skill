import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareLegacyRepair } from "../scripts/prepare-legacy-repair.mjs";
import { prepareComponentReconstructionEvidence } from "../scripts/orchestrate.mjs";

function write(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, value);
}

test("automatically decompiles the captured bootstrap candidate before returning a repair loop", async () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-legacy-repair-"));
  const project = join(work, "react");
  write(join(project, "public/assets/app.123.js"), "(()=>{function startExperience(){return 'ready'};startExperience()})();\n");
  write(join(project, "reports/bootstrap-contract.json"), JSON.stringify({
    bootstrapCandidates: [{ path: "assets/app.123.js", exists: true, touchesVisibleDom: true }],
  }));

  const report = await prepareLegacyRepair({ project, work });
  assert.equal(report.prepared, true);
  assert.equal(report.candidate, "assets/app.123.js");
  assert.equal(existsSync(join(work, ".cloner/decompiled/main.js")), true);
  assert.equal(existsSync(join(work, ".cloner/decompiled/report.json")), true);
  assert.match(readFileSync(join(work, ".cloner/decompiled/main.js"), "utf8"), /startExperience/);
});

test("prepares bootstrap and decompiled evidence before component reconstruction can return a repair loop", async () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-component-evidence-"));
  const project = join(work, "react");
  write(join(project, "public/assets/app.123.js"), "(()=>{const canvas=document.createElement('canvas');canvas.getContext('webgl');startExperience()})();\n");
  write(join(project, "reports/conversion-manifest.json"), JSON.stringify({
    legacyScripts: [{ route: "/", src: "/assets/app.123.js", type: "text/javascript" }],
  }));
  write(join(project, "reports/behavior-contracts.json"), JSON.stringify({ summary: { canvas: 1, workers: 0 } }));

  const evidence = await prepareComponentReconstructionEvidence({ output: project, work });
  assert.ok(evidence.bootstrapContract.bootstrapCandidates.some((entry) => entry.path === "assets/app.123.js"));
  assert.equal(evidence.legacyRepair.prepared, true);
  assert.equal(existsSync(join(work, ".cloner/decompiled/main.js")), true);
  assert.equal(existsSync(join(project, "reports/bootstrap-contract.json")), true);
});
