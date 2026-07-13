#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { ensureCleanDir, listFiles, parseArgs, safeJson, toPosix, writeText } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.url || !args.output) {
  console.error("Usage: capture-site.mjs --url URL --output MIRROR --authorized [--allow-host host1,host2] [--ignore-robots]");
  process.exit(2);
}
if (!args.authorized) {
  console.error("Refusing to capture without --authorized. Confirm you have permission to copy and transform this site.");
  process.exit(2);
}

const url = new URL(String(args.url));
if (!/^https?:$/.test(url.protocol)) throw new Error("Only http/https URLs are supported");
const output = resolve(String(args.output));
const depth = Number(args.depth || 3);
const allowHosts = String(args["allow-host"] || "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const versionResult = spawnSync("httrack", ["--version"], { encoding: "utf8" });
if (versionResult.error) throw new Error("HTTrack is not installed or not on PATH");
const versionText = `${versionResult.stdout || ""}\n${versionResult.stderr || ""}`;
const versionMatch = versionText.match(/HTTrack version\s+([\d.-]+)/i);
const engine = versionMatch ? `HTTrack ${versionMatch[1]}` : "HTTrack unknown";

ensureCleanDir(output);
const filters = ["-*", `+${url.host}/*`, ...allowHosts.map((host) => `+${host}/*`)];
const httrackArgs = [
  url.href,
  "-O", output,
  ...filters,
  `-r${depth}`,
  "-c4",
  "--keep-alive",
  "--display=1",
  "--disable-security-limits",
];
if (args["ignore-robots"]) httrackArgs.push("--robots=0");

const capture = spawnSync("httrack", httrackArgs, { encoding: "utf8" });
writeText(join(output, "capture-stdout.log"), capture.stdout || "");
writeText(join(output, "capture-stderr.log"), capture.stderr || "");
if (capture.status !== 0) {
  console.error(capture.stderr || capture.stdout || `HTTrack exited ${capture.status}`);
  process.exit(capture.status || 1);
}

const indexFiles = listFiles(output).filter((file) => file.endsWith("index.html"));
const nestedIndexes = indexFiles.filter((file) => dirname(file) !== output);
const hostToken = url.hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
const rankIndex = (file) => {
  const rel = toPosix(relative(output, file));
  const hostMatch = rel === `${hostToken}/index.html` ? 0
    : rel.startsWith(`${hostToken}/`) ? 1
      : rel.startsWith(`${hostToken}_`) ? 2 : 3;
  return [hostMatch, rel.split("/").length, rel.length, rel];
};
const preferred = [...nestedIndexes].sort((left, right) => {
  const a = rankIndex(left);
  const b = rankIndex(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
})[0];
if (!preferred) throw new Error(`HTTrack finished but no captured site index was found in ${output}`);
const siteRoot = dirname(preferred);

const dynamicScript = resolve(dirname(new URL(import.meta.url).pathname), "fetch-dynamic-assets.mjs");
const dynamic = spawnSync(process.execPath, [
  dynamicScript,
  "--mirror", siteRoot,
  "--source-url", url.href,
  ...(args.hints ? ["--hints", resolve(String(args.hints))] : []),
  ...(args["strict-dynamic-assets"] ? ["--strict"] : []),
], { encoding: "utf8" });
writeText(join(output, "dynamic-assets-stdout.log"), dynamic.stdout || "");
writeText(join(output, "dynamic-assets-stderr.log"), dynamic.stderr || "");
if (dynamic.status !== 0) {
  console.error(dynamic.stderr || dynamic.stdout || `Dynamic asset fetch exited ${dynamic.status}`);
  process.exit(dynamic.status || 1);
}

const report = {
  sourceUrl: url.href,
  engine,
  command: ["httrack", ...httrackArgs],
  siteRoot,
  files: listFiles(siteRoot).length,
  ignoredRobots: Boolean(args["ignore-robots"]),
  authorizationConfirmed: true,
  allowedResourceHosts: allowHosts,
};
const inventoryFile = join(output, "asset-manifest.json");
const inventory = {
  sourceUrl: url.href,
  siteRoot,
  files: listFiles(siteRoot).map((file) => {
    const bytes = readFileSync(file);
    return {
      path: toPosix(relative(siteRoot, file)),
      bytes: statSync(file).size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }).sort((left, right) => left.path.localeCompare(right.path)),
};
writeText(inventoryFile, safeJson(inventory));
report.inventoryFile = inventoryFile;
writeText(join(output, "capture-report.json"), safeJson(report));
console.log(`Captured ${url.href} to ${siteRoot}`);
