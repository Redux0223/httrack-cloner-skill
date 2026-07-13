import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ensureDir, readText, safeJson, writeText } from "./lib.mjs";

const CLASSIFICATIONS = [
  { pattern: /route|title|not-found/, value: "route" },
  { pattern: /visible-text|landmark|content/, value: "content" },
  { pattern: /geometry|style|screenshot|layout/, value: "layout" },
  { pattern: /asset|font|media|model|wasm|worker-file|parse|content-type|mime/, value: "asset" },
  { pattern: /external|network|fetch|websocket|beacon/, value: "network" },
  { pattern: /lifecycle|engine|canvas|cleanup|listener|animation-frame/, value: "lifecycle" },
];

export function classifyFinding(finding) {
  const code = String(finding?.code || "unknown");
  return CLASSIFICATIONS.find((entry) => entry.pattern.test(code))?.value || "behavior";
}

function readHistory(path) {
  return existsSync(path) ? JSON.parse(readText(path)) : [];
}

export function recordRepair({
  historyFile,
  finding,
  strategy,
  failureSignature = null,
  repairActionCode = null,
  filesChanged = [],
  beforeHashes = {},
  afterHashes = {},
  regressionTest,
  result,
  postRepairDelta = {},
}) {
  const path = resolve(historyFile);
  const history = readHistory(path);
  const classification = classifyFinding(finding);
  if (history.some((entry) => (
    entry.classification === classification
    && entry.strategy === strategy
    && entry.result === "failed"
  ))) {
    throw new Error(`Refusing to repeat ineffective repair strategy: ${classification}/${strategy}`);
  }
  if (result === "passed" && !String(regressionTest || "").trim()) {
    throw new Error("A passed repair requires a named regression test");
  }
  if (!String(repairActionCode || "").trim()) {
    throw new Error("A repair requires a machine-readable repairActionCode");
  }
  const changed = filesChanged.map((file) => String(file).replace(/\\/g, "/"));
  const reportOnly = changed.length > 0 && changed.every((file) => (
    file.startsWith("react/reports/")
    || file.startsWith("reports/")
    || file.startsWith("proof/")
    || file.endsWith("/.cloner/invocation.json")
    || file === ".cloner/invocation.json"
  ));
  if (reportOnly) throw new Error("Report edit is not a repair; change source, assets, or tests and regenerate reports");
  const previous = history.at(-1) || null;
  const record = {
    findingId: finding?.id || finding?.code || `finding-${history.length + 1}`,
    findingCode: finding?.code || "unknown",
    classification,
    strategy,
    failureSignature,
    previousFailureSignature: previous?.failureSignature || null,
    attempt: history.filter((entry) => entry.failureSignature === failureSignature).length + 1,
    repairActionCode,
    filesChanged,
    changedArtifacts: filesChanged,
    beforeHashes,
    afterHashes,
    regressionTest: regressionTest || null,
    result,
    postRepairDelta,
    converged: result === "passed",
    recordedAt: new Date().toISOString(),
  };
  history.push(record);
  ensureDir(dirname(path));
  writeText(path, safeJson(history));
  return record;
}
