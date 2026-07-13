import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  verifyStyleProvenance,
  writeStyleBaseline,
} from "../scripts/verify-style-provenance.mjs";

function write(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, value);
}

test("rejects modified captured CSS and untracked replacement styles", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-style-provenance-"));
  const project = join(work, "react");
  write(join(project, "src/styles/source.css"), ".Hero{position:fixed;color:#fff}\n");
  writeStyleBaseline({ project, work });

  write(join(project, "src/styles/source.css"), ".marketing{min-height:100vh;color:#fff}\n");
  write(join(project, "src/styles/marketing.css"), ".card{padding:20px}\n");

  const report = verifyStyleProvenance({ project, work });
  assert.equal(report.passed, false);
  assert.deepEqual(report.modified.map((entry) => entry.path), ["src/styles/source.css"]);
  assert.deepEqual(report.untracked.map((entry) => entry.path), ["src/styles/marketing.css"]);
});
