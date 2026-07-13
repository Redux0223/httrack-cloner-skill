import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyContentProvenance } from "../scripts/verify-content-provenance.mjs";

function write(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, value);
}

test("rejects user-facing React copy that does not occur in captured source evidence", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-content-provenance-"));
  const project = join(work, "react");
  write(join(work, "mirror/example.com/index.html"), "<!doctype html><main><h1>Original headline</h1><p>Captured supporting copy.</p></main>");
  write(join(project, "src/pages/HomePage.tsx"), `
    export default function HomePage() {
      const cards = [{ name: "Invented cocktail", notes: "A fabricated tasting note that was never captured." }];
      return <main><h1>Original headline</h1><p>Captured supporting copy.</p>{cards.map(card => <article><h2>{card.name}</h2><p>{card.notes}</p></article>)}</main>;
    }
  `);
  write(join(project, "reports/react-owned-ui.json"), JSON.stringify({
    routes: [{ route: "/", reachableFiles: ["src/pages/HomePage.tsx"] }],
  }));

  const report = verifyContentProvenance({ project, mirror: join(work, "mirror") });
  assert.equal(report.passed, false);
  assert.ok(report.unsupported.some((entry) => entry.text === "Invented cocktail"));
  assert.ok(report.unsupported.some((entry) => entry.text.includes("fabricated tasting note")));
  assert.ok(!report.unsupported.some((entry) => entry.text === "Original headline"));
  const persisted = JSON.parse(readFileSync(join(project, "reports/content-provenance.json"), "utf8"));
  assert.equal(persisted.passed, false);
});

test("ignores implementation strings while still checking rendered copy", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-content-implementation-"));
  const project = join(work, "react");
  write(join(work, "mirror/example.com/index.html"), "<!doctype html><main><h1>Captured title</h1></main>");
  write(join(project, "src/pages/HomePage.tsx"), `
    export default function HomePage() {
      const contextName = "WEBGL_lose_context";
      return <main className="XText body-regular" data-testid="home" aria-label="Home canvas">
        <h1>Captured title</h1>
        <p>Invented rendered copy</p>
        <canvas data-context={contextName} />
      </main>;
    }
  `);
  write(join(project, "reports/react-owned-ui.json"), JSON.stringify({
    routes: [{ route: "/", reachableFiles: ["src/pages/HomePage.tsx"] }],
  }));

  const report = verifyContentProvenance({ project, mirror: join(work, "mirror") });
  assert.deepEqual(report.unsupported.map((entry) => entry.text), ["Invented rendered copy"]);
  assert.ok(!report.checked.some((entry) => entry.text === "XText body-regular"));
  assert.ok(!report.checked.some((entry) => entry.text === "Home canvas"));
  assert.ok(!report.checked.some((entry) => entry.text === "WEBGL_lose_context"));
});

test("ignores implementation strings while retaining accessibility metadata", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-content-provenance-implementation-"));
  const project = join(work, "react");
  write(join(work, "mirror/example.com/index.html"), "<!doctype html><main><h1>Captured headline</h1></main>");
  write(join(project, "src/pages/HomePage.tsx"), `
    export default function HomePage() {
      const engineConstant = "WEBGL_lose_context";
      void engineConstant;
      return <main className="XText body-regular" data-testid="home" aria-label="Accessible home canvas">
        <h1>Captured headline</h1>
      </main>;
    }
  `);
  write(join(project, "reports/react-owned-ui.json"), JSON.stringify({
    routes: [{ route: "/", reachableFiles: ["src/pages/HomePage.tsx"] }],
  }));

  const report = verifyContentProvenance({ project, mirror: join(work, "mirror") });
  assert.equal(report.passed, true);
  assert.deepEqual(report.unsupported, []);
  assert.ok(!report.checked.some((entry) => entry.text === "XText body-regular"));
  assert.ok(!report.checked.some((entry) => entry.text === "Accessible home canvas"));
  assert.ok(!report.checked.some((entry) => entry.text === "WEBGL_lose_context"));
});

test("checks static visible attributes but not class, data, or aria attributes", () => {
  const work = mkdtempSync(join(tmpdir(), "cloner-content-provenance-attributes-"));
  const project = join(work, "react");
  write(join(work, "mirror/example.com/index.html"), "<!doctype html><img alt='Captured bottle'>");
  write(join(project, "src/pages/HomePage.tsx"), `
    export default function HomePage() {
      return <img className="hero image" data-testid="hero" aria-label="Decorative bottle" alt="Invented bottle" />;
    }
  `);
  write(join(project, "reports/react-owned-ui.json"), JSON.stringify({
    routes: [{ route: "/", reachableFiles: ["src/pages/HomePage.tsx"] }],
  }));

  const report = verifyContentProvenance({ project, mirror: join(work, "mirror") });
  assert.equal(report.passed, false);
  assert.ok(report.unsupported.some((entry) => entry.text === "Invented bottle"));
  assert.ok(!report.checked.some((entry) => entry.text === "hero image"));
  assert.ok(!report.checked.some((entry) => entry.text === "Decorative bottle"));
});
