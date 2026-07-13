#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { listFiles, parseArgs, safeJson, toPosix, writeText } from "./lib.mjs";
import { analyzeJavaScript, findCredentials, isLoopbackUrl } from "./runtime-analysis.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.project) {
  console.error("Usage: verify-no-external.mjs --project REACT_PROJECT");
  process.exit(2);
}

const project = resolve(String(args.project));
const manifestPath = join(project, "reports/conversion-manifest.json");
if (!existsSync(manifestPath)) throw new Error(`Missing conversion manifest: ${manifestPath}`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const runtimeFiles = new Set();

if (existsSync(join(project, "index.html"))) runtimeFiles.add(join(project, "index.html"));
for (const directory of ["src", "public", "dist"]) {
  const root = join(project, directory);
  if (!existsSync(root)) continue;
  for (const file of listFiles(root)) runtimeFiles.add(file);
}

const textExtensions = new Set([".css", ".htm", ".html", ".js", ".jsx", ".mjs", ".cjs", ".svg"]);
const resourcePatterns = [
  { kind: "css-url", regex: /url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)/gi },
  { kind: "css-import", regex: /@import\s+(?:url\()?\s*["']((?:https?:)?\/\/[^"')\s]+)/gi },
  { kind: "script-src", regex: /<script[^>]+src=["']((?:https?:)?\/\/[^"']+)/gi },
  { kind: "stylesheet", regex: /<link(?=[^>]+rel=["'](?:stylesheet|preload|modulepreload)["'])[^>]+href=["']((?:https?:)?\/\/[^"']+)/gi },
  { kind: "stylesheet", regex: /<link(?=[^>]+href=["']((?:https?:)?\/\/[^"']+)["'])[^>]+rel=["'](?:stylesheet|preload|modulepreload)["']/gi },
  { kind: "media-src", regex: /<(?:img|source|video|audio|iframe)[^>]+(?:src|poster)=["']((?:https?:)?\/\/[^"']+)/gi },
  { kind: "form-action", regex: /<form[^>]+action=["']((?:https?:)?\/\/[^"']+)/gi },
];

const findings = [];
const navigationWarnings = [];
const unknownRemoteLiterals = [];
const parseErrors = [];
const credentialFindings = [];

function lineFor(text, index) {
  return text.slice(0, index).split("\n").length;
}

for (const file of runtimeFiles) {
  const extension = extname(file).toLowerCase();
  if (!textExtensions.has(extension)) continue;
  const text = readFileSync(file, "utf8");
  const fileLabel = toPosix(relative(project, file));

  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    try {
      const analysis = analyzeJavaScript(text);
      findings.push(...analysis.automatic.map(({ origins, ...finding }) => ({ file: fileLabel, ...finding })));
      navigationWarnings.push(...analysis.navigation.map(({ origins, ...finding }) => ({ file: fileLabel, ...finding })));
      unknownRemoteLiterals.push(...analysis.unknown.map(({ node, ...finding }) => ({ file: fileLabel, ...finding })));
      credentialFindings.push(...findCredentials(text).map((finding) => ({ file: fileLabel, ...finding })));
    } catch (error) {
      parseErrors.push({ file: fileLabel, error: error.message });
    }
  }

  for (const { kind, regex } of resourcePatterns) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      const url = [...match].slice(1).find(Boolean);
      if (!url || isLoopbackUrl(url)) continue;
      findings.push({ kind, file: fileLabel, line: lineFor(text, match.index), column: 1, url });
    }
  }
}

const manifestDiagnostics = (manifest.runtimeExternalReferences || [])
  .filter((finding) => !isLoopbackUrl(finding.url))
  .map((finding) => ({ kind: "manifest-unresolved", file: "reports/conversion-manifest.json", ...finding }));

const report = {
  checkedFiles: [...runtimeFiles].map((file) => toPosix(relative(project, file))).sort(),
  findings,
  navigationWarnings,
  unknownRemoteLiterals,
  manifestDiagnostics,
  parseErrors,
  credentialFindings,
  passed: (
    findings.length === 0
    && (!args.strict || navigationWarnings.length === 0)
    && (!args.strict || unknownRemoteLiterals.length === 0)
    && (!args.strict || manifestDiagnostics.length === 0)
    && parseErrors.length === 0
    && credentialFindings.length === 0
  ),
};
writeText(join(project, "reports/no-external-runtime.json"), safeJson(report));

if (!report.passed) {
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line || 1} ${finding.kind} ${finding.url || finding.error || "unresolved"}`);
  }
  for (const error of parseErrors) console.error(`${error.file}:1 parse-error ${error.error}`);
  for (const finding of credentialFindings) console.error(`${finding.file}:${finding.line} credential ${finding.kind} ${finding.fingerprint}`);
  for (const finding of navigationWarnings) console.error(`${finding.file}:${finding.line} outbound-navigation ${finding.url}`);
  for (const finding of unknownRemoteLiterals) console.error(`${finding.file}:${finding.line} remote-literal ${finding.url}`);
  for (const finding of manifestDiagnostics) console.error(`${finding.file}:${finding.line || 1} manifest-unresolved ${finding.url || finding.cause || "unknown"}`);
  process.exit(3);
}
console.log(`No automatic external runtime requests found in ${runtimeFiles.size} file(s).`);
