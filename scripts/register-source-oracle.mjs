#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { listFiles, parseArgs, readText, safeJson, toPosix, writeText } from "./lib.mjs";
import { isLoopbackUrl } from "./runtime-analysis.mjs";

function digest(path) {
  const bytes = readFileSync(path);
  return {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function manifestIntegrity(manifest) {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    sourceUrl: manifest.sourceUrl,
    previewUrl: manifest.previewUrl,
    oracleRoot: manifest.oracleRoot,
    files: manifest.files,
  })).digest("hex");
}

function manifestPath(work) {
  return join(resolve(work), ".cloner/oracle/manifest.json");
}

function within(root, candidate) {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== "..");
}

export function registerSourceOracle({ work, sourceUrl, previewUrl, oracleRoot }) {
  const runRoot = resolve(work);
  const allowedRoot = join(runRoot, ".cloner/oracle");
  const root = resolve(oracleRoot);
  const mirrorRoot = join(runRoot, "mirror");
  if (!within(allowedRoot, root) || root === allowedRoot || !existsSync(root)) {
    throw new Error("source-oracle-invalid: oracle root must be a populated subdirectory of RUN/.cloner/oracle");
  }
  if (!isLoopbackUrl(String(previewUrl))) throw new Error("source-oracle-invalid: preview URL must be loopback HTTP(S)");
  const capturedHashes = new Set(existsSync(mirrorRoot) ? listFiles(mirrorRoot).map((file) => digest(file).sha256) : []);
  const files = listFiles(root)
    .map((file) => ({ path: toPosix(relative(root, file)), ...digest(file) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (files.length === 0 || files.some((entry) => !capturedHashes.has(entry.sha256))) {
    throw new Error("source-oracle-invalid: every oracle file must match unchanged captured bytes");
  }
  const manifest = {
    schemaVersion: 1,
    sourceUrl: new URL(String(sourceUrl)).href,
    previewUrl: new URL(String(previewUrl)).href,
    oracleRoot: root,
    files,
  };
  manifest.integrity = manifestIntegrity(manifest);
  writeText(manifestPath(runRoot), safeJson(manifest));
  return manifest;
}

export function loadSourceOracle({ work, sourceUrl }) {
  const runRoot = resolve(work);
  const path = manifestPath(runRoot);
  if (!existsSync(path)) return null;
  const manifest = JSON.parse(readText(path));
  const expectedSource = new URL(String(sourceUrl)).href;
  const root = resolve(String(manifest.oracleRoot || ""));
  const allowedRoot = join(runRoot, ".cloner/oracle");
  const currentFiles = existsSync(root)
    ? listFiles(root).map((file) => ({ path: toPosix(relative(root, file)), ...digest(file) })).sort((left, right) => left.path.localeCompare(right.path))
    : [];
  const valid = manifest.schemaVersion === 1
    && manifest.sourceUrl === expectedSource
    && isLoopbackUrl(String(manifest.previewUrl || ""))
    && within(allowedRoot, root)
    && root !== allowedRoot
    && JSON.stringify(currentFiles) === JSON.stringify(manifest.files)
    && manifest.integrity === manifestIntegrity(manifest);
  if (!valid) throw new Error(`source-oracle-invalid: ${path}`);
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.work || !args.source || !args.preview || !args.root) {
    console.error("Usage: register-source-oracle.mjs --work RUN --source URL --preview LOOPBACK_URL --root RUN/.cloner/oracle/SITE");
    process.exit(2);
  }
  try {
    const manifest = registerSourceOracle({
      work: String(args.work),
      sourceUrl: String(args.source),
      previewUrl: String(args.preview),
      oracleRoot: String(args.root),
    });
    console.log(`Registered ${manifest.files.length} immutable source-oracle file(s).`);
  } catch (error) {
    console.error(error.message);
    process.exit(3);
  }
}
