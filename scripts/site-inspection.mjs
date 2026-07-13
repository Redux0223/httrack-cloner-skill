import { extname, join, relative } from "node:path";
import {
  classifyAssetContent,
  classifyBootstrapScript,
  listFiles,
  readText,
  safeJson,
  toPosix,
  writeText,
} from "./lib.mjs";
import { analyzeBehavior } from "./runtime-analysis.mjs";

const SUMMARY_KEYS = [
  "events",
  "animationFrames",
  "timers",
  "observers",
  "storage",
  "history",
  "forms",
  "media",
  "canvas",
  "workers",
  "domSelectors",
  "cleanupRequirements",
];

export function inspectGeneratedSite({ output, publicRoot, pageRecords }) {
  const scripts = listFiles(publicRoot)
    .filter((file) => [".js", ".mjs", ".cjs"].includes(extname(file).toLowerCase()))
    .map((file) => {
      const path = toPosix(relative(output, file));
      const contentSignature = classifyAssetContent(readText(file), { expectedExtension: extname(file) });
      return {
        path,
        classification: contentSignature === "json"
          ? "inert-data"
          : classifyBootstrapScript(path, path.endsWith(".mjs") ? "module" : "text/javascript"),
        contentSignature,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));

  const files = scripts.map((script) => {
    const file = join(output, ...script.path.split("/"));
    if (script.contentSignature !== "javascript" && script.contentSignature !== "empty") {
      return {
        file: script.path,
        contentSignature: script.contentSignature,
        detectedLanguage: script.contentSignature,
        interactionFamilies: [],
      };
    }
    try {
      return {
        file: script.path,
        contentSignature: script.contentSignature,
        detectedLanguage: "javascript",
        ...analyzeBehavior(readText(file)),
      };
    } catch (error) {
      return {
        file: script.path,
        contentSignature: script.contentSignature,
        detectedLanguage: "javascript",
        parseError: error.message,
      };
    }
  });

  const summary = Object.fromEntries(SUMMARY_KEYS.map((key) => [
    key,
    files.reduce((total, file) => total + (Array.isArray(file[key]) ? file[key].length : 0), 0),
  ]));
  summary.interactionFamilies = [...new Set(files.flatMap((file) => file.interactionFamilies || []))].sort();
  summary.blockingInteractionFamilies = summary.interactionFamilies.filter((family) => family === "press-and-hold");
  summary.parseErrorFiles = files.filter((file) => file.parseError).length;
  summary.unknownScriptFiles = scripts.filter((script) => script.classification.startsWith("unknown-")).length;
  const inspection = {
    routes: pageRecords.map((page) => page.route),
    pages: pageRecords.map((page) => ({
      route: page.route,
      title: page.title,
      heading: page.heading,
      sourceFile: page.pageFile ? toPosix(relative(output, page.pageFile)) : null,
    })),
    scripts,
  };
  const contracts = { summary, files };

  writeText(join(output, "reports/site-inspection.json"), safeJson(inspection));
  writeText(join(output, "reports/behavior-contracts.json"), safeJson(contracts));
  return { inspection, contracts };
}
