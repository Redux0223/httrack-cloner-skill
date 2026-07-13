#!/usr/bin/env node
import { existsSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import {
  classifyBootstrapScript,
  listFiles,
  parseArgs,
  readText,
  safeJson,
  toPosix,
  writeText,
} from "./lib.mjs";
import { discoverRuntimeAssetReferences } from "./runtime-asset-references.mjs";

function normalizePublicPath(value) {
  let path = String(value || "").split("#")[0].split("?")[0].replace(/^~+/, "").replace(/^\/+/, "");
  try {
    path = decodeURIComponent(path);
  } catch {}
  return path;
}

function inspectScript(path, source) {
  const runtimeReferences = discoverRuntimeAssetReferences(source).references;
  const dynamicScriptTargets = runtimeReferences
    .filter((reference) => /[.]m?js(?:[?#].*)?$/i.test(reference))
    .map(normalizePublicPath)
    .filter(Boolean);
  const createsScript = /createElement\(\s*["']script["']/.test(source);
  const touchesVisibleDom = /createElement\(\s*["'](?:canvas|button|form|input|main|section|div)["']|appendChild|innerHTML|insertAdjacentHTML/.test(source);
  const createsWorker = /new\s+(?:SharedWorker|Worker)\s*\(/.test(source);
  const hasCanvasOrWebGl = /createElement\(\s*["']canvas["']|getContext\(\s*["'](?:webgl|webgl2)|WebGLRenderer/.test(source);
  const topLevelCalls = [...source.matchAll(/(?:^|[;{}]\s*)([A-Za-z_$][\w$]*(?:[.][A-Za-z_$][\w$]*)*)\s*\(/gm)]
    .slice(0, 200)
    .map((match) => match[1]);
  return {
    path,
    bytes: Buffer.byteLength(source),
    createsScript,
    touchesVisibleDom,
    createsWorker,
    hasCanvasOrWebGl,
    dynamicScriptTargets: [...new Set(dynamicScriptTargets)],
    topLevelCalls: [...new Set(topLevelCalls)],
  };
}

export function extractBootstrapContract(project) {
  const root = resolve(project);
  const publicRoot = join(root, "public");
  const manifestPath = join(root, "reports/conversion-manifest.json");
  const behaviorPath = join(root, "reports/behavior-contracts.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readText(manifestPath)) : {};
  const behavior = existsSync(behaviorPath) ? JSON.parse(readText(behaviorPath)) : {};
  const publicScripts = existsSync(publicRoot)
    ? listFiles(publicRoot).filter((file) => [".js", ".mjs", ".cjs"].includes(extname(file).toLowerCase()))
    : [];
  const scriptByPath = new Map(publicScripts.map((file) => {
    const path = toPosix(relative(publicRoot, file));
    return [path, inspectScript(path, readText(file))];
  }));

  const legacyEntries = (manifest.legacyScripts || []).map((legacy) => {
    const loaderPath = normalizePublicPath(legacy.src);
    const inspected = scriptByPath.get(loaderPath) || {
      path: loaderPath,
      bytes: 0,
      createsScript: false,
      touchesVisibleDom: false,
      createsWorker: false,
      hasCanvasOrWebGl: false,
      dynamicScriptTargets: [],
      topLevelCalls: [],
    };
    const targets = inspected.dynamicScriptTargets.map((path) => {
      const target = scriptByPath.get(path);
      return {
        path,
        exists: Boolean(target),
        classification: target
          ? (target.hasCanvasOrWebGl || target.createsWorker || target.touchesVisibleDom ? "application-bootstrap" : "runtime-script")
          : "missing",
      };
    });
    const classification = inspected.createsScript && targets.length > 0
      ? "application-bootstrap-loader"
      : inspected.touchesVisibleDom || inspected.hasCanvasOrWebGl
        ? "application-bootstrap"
        : "unknown-script";
    return {
      route: legacy.route,
      loader: loaderPath,
      classification,
      dynamicScriptTargets: targets,
      topLevelCalls: inspected.topLevelCalls,
      globalSideEffects: {
        touchesVisibleDom: inspected.touchesVisibleDom,
        createsWorker: inspected.createsWorker,
        hasCanvasOrWebGl: inspected.hasCanvasOrWebGl,
      },
    };
  });

  const candidatePaths = new Set(legacyEntries.flatMap((entry) => entry.dynamicScriptTargets.map((target) => target.path)));
  for (const [path, inspected] of scriptByPath) {
    const classified = classifyBootstrapScript(path, path.endsWith(".mjs") ? "module" : "text/javascript");
    if (classified === "business-bootstrap" || /(?:^|\/)(?:app|main|index)[.-][^/]+[.]m?js$/i.test(path)) {
      if (inspected.touchesVisibleDom || inspected.hasCanvasOrWebGl || inspected.createsWorker) candidatePaths.add(path);
    }
  }
  const bootstrapCandidates = [...candidatePaths].sort().map((path) => {
    const inspected = scriptByPath.get(path);
    return {
      path,
      exists: Boolean(inspected),
      touchesVisibleDom: Boolean(inspected?.touchesVisibleDom),
      createsWorker: Boolean(inspected?.createsWorker),
      hasCanvasOrWebGl: Boolean(inspected?.hasCanvasOrWebGl),
      topLevelCalls: inspected?.topLevelCalls || [],
    };
  });
  const runtimeEngineEvidence = {
    canvas: Number(behavior.summary?.canvas || 0),
    workers: Number(behavior.summary?.workers || 0),
  };
  const contract = {
    schemaVersion: 1,
    legacyEntries,
    bootstrapCandidates,
    runtimeEngineEvidence,
    unresolvedTargets: legacyEntries.flatMap((entry) => entry.dynamicScriptTargets.filter((target) => !target.exists)),
  };
  writeText(join(root, "reports/bootstrap-contract.json"), safeJson(contract));
  writeText(join(root, "reports/legacy-classification.json"), safeJson({
    schemaVersion: 1,
    entries: legacyEntries.map(({ route, loader, classification, dynamicScriptTargets, globalSideEffects }) => ({
      route,
      loader,
      classification,
      dynamicScriptTargets,
      globalSideEffects,
    })),
  }));
  return contract;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) {
    console.error("Usage: extract-bootstrap-contract.mjs --project PROJECT");
    process.exit(2);
  }
  const contract = extractBootstrapContract(String(args.project));
  console.log(`Bootstrap contract: ${contract.legacyEntries.length} legacy loader(s), ${contract.bootstrapCandidates.length} candidate(s).`);
}
