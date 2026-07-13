import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyPublicAssetProvenance } from "../scripts/verify-public-asset-provenance.mjs";

function write(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, value);
}

test("rejects public asset placeholders that were never captured from the source", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-public-provenance-"));
  const project = join(work, "react");
  const mirror = join(work, "mirror");
  write(join(mirror, "example.com/assets/real.json"), '{"captured":true}\n');
  write(join(project, "public/assets/real.json"), '{"captured":true}\n');
  write(join(project, "public/assets/fake.json"), '{"success":true}\n');
  write(join(project, "reports/conversion-manifest.json"), JSON.stringify({ siteRoot: "example.com" }));

  const report = verifyPublicAssetProvenance({ project, mirror });
  assert.equal(report.passed, false);
  assert.deepEqual(report.uncaptured.map((entry) => entry.path), ["assets/fake.json"]);
});

test("rejects captured asset paths whose bytes were replaced", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-public-byte-provenance-"));
  const project = join(work, "react");
  const mirror = join(work, "mirror");
  write(join(mirror, "example.com/assets/hero.bin"), "captured-source-bytes");
  write(join(project, "public/assets/hero.bin"), "bad");
  write(join(project, "reports/conversion-manifest.json"), JSON.stringify({ siteRoot: "example.com" }));

  const report = verifyPublicAssetProvenance({ project, mirror });
  assert.equal(report.passed, false);
  assert.deepEqual(report.mismatched.map((entry) => entry.path), ["assets/hero.bin"]);
});
