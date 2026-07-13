import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  diffArtifactSnapshots,
  forbiddenReportEdits,
  snapshotRunArtifacts,
} from "../scripts/artifact-trace.mjs";

function write(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, value);
}

test("traces source, report, and public-asset changes between resumes", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-artifact-trace-"));
  write(join(work, "react/src/pages/HomePage.tsx"), "export default () => <main>Captured</main>;");
  write(join(work, "react/reports/conversion-manifest.json"), '{"legacyScripts":["main.js"]}');
  const before = snapshotRunArtifacts(work);

  write(join(work, "react/src/pages/HomePage.tsx"), "export default () => <main>Invented</main>;");
  write(join(work, "react/reports/conversion-manifest.json"), '{"legacyScripts":[]}');
  write(join(work, "react/public/assets/fake.json"), "{}");
  const delta = diffArtifactSnapshots(before, snapshotRunArtifacts(work));

  assert.deepEqual(delta.added.map((entry) => entry.path), ["react/public/assets/fake.json"]);
  assert.deepEqual(delta.modified.map((entry) => entry.path), [
    "react/reports/conversion-manifest.json",
    "react/src/pages/HomePage.tsx",
  ]);
  assert.deepEqual(delta.reportEdits, ["react/reports/conversion-manifest.json"]);
});

test("treats verifier-owned report edits as forbidden while allowing proof-profile authoring", () => {
  assert.deepEqual(forbiddenReportEdits([
    "react/reports/conversion-manifest.json",
    "react/reports/public-asset-provenance.json",
    "react/reports/proof-profile.json",
    "react/reports/engine-contract.json",
  ]), [
    "react/reports/conversion-manifest.json",
    "react/reports/public-asset-provenance.json",
  ]);
});
