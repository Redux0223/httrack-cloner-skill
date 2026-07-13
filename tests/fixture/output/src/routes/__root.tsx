import { Outlet, createRootRoute } from "@tanstack/react-router";

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
