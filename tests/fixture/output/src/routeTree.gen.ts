/* eslint-disable */
// @ts-nocheck
// Generated from the captured route manifest. TanStack Router may refresh this file.
import { Route as rootRouteImport } from "./routes/__root";
import { Route as AboutRouteImport } from "./routes/about";
import { Route as IndexRouteImport } from "./routes/index";

const AboutRoute = AboutRouteImport.update({
  id: "/about",
  path: "/about",
  getParentRoute: () => rootRouteImport,
} as any);

const IndexRoute = IndexRouteImport.update({
  id: "/",
  path: "/",
  getParentRoute: () => rootRouteImport,
} as any);

export interface FileRoutesByFullPath {
  "/about": typeof AboutRoute
  "/": typeof IndexRoute
}
export interface FileRoutesByTo {
  "/about": typeof AboutRoute
  "/": typeof IndexRoute
}
export interface FileRoutesById {
  __root__: typeof rootRouteImport
  "/about": typeof AboutRoute
  "/": typeof IndexRoute
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: "/about" | "/"
  fileRoutesByTo: FileRoutesByTo
  to: "/about" | "/"
  id: "__root__" | "/about" | "/"
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren {
  AboutRoute: typeof AboutRoute
  IndexRoute: typeof IndexRoute
}

declare module "@tanstack/react-router" {
  interface FileRoutesByPath {
    "/about": {
      id: "/about"
      path: "/about"
      fullPath: "/about"
      preLoaderRoute: typeof AboutRouteImport
      parentRoute: typeof rootRouteImport
    }
    "/": {
      id: "/"
      path: "/"
      fullPath: "/"
      preLoaderRoute: typeof IndexRouteImport
      parentRoute: typeof rootRouteImport
    }
  }
}

const rootRouteChildren: RootRouteChildren = {
  AboutRoute: AboutRoute,
  IndexRoute: IndexRoute,
};

export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>();
