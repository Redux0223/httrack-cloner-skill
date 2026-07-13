#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { parseArgs, safeJson, writeText } from "./lib.mjs";

function availablePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePromise(address.port));
    });
  });
}

async function waitForUrl(url, child, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`Preview exited before becoming ready with code ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error(`Preview did not become ready within ${timeoutMs}ms: ${url}`);
}

function copyProject(project, destination) {
  cpSync(project, destination, {
    recursive: true,
    filter(source) {
      const path = relative(project, source).split("\\").join("/");
      if (!path) return true;
      return !(
        path === "node_modules"
        || path.startsWith("node_modules/")
        || path === "dist"
        || path.startsWith("dist/")
        || path === ".cloner"
        || path.startsWith(".cloner/")
        || path.endsWith(".zip")
      );
    },
  });
}

export async function verifyReproducible({ project, routes = ["/"] }) {
  const source = resolve(project);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "httrack-react-repro-"));
  const cleanProject = join(temporaryRoot, basename(source));
  copyProject(source, cleanProject);
  const commands = [];
  let preview;
  try {
    for (const [command, args] of [
      ["npm", ["ci"]],
      ["npm", ["run", "build"]],
    ]) {
      const result = spawnSync(command, args, { cwd: cleanProject, encoding: "utf8" });
      commands.push({ command: [command, ...args].join(" "), status: result.status, stdout: result.stdout, stderr: result.stderr });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
    }

    const port = await availablePort();
    preview = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(port)], {
      cwd: cleanProject,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const baseUrl = `http://127.0.0.1:${port}/`;
    await waitForUrl(baseUrl, preview);
    const routeResults = [];
    for (const route of routes) {
      const response = await fetch(new URL(route.replace(/^\//, ""), baseUrl));
      routeResults.push({ route, status: response.status, contentType: response.headers.get("content-type") });
    }
    const report = {
      passed: commands.every((entry) => entry.status === 0) && routeResults.every((entry) => entry.status === 200),
      commands,
      routes: routeResults,
      previewUrl: baseUrl,
    };
    writeText(join(source, "reports/reproducibility.json"), safeJson(report));
    return report;
  } finally {
    if (preview && preview.exitCode === null) {
      try {
        if (process.platform === "win32") preview.kill("SIGTERM");
        else process.kill(-preview.pid, "SIGTERM");
      } catch {}
      await new Promise((resolvePromise) => {
        const timeout = setTimeout(() => {
          try {
            if (process.platform === "win32") preview.kill("SIGKILL");
            else process.kill(-preview.pid, "SIGKILL");
          } catch {}
          resolvePromise();
        }, 2000);
        preview.once("exit", () => {
          clearTimeout(timeout);
          resolvePromise();
        });
      });
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) {
    console.error("Usage: verify-reproducible.mjs --project PROJECT [--routes JSON]");
    process.exit(2);
  }
  const routes = args.routes ? JSON.parse(String(args.routes)) : ["/"];
  const report = await verifyReproducible({ project: String(args.project), routes });
  if (!report.passed) process.exit(3);
}
