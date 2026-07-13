import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { listFiles, readText, safeJson, toPosix, writeText } from "./lib.mjs";

const TRACKED_PATHS = [
  "react/src",
  "react/public",
  "react/reports",
  "react/package.json",
  "react/package-lock.json",
  "react/tsconfig.json",
  "react/vite.config.ts",
  "proof/proof-contract.json",
  ".cloner/oracle/manifest.json",
  ".cloner/repair-history.json",
];

const AGENT_AUTHORED_REPORTS = new Set([
  "react/reports/proof-profile.json",
  "react/reports/engine-contract.json",
]);

export function forbiddenReportEdits(reportEdits = []) {
  return reportEdits.filter((path) => !AGENT_AUTHORED_REPORTS.has(path));
}

function digest(path) {
  const bytes = readFileSync(path);
  return {
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function snapshotRunArtifacts(work) {
  const root = resolve(work);
  const files = TRACKED_PATHS.flatMap((tracked) => {
    const path = join(root, ...tracked.split("/"));
    if (!existsSync(path)) return [];
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
  const entries = [...new Set(files)]
    .filter((file) => !file.includes("/node_modules/") && !file.includes("/dist/"))
    .map((file) => ({ path: toPosix(relative(root, file)), ...digest(file) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return { schemaVersion: 1, entries };
}

export function diffArtifactSnapshots(before = { entries: [] }, after = { entries: [] }) {
  const beforeByPath = new Map((before.entries || []).map((entry) => [entry.path, entry]));
  const afterByPath = new Map((after.entries || []).map((entry) => [entry.path, entry]));
  const added = (after.entries || []).filter((entry) => !beforeByPath.has(entry.path));
  const removed = (before.entries || []).filter((entry) => !afterByPath.has(entry.path));
  const modified = (after.entries || []).filter((entry) => {
    const prior = beforeByPath.get(entry.path);
    return prior && prior.sha256 !== entry.sha256;
  }).map((entry) => ({ ...entry, before: beforeByPath.get(entry.path) }));
  const reportEdits = modified
    .map((entry) => entry.path)
    .filter((path) => path.startsWith("react/reports/"));
  return { added, removed, modified, reportEdits };
}

export function beginArtifactTrace(work) {
  const root = resolve(work);
  const snapshotFile = join(root, ".cloner/artifact-snapshot.json");
  const previous = existsSync(snapshotFile) ? JSON.parse(readText(snapshotFile)) : null;
  const start = snapshotRunArtifacts(root);
  return {
    start,
    externalChanges: previous ? diffArtifactSnapshots(previous, start) : null,
  };
}

export function endArtifactTrace(work, { start, externalChanges, status }) {
  const root = resolve(work);
  const end = snapshotRunArtifacts(root);
  const traceFile = join(root, ".cloner/artifact-trace.json");
  const existing = existsSync(traceFile) ? JSON.parse(readText(traceFile)) : { schemaVersion: 1, invocations: [] };
  existing.invocations.push({
    at: new Date().toISOString(),
    status,
    externalChanges,
    pipelineChanges: diffArtifactSnapshots(start, end),
  });
  writeText(traceFile, safeJson(existing));
  writeText(join(root, ".cloner/artifact-snapshot.json"), safeJson(end));
  return existing.invocations.at(-1);
}
