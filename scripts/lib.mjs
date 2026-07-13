import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, parse as parsePath, posix, relative, resolve, sep } from "node:path";

export const TRACKER_HOSTS = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "hotjar.com",
  "segment.io",
  "segment.com",
  "clarity.ms",
  "fullstory.com",
];

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return args;
}

export function ensureCleanDir(path) {
  const target = resolve(path);
  const protectedPaths = new Set([parsePath(target).root, resolve(homedir()), resolve(process.cwd())]);
  if (protectedPaths.has(target)) throw new Error(`Refusing to clean protected directory: ${target}`);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function readText(path) {
  return readFileSync(path, "utf8");
}

export function classifyAssetContent(value, { contentType = "", expectedExtension = "" } = {}) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  const sample = bytes.subarray(0, 4096);
  const text = sample.toString("utf8").replace(/^\uFEFF/, "").trimStart();
  const mime = String(contentType).split(";", 1)[0].trim().toLowerCase();
  const extension = String(expectedExtension).toLowerCase();

  if (sample.includes(0)) return "binary";
  if (
    mime === "text/html"
    || /^<!doctype\s+html\b/i.test(text)
    || /^<html(?:\s|>)/i.test(text)
    || (/^<(?:head|body)(?:\s|>)/i.test(text) && /<\/(?:head|body)>/i.test(text))
  ) return "html";
  if (mime === "application/json" || mime.endsWith("+json")) return "json";
  if (/^[\[{]/.test(text)) {
    try {
      JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
      return "json";
    } catch {
      // JavaScript frequently starts with an object or block, so parsing failure falls through.
    }
  }
  if (["text/javascript", "application/javascript", "application/ecmascript", "text/ecmascript"].includes(mime)) return "javascript";
  if (mime === "text/css" || extension === ".css") return "css";
  if ([".js", ".cjs", ".mjs"].includes(extension)) return "javascript";
  if (extension === ".json") return "json";
  if (text.length === 0) return "empty";
  return "text";
}

export function writeText(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, value);
}

export function listFiles(root) {
  const files = [];
  function walk(current) {
    for (const name of readdirSync(current)) {
      const fullPath = join(current, name);
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not supported in captured input: ${fullPath}`);
      if (stat.isDirectory()) walk(fullPath);
      else files.push(fullPath);
    }
  }
  walk(root);
  return files;
}

export function toPosix(path) {
  return path.split(sep).join("/");
}

export function copyMirror(input, output) {
  cpSync(input, output, {
    recursive: true,
    filter(source) {
      const rel = toPosix(relative(input, source));
      return !rel.startsWith("hts-cache/") && !rel.startsWith("hts-log") && !rel.endsWith(".DS_Store");
    },
  });
}

export function copyFiles(input, output, predicate = () => true) {
  for (const file of listFiles(input)) {
    const rel = toPosix(relative(input, file));
    if (!predicate(rel, file)) continue;
    const destination = join(output, ...rel.split("/"));
    ensureDir(dirname(destination));
    cpSync(file, destination);
  }
}

export function findSiteRoot(input, sourceUrl) {
  const hostname = new URL(sourceUrl).hostname;
  const directIndex = join(input, "index.html");
  const hostRoot = join(input, hostname);
  if (existsSync(join(hostRoot, "index.html"))) return hostRoot;
  if (existsSync(directIndex)) return input;
  const candidate = readdirSync(input)
    .map((name) => join(input, name))
    .find((path) => existsSync(join(path, "index.html")));
  if (!candidate) throw new Error(`No site root with index.html found under ${input}`);
  return candidate;
}

export function routeFromHtml(relativeHtml) {
  const normalized = toPosix(relativeHtml);
  if (normalized === "index.html") return "/";
  if (normalized.endsWith("/index.html")) return `/${normalized.slice(0, -"/index.html".length)}`;
  return `/${normalized.replace(/\.html?$/i, "")}`;
}

export function parseCapturedHref(href, sourceUrl) {
  const url = new URL(href, sourceUrl);
  return {
    pathname: routeFromHtml(url.pathname.replace(/^\//, "")),
    search: url.search,
    hash: url.hash,
  };
}

export function routeFileStem(route) {
  if (route === "/") return "index";
  return route
    .replace(/^\//, "")
    .split("/")
    .map((part) => part.replace(/[^A-Za-z0-9_$-]/g, "-"))
    .join(".");
}

export function classifyBootstrapScript(src, type = "") {
  const path = String(src).toLowerCase().replace(/([.]m?js)(?:[.](?:reconstructed|disabled|backup|bak|old|orig|txt))+$/, "$1");
  if (/draco|basis|stats|vendor\//.test(path)) return "vendor-runtime";
  if (/\/(?:main|app|index)(?:[-.][a-z0-9_-]+)*[.]m?js$/.test(path)) return "business-bootstrap";
  if (type === "module" && /[.]m?js$/.test(path)) return "unknown-module";
  return "unknown-script";
}

export function componentName(route) {
  if (route === "/") return "HomePage";
  const words = route.split("/").filter(Boolean).flatMap((part) => part.split(/[^a-zA-Z0-9]+/));
  const name = words.map((word) => word ? word[0].toUpperCase() + word.slice(1) : "").join("");
  const safeName = name && /^[A-Za-z_$]/.test(name) ? name : `Page${name}`;
  return `${safeName || "Page"}Page`;
}

export function isRemote(value) {
  return /^(?:https?:)?\/\//i.test(value || "");
}

export function isTracker(value) {
  return TRACKER_HOSTS.some((host) => String(value).includes(host));
}

export function stripQueryAndHash(value) {
  return String(value).split("#")[0].split("?")[0];
}

export function resolveMirrorPath({ href, pageMirrorRel, sitePrefix }) {
  const clean = decodeURIComponent(stripQueryAndHash(href));
  if (clean.startsWith("/")) return posix.normalize(posix.join(sitePrefix, clean.slice(1)));
  return posix.normalize(posix.join(posix.dirname(pageMirrorRel), clean));
}

export function publicUrl(mirrorRelativePath) {
  return `/source/${mirrorRelativePath.split("/").map(encodeURIComponent).join("/")}`;
}

export function relativeImport(fromFile, targetFile) {
  let value = toPosix(relative(dirname(fromFile), targetFile));
  if (!value.startsWith(".")) value = `./${value}`;
  return value;
}

export function isRuntimeTextAsset(path) {
  return [".css", ".js", ".mjs", ".json", ".svg"].includes(extname(path).toLowerCase());
}

export function scanLikelyRuntimeExternals(root) {
  const findings = [];
  const patterns = [
    /fetch\s*\(\s*["'`](https?:\/\/[^"'`]+)/g,
    /(?:src|href|poster)\s*=\s*["'](https?:\/\/[^"']+)/g,
    /url\(\s*["']?(https?:\/\/[^"')\s]+)/g,
    /new\s+WebSocket\s*\(\s*["'`](wss?:\/\/[^"'`]+)/g,
  ];
  for (const file of listFiles(root)) {
    if (!isRuntimeTextAsset(file)) continue;
    const text = readText(file);
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        if (!isTracker(match[1])) findings.push({ file: toPosix(relative(root, file)), url: match[1] });
      }
    }
  }
  return findings;
}

export function safeJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}
