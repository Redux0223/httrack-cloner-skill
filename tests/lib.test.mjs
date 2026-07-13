import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyBootstrapScript,
  componentName,
  parseCapturedHref,
  routeFileStem,
} from "../scripts/lib.mjs";

test("generates valid JavaScript identifiers for numeric routes", () => {
  const name = componentName("/123-tools");
  assert.match(name, /^[A-Za-z_$][A-Za-z0-9_$]*$/);
});

test("preserves pathname search and hash for captured internal links", () => {
  assert.deepEqual(
    parseCapturedHref("about.html?tab=team#bio", "https://fixture.example/"),
    { pathname: "/about", search: "?tab=team", hash: "#bio" },
  );
});

test("creates stable TanStack route file stems", () => {
  assert.equal(routeFileStem("/"), "index");
  assert.equal(routeFileStem("/about/team"), "about.team");
});

test("classifies captured application bootstrap bundles separately from libraries", () => {
  assert.equal(classifyBootstrapScript("assets/main-CJJ9sJBo.js", "module"), "business-bootstrap");
  assert.equal(classifyBootstrapScript("assets/js/app.1782836328290.js", "text/javascript"), "business-bootstrap");
  assert.equal(classifyBootstrapScript("assets/js/app.1782836328290.js.reconstructed", "text/javascript"), "business-bootstrap");
  assert.equal(classifyBootstrapScript("vendor/draco_decoder.js", "text/javascript"), "vendor-runtime");
});
