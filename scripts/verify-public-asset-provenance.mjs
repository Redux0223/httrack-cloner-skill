#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { listFiles, parseArgs, readText, safeJson, toPosix, writeText } from "./lib.mjs";

const TRANSFORMABLE_SOURCE_EXTENSIONS = new Set([".cjs", ".css", ".htm", ".html", ".js", ".mjs"]);

function fileDigest(path) {
  const bytes = readFileSync(path);
  return {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function verifyPublicAssetProvenance({ project, mirror }) {
  const projectRoot = resolve(project);
  const mirrorRoot = resolve(mirror || join(projectRoot, "..", "mirror"));
  const publicRoot = join(projectRoot, "public");
  const manifestPath = join(projectRoot, "reports/conversion-manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readText(manifestPath)) : {};
  const siteRoot = manifest.siteRoot ? join(mirrorRoot, ...String(manifest.siteRoot).split("/")) : mirrorRoot;
  const capturedSite = new Map(existsSync(siteRoot)
    ? listFiles(siteRoot).map((file) => [toPosix(relative(siteRoot, file)), file])
    : []);
  const capturedMirror = new Map(existsSync(mirrorRoot)
    ? listFiles(mirrorRoot).map((file) => [toPosix(relative(mirrorRoot, file)), file])
    : []);
  const generatedPath = join(projectRoot, "reports/generated-public-assets.json");
  const generated = existsSync(generatedPath) ? JSON.parse(readText(generatedPath)) : { entries: [] };
  const declared = new Set((generated.entries || []).filter((entry) => entry.provenance && entry.kind).map((entry) => entry.path));
  const checked = existsSync(publicRoot)
    ? listFiles(publicRoot)
      .map((file) => toPosix(relative(publicRoot, file)))
      .filter((path) => !path.startsWith("legacy/"))
    : [];
  const uncaptured = checked.filter((path) => {
    if (declared.has(path) || capturedSite.has(path)) return false;
    if (path.startsWith("_external/") && capturedMirror.has(path.slice("_external/".length))) return false;
    return true;
  }).map((path) => ({ path }));
  const mismatched = checked.flatMap((path) => {
    if (declared.has(path) || TRANSFORMABLE_SOURCE_EXTENSIONS.has(extname(path).toLowerCase())) return [];
    const captured = capturedSite.get(path)
      || (path.startsWith("_external/") ? capturedMirror.get(path.slice("_external/".length)) : null);
    if (!captured) return [];
    const projectFile = join(publicRoot, ...path.split("/"));
    const expected = fileDigest(captured);
    const actual = fileDigest(projectFile);
    return expected.sha256 === actual.sha256 ? [] : [{ path, expected, actual }];
  });
  const report = {
    schemaVersion: 2,
    passed: uncaptured.length === 0 && mismatched.length === 0,
    checked: checked.length,
    declaredGenerated: [...declared].sort(),
    uncaptured,
    mismatched,
  };
  writeText(join(projectRoot, "reports/public-asset-provenance.json"), safeJson(report));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) {
    console.error("Usage: verify-public-asset-provenance.mjs --project PROJECT [--mirror MIRROR]");
    process.exit(2);
  }
  const report = verifyPublicAssetProvenance({ project: String(args.project), mirror: args.mirror ? String(args.mirror) : undefined });
  if (!report.passed) {
    for (const finding of report.uncaptured) console.error(`Uncaptured public asset: ${finding.path}`);
    for (const finding of report.mismatched) console.error(`Modified captured public asset: ${finding.path}`);
    process.exit(3);
  }
  console.log(`Verified provenance for ${report.checked} public asset(s).`);
}
