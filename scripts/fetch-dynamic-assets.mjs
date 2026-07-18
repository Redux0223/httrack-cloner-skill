#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { parse } from "parse5";
import {
  classifyAssetContent,
  ensureDir,
  externalAssetRelativePath,
  isTracker,
  isRuntimeTextAsset,
  listFiles,
  parseArgs,
  readText,
  safeJson,
  toPosix,
  writeText,
} from "./lib.mjs";
import { discoverConstructedAssetReferences } from "./dynamic-asset-discovery.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.mirror || !args["source-url"]) {
  console.error("Usage: fetch-dynamic-assets.mjs --mirror SITE_ROOT --source-url URL [--strict]");
  process.exit(2);
}

const mirror = resolve(String(args.mirror));
const source = new URL(String(args["source-url"]));
const extensions = new Set([
  ".avif", ".bin", ".css", ".frag", ".fs", ".gif", ".glb", ".gltf", ".glsl", ".ico", ".jpeg", ".jpg",
  ".js", ".json", ".ktx2", ".mp3", ".mp4", ".ogg", ".otf", ".png", ".svg",
  ".ttf", ".vert", ".vs", ".wasm", ".wav", ".webm", ".webp", ".woff", ".woff2",
]);
const fetched = [];
const existing = [];
const failed = [];
const rejected = [];
const processedPaths = new Set();
const scannedFiles = new Set();
const rounds = [];
const hintedCandidates = new Map();
const sourceUrlByRelativePath = new Map();
const previousReportPath = join(mirror, "dynamic-assets-report.json");

if (existsSync(previousReportPath)) {
  const previousReport = JSON.parse(readText(previousReportPath));
  for (const entry of [...(previousReport.fetched || []), ...(previousReport.existing || [])]) {
    if (entry.path && entry.url) sourceUrlByRelativePath.set(entry.path, entry.url);
  }
}

function resolveCandidate(raw, foundIn) {
  if (!raw || /^(data:|blob:|#)/i.test(raw)) return null;
  if (/^\.\.\/[^/]+\.[a-z]{2,}(?:\/|$)/i.test(raw)) return null;
  if (/^\/[^/]+\.[a-z]{2,}\//i.test(raw)) return null;
  let url;
  try {
    const extension = extname(foundIn).toLowerCase();
    const fileRelative = [".css", ".html", ".htm"].includes(extension) || raw.startsWith("./") || raw.startsWith("../");
    const capturedSourceUrl = sourceUrlByRelativePath.get(foundIn);
    const base = capturedSourceUrl ? new URL(capturedSourceUrl) : fileRelative ? new URL(foundIn, source) : source;
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (!extensions.has(extname(url.pathname).toLowerCase()) || isTracker(url.href)) return null;
  const relativePath = url.origin === source.origin
    ? decodeURIComponent(url.pathname.replace(/^\/+/, ""))
    : externalAssetRelativePath(url);
  if (!relativePath || relativePath.includes("..")) return null;
  sourceUrlByRelativePath.set(relativePath, url.href);
  return { relativePath, url: url.href, foundIn };
}

if (args.hints) {
  const hintsPath = resolve(String(args.hints));
  for (const line of readText(hintsPath).split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    const candidate = resolveCandidate(value, "asset-hints.txt");
    if (candidate) hintedCandidates.set(candidate.relativePath, candidate);
  }
}

const extensionPattern = [
  "woff2", "jpeg", "json", "ktx2", "webm", "webp", "avif", "gltf", "glsl", "wasm",
  "woff", "frag", "vert", "bin", "css", "gif", "glb", "ico", "jpg", "js", "mp3", "mp4", "ogg",
  "otf", "png", "svg", "ttf", "wav", "fs", "vs",
].join("|");
const rootedAssetPattern = new RegExp(
  `(?:https?:\\/\\/[^\\s"'\\x60)]+|\\/(?:[A-Za-z0-9_@.%+() -]+\\/)+[A-Za-z0-9_@.%+() -]+\\.(?:${extensionPattern})(?:\\?[^\\s"'\\x60)]*)?|(?:assets|vendor)\\/(?:[A-Za-z0-9_@.%+() -]+\\/)*[A-Za-z0-9_@.%+() -]+\\.(?:${extensionPattern})(?:\\?[^\\s"'\\x60)]*)?)`,
  "gi",
);
const relativeAssetPattern = new RegExp(`(?:\\.\\.?\\/)(?:[A-Za-z0-9_@.%+() -]+\\/)*[A-Za-z0-9_@.%+() -]+\\.(?:${extensionPattern})(?:\\?[^\\s"'\\x60)]*)?`, "gi");
const cssUrlPattern = /url\(\s*["']?([^"')\s]+)["']?\s*\)/gi;

function htmlAssetReferences(text) {
  const references = [];
  const document = parse(text);
  function walk(node) {
    if (node.tagName) {
      const attributes = new Map((node.attrs || []).map((attribute) => [attribute.name, attribute.value]));
      const rel = String(attributes.get("rel") || "").split(/\s+/);
      if (node.tagName === "link" && rel.some((value) => ["stylesheet", "preload", "modulepreload", "icon"].includes(value))) {
        references.push(attributes.get("href"));
      }
      if (node.tagName === "script") references.push(attributes.get("src"));
      if (["img", "source", "video", "audio", "track", "embed", "input"].includes(node.tagName)) {
        for (const name of ["src", "data-src", "data-original", "data-lazy-src", "poster"]) references.push(attributes.get(name));
        for (const candidate of String(attributes.get("srcset") || "").split(",")) references.push(candidate.trim().split(/\s+/)[0]);
      }
      const style = attributes.get("style") || "";
      for (const match of style.matchAll(cssUrlPattern)) references.push(match[1]);
    }
    for (const child of node.childNodes || []) walk(child);
  }
  walk(document);
  return references.filter(Boolean);
}

function scanNewFiles() {
  const discovered = new Map();
  for (const file of listFiles(mirror)) {
    const extension = extname(file).toLowerCase();
    if (!isRuntimeTextAsset(file) && ![".html", ".htm"].includes(extension)) continue;
    const foundIn = toPosix(relative(mirror, file));
    if (scannedFiles.has(foundIn)) continue;
    scannedFiles.add(foundIn);
    const text = readText(file);
    if ([".html", ".htm"].includes(extension)) {
      for (const reference of htmlAssetReferences(text)) {
        const candidate = resolveCandidate(reference, foundIn);
        if (candidate) discovered.set(candidate.relativePath, candidate);
      }
    }
    if (![".html", ".htm"].includes(extension)) {
      for (const match of text.matchAll(rootedAssetPattern)) {
        const candidate = resolveCandidate(match[0], foundIn);
        if (candidate) discovered.set(candidate.relativePath, candidate);
      }
      for (const match of text.matchAll(relativeAssetPattern)) {
        const candidate = resolveCandidate(match[0], foundIn);
        if (candidate) discovered.set(candidate.relativePath, candidate);
      }
    }
    for (const match of text.matchAll(cssUrlPattern)) {
      const candidate = resolveCandidate(match[1], foundIn);
      if (candidate) discovered.set(candidate.relativePath, candidate);
    }
    for (const reference of discoverConstructedAssetReferences(text, { html: [".html", ".htm"].includes(extension) })) {
      const candidate = resolveCandidate(reference, foundIn);
      if (candidate) discovered.set(candidate.relativePath, candidate);
    }
  }
  return discovered;
}

async function fetchRound(discovered) {
  const queue = [...discovered.values()].filter((candidate) => !processedPaths.has(candidate.relativePath));
  const round = { discovered: queue.length, fetched: 0, existing: 0, rejected: 0, failed: 0 };
  const concurrency = Math.min(8, Math.max(1, Number(args.concurrency || 6)));

  async function fetchWithRetry(url) {
    const attempts = Math.max(1, Number(args.retries || 3));
    const timeoutMs = Math.max(50, Number(args["timeout-ms"] || 15_000));
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          redirect: "follow",
          headers: {
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
            referer: source.href,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) return response;
        const error = new Error(`HTTP ${response.status}`);
        if (response.status < 500 || attempt === attempts - 1) throw error;
        lastError = error;
      } catch (error) {
        lastError = error;
        if (attempt === attempts - 1) throw error;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 150 * (2 ** attempt)));
    }
    throw lastError;
  }

  async function worker() {
    while (queue.length > 0) {
      const candidate = queue.shift();
      processedPaths.add(candidate.relativePath);
      const destination = join(mirror, ...candidate.relativePath.split("/"));
      if (existsSync(destination)) {
        sourceUrlByRelativePath.set(candidate.relativePath, candidate.url);
        existing.push({ path: candidate.relativePath, url: candidate.url, foundIn: candidate.foundIn });
        round.existing += 1;
        continue;
      }
      try {
        const response = await fetchWithRetry(candidate.url);
        const bytes = Buffer.from(await response.arrayBuffer());
        const classification = classifyAssetContent(bytes, {
          contentType: response.headers.get("content-type") || "",
          expectedExtension: extname(candidate.relativePath),
        });
        if (classification === "html" && !/[.]html?$/i.test(candidate.relativePath)) {
          rejected.push({
            path: candidate.relativePath,
            bytes: bytes.length,
            url: candidate.url,
            foundIn: candidate.foundIn,
            classification,
            contentType: response.headers.get("content-type") || "",
            reason: "content-type-mismatch",
          });
          round.rejected += 1;
          continue;
        }
        ensureDir(dirname(destination));
        await import("node:fs/promises").then(({ writeFile }) => writeFile(destination, bytes));
        sourceUrlByRelativePath.set(candidate.relativePath, response.url || candidate.url);
        fetched.push({
          path: candidate.relativePath,
          bytes: bytes.length,
          url: candidate.url,
          foundIn: candidate.foundIn,
          classification,
          contentType: response.headers.get("content-type") || "",
        });
        round.fetched += 1;
      } catch (error) {
        failed.push({ path: candidate.relativePath, error: error.message, url: candidate.url, foundIn: candidate.foundIn });
        round.failed += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  rounds.push(round);
  return round;
}

for (let roundIndex = 0; roundIndex < Number(args.rounds || 6); roundIndex += 1) {
  const discovered = scanNewFiles();
  if (roundIndex === 0) {
    for (const [path, candidate] of hintedCandidates) discovered.set(path, candidate);
  }
  const round = await fetchRound(discovered);
  if (round.fetched === 0) break;
}

const report = {
  sourceUrl: source.href,
  scannedFiles: scannedFiles.size,
  discovered: processedPaths.size,
  hinted: hintedCandidates.size,
  rounds,
  fetched,
  existing,
  rejected,
  failed,
};
writeText(join(mirror, "dynamic-assets-report.json"), safeJson(report));

console.log(`Dynamic assets: ${fetched.length} fetched, ${existing.length} existing, ${rejected.length} rejected, ${failed.length} failed`);
if (failed.length > 0 && args.strict) process.exit(3);
