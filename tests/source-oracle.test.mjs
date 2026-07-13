import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadSourceOracle,
  registerSourceOracle,
} from "../scripts/register-source-oracle.mjs";

function write(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, value);
}

test("registers only a loopback oracle made from unchanged captured bytes", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-source-oracle-"));
  write(join(work, "mirror/example.com/index.html"), "<main>Captured</main>");
  write(join(work, ".cloner/oracle/site/index.html"), "<main>Captured</main>");

  const manifest = registerSourceOracle({
    work,
    sourceUrl: "https://example.com/",
    previewUrl: "http://127.0.0.1:8080/",
    oracleRoot: join(work, ".cloner/oracle/site"),
  });
  assert.equal(manifest.files.length, 1);
  assert.equal(loadSourceOracle({ work, sourceUrl: "https://example.com/" }).previewUrl, "http://127.0.0.1:8080/");

  write(join(work, ".cloner/oracle/site/index.html"), "<main>Changed</main>");
  assert.throws(() => loadSourceOracle({ work, sourceUrl: "https://example.com/" }), /source-oracle-invalid/);
});

test("rejects an oracle containing bytes absent from the capture", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-source-oracle-invented-"));
  write(join(work, "mirror/example.com/index.html"), "<main>Captured</main>");
  write(join(work, ".cloner/oracle/site/index.html"), "<main>Invented</main>");

  assert.throws(() => registerSourceOracle({
    work,
    sourceUrl: "https://example.com/",
    previewUrl: "http://127.0.0.1:8080/",
    oracleRoot: join(work, ".cloner/oracle/site"),
  }), /source-oracle-invalid/);
});
