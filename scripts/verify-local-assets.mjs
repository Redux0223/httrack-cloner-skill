#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { listFiles, parseArgs, readText, safeJson, toPosix, writeText } from "./lib.mjs";
import { discoverRuntimeAssetReferences } from "./runtime-asset-references.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.project) {
  console.error("Usage: verify-local-assets.mjs --project REACT_PROJECT [--hints asset-hints.txt] [--strict-runtime]");
  process.exit(2);
}

const project = resolve(String(args.project));
const publicRoot = join(project, "public");
if (!existsSync(publicRoot)) throw new Error(`Missing public directory: ${publicRoot}`);

const assetExtensions = [
  "avif", "bin", "css", "frag", "fs", "gif", "glb", "gltf", "glsl", "ico", "jpeg", "jpg", "js", "json",
  "ktx2", "mp3", "mp4", "ogg", "otf", "png", "svg", "ttf", "wasm", "wav", "webm",
  "vert", "vs", "webp", "woff", "woff2",
];
const extensionPattern = [...assetExtensions].sort((left, right) => right.length - left.length).join("|");
const quotedAssetPattern = new RegExp(`["'\\x60]((?:\\/|\\.\\.?\\/|(?:assets|vendor|legacy|_external)\\/)[A-Za-z0-9_@.%+\\- /]+\\.(?:${extensionPattern})(?:[?#][^"'\\x60\\s]*)?)["'\\x60]`, "gi");
const rootedAssetPattern = new RegExp(`(\\/(?:assets|vendor|legacy|_external)\\/[^\\s"'\\x60)]+\\.(?:${extensionPattern})(?:[?#][^\\s"'\\x60)]*)?)`, "gi");
const cssUrlPattern = /url\(\s*["']?([^"')\s]+)["']?\s*\)/gi;
const markupExtensions = new Set([".css", ".htm", ".html"]);
const javaScriptExtensions = new Set([".js", ".mjs", ".cjs"]);
const references = new Map();
const parseFailures = [];

function stripSuffix(value) {
  return String(value).split("#")[0].split("?")[0];
}

function addReference(raw, fromFile, source = "static") {
  if (!raw || /^(?:data:|blob:|https?:|\/\/|#)/i.test(raw)) return;
  let clean;
  try {
    clean = decodeURIComponent(stripSuffix(raw));
  } catch {
    clean = stripSuffix(raw);
  }
  if (!clean || clean.includes("${") || !assetExtensions.includes(extname(clean).slice(1).toLowerCase())) return;

  let destination;
  if (clean.startsWith("/")) destination = join(publicRoot, ...clean.slice(1).split("/"));
  else if (clean.startsWith("./") || clean.startsWith("../") || extname(fromFile).toLowerCase() === ".css") {
    destination = resolve(dirname(fromFile), clean);
  } else {
    destination = join(publicRoot, ...clean.split("/"));
  }
  const key = `${toPosix(relative(project, fromFile))}\0${clean}`;
  references.set(key, {
    from: toPosix(relative(project, fromFile)),
    raw,
    source,
    resolved: toPosix(relative(project, destination)),
    destination,
  });
}

const scanFiles = listFiles(publicRoot).filter((file) => {
  const relativeFile = toPosix(relative(publicRoot, file));
  if (relativeFile.startsWith("_external/") && /\.html?$/i.test(relativeFile)) return false;
  const extension = extname(file).toLowerCase();
  return [".htm", ".html"].includes(extension) || javaScriptExtensions.has(extension);
});
const sourceCss = join(project, "src/styles/source.css");
if (existsSync(sourceCss)) scanFiles.push(sourceCss);
const indexHtml = join(project, "index.html");
if (existsSync(indexHtml)) scanFiles.push(indexHtml);

for (const file of scanFiles) {
  const text = readText(file);
  const extension = extname(file).toLowerCase();
  if (javaScriptExtensions.has(extension)) {
    const discovery = discoverRuntimeAssetReferences(text);
    for (const reference of discovery.references) addReference(reference, file, "javascript-runtime-sink");
    if (discovery.parseError) {
      parseFailures.push({
        file: toPosix(relative(project, file)),
        error: discovery.parseError,
      });
    }
  } else {
    for (const match of text.matchAll(quotedAssetPattern)) addReference(match[1], file);
    for (const match of text.matchAll(rootedAssetPattern)) addReference(match[1], file);
    for (const match of text.matchAll(cssUrlPattern)) addReference(match[1], file, "css-url");
  }
}

if (args.hints) {
  const hintsPath = resolve(String(args.hints));
  for (const line of readText(hintsPath).split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    addReference(value, indexHtml, "hint");
  }
}

const missing = [...references.values()]
  .filter((reference) => !existsSync(reference.destination))
  .map(({ destination, ...reference }) => reference)
  .sort((left, right) => left.resolved.localeCompare(right.resolved));

// Bundle scanners intentionally over-approximate. Let browser proof decide whether
// a JavaScript sink is reachable; direct HTML/CSS references remain hard failures.
const diagnosticMissing = missing.filter((reference) =>
  reference.source === "javascript-runtime-sink" || reference.source === "hint");
const blockingMissing = missing.filter((reference) => !diagnosticMissing.includes(reference));
const strictRuntime = Boolean(args["strict-runtime"]);

const inventory = listFiles(publicRoot).map((file) => {
  const bytes = readFileSync(file);
  return {
    path: toPosix(relative(publicRoot, file)),
    bytes: statSync(file).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}).sort((left, right) => left.path.localeCompare(right.path));

const report = {
  inventory,
  references: [...references.values()].map(({ destination, ...reference }) => reference),
  parseFailures,
  missing,
  blockingMissing,
  diagnosticMissing,
  strictRuntime,
  passed: strictRuntime
    ? missing.length === 0 && parseFailures.length === 0
    : blockingMissing.length === 0,
};
writeText(join(project, "reports/local-assets.json"), safeJson(report));

if (!report.passed) {
  for (const finding of strictRuntime ? missing : blockingMissing) {
    console.error(`${finding.from} -> ${finding.raw} missing at ${finding.resolved}`);
  }
  for (const finding of parseFailures) console.error(`${finding.file} could not be analyzed: ${finding.error}`);
  process.exit(3);
}
for (const finding of diagnosticMissing) {
  console.warn(`Diagnostic: ${finding.from} -> ${finding.raw} missing at ${finding.resolved}`);
}
for (const finding of parseFailures) {
  console.warn(`Diagnostic: ${finding.file} could not be analyzed: ${finding.error}`);
}
console.log(`Verified ${inventory.length} local asset(s) and ${references.size} reference(s).`);
