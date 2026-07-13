#!/usr/bin/env node
import { existsSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import {
  classifyBootstrapScript,
  listFiles,
  parseArgs,
  readText,
  safeJson,
  toPosix,
  writeText,
} from "./lib.mjs";
import { findJsxOpeningElements } from "./jsx-source-analysis.mjs";
import { analyzeBehavior } from "./runtime-analysis.mjs";

function filesUnder(path) {
  return existsSync(path) ? listFiles(path) : [];
}

function textFiles(root, path) {
  return filesUnder(path)
    .filter((file) => [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"].includes(extname(file).toLowerCase()))
    .map((file) => ({
      file,
      path: toPosix(relative(root, file)),
      source: readText(file),
    }));
}

const NON_VISIBLE_INTRINSIC_ELEMENTS = new Set(["link", "meta", "noscript", "script", "style", "title"]);

function visibleIntrinsicElementCount(source) {
  return findJsxOpeningElements(source).filter((element) => !NON_VISIBLE_INTRINSIC_ELEMENTS.has(element.tag)).length;
}

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

function reachableVisibleElementCount(entry, sourceByFile) {
  const visited = new Set();
  const queue = [entry];
  let count = 0;
  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const source = sourceByFile.get(file);
    if (source === undefined) continue;
    count += visibleIntrinsicElementCount(source);
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)) {
      const imported = resolveLocalImport(file, match[1], sourceByFile);
      if (imported) queue.push(imported);
    }
  }
  return count;
}

function implementedMethodBodies(source, method) {
  const bodies = [];
  const patterns = [
    new RegExp(`(?:async\\s+)?${method}\\s*\\([^)]*\\)\\s*(?::[^={;\\n]+)?\\s*\\{([\\s\\S]*?)\\}`, "g"),
    new RegExp(`${method}\\s*:\\s*(?:async\\s*)?\\([^)]*\\)\\s*(?::[^=;\\n]+)?=>\\s*\\{([\\s\\S]*?)\\}`, "g"),
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) bodies.push(match[1]);
  }
  return bodies;
}

function meaningfulMethodBody(body) {
  const normalized = String(body)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\bvoid\s+0\s*;?/g, "")
    .replace(/\breturn\s*;?/g, "")
    .replace(/[\s;]+/g, "");
  return normalized.length > 0;
}

function capturedRuntimeEvidence(root) {
  const mirrorRoot = join(root, "..", "mirror");
  if (basename(root) !== "react" || !existsSync(mirrorRoot)) return { canvas: 0, workers: 0, files: [] };
  const files = filesUnder(mirrorRoot)
    .filter((file) => [".js", ".mjs", ".cjs"].includes(extname(file).toLowerCase()))
    .flatMap((file) => {
      const path = toPosix(relative(mirrorRoot, file));
      const classification = classifyBootstrapScript(path, path.endsWith(".mjs") ? "module" : "text/javascript");
      if (classification !== "business-bootstrap") return [];
      try {
        const behavior = analyzeBehavior(readText(file));
        return [{ path, canvas: behavior.canvas.length, workers: behavior.workers.length }];
      } catch {
        return [];
      }
    });
  return {
    canvas: files.reduce((total, entry) => total + entry.canvas, 0),
    workers: files.reduce((total, entry) => total + entry.workers, 0),
    files,
  };
}

export function verifyArchitecture(project) {
  const root = resolve(project);
  const packagePath = join(root, "package.json");
  const packageJson = existsSync(packagePath) ? JSON.parse(readText(packagePath)) : {};
  const conversionManifestPath = join(root, "reports/conversion-manifest.json");
  const conversionManifest = existsSync(conversionManifestPath) ? JSON.parse(readText(conversionManifestPath)) : {};
  const siteInspectionPath = join(root, "reports/site-inspection.json");
  const siteInspection = existsSync(siteInspectionPath) ? JSON.parse(readText(siteInspectionPath)) : {};
  const behaviorContractsPath = join(root, "reports/behavior-contracts.json");
  const behaviorContracts = existsSync(behaviorContractsPath) ? JSON.parse(readText(behaviorContractsPath)) : {};
  const sourceFiles = textFiles(root, join(root, "src"));
  const publicFiles = filesUnder(join(root, "public"))
    .filter((file) => /[.]m?js(?:[.][a-z0-9_-]+)*$/i.test(file))
    .map((file) => ({ file, path: toPosix(relative(root, file)), source: readText(file) }));
  const allSource = sourceFiles.map((entry) => entry.source).join("\n");

  const tanstackRouter = Boolean(packageJson.dependencies?.["@tanstack/react-router"])
    && /\bRouterProvider\b/.test(allSource)
    && /\bcreateFileRoute\b/.test(allSource);
  const dynamicScriptInjection = sourceFiles
    .filter((entry) => /createElement\(\s*["']script["']|appendChild\(\s*script\b|LegacyScripts|data-legacy-route/.test(entry.source))
    .map((entry) => ({ file: entry.path }));
  const businessBootstrapBundles = publicFiles
    .filter((entry) => classifyBootstrapScript(entry.path, entry.path.endsWith(".mjs") ? "module" : "text/javascript") === "business-bootstrap")
    .map((entry) => ({ file: entry.path }));
  const legacyMarkers = sourceFiles
    .filter((entry) => /\bLegacyScripts\b|legacyScripts|legacy-script-adapter/.test(entry.source))
    .map((entry) => ({ file: entry.path }));
  const capturedLegacyScripts = Array.isArray(conversionManifest.legacyScripts)
    ? conversionManifest.legacyScripts
    : [];
  const sourceByFile = new Map(sourceFiles.map((entry) => [entry.file, entry.source]));
  const pageByRoute = new Map((siteInspection.pages || []).map((page) => [page.route, page]));
  const bootstrapOwnedShells = capturedLegacyScripts.flatMap((legacy) => {
    const sourceFile = pageByRoute.get(legacy.route)?.sourceFile;
    if (!sourceFile) return [];
    const absolute = resolve(root, sourceFile);
    const visibleElements = reachableVisibleElementCount(absolute, sourceByFile);
    return visibleElements === 0 ? [{ route: legacy.route, sourceFile, legacyScript: legacy.src, visibleElements }] : [];
  });

  const engineEntries = sourceFiles.filter((entry) => /(?:^|\/)src\/engines\/[^/]+\/index[.]tsx?$/.test(entry.path));
  const engineContracts = engineEntries.map((entry) => {
    const required = ["start", "resize", "dispatch", "snapshot", "destroy"];
    const bodies = Object.fromEntries(required.map((method) => [method, implementedMethodBodies(entry.source, method)]));
    const missing = required.filter((method) => bodies[method].length === 0);
    const placeholder = required.filter((method) => method !== "snapshot" && bodies[method].length > 0 && !bodies[method].some(meaningfulMethodBody));
    return { file: entry.path, passed: missing.length === 0 && placeholder.length === 0, missing, placeholder };
  });
  const capturedRuntime = capturedRuntimeEvidence(root);
  const runtimeEngineEvidence = {
    canvas: Math.max(Number(behaviorContracts.summary?.canvas || 0), capturedRuntime.canvas),
    workers: Math.max(Number(behaviorContracts.summary?.workers || 0), capturedRuntime.workers),
    capturedFiles: capturedRuntime.files,
  };
  const engineRequired = runtimeEngineEvidence.canvas > 0
    || runtimeEngineEvidence.workers > 0
    || /<canvas\b|getContext\(\s*["'](?:webgl|webgl2)|WebGLRenderer/.test(allSource);
  const visibleDomOwnedImperatively = /document[.]body[.]appendChild|document[.]body[.]innerHTML|insertAdjacentHTML/.test(allSource);
  const reactOwnsVisibleDom = !visibleDomOwnedImperatively && bootstrapOwnedShells.length === 0;
  const engineSource = engineEntries.map((entry) => entry.source).join("\n");
  const reactSourceOutsideEngines = sourceFiles.filter((entry) => !engineEntries.includes(entry)).map((entry) => entry.source).join("\n");
  const engineMounted = engineEntries.length > 0
    && /from\s*["'][^"']*engines\//.test(reactSourceOutsideEngines)
    && /[.]start\s*\(/.test(reactSourceOutsideEngines)
    && /[.]destroy\s*\(/.test(reactSourceOutsideEngines);
  const runtimeCanvasSurfacePresent = runtimeEngineEvidence.canvas === 0
    || (/<canvas\b/.test(reactSourceOutsideEngines) && /getContext\s*\(|WebGLRenderer|renderer/.test(engineSource));
  const runtimeWorkerCleanupPresent = runtimeEngineEvidence.workers === 0 || /[.]terminate\s*\(/.test(engineSource);
  const runtimeRenderOutputPresent = runtimeEngineEvidence.canvas === 0 || /\b(?:drawImage|fillRect|strokeRect|clearRect|fillText|strokeText|putImageData|drawArrays|drawElements|clear|render)\s*\(/.test(engineSource);
  const capturedBootstrapReplacementProven = capturedRuntime.files.length === 0 || runtimeRenderOutputPresent;

  const findings = [];
  if (!tanstackRouter) findings.push({ code: "tanstack-router-missing" });
  if (dynamicScriptInjection.length > 0) findings.push({ code: "dynamic-script-injection" });
  if (businessBootstrapBundles.length > 0) findings.push({ code: "business-bootstrap-bundle" });
  if (legacyMarkers.length > 0) findings.push({ code: "legacy-adapter-marker" });
  if (capturedLegacyScripts.length > 0) findings.push({ code: "captured-legacy-script-not-reconstructed" });
  if (bootstrapOwnedShells.length > 0) findings.push({ code: "bootstrap-owned-shell", routes: bootstrapOwnedShells.map((entry) => entry.route) });
  if (!reactOwnsVisibleDom) findings.push({ code: "visible-dom-owned-outside-react" });
  if (engineRequired && engineContracts.length === 0) {
    findings.push({
      code: runtimeEngineEvidence.canvas > 0 || runtimeEngineEvidence.workers > 0
        ? "runtime-engine-present-but-unisolated"
        : "engine-contract-missing",
    });
  }
  if (engineContracts.some((entry) => !entry.passed)) findings.push({ code: "engine-contract-incomplete" });
  if (engineContracts.some((entry) => entry.placeholder.length > 0)) findings.push({
    code: "engine-contract-placeholder",
    methods: engineContracts.flatMap((entry) => entry.placeholder),
  });
  if (engineRequired && engineContracts.length > 0 && !engineMounted) findings.push({ code: "engine-contract-unmounted" });
  if (!runtimeCanvasSurfacePresent) findings.push({ code: "runtime-canvas-surface-missing" });
  if (!runtimeWorkerCleanupPresent) findings.push({ code: "runtime-worker-cleanup-missing" });
  if (engineRequired && engineContracts.length > 0 && !runtimeRenderOutputPresent) findings.push({ code: "engine-runtime-placeholder" });
  if (!capturedBootstrapReplacementProven) findings.push({ code: "captured-bootstrap-replacement-unproven" });

  const report = {
    passed: findings.length === 0,
    tanstackRouter,
    reactOwnsVisibleDom,
    businessBootstrapBundles,
    dynamicScriptInjection,
    legacyMarkers,
    capturedLegacyScripts,
    bootstrapOwnedShells,
    runtimeEngineEvidence,
    engineMounted,
    runtimeCanvasSurfacePresent,
    runtimeWorkerCleanupPresent,
    runtimeRenderOutputPresent,
    capturedBootstrapReplacementProven,
    engineContracts,
    findings,
  };
  writeText(join(root, "reports/architecture-verification.json"), safeJson(report));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) {
    console.error("Usage: verify-architecture.mjs --project PROJECT");
    process.exit(2);
  }
  const report = verifyArchitecture(String(args.project));
  if (!report.passed) {
    console.error(`Architecture verification failed with ${report.findings.length} finding(s).`);
    process.exit(3);
  }
  console.log("Architecture verification passed.");
}
