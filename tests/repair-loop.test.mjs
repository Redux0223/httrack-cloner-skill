import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classifyFinding, recordRepair } from "../scripts/repair-loop.mjs";

test("classifies proof findings and prevents repeating ineffective repair strategies", () => {
  assert.equal(classifyFinding({ code: "visible-text-mismatch" }), "content");
  assert.equal(classifyFinding({ code: "automatic-external-request" }), "network");

  const historyFile = join(mkdtempSync(join(tmpdir(), "repair-history-")), "repair-history.json");
  const first = recordRepair({
    historyFile,
    finding: { id: "f-1", code: "visible-text-mismatch" },
    strategy: "rewrite-content-module",
    failureSignature: "signature-a",
    repairActionCode: "rewrite-react-content",
    filesChanged: ["src/content/home.ts"],
    beforeHashes: { "src/content/home.ts": "a" },
    afterHashes: { "src/content/home.ts": "b" },
    regressionTest: "content-home.test.ts",
    result: "failed",
  });
  assert.equal(first.attempt, 1);
  assert.equal(first.failureSignature, "signature-a");
  assert.equal(first.repairActionCode, "rewrite-react-content");
  assert.equal(first.converged, false);

  assert.throws(
    () => recordRepair({
      historyFile,
      finding: { id: "f-1", code: "visible-text-mismatch" },
      strategy: "rewrite-content-module",
      failureSignature: "signature-a",
      repairActionCode: "rewrite-react-content",
      filesChanged: ["src/content/home.ts"],
      beforeHashes: { "src/content/home.ts": "b" },
      afterHashes: { "src/content/home.ts": "c" },
      regressionTest: "content-home.test.ts",
      result: "failed",
    }),
    /ineffective repair strategy/i,
  );

  assert.throws(
    () => recordRepair({
      historyFile,
      finding: { id: "f-2", code: "geometry-mismatch" },
      strategy: "repair-layout",
      failureSignature: "signature-b",
      repairActionCode: "repair-layout",
      filesChanged: ["src/styles/home.css"],
      beforeHashes: {},
      afterHashes: {},
      regressionTest: "",
      result: "passed",
    }),
    /regression test/i,
  );
});

test("rejects report-only edits as repair evidence", () => {
  const historyFile = join(mkdtempSync(join(tmpdir(), "repair-history-report-only-")), "repair-history.json");
  assert.throws(
    () => recordRepair({
      historyFile,
      finding: { code: "captured-legacy-script-not-reconstructed" },
      strategy: "clear-manifest",
      failureSignature: "legacy-a",
      repairActionCode: "classify-and-reconstruct-bootstrap",
      filesChanged: ["react/reports/conversion-manifest.json", "react/reports/architecture-verification.json"],
      beforeHashes: {},
      afterHashes: {},
      regressionTest: "architecture.test.mjs",
      result: "passed",
    }),
    /report edit is not a repair/i,
  );
});
