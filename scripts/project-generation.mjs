import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  componentName,
  ensureDir,
  readText,
  relativeImport,
  routeFileStem,
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

function renderIndexHtml({ title, favicon }) {
  const faviconTag = favicon ? `\n    <link rel="icon" href="${favicon}" />` : "";
  const escapedTitle = String(title || "React mirror").replace(
    /[&<>]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character],
  );
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; connect-src 'self' blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />${faviconTag}
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

function renderPageRoute(page, routeFile) {
  const pageImport = relativeImport(routeFile, page.pageFile).replace(/\.[^.]+$/, "");
  return `import { createFileRoute } from "@tanstack/react-router";
import ${page.name} from ${JSON.stringify(pageImport)};

export const Route = createFileRoute(${JSON.stringify(page.route)})({
  component: ${page.name},
});
`;
}

function renderRouteTree(pages) {
  const imports = pages
    .map((page) => `import { Route as ${routeImportName(page.route)} } from ${JSON.stringify(`./routes/${routeFileStem(page.route)}`)};`)
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

function renderNetworkPolicy() {
  return `import offlineRoutes from "./offline-routes";

const nativeFetch = globalThis.fetch.bind(globalThis);
const localOrigin = globalThis.location.origin;

function requestUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input), globalThis.location.href);
}

function offlinePath(url: URL) {
  return "/__offline__/" + url.host + url.pathname + url.search;
}

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
  __HTTRACK_NETWORK_POLICY__: Object.freeze({ localOrigin, offlinePrefix: "/__offline__/" }),
});
`;
}

export function writeTanStackProject({ output, pages, css, offlineRules, basePath = "/", title, favicon }) {
  ensureDir(join(output, "src/routes"));
  ensureDir(join(output, "src/runtime"));
  ensureDir(join(output, "src/styles"));

  writeText(join(output, "package.json"), renderPackageJson());
  writeText(join(output, "package-lock.json"), readText(join(SCRIPT_DIR, "templates/react-package-lock.json")));
  writeText(join(output, "tsconfig.json"), renderTsConfig());
  writeText(join(output, "vite.config.ts"), renderViteConfig(basePath));
  writeText(join(output, "vitest.config.ts"), renderVitestConfig());
  writeText(join(output, "index.html"), renderIndexHtml({ title, favicon }));
  writeText(join(output, "src/main.tsx"), renderMain());
  writeText(join(output, "src/routes/__root.tsx"), renderRootRoute());

  for (const page of pages) {
    const routeFile = join(output, "src/routes", `${routeFileStem(page.route)}.tsx`);
    writeText(routeFile, renderPageRoute(page, routeFile));
  }

  writeText(join(output, "src/runtime/offline-routes.ts"), renderOfflineRoutes(offlineRules.routes || []));
  writeText(join(output, "src/runtime/network-policy.ts"), renderNetworkPolicy());
  writeText(join(output, "src/styles/source.css"), `${css}\n`);
  writeText(join(output, "src/routeTree.gen.ts"), renderRouteTree(pages));
}

export function generatedRouteFile(output, route) {
  return join(output, "src/routes", `${routeFileStem(route)}.tsx`);
}

export function generatedPageName(pageFile) {
  return basename(pageFile).replace(/\.[^.]+$/, "");
}
