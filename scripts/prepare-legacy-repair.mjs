#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { decompileBundle } from "./decompile-bundle.mjs";
import { parseArgs, readText, safeJson, writeText } from "./lib.mjs";

export async function prepareLegacyRepair({ project, work }) {
  const projectRoot = resolve(project);
  const workRoot = resolve(work);
  const contractPath = join(projectRoot, "reports/bootstrap-contract.json");
  const output = join(workRoot, ".cloner/decompiled/main.js");
  const provenancePath = join(workRoot, ".cloner/decompiled/report.json");
  const preparationPath = join(workRoot, ".cloner/legacy-repair-preparation.json");
  const contract = existsSync(contractPath) ? JSON.parse(readText(contractPath)) : { bootstrapCandidates: [] };
  const candidate = (contract.bootstrapCandidates || []).find((entry) => entry.exists && existsSync(join(projectRoot, "public", entry.path)));
  if (!candidate) {
    const report = { schemaVersion: 1, prepared: false, reason: "bootstrap-candidate-missing" };
    writeText(preparationPath, safeJson(report));
    return report;
  }
  const input = join(projectRoot, "public", candidate.path);
  const provenance = existsSync(output) && existsSync(provenancePath)
    ? JSON.parse(readText(provenancePath))
    : await decompileBundle({ input, output, report: provenancePath });
  const report = {
    schemaVersion: 1,
    prepared: true,
    candidate: candidate.path,
    input,
    output,
    provenance: provenancePath,
    inputSha256: provenance.inputSha256,
    outputSha256: provenance.outputSha256,
  };
  writeText(preparationPath, safeJson(report));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.work) {
    console.error("Usage: prepare-legacy-repair.mjs --project PROJECT --work RUN_DIR");
    process.exit(2);
  }
  const report = await prepareLegacyRepair({ project: String(args.project), work: String(args.work) });
  console.log(report.prepared ? `Prepared ${report.candidate} at ${report.output}.` : `Legacy repair preparation skipped: ${report.reason}.`);
}
