#!/usr/bin/env node
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { webcrack } from "webcrack";
import { parseArgs, readText, safeJson, writeText } from "./lib.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function webcrackVersion() {
  const packageJson = JSON.parse(readText(new URL("./node_modules/webcrack/package.json", import.meta.url)));
  return packageJson.version;
}

export async function decompileBundle({ input, output, report }) {
  const inputPath = resolve(input);
  const outputPath = resolve(output);
  const reportPath = resolve(report);
  const captured = readText(inputPath);
  const result = await webcrack(captured, {
    deobfuscate: true,
    jsx: true,
    mangle: false,
    unpack: true,
    unminify: true,
  });
  const source = `${result.code.trim()}\n`;
  writeText(outputPath, source);
  const provenance = {
    input: basename(inputPath),
    output: basename(outputPath),
    inputSha256: sha256(captured),
    outputSha256: sha256(source),
    sourceMapUsed: false,
    bundleUnpacked: Boolean(result.bundle),
    tool: "webcrack",
    toolVersion: webcrackVersion(),
  };
  writeText(reportPath, safeJson(provenance));
  return provenance;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.output || !args.report) {
    console.error("Usage: decompile-bundle.mjs --input BUNDLE --output SOURCE --report REPORT");
    process.exit(2);
  }
  try {
    const provenance = await decompileBundle({
      input: String(args.input),
      output: String(args.output),
      report: String(args.report),
    });
    console.log(`Decompiled ${provenance.input} with ${provenance.tool}@${provenance.toolVersion}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  }
}
