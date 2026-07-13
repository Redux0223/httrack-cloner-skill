#!/usr/bin/env node
import { existsSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { listFiles, parseArgs, readText, safeJson, toPosix, writeText } from "./lib.mjs";
import { findJsxOpeningElements } from "./jsx-source-analysis.mjs";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const NON_VISIBLE = new Set(["link", "meta", "noscript", "script", "style", "title"]);
const INTERACTIVE = new Set(["a", "audio", "button", "details", "input", "select", "summary", "textarea", "video"]);
const FORM_CONTROLS = new Set(["input", "select", "textarea"]);
const MEDIA_ELEMENTS = new Set(["audio", "video"]);

function resolveLocalImport(fromFile, specifier, sourceByFile) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(fromFile, "..", specifier);
  const candidates = [
    base,
    ...[".tsx", ".ts", ".jsx", ".js"].map((extension) => `${base}${extension}`),
    ...[".tsx", ".ts", ".jsx", ".js"].map((extension) => join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => sourceByFile.has(candidate)) || null;
}

function selectorFor(tag, attributes) {
  const id = attributes.match(/\bid\s*=\s*["']([^"']+)["']/)?.[1];
  if (id) return `#${id}`;
  const testId = attributes.match(/\bdata-testid\s*=\s*["']([^"']+)["']/)?.[1];
  if (testId) return `[data-testid="${testId}"]`;
  const name = attributes.match(/\bname\s*=\s*["']([^"']+)["']/)?.[1];
  if (name) return `${tag}[name="${name}"]`;
  return tag;
}

function inspectSource(source) {
  const visibleTags = [];
  const interactiveSelectors = [];
  const canvasSelectors = [];
  const formSelectors = [];
  const mediaSelectors = [];
  for (const element of findJsxOpeningElements(source)) {
    const { tag, attributes } = element;
    if (NON_VISIBLE.has(tag)) continue;
    visibleTags.push(tag);
    const selector = selectorFor(tag, attributes);
    if (tag === "canvas") canvasSelectors.push(selector);
    if (INTERACTIVE.has(tag) || /\brole\s*=\s*["']button["']/.test(attributes)) interactiveSelectors.push(selector);
    if (FORM_CONTROLS.has(tag)) formSelectors.push(selector);
    if (MEDIA_ELEMENTS.has(tag)) mediaSelectors.push(selector);
  }
  return {
    visibleTags,
    interactiveSelectors,
    canvasSelectors,
    formSelectors,
    mediaSelectors,
    bodyClassWrites: [...source.matchAll(/document[.]body[.]class(?:Name|List)\b/g)].length,
    overflowWrites: [...source.matchAll(/(?:document[.]body|document[.]documentElement)[.]style[.]overflow\b/g)].length,
  };
}

export function extractReactOwnedUi(project) {
  const root = resolve(project);
  const srcRoot = join(root, "src");
  const sourceFiles = existsSync(srcRoot)
    ? listFiles(srcRoot).filter((file) => SOURCE_EXTENSIONS.has(extname(file).toLowerCase()))
    : [];
  const sourceByFile = new Map(sourceFiles.map((file) => [file, readText(file)]));
  const siteInspectionPath = join(root, "reports/site-inspection.json");
  const siteInspection = existsSync(siteInspectionPath) ? JSON.parse(readText(siteInspectionPath)) : { pages: [] };

  const routes = (siteInspection.pages || []).map((page) => {
    const entry = resolve(root, page.sourceFile || "");
    const queue = [entry];
    const visited = new Set();
    const visibleTags = [];
    const interactiveSelectors = [];
    const canvasSelectors = [];
    const formSelectors = [];
    const mediaSelectors = [];
    let bodyClassWrites = 0;
    let overflowWrites = 0;
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file || visited.has(file) || !sourceByFile.has(file)) continue;
      visited.add(file);
      const source = sourceByFile.get(file);
      const inspected = inspectSource(source);
      visibleTags.push(...inspected.visibleTags);
      interactiveSelectors.push(...inspected.interactiveSelectors);
      canvasSelectors.push(...inspected.canvasSelectors);
      formSelectors.push(...inspected.formSelectors);
      mediaSelectors.push(...inspected.mediaSelectors);
      bodyClassWrites += inspected.bodyClassWrites;
      overflowWrites += inspected.overflowWrites;
      for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)) {
        const imported = resolveLocalImport(file, match[1], sourceByFile);
        if (imported) queue.push(imported);
      }
    }
    return {
      route: page.route,
      sourceFile: page.sourceFile,
      reachableFiles: [...visited].map((file) => toPosix(relative(root, file))).sort(),
      visibleElements: visibleTags.length,
      visibleTags,
      interactiveSelectors: [...new Set(interactiveSelectors)],
      canvasSelectors: [...new Set(canvasSelectors)],
      formSelectors: [...new Set(formSelectors)],
      mediaSelectors: [...new Set(mediaSelectors)],
      globalUi: { bodyClassWrites, overflowWrites },
    };
  });

  const report = {
    schemaVersion: 1,
    routes,
    summary: {
      routes: routes.length,
      emptyRoutes: routes.filter((route) => route.visibleElements === 0).length,
      visibleElements: routes.reduce((total, route) => total + route.visibleElements, 0),
      interactiveSelectors: routes.reduce((total, route) => total + route.interactiveSelectors.length, 0),
      canvasMounts: routes.reduce((total, route) => total + route.canvasSelectors.length, 0),
    },
  };
  writeText(join(root, "reports/react-owned-ui.json"), safeJson(report));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) {
    console.error("Usage: extract-react-owned-ui.mjs --project PROJECT");
    process.exit(2);
  }
  const report = extractReactOwnedUi(String(args.project));
  console.log(`React-owned UI: ${report.summary.visibleElements} visible element(s) across ${report.summary.routes} route(s).`);
}
