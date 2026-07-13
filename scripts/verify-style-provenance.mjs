#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { listFiles, parseArgs, readText, safeJson, toPosix, writeText } from "./lib.mjs";

function digest(path) {
  const bytes = readFileSync(path);
  return {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function styleEntries(projectRoot) {
  const sourceRoot = join(projectRoot, "src");
  if (!existsSync(sourceRoot)) return [];
  return listFiles(sourceRoot)
    .filter((file) => extname(file).toLowerCase() === ".css")
    .map((file) => ({ path: toPosix(relative(projectRoot, file)), ...digest(file) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function baselinePath(work) {
  return join(resolve(work), ".cloner/style-baseline.json");
}

export function writeStyleBaseline({ project, work = join(resolve(project), "..") }) {
  const projectRoot = resolve(project);
  const report = {
    schemaVersion: 1,
    project: projectRoot,
    entries: styleEntries(projectRoot),
  };
  writeText(baselinePath(work), safeJson(report));
  return report;
}

export function verifyStyleProvenance({ project, work = join(resolve(project), "..") }) {
  const projectRoot = resolve(project);
  const path = baselinePath(work);
  const baseline = existsSync(path) ? JSON.parse(readText(path)) : null;
  const current = styleEntries(projectRoot);
  const expectedByPath = new Map((baseline?.entries || []).map((entry) => [entry.path, entry]));
  const currentByPath = new Map(current.map((entry) => [entry.path, entry]));
  const modified = current.filter((entry) => {
    const expected = expectedByPath.get(entry.path);
    return expected && expected.sha256 !== entry.sha256;
  }).map((entry) => ({ path: entry.path, expected: expectedByPath.get(entry.path), actual: entry }));
  const untracked = current.filter((entry) => !expectedByPath.has(entry.path));
  const missing = (baseline?.entries || []).filter((entry) => !currentByPath.has(entry.path));
  const report = {
    schemaVersion: 1,
    passed: Boolean(baseline) && modified.length === 0 && untracked.length === 0 && missing.length === 0,
    baseline: path,
    baselineMissing: !baseline,
    checked: current.length,
    modified,
    untracked,
    missing,
  };
  writeText(join(projectRoot, "reports/style-provenance.json"), safeJson(report));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) {
    console.error("Usage: verify-style-provenance.mjs --project PROJECT [--work RUN_DIR] [--write-baseline]");
    process.exit(2);
  }
  const project = resolve(String(args.project));
  const work = args.work ? resolve(String(args.work)) : join(project, "..");
  if (args["write-baseline"]) {
    const baseline = writeStyleBaseline({ project, work });
    console.log(`Recorded ${baseline.entries.length} captured style file(s).`);
  } else {
    const report = verifyStyleProvenance({ project, work });
    if (!report.passed) {
      if (report.baselineMissing) console.error(`Missing style baseline: ${report.baseline}`);
      for (const finding of report.modified) console.error(`Modified captured style: ${finding.path}`);
      for (const finding of report.untracked) console.error(`Untracked style file: ${finding.path}`);
      for (const finding of report.missing) console.error(`Missing captured style: ${finding.path}`);
      process.exit(3);
    }
    console.log(`Verified ${report.checked} captured style file(s).`);
  }
}
