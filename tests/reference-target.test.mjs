import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

test("the public release excludes captured websites and documents adapter semantics", () => {
  const root = resolve(".");
  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.equal(existsSync(join(root, "experiments")), false);
  assert.equal(existsSync(join(root, "clone-runs")), false);
  assert.match(readme, /React adapter/);
  assert.match(readme, /123 automated tests/);
  assert.match(readme, /authorized/i);
});

test("the production Skill directly delivers the project and opens its preview", () => {
  const skillRoot = resolve(".");
  const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
  const proofProtocol = readFileSync(join(skillRoot, "references/proof-protocol.md"), "utf8");
  const tools = JSON.parse(readFileSync(join(skillRoot, "scripts/package.json"), "utf8"));

  assert.match(skill, /OPEN_PREVIEW|open(?:s|ed)? (?:the )?(?:local )?preview/i);
  assert.match(skill, /proof-only local source oracle/i);
  assert.match(proofProtocol, /live source.*unavailable.*proof-only local source oracle/is);
  assert.doesNotMatch(skill, /ZIP|--archive/);
  assert.equal("archiver" in tools.dependencies, false);
  assert.equal(existsSync(join(skillRoot, "scripts/package-project.mjs")), false);
});
