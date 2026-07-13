#!/usr/bin/env node
import { existsSync, renameSync } from "node:fs";
import { basename, dirname, extname, join, posix, relative, resolve, sep } from "node:path";
import { parse } from "parse5";
import {
  componentName,
  classifyAssetContent,
  copyFiles,
  ensureCleanDir,
  ensureDir,
  findSiteRoot,
  isRemote,
  isTracker,
  listFiles,
  parseArgs,
  readText,
  relativeImport,
  resolveMirrorPath,
  routeFromHtml,
  safeJson,
  toPosix,
  writeText,
} from "./lib.mjs";
import { writeTanStackProject } from "./project-generation.mjs";
import { writeAuthorizationManifest } from "./generate-authorization.mjs";
import { inspectGeneratedSite } from "./site-inspection.mjs";
import { sanitizeJavaScript } from "./runtime-analysis.mjs";

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const BOOLEAN_ATTRIBUTES = new Set([
  "allowFullScreen", "async", "autoFocus", "autoPlay", "controls", "default", "defer", "disabled", "download",
  "formNoValidate", "hidden", "itemScope", "loop", "multiple", "muted", "noValidate", "open",
  "playsInline", "readOnly", "required", "reversed",
]);
const ATTRIBUTE_MAP = new Map([
  ["class", "className"],
  ["for", "htmlFor"],
  ["charset", "charSet"],
  ["http-equiv", "httpEquiv"],
  ["tabindex", "tabIndex"],
  ["crossorigin", "crossOrigin"],
  ["referrerpolicy", "referrerPolicy"],
  ["srcset", "srcSet"],
  ["autocomplete", "autoComplete"],
  ["autoplay", "autoPlay"],
  ["playsinline", "playsInline"],
  ["readonly", "readOnly"],
  ["colspan", "colSpan"],
  ["rowspan", "rowSpan"],
  ["stroke-width", "strokeWidth"],
  ["stroke-linecap", "strokeLinecap"],
  ["stroke-linejoin", "strokeLinejoin"],
  ["fill-rule", "fillRule"],
  ["clip-rule", "clipRule"],
]);

const args = parseArgs(process.argv.slice(2));
if (!args.input || !args.output || !args["source-url"]) {
  console.error("Usage: run-pipeline.mjs --input MIRROR --output PROJECT --source-url URL");
  process.exit(2);
}

const input = resolve(String(args.input));
const output = resolve(String(args.output));
const sourceUrl = String(args["source-url"]);
const overlaps = (parent, candidate) => candidate === parent || candidate.startsWith(`${parent}${sep}`);
if (overlaps(input, output) || overlaps(output, input)) {
  throw new Error("Input and output directories must not overlap");
}
if (!existsSync(input)) throw new Error(`Input mirror does not exist: ${input}`);

const siteRoot = findSiteRoot(input, sourceUrl);
const sitePrefix = toPosix(relative(input, siteRoot));
const ignoredErrorDocuments = [];

function capturedErrorDocument(file, siteRelative) {
  try {
    const document = parse(readText(file));
    let canonical = null;
    function walk(node) {
      if (node.tagName === "link") {
        const attributes = attrMap(node);
        if (String(attributes.get("rel") || "").split(/\s+/).includes("canonical")) canonical = attributes.get("href") || null;
      }
      for (const child of node.childNodes || []) walk(child);
    }
    walk(document);
    if (!canonical) return null;
    const canonicalUrl = new URL(canonical, sourceUrl);
    if (canonicalUrl.origin !== new URL(sourceUrl).origin) return null;
    const route = routeFromHtml(siteRelative);
    const canonicalRoute = canonicalUrl.pathname.replace(/\/$/, "") || "/";
    if (canonicalRoute === route) return null;
    const title = textContent(findNode(document, "title"));
    const body = findNode(document, "body");
    const bodyClass = attrMap(body).get("class") || "";
    if (!/(?:^|\b)(?:404|error|not[- ]found)(?:\b|$)/i.test(`${title} ${bodyClass}`)) return null;
    return { siteRelative, route, canonicalRoute, title: title.trim(), bodyClass };
  } catch {
    return null;
  }
}

const capturedPages = listFiles(siteRoot)
  .filter((file) => /\.html?$/i.test(file))
  .map((file) => ({
    sourceFile: file,
    siteRelative: toPosix(relative(siteRoot, file)),
    mirrorRelative: toPosix(relative(input, file)),
  }))
  .filter((page) => !page.siteRelative.startsWith("hts-cache/"))
  .filter((page) => {
    const ignored = capturedErrorDocument(page.sourceFile, page.siteRelative);
    if (!ignored) return true;
    ignoredErrorDocuments.push(ignored);
    return false;
  })
  .sort((left, right) => left.siteRelative.localeCompare(right.siteRelative));
const ignoredErrorMirrorPaths = new Set(ignoredErrorDocuments.map((entry) => (
  sitePrefix && sitePrefix !== "." ? posix.join(sitePrefix, entry.siteRelative) : entry.siteRelative
)));

const pagesByRoute = new Map();
for (const page of capturedPages) {
  const route = routeFromHtml(page.siteRelative);
  if (!pagesByRoute.has(route)) pagesByRoute.set(route, []);
  pagesByRoute.get(route).push(page);
}
const duplicateRoutePages = [];
const pages = [...pagesByRoute.entries()].map(([route, candidates]) => {
  const ranked = [...candidates].sort((left, right) => {
    const leftIndex = /(^|\/)index\.html?$/i.test(left.siteRelative) ? 1 : 0;
    const rightIndex = /(^|\/)index\.html?$/i.test(right.siteRelative) ? 1 : 0;
    return rightIndex - leftIndex || left.siteRelative.localeCompare(right.siteRelative);
  });
  if (ranked.length > 1) {
    duplicateRoutePages.push({
      route,
      selected: ranked[0].siteRelative,
      alternatives: ranked.slice(1).map((page) => page.siteRelative),
    });
  }
  return ranked[0];
}).sort((left, right) => left.siteRelative.localeCompare(right.siteRelative));

if (pages.length === 0) throw new Error(`No HTML pages found in ${siteRoot}`);

ensureCleanDir(output);
ensureDir(join(output, "src/pages"));
ensureDir(join(output, "src/runtime"));
ensureDir(join(output, "public"));
ensureDir(join(output, "public/legacy"));
ensureDir(join(output, "reports"));

const publicRoot = join(output, "public");
const captureControlFile = (path) => (
  path.startsWith("hts-cache/")
  || path.startsWith("hts-log")
  || path.endsWith(".DS_Store")
  || ["index.html", "backblue.gif", "fade.gif", "capture-report.json", "asset-manifest.json"].includes(path)
  || /^(?:capture|dynamic-assets)-(?:stdout|stderr)\.log$/.test(path)
  || path === "dynamic-assets-report.json"
);
copyFiles(siteRoot, publicRoot, (path) => !/\.html?$/i.test(path) && !captureControlFile(path));

if (sitePrefix && sitePrefix !== ".") {
  copyFiles(input, join(publicRoot, "_external"), (path) => (
    path !== sitePrefix
    && !path.startsWith(`${sitePrefix}/`)
    && !/^[^/]+\/index\.html?$/i.test(path)
    && !captureControlFile(path)
  ));
}

const routeByHtml = new Map(capturedPages.map((page) => [page.mirrorRelative, routeFromHtml(page.siteRelative)]));
const routeOwners = new Map();
for (const page of pages) {
  const route = routeFromHtml(page.siteRelative);
  routeOwners.set(route, page.siteRelative);
}
const removedTrackers = [];
const removedExternalStyles = [];
const removedInlineHandlers = [];
const unresolvedAutomaticExternals = [];
const cssChunks = [];
const pageRecords = [];
const stubbedRemoteRequests = [];
const localizedRemoteRequests = [];
const outboundNavigations = [];
const unknownRemoteLiterals = [];
const runtimeParseErrors = [];
const redactedCredentials = [];
const removedOutboundNavigations = [];
const removedRemoteLiterals = [];
const runtimeAssetClassifications = [];
const usedComponentNames = new Set();

function encodePublicPath(path) {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function runtimePublicUrl(mirrorRelativePath) {
  const normalized = posix.normalize(mirrorRelativePath).replace(/^\.\//, "");
  if (!sitePrefix || sitePrefix === ".") return `/${encodePublicPath(normalized)}`;
  if (normalized === sitePrefix) return "/";
  if (normalized.startsWith(`${sitePrefix}/`)) {
    return `/${encodePublicPath(normalized.slice(sitePrefix.length + 1))}`;
  }
  return `/_external/${encodePublicPath(normalized)}`;
}

function findNode(root, tagName) {
  if (root.tagName === tagName) return root;
  for (const child of root.childNodes || []) {
    const found = findNode(child, tagName);
    if (found) return found;
  }
  return null;
}

function attrMap(node) {
  return new Map((node.attrs || []).map((attr) => [attr.name, attr.value]));
}

function isExecutableScriptType(type) {
  const normalized = String(type || "").split(";", 1)[0].trim().toLowerCase();
  return !normalized || [
    "module",
    "text/javascript",
    "application/javascript",
    "text/ecmascript",
    "application/ecmascript",
  ].includes(normalized);
}

function textContent(node) {
  if (!node) return "";
  if (node.nodeName === "#text") return node.value || "";
  return (node.childNodes || []).map(textContent).join("");
}

function cssPropertyName(name) {
  if (name.startsWith("--")) return JSON.stringify(name);
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function styleToJsx(value, context) {
  const entries = [];
  for (const declaration of String(value).split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim();
    let cssValue = declaration.slice(colon + 1).trim();
    if (!name || !cssValue) continue;
    cssValue = rewriteCssUrls(cssValue, context);
    entries.push(`${cssPropertyName(name)}: ${JSON.stringify(cssValue)}`);
  }
  return `{{ ${entries.join(", ")} } as React.CSSProperties}`;
}

function rewriteSrcSet(value, context) {
  return String(value)
    .split(",")
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      parts[0] = rewriteUrl(parts[0], context, "srcSet");
      return parts.join(" ");
    })
    .join(", ");
}

function rewriteUrl(value, context, attribute) {
  if (!value || value.startsWith("#") || /^(data:|blob:|mailto:|tel:|javascript:)/i.test(value)) return value;
  if (isRemote(value)) {
    if (attribute === "href" && context.tagName === "a") return value;
    if (isTracker(value)) removedTrackers.push({ page: context.page.siteRelative, value });
    else unresolvedAutomaticExternals.push({ page: context.page.siteRelative, attribute, value });
    return "";
  }
  const mirrorPath = resolveMirrorPath({ href: value, pageMirrorRel: context.page.mirrorRelative, sitePrefix });
  if (ignoredErrorMirrorPaths.has(mirrorPath)) return "";
  if (attribute === "href" && routeByHtml.has(mirrorPath)) return routeByHtml.get(mirrorPath);
  return runtimePublicUrl(mirrorPath);
}

function internalLinkTarget(node, context) {
  if (node.tagName !== "a") return null;
  const attributes = attrMap(node);
  const href = attributes.get("href");
  if (!href || attributes.has("download") || attributes.get("target")) return null;
  if (isRemote(href) || /^(?:mailto:|tel:|javascript:|data:|blob:|#)/i.test(href)) return null;
  const mirrorPath = resolveMirrorPath({ href, pageMirrorRel: context.page.mirrorRelative, sitePrefix });
  const route = routeByHtml.get(mirrorPath);
  if (!route) return null;
  const pageUrl = new URL(context.page.siteRelative, sourceUrl);
  const url = new URL(href, pageUrl);
  const search = Object.fromEntries(url.searchParams.entries());
  return {
    route,
    search,
    hash: url.hash.replace(/^#/, ""),
  };
}

function jsxObject(value) {
  const entries = Object.entries(value);
  return `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${JSON.stringify(item)}`).join(", ")} }`;
}

function rewriteCssUrls(css, context) {
  return String(css).replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (full, _quote, rawUrl) => {
    if (/^(data:|blob:|#)/i.test(rawUrl)) return full;
    if (isRemote(rawUrl)) {
      if (isTracker(rawUrl)) removedTrackers.push({ page: context.page.siteRelative, value: rawUrl });
      else unresolvedAutomaticExternals.push({ page: context.page.siteRelative, attribute: "css-url", value: rawUrl });
      return "url('')";
    }
    const mirrorPath = resolveMirrorPath({ href: rawUrl, pageMirrorRel: context.cssMirrorRel || context.page.mirrorRelative, sitePrefix });
    if (ignoredErrorMirrorPaths.has(mirrorPath)) return "url('')";
    return `url(${JSON.stringify(runtimePublicUrl(mirrorPath))})`;
  });
}

function jsxAttribute(attr, context) {
  const rawName = attr.name;
  if (/^on[a-z]/i.test(rawName)) {
    removedInlineHandlers.push({ page: context.page.siteRelative, attribute: rawName });
    return null;
  }
  let name = ATTRIBUTE_MAP.get(rawName) || rawName;
  if (name === "style") return `style=${styleToJsx(attr.value, context)}`;
  if (name === "srcSet") return `${name}={${JSON.stringify(rewriteSrcSet(attr.value, context))}}`;
  if (["src", "poster", "action"].includes(name)) {
    const value = rewriteUrl(attr.value, context, name);
    return value ? `${name}={${JSON.stringify(value)}}` : null;
  }
  if (name === "href") {
    const value = rewriteUrl(attr.value, context, name);
    return value ? `${name}={${JSON.stringify(value)}}` : null;
  }
  if (name === "xlink:href") name = "xlinkHref";
  if (attr.value === "") return BOOLEAN_ATTRIBUTES.has(name) ? name : `${name}={""}`;
  return `${name}={${JSON.stringify(attr.value)}}`;
}

function nodeToJsx(node, context, depth = 2) {
  const indent = "  ".repeat(depth);
  if (node.nodeName === "#text") {
    if (!node.value) return "";
    return `${indent}{${JSON.stringify(node.value)}}`;
  }
  if (node.nodeName === "#comment" || !node.tagName) return "";
  if (["script", "style", "link", "meta", "title"].includes(node.tagName)) return "";
  const childContext = { ...context, tagName: node.tagName };
  const linkTarget = internalLinkTarget(node, childContext);
  const renderedTag = linkTarget ? "Link" : node.tagName;
  const attributes = (node.attrs || [])
    .filter((attr) => !(linkTarget && attr.name === "href"))
    .map((attr) => jsxAttribute(attr, childContext))
    .filter(Boolean);
  if (linkTarget) {
    attributes.unshift(`to={${JSON.stringify(linkTarget.route)}}`);
    if (Object.keys(linkTarget.search).length > 0) attributes.push(`search={${jsxObject(linkTarget.search)}}`);
    if (linkTarget.hash) attributes.push(`hash={${JSON.stringify(linkTarget.hash)}}`);
  }
  const opening = attributes.length ? `<${renderedTag} ${attributes.join(" ")}` : `<${renderedTag}`;
  if (VOID_TAGS.has(node.tagName)) return `${indent}${opening} />`;
  const children = (node.childNodes || []).map((child) => nodeToJsx(child, childContext, depth + 1)).filter(Boolean);
  if (children.length === 0) return `${indent}${opening}></${renderedTag}>`;
  return `${indent}${opening}>\n${children.join("\n")}\n${indent}</${renderedTag}>`;
}

function collectDocumentAssets(document, page) {
  const head = findNode(document, "head");
  const titleNode = findNode(head || document, "title");
  const title = titleNode?.childNodes?.find((node) => node.nodeName === "#text")?.value || basename(page.siteRelative);
  const scripts = [];
  const dataScripts = [];
  let inlineIndex = 0;

  const nodes = [];
  function walk(node) {
    nodes.push(node);
    for (const child of node.childNodes || []) walk(child);
  }
  walk(document);

  for (const node of nodes) {
    if (node.tagName === "style") {
      const css = (node.childNodes || []).filter((child) => child.nodeName === "#text").map((child) => child.value).join("");
      cssChunks.push(`/* inline: ${page.siteRelative} */\n${rewriteCssUrls(css, { page })}`);
    }
    if (node.tagName === "link") {
      const attrs = attrMap(node);
      if (attrs.get("rel") !== "stylesheet") continue;
      const href = attrs.get("href") || "";
      if (isRemote(href)) {
        removedExternalStyles.push({ page: page.siteRelative, href });
        continue;
      }
      const cssMirrorRel = resolveMirrorPath({ href, pageMirrorRel: page.mirrorRelative, sitePrefix });
      const cssPath = join(input, cssMirrorRel);
      if (!existsSync(cssPath)) continue;
      cssChunks.push(`/* source: ${cssMirrorRel} */\n${rewriteCssUrls(readText(cssPath), { page, cssMirrorRel })}`);
    }
    if (node.tagName === "script") {
      const attrs = attrMap(node);
      const src = attrs.get("src");
      const type = attrs.get("type") || "";
      const executable = isExecutableScriptType(type);
      if (!executable) {
        let code = (node.childNodes || []).filter((child) => child.nodeName === "#text").map((child) => child.value).join("");
        if (src && !isRemote(src)) {
          const mirrorPath = resolveMirrorPath({ href: src, pageMirrorRel: page.mirrorRelative, sitePrefix });
          const sourcePath = join(input, mirrorPath);
          if (existsSync(sourcePath)) code = readText(sourcePath);
          else unresolvedAutomaticExternals.push({ page: page.siteRelative, attribute: "data-script", value: src, cause: "missing-local-asset" });
        } else if (src) {
          unresolvedAutomaticExternals.push({ page: page.siteRelative, attribute: "data-script", value: src, cause: "remote-data-script" });
        }
        dataScripts.push({
          attrs: (node.attrs || []).filter((attr) => attr.name !== "src"),
          code,
        });
        continue;
      }
      if (src) {
        if (isRemote(src)) {
          if (isTracker(src)) removedTrackers.push({ page: page.siteRelative, value: src });
          else unresolvedAutomaticExternals.push({ page: page.siteRelative, attribute: "script", value: src });
          continue;
        }
        const mirrorPath = resolveMirrorPath({ href: src, pageMirrorRel: page.mirrorRelative, sitePrefix });
        scripts.push({ src: runtimePublicUrl(mirrorPath), type: type || "text/javascript" });
      } else {
        const code = (node.childNodes || []).filter((child) => child.nodeName === "#text").map((child) => child.value).join("");
        if (!code.trim()) continue;
        if (/\bgtag\b|dataLayer|google-analytics|googletagmanager/.test(code)) {
          removedTrackers.push({ page: page.siteRelative, value: "inline analytics" });
          continue;
        }
        const filename = `${componentName(routeFromHtml(page.siteRelative))}-${inlineIndex++}.js`;
        writeText(join(output, "public/legacy", filename), code);
        scripts.push({ src: `/legacy/${filename}`, type: type || "text/javascript" });
      }
    }
  }

  return { title, scripts, dataScripts };
}

function dataScriptToJsx(script, page) {
  const attributes = script.attrs
    .map((attr) => jsxAttribute(attr, { page, tagName: "script" }))
    .filter(Boolean);
  attributes.push(`dangerouslySetInnerHTML={{ __html: ${JSON.stringify(script.code)} }}`);
  return `      <script ${attributes.join(" ")} />`;
}

function localRuntimeAdapterSource(scripts) {
  if (scripts.length === 0) return { declaration: "", call: "", mount: "" };
  return {
    declaration: `const localRuntimeScripts = ${JSON.stringify(scripts, null, 2)};

function useLocalRuntimeAdapter() {
  useEffect(() => {
    let disposed = false;
    const mounted: HTMLScriptElement[] = [];
    const load = async () => {
      for (const entry of localRuntimeScripts) {
        if (disposed) return;
        await new Promise<void>((resolve) => {
          const script = document.createElement("script");
          script.src = entry.src;
          script.type = entry.type;
          script.async = false;
          script.dataset.localRuntimeAdapter = "true";
          script.addEventListener("load", () => resolve(), { once: true });
          script.addEventListener("error", () => resolve(), { once: true });
          document.body.appendChild(script);
          mounted.push(script);
        });
      }
    };
    void load();
    return () => {
      disposed = true;
      for (const script of mounted) script.remove();
    };
  }, []);
}
`,
    call: "  useLocalRuntimeAdapter();\n",
    mount: '      <main id="local-runtime-root" data-local-runtime-adapter="true" style={{ display: "contents" }} />',
  };
}

for (const page of pages) {
  const document = parse(readText(page.sourceFile));
  const body = findNode(document, "body");
  const route = routeFromHtml(page.siteRelative);
  const baseName = componentName(route);
  let name = baseName;
  let suffix = 2;
  while (usedComponentNames.has(name)) name = `${baseName}${suffix++}`;
  usedComponentNames.add(name);
  const head = collectDocumentAssets(document, page);
  const runtimeAdapter = localRuntimeAdapterSource(head.scripts);
  const bodyAttrs = attrMap(body || { attrs: [] });
  const heading = textContent(findNode(body || document, "h1")).trim() || head.title;
  const dataScriptJsx = head.dataScripts.map((script) => dataScriptToJsx(script, page));
  const jsx = [
    ...dataScriptJsx,
    ...(body?.childNodes || []).map((node) => nodeToJsx(node, { page }, 2)).filter(Boolean),
    runtimeAdapter.mount,
  ].join("\n");
  const pageFile = join(output, "src/pages", `${name}.tsx`);
  writeText(pageFile, `import { Link } from "@tanstack/react-router";\nimport React, { useEffect } from "react";\n\n${runtimeAdapter.declaration}export default function ${name}() {\n${runtimeAdapter.call}  useEffect(() => {\n    document.title = ${JSON.stringify(head.title)};\n    const previousClass = document.body.className;\n    document.body.className = ${JSON.stringify(bodyAttrs.get("class") || "")};\n    return () => { document.body.className = previousClass; };\n  }, []);\n\n  return (\n    <>\n${jsx || "      <div />"}\n    </>\n  );\n}\n`);
  pageRecords.push({ route, name, pageFile, scripts: head.scripts, heading, title: head.title });
}

for (const file of listFiles(publicRoot)) {
  if (!/[.](?:c?js|mjs)$/i.test(file)) continue;
  const fileLabel = toPosix(relative(output, file));
  const publicRelative = toPosix(relative(publicRoot, file));
  const source = readText(file);
  const classification = classifyAssetContent(source, { expectedExtension: extname(file) });
  const classificationEvidence = {
    bytes: Buffer.byteLength(source),
    contentSignature: classification,
    firstLineSample: source.split(/\r?\n/, 1)[0].slice(0, 120),
  };
  if (classification === "html") {
    const quarantineRelative = `${publicRelative}.html`;
    const quarantinePath = join(output, "reports/quarantine", ...quarantineRelative.split("/"));
    ensureDir(dirname(quarantinePath));
    renameSync(file, quarantinePath);
    runtimeAssetClassifications.push({
      file: fileLabel,
      classification,
      action: "quarantined",
      quarantineFile: toPosix(relative(output, quarantinePath)),
      ...classificationEvidence,
    });
    for (const page of pageRecords) {
      if (page.scripts.some((script) => script.src === `/${encodePublicPath(publicRelative)}`)) {
        unresolvedAutomaticExternals.push({
          file: fileLabel,
          kind: "content-type-mismatch",
          cause: "html-misfiled-as-javascript",
        });
      }
    }
    continue;
  }
  if (classification === "json") {
    runtimeAssetClassifications.push({ file: fileLabel, classification, action: "preserved-data", ...classificationEvidence });
    continue;
  }
  runtimeAssetClassifications.push({ file: fileLabel, classification, action: "analyzed", ...classificationEvidence });
  try {
    const result = sanitizeJavaScript(source, { sourceUrl });
    if (result.changed) writeText(file, result.source);
    stubbedRemoteRequests.push(...result.stubbedRemoteRequests.map((finding) => ({ file: fileLabel, ...finding })));
    localizedRemoteRequests.push(...result.localizedRemoteRequests.map((finding) => ({ file: fileLabel, ...finding })));
    outboundNavigations.push(...result.navigation.map((finding) => ({ file: fileLabel, ...finding })));
    unknownRemoteLiterals.push(...result.unknown.map((finding) => ({ file: fileLabel, ...finding })));
    redactedCredentials.push(...result.redactedCredentials.map((finding) => ({ file: fileLabel, ...finding })));
    removedOutboundNavigations.push(...result.removedOutboundNavigations.map((finding) => ({ file: fileLabel, ...finding })));
    removedRemoteLiterals.push(...result.removedRemoteLiterals.map((url) => ({ file: fileLabel, url })));
    unresolvedAutomaticExternals.push(...result.automaticAfter.map((finding) => ({ file: fileLabel, ...finding })));
    unresolvedAutomaticExternals.push(...result.unresolvedRemoteRequests.map((finding) => ({ file: fileLabel, ...finding })));
  } catch (error) {
    runtimeParseErrors.push({ file: fileLabel, error: error.message });
  }
}

const offlineRules = args["offline-rules"]
  ? JSON.parse(readText(resolve(String(args["offline-rules"]))))
  : { routes: [] };
const rootPage = pageRecords.find((page) => page.route === "/") || pageRecords[0];
const faviconCandidates = ["favicon.ico", "favicon.svg", "favicon.png", "assets/brand/favicon.svg", "assets/brand/favicon.png"];
const favicon = faviconCandidates.find((path) => existsSync(join(publicRoot, ...path.split("/"))));
writeTanStackProject({
  output,
  pages: pageRecords,
  css: cssChunks.join("\n\n"),
  offlineRules,
  basePath: String(args["base-path"] || "/"),
  title: rootPage?.title,
  favicon: favicon ? `/${encodePublicPath(favicon)}` : null,
});
inspectGeneratedSite({ output, publicRoot, pageRecords });

const runtimeExternalReferences = [
  ...unresolvedAutomaticExternals,
  ...runtimeParseErrors,
].map((finding) => ({
  cause: finding.cause || (finding.error ? "parse-error" : finding.kind === "content-type-mismatch" ? "content-type-mismatch" : "remote-url"),
  ...finding,
}));
const unresolvedCountByCause = runtimeExternalReferences.reduce((counts, finding) => {
  counts[finding.cause] = (counts[finding.cause] || 0) + 1;
  return counts;
}, {});
const manifest = {
  sourceUrl,
  siteRoot: toPosix(relative(input, siteRoot)) || ".",
  routes: pageRecords.map((page) => page.route),
  duplicateRoutePages,
  ignoredErrorDocuments,
  conversionMode: "react-structure-with-legacy-script-adapters",
  runtimeExternalReferences,
  unresolvedCountByCause,
  stubbedRemoteRequests,
  localizedRemoteRequests,
  outboundNavigations,
  removedOutboundNavigations,
  removedRemoteLiterals,
  unknownRemoteLiterals,
  runtimeParseErrors,
  runtimeAssetClassifications,
  redactedCredentials,
  removedTrackers,
  removedExternalStyles,
  removedInlineHandlers,
  legacyScripts: pageRecords.flatMap((page) => page.scripts.map((script) => ({ route: page.route, ...script }))),
};
writeText(join(output, "reports/conversion-manifest.json"), safeJson(manifest));

const authorizationManifest = writeAuthorizationManifest({
  outputFile: join(output, "reports/authorization-manifest.json"),
  sourceUrl,
  siteRoot,
  publicRoot,
  authorized: Boolean(args.authorized),
});
writeText(join(output, "reports/compliance-review.json"), safeJson({
  sourceUrl,
  legalConclusion: false,
  automatedStatus: runtimeExternalReferences.length === 0 ? "passed" : "blocked",
  authorizationDecision: authorizationManifest.decision,
  automatedChecks: {
    noAutomaticExternalRequests: runtimeExternalReferences.length === 0,
    removedTrackers: removedTrackers.length,
    stubbedThirdPartyRequests: stubbedRemoteRequests.length,
    redactedCredentials: redactedCredentials.length,
    outboundNavigations: outboundNavigations.length,
    removedOutboundNavigations: removedOutboundNavigations.length,
    unknownRemoteLiterals: unknownRemoteLiterals.length,
  },
  statement: "Automated technical and evidence assessment only; not a legal conclusion.",
}));

if (runtimeExternalReferences.length > 0 && args.strict) {
  console.error(`Conversion produced ${runtimeExternalReferences.length} unresolved automatic external reference(s). See reports/conversion-manifest.json`);
  process.exit(3);
}

console.log(`Generated ${output}`);
console.log(`Routes: ${manifest.routes.join(", ")}`);
