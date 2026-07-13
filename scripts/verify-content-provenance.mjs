#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { listFiles, parseArgs, readText, safeJson, writeText } from "./lib.mjs";

const EVIDENCE_EXTENSIONS = new Set([".css", ".htm", ".html", ".js", ".json", ".md", ".svg", ".txt"]);

function normalize(value) {
  return String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function decodeQuoted(quote, value) {
  try {
    if (quote === '"') return JSON.parse(`"${value}"`);
  } catch {}
  return value.replace(/\\([\\'"nrt])/g, (_match, escaped) => ({ n: "\n", r: "\r", t: "\t" }[escaped] ?? escaped));
}

function looksUserFacing(value) {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length < 4 || !/[A-Za-z]/.test(text)) return false;
  if (/^(?:https?:|data:|blob:|\/|\.\/|\.\.\/|#|\[|\{|@)/i.test(text)) return false;
  if (/^[a-z0-9_.:@/-]+$/i.test(text) && text === text.toLowerCase()) return false;
  if (/^[a-z][a-z0-9_-]*(?:\s+[a-z][a-z0-9_-]*)+$/.test(text)) return false;
  if (/^(?:application|text|image|audio|video)\//i.test(text)) return false;
  if (/[<>{}=;]/.test(text)) return false;
  return /\s/.test(text) || /^[A-Z]/.test(text);
}

function sourcePhrases(source, file) {
  const phrases = [];
  const record = (text, index) => {
    const value = String(text).replace(/\s+/g, " ").trim();
    if (!looksUserFacing(value)) return;
    const line = source.slice(0, index).split("\n").length;
    const lineSource = source.split("\n")[line - 1] || "";
    if (/^\s*(?:import|export)\b/.test(lineSource) || /\bfrom\s*["']/.test(lineSource)) return;
    phrases.push({ file, line, text: value });
  };
  if (!/[<][a-z][a-z0-9-]*\b/i.test(source)) return phrases;
  for (const match of source.matchAll(/>([^<>{}]+)</g)) record(match[1], match.index);

  const visibleAttributes = /\b(?:alt|title|placeholder|value)\s*=\s*(?:(["'])([^"'\n]*(?:\\.[^"'\n]*)*)\1|\{\s*(["'])([^"'\n]*(?:\\.[^"'\n]*)*)\3\s*\})/g;
  for (const match of source.matchAll(visibleAttributes)) {
    const quote = match[1] || match[3];
    const value = match[2] ?? match[4];
    record(decodeQuoted(quote, value), match.index);
  }

  const renderedProperties = new Set();
  const renderedIdentifiers = new Set();
  for (const match of source.matchAll(/>\s*\{([^{}]{1,800})\}\s*</g)) {
    const expression = match[1];
    for (const property of expression.matchAll(/[.]([A-Za-z_$][\w$]*)\b/g)) renderedProperties.add(property[1]);
    for (const identifier of expression.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) renderedIdentifiers.add(identifier[1]);
    for (const literal of expression.matchAll(/(["'])([^"'\n]*(?:\\.[^"'\n]*)*)\1/g)) {
      record(decodeQuoted(literal[1], literal[2]), match.index + literal.index);
    }
  }

  for (const property of renderedProperties) {
    const pattern = new RegExp(`\\b${property.replace(/[$]/g, "\\$")}\\s*:\\s*(["'])([^"'\\n]*(?:\\\\.[^"'\\n]*)*)\\1`, "g");
    for (const match of source.matchAll(pattern)) record(decodeQuoted(match[1], match[2]), match.index);
  }
  for (const identifier of renderedIdentifiers) {
    const pattern = new RegExp(`\\b(?:const|let|var)\\s+${identifier.replace(/[$]/g, "\\$")}\\s*=\\s*(["'])([^"'\\n]*(?:\\\\.[^"'\\n]*)*)\\1`, "g");
    for (const match of source.matchAll(pattern)) record(decodeQuoted(match[1], match[2]), match.index);
  }
  return phrases;
}

export function verifyContentProvenance({ project, mirror }) {
  const projectRoot = resolve(project);
  const mirrorRoot = resolve(mirror || join(projectRoot, "..", "mirror"));
  const uiPath = join(projectRoot, "reports/react-owned-ui.json");
  const ui = existsSync(uiPath) ? JSON.parse(readText(uiPath)) : { routes: [] };
  const sourcePaths = [...new Set((ui.routes || []).flatMap((route) => route.reachableFiles || []))];
  const evidenceFiles = existsSync(mirrorRoot)
    ? listFiles(mirrorRoot).filter((file) => EVIDENCE_EXTENSIONS.has(extname(file).toLowerCase()))
    : [];
  const decompiled = join(projectRoot, "..", ".cloner/decompiled/main.js");
  if (existsSync(decompiled)) evidenceFiles.push(decompiled);
  const evidenceCorpus = evidenceFiles.map((file) => normalize(readText(file))).join("\n");
  const phrases = sourcePaths.flatMap((relativePath) => {
    const file = join(projectRoot, relativePath);
    return existsSync(file) ? sourcePhrases(readText(file), relativePath) : [];
  });
  const unique = new Map();
  for (const phrase of phrases) unique.set(`${phrase.file}\0${phrase.text}`, phrase);
  const unsupported = [...unique.values()].filter((phrase) => !evidenceCorpus.includes(normalize(phrase.text)));
  const report = {
    schemaVersion: 1,
    passed: unsupported.length === 0,
    evidenceFiles: evidenceFiles.length,
    evidenceSha256: createHash("sha256").update(evidenceCorpus).digest("hex"),
    checked: [...unique.values()],
    unsupported,
  };
  writeText(join(projectRoot, "reports/content-provenance.json"), safeJson(report));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) {
    console.error("Usage: verify-content-provenance.mjs --project PROJECT [--mirror MIRROR]");
    process.exit(2);
  }
  const report = verifyContentProvenance({ project: String(args.project), mirror: args.mirror ? String(args.mirror) : undefined });
  if (!report.passed) {
    for (const finding of report.unsupported) console.error(`${finding.file}:${finding.line} unsupported visible copy: ${finding.text}`);
    process.exit(3);
  }
  console.log(`Verified ${report.checked.length} user-facing phrase(s) against ${report.evidenceFiles} captured evidence file(s).`);
}
