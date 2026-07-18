import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  componentName,
  ensureDir,
  readText,
  relativeImport,
  safeJson,
  writeText,
} from "./lib.mjs";

const PACKAGE_VERSIONS = Object.freeze({
  router: "1.170.17",
  routerPlugin: "1.168.19",
  react: "19.0.0",
  reactDom: "19.0.0",
  reactPlugin: "4.3.4",
  typescript: "5.7.2",
  vite: "6.4.3",
  vitest: "^2.1.8",
  jsdom: "^29.1.1",
});

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function routeImportName(route) {
  return `${routeRuntimeName(route)}Import`;
}

function routeRuntimeName(route) {
  if (route === "/") return "IndexRoute";
  return `${componentName(route).replace(/Page$/, "")}Route`;
}

function renderPackageJson() {
  return safeJson({
    name: "httrack-react-output",
    version: "0.2.0",
    private: true,
    type: "module",
    scripts: {
      dev: "vite",
      build: "vite build",
      preview: "vite preview",
      typecheck: "tsc --noEmit",
      test: "vitest run",
    },
    dependencies: {
      "@tanstack/react-router": PACKAGE_VERSIONS.router,
      react: PACKAGE_VERSIONS.react,
      "react-dom": PACKAGE_VERSIONS.reactDom,
    },
    devDependencies: {
      "@tanstack/router-plugin": PACKAGE_VERSIONS.routerPlugin,
      "@types/react": "19.0.2",
      "@types/react-dom": "19.0.2",
      "@vitejs/plugin-react": PACKAGE_VERSIONS.reactPlugin,
      "@testing-library/jest-dom": "^6.6.3",
      "@testing-library/react": "^16.1.0",
      "@types/node": "^26.1.1",
      typescript: PACKAGE_VERSIONS.typescript,
      vite: PACKAGE_VERSIONS.vite,
      vitest: PACKAGE_VERSIONS.vitest,
      jsdom: PACKAGE_VERSIONS.jsdom,
    },
  });
}

function renderTsConfig() {
  return safeJson({
    compilerOptions: {
      target: "ES2022",
      useDefineForClassFields: true,
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      allowJs: false,
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      strict: true,
      forceConsistentCasingInFileNames: true,
      module: "ESNext",
      moduleResolution: "Bundler",
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: "react-jsx",
    },
    include: ["src", "vite.config.ts"],
  });
}

function renderViteConfig(basePath) {
  return `import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.CLONE_BASE_PATH || ${JSON.stringify(basePath)},
  plugins: [tanstackRouter({ autoCodeSplitting: true }), react()],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
});
`;
}

function renderVitestConfig() {
  return `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
  },
});
`;
}

function escapeHtmlAttribute(value) {
  return String(value).replace(/[&<>\"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  })[character]);
}

function renderIndexHtml({ title, favicon, viewport, lang, dir }) {
  const faviconTag = favicon ? `\n    <link rel="icon" href="${favicon}" />` : "";
  const viewportTag = viewport
    ? `\n    <meta name="viewport" content="${escapeHtmlAttribute(viewport)}" />`
    : "";
  const htmlAttributes = [
    lang ? `lang="${escapeHtmlAttribute(lang)}"` : "",
    dir ? `dir="${escapeHtmlAttribute(dir)}"` : "",
  ].filter(Boolean).join(" ");
  const escapedTitle = String(title || "React mirror").replace(
    /[&<>]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character],
  );
  return `<!doctype html>
<html${htmlAttributes ? ` ${htmlAttributes}` : ""}>
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; connect-src 'self' blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'" />
    ${viewportTag}${faviconTag}
    <title>${escapedTitle}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

function renderRootRoute() {
  return `import { Outlet, createRootRoute } from "@tanstack/react-router";

function RootLayout() {
  return <Outlet />;
}

function NotFoundPage() {
  return <main role="main"><h1>404</h1></main>;
}

function RouteError({ error }: { error: Error }) {
  return <main role="main"><h1>Unable to render this page</h1><pre>{error.message}</pre></main>;
}

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
  errorComponent: RouteError,
});
`;
}

function renderCapturedHtmlTypes() {
  return `import type * as React from "react";

declare module "react" {
  interface HTMLAttributes<T> {
    [capturedAttribute: string]: unknown;
  }

  namespace JSX {
    interface IntrinsicElements {
      font: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        color?: string;
        face?: string;
        size?: string | number;
      };
    }
  }
}
`;
}

function renderPageRoute(page, routeFile) {
  const pageImport = relativeImport(routeFile, page.pageFile).replace(/\.[^.]+$/, "");
  return `import { createFileRoute } from "@tanstack/react-router";
import ${page.name} from ${JSON.stringify(pageImport)};

export const Route = createFileRoute(${JSON.stringify(page.route)})({
  component: ${page.name},
});
`;
}

export function projectRouteFileStem(route, routes = []) {
  if (route === "/") return "index";
  const routeSet = new Set(routes);
  const parts = route.replace(/^\//, "").split("/");
  return parts.map((part, index) => {
    const sanitized = part.replace(/[^A-Za-z0-9_$-]/g, "-");
    const prefix = `/${parts.slice(0, index + 1).join("/")}`;
    return index < parts.length - 1 && routeSet.has(prefix) ? `${sanitized}_` : sanitized;
  }).join(".");
}

function renderRouteTree(pages) {
  const routes = pages.map((page) => page.route);
  const imports = pages
    .map((page) => `import { Route as ${routeImportName(page.route)} } from ${JSON.stringify(`./routes/${projectRouteFileStem(page.route, routes)}`)};`)
    .join("\n");
  const updates = pages
    .map((page) => {
      return `const ${routeRuntimeName(page.route)} = ${routeImportName(page.route)}.update({
  id: ${JSON.stringify(page.route)},
  path: ${JSON.stringify(page.route)},
  getParentRoute: () => rootRouteImport,
} as any);`;
    })
    .join("\n\n");
  const fullPathEntries = pages.map((page) => `  ${JSON.stringify(page.route)}: typeof ${routeRuntimeName(page.route)}`).join("\n");
  const idEntries = ["  __root__: typeof rootRouteImport", ...pages.map((page) => `  ${JSON.stringify(page.route)}: typeof ${routeRuntimeName(page.route)}`)].join("\n");
  const routeUnion = pages.map((page) => JSON.stringify(page.route)).join(" | ");
  const idUnion = [`"__root__"`, ...pages.map((page) => JSON.stringify(page.route))].join(" | ");
  const childTypes = pages.map((page) => `  ${routeRuntimeName(page.route)}: typeof ${routeRuntimeName(page.route)}`).join("\n");
  const fileRouteTypes = pages.map((page) => `    ${JSON.stringify(page.route)}: {
      id: ${JSON.stringify(page.route)}
      path: ${JSON.stringify(page.route)}
      fullPath: ${JSON.stringify(page.route)}
      preLoaderRoute: typeof ${routeImportName(page.route)}
      parentRoute: typeof rootRouteImport
    }`).join("\n");
  const children = pages.map((page) => `  ${routeRuntimeName(page.route)}: ${routeRuntimeName(page.route)},`).join("\n");
  return `/* eslint-disable */
// @ts-nocheck
// Generated from the captured route manifest. TanStack Router may refresh this file.
import { Route as rootRouteImport } from "./routes/__root";
${imports}

${updates}

export interface FileRoutesByFullPath {
${fullPathEntries}
}
export interface FileRoutesByTo {
${fullPathEntries}
}
export interface FileRoutesById {
${idEntries}
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: ${routeUnion}
  fileRoutesByTo: FileRoutesByTo
  to: ${routeUnion}
  id: ${idUnion}
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren {
${childTypes}
}

declare module "@tanstack/react-router" {
  interface FileRoutesByPath {
${fileRouteTypes}
  }
}

const rootRouteChildren: RootRouteChildren = {
${children}
};

export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>();
`;
}

function renderMain() {
  return `import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import "./runtime/network-policy";
import { routeTree } from "./routeTree.gen";
import "./styles/source.css";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
`;
}

function renderOfflineRoutes(routes) {
  return `export interface OfflineRoute {
  match?: string;
  prefix?: string;
  methods?: string[];
  status?: number;
  json?: unknown;
  headers?: Record<string, string>;
}

const offlineRoutes: OfflineRoute[] = ${JSON.stringify(routes, null, 2)};

export default offlineRoutes;
`;
}

function renderNetworkPolicy(remoteAssets) {
  return `import offlineRoutes from "./offline-routes";

const nativeFetch = globalThis.fetch.bind(globalThis);
const localOrigin = globalThis.location.origin;
const remoteAssetRoutes: Record<string, string> = ${JSON.stringify(remoteAssets, null, 2)};
const emptyScriptUrl = URL.createObjectURL(new Blob([""], { type: "text/javascript" }));
const emptyStyleUrl = URL.createObjectURL(new Blob([""], { type: "text/css" }));
const emptyMediaUrl = URL.createObjectURL(new Blob([], { type: "application/octet-stream" }));
const transparentImage = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

function requestUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input), globalThis.location.href);
}

function offlinePath(url: URL) {
  return "/__offline__/" + url.host + url.pathname + url.search;
}

function mappedRemoteAsset(value: string) {
  let url: URL;
  try {
    url = new URL(value, globalThis.location.href);
  } catch {
    return value;
  }
  if (url.origin === localOrigin || url.protocol === "data:" || url.protocol === "blob:") return value;
  return remoteAssetRoutes[url.href] || remoteAssetRoutes[url.origin + url.pathname] || null;
}

function replacementUrl(element: Element, attribute: string, value: string) {
  const normalized = value.trim();
  const inert = !normalized || normalized.startsWith("#") || normalized.startsWith("/__offline__/");
  if (inert && element instanceof HTMLScriptElement) return emptyScriptUrl;
  if (inert && element instanceof HTMLLinkElement) return emptyStyleUrl;
  if (inert && element instanceof HTMLImageElement) return transparentImage;
  if (inert && (element instanceof HTMLMediaElement || element instanceof HTMLSourceElement)) return emptyMediaUrl;
  if (element instanceof HTMLScriptElement) {
    try {
      const url = new URL(value, globalThis.location.href);
      if (url.origin === localOrigin && !/\.(?:c?js|mjs)$/i.test(url.pathname)) return emptyScriptUrl;
    } catch {
      return emptyScriptUrl;
    }
  }
  const mapped = mappedRemoteAsset(value);
  if (mapped) return mapped;
  if (element instanceof HTMLScriptElement) return emptyScriptUrl;
  if (element instanceof HTMLLinkElement) return emptyStyleUrl;
  if (element instanceof HTMLImageElement) return transparentImage;
  if (element instanceof HTMLMediaElement || element instanceof HTMLSourceElement) return emptyMediaUrl;
  return offlinePath(new URL(value, globalThis.location.href));
}

function patchUrlProperty(prototype: object, property: string) {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
  const getter = descriptor?.get;
  const setter = descriptor?.set;
  if (!getter || !setter) return;
  Object.defineProperty(prototype, property, {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get: getter,
    set(value) {
      setter.call(this, replacementUrl(this as Element, property, String(value)));
    },
  });
}

for (const [prototype, property] of [
  [HTMLScriptElement.prototype, "src"],
  [HTMLLinkElement.prototype, "href"],
  [HTMLImageElement.prototype, "src"],
  [HTMLSourceElement.prototype, "src"],
  [HTMLVideoElement.prototype, "src"],
  [HTMLVideoElement.prototype, "poster"],
  [HTMLAudioElement.prototype, "src"],
] as const) patchUrlProperty(prototype, property);

const nativeSetAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (name, value) {
  const normalized = String(name).toLowerCase();
  const loadsResource = normalized === "src" || normalized === "poster"
    || (normalized === "href" && this instanceof HTMLLinkElement);
  return nativeSetAttribute.call(this, name, loadsResource ? replacementUrl(this, normalized, String(value)) : value);
};

function offlineResponse(url: URL, input: RequestInfo | URL, init?: RequestInit) {
  const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  const rule = offlineRoutes.find((candidate) => {
    const methods = candidate.methods || ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
    const matchesPath = candidate.prefix ? url.pathname.startsWith(candidate.prefix) : url.pathname === candidate.match;
    return matchesPath && methods.includes(method);
  });
  const status = rule?.status ?? 503;
  const body = rule?.json ?? { ok: false, offline: true, error: "External service removed from this local clone." };
  const responseBody = [204, 205, 304].includes(status) ? null : JSON.stringify(body);
  return Promise.resolve(new Response(responseBody, {
    status,
    headers: { "content-type": "application/json", ...(rule?.headers || {}) },
  }));
}

globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = requestUrl(input);
  if (url.origin !== localOrigin) {
    return offlineResponse(new URL(offlinePath(url), localOrigin), input, init);
  }
  if (url.pathname.startsWith("/__offline__/")) return offlineResponse(url, input, init);
  return nativeFetch(input, init);
};

if (globalThis.navigator?.sendBeacon) {
  const nativeBeacon = globalThis.navigator.sendBeacon.bind(globalThis.navigator);
  globalThis.navigator.sendBeacon = (input, data) => {
    const url = requestUrl(input);
    if (url.origin !== localOrigin || url.pathname.startsWith("/__offline__/")) return false;
    return nativeBeacon(input, data);
  };
}

Object.assign(globalThis, {
  __HTTRACK_NETWORK_POLICY__: Object.freeze({ localOrigin, offlinePrefix: "/__offline__/", remoteAssetRoutes }),
});
`;
}

export function writeTanStackProject({ output, pages, css, offlineRules, remoteAssets = {}, basePath = "/", title, favicon, viewport, lang, dir }) {
  ensureDir(join(output, "src/routes"));
  ensureDir(join(output, "src/runtime"));
  ensureDir(join(output, "src/styles"));
  ensureDir(join(output, "src/types"));

  writeText(join(output, "package.json"), renderPackageJson());
  writeText(join(output, "package-lock.json"), readText(join(SCRIPT_DIR, "templates/react-package-lock.json")));
  writeText(join(output, "tsconfig.json"), renderTsConfig());
  writeText(join(output, "vite.config.ts"), renderViteConfig(basePath));
  writeText(join(output, "vitest.config.ts"), renderVitestConfig());
  writeText(join(output, "index.html"), renderIndexHtml({ title, favicon, viewport, lang, dir }));
  writeText(join(output, "src/main.tsx"), renderMain());
  writeText(join(output, "src/routes/__root.tsx"), renderRootRoute());
  writeText(join(output, "src/types/captured-html.d.ts"), renderCapturedHtmlTypes());

  const routes = pages.map((page) => page.route);
  for (const page of pages) {
    const routeFile = join(output, "src/routes", `${projectRouteFileStem(page.route, routes)}.tsx`);
    writeText(routeFile, renderPageRoute(page, routeFile));
  }

  writeText(join(output, "src/runtime/offline-routes.ts"), renderOfflineRoutes(offlineRules.routes || []));
  writeText(join(output, "src/runtime/network-policy.ts"), renderNetworkPolicy(remoteAssets));
  writeText(join(output, "src/styles/source.css"), `${css}\n`);
  writeText(join(output, "src/routeTree.gen.ts"), renderRouteTree(pages));
}

export function generatedRouteFile(output, route, routes = []) {
  return join(output, "src/routes", `${projectRouteFileStem(route, routes)}.tsx`);
}

export function generatedPageName(pageFile) {
  return basename(pageFile).replace(/\.[^.]+$/, "");
}
