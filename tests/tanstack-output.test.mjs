import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve("tests");
const output = join(root, "fixture/tanstack-output");
const runner = resolve("./scripts/run-pipeline.mjs");

test("generates a TypeScript TanStack Router project without a hand-written history router", () => {
  rmSync(output, { recursive: true, force: true });
  const result = spawnSync(
    process.execPath,
    [
      runner,
      "--input",
      join(root, "fixture/mirror"),
      "--output",
      output,
      "--source-url",
      "https://fixture.example/",
      "--offline-rules",
      join(root, "fixture/offline-rules.json"),
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const packageJson = JSON.parse(readFileSync(join(output, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies["@tanstack/react-router"], "1.170.17");
  assert.equal(packageJson.devDependencies["@tanstack/router-plugin"], "1.168.19");
  assert.equal(packageJson.devDependencies.typescript, "5.7.2");
  assert.equal(packageJson.scripts.test, "vitest run");
  assert.ok(packageJson.devDependencies.vitest);
  assert.ok(packageJson.devDependencies.jsdom);
  assert.ok(packageJson.devDependencies["@testing-library/react"]);
  assert.ok(existsSync(join(output, "package-lock.json")));
  assert.equal(packageJson.scripts.test, "vitest run");
  assert.ok(packageJson.devDependencies.vitest);
  assert.ok(packageJson.devDependencies.jsdom);
  assert.ok(packageJson.devDependencies["@testing-library/react"]);
  assert.ok(existsSync(join(output, "package-lock.json")));

  assert.ok(existsSync(join(output, "src/routes/__root.tsx")));
  assert.ok(existsSync(join(output, "src/routes/index.tsx")));
  assert.ok(existsSync(join(output, "src/routes/about.tsx")));
  assert.ok(existsSync(join(output, "src/routeTree.gen.ts")));
  assert.ok(existsSync(join(output, "vitest.config.ts")));

  const rootRoute = readFileSync(join(output, "src/routes/__root.tsx"), "utf8");
  const indexRoute = readFileSync(join(output, "src/routes/index.tsx"), "utf8");
  const mainSource = readFileSync(join(output, "src/main.tsx"), "utf8");
  const viteSource = readFileSync(join(output, "vite.config.ts"), "utf8");
  const vitestSource = readFileSync(join(output, "vitest.config.ts"), "utf8");
  const tsconfig = JSON.parse(readFileSync(join(output, "tsconfig.json"), "utf8"));
  const routeTree = readFileSync(join(output, "src/routeTree.gen.ts"), "utf8");

  assert.match(rootRoute, /createRootRoute/);
  assert.match(indexRoute, /createFileRoute\("\/"\)/);
  assert.doesNotMatch(indexRoute, /from\s+"[^"]+[.]tsx"/);
  assert.match(mainSource, /RouterProvider/);
  assert.doesNotMatch(mainSource, /popstate|pushState|LegacyScripts/);
  assert.ok(viteSource.indexOf("tanstackRouter(") < viteSource.indexOf("react()"));
  assert.match(vitestSource, /environment:\s*["']jsdom["']/);
  assert.equal(tsconfig.compilerOptions.strict, true);
  assert.match(routeTree, /interface FileRoutesByPath/);
  assert.match(routeTree, /_addFileTypes<FileRouteTypes>/);
});
