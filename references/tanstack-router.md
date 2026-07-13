# TanStack Router Reconstruction Reference

## Required Project Shape

Use file-based routing:

```text
src/routes/__root.tsx
src/routes/index.tsx
src/routes/about.tsx
src/routeTree.gen.ts
```

Vite plugin order is mandatory:

```ts
plugins: [tanstackRouter({ autoCodeSplitting: true }), react()]
```

## Root Route

`__root.tsx` owns global layout, `Outlet`, not-found UI, and route error UI. Do not silently map unknown paths to `/`.

## File Routes

```tsx
export const Route = createFileRoute("/about")({
  component: AboutPage,
});
```

The generated route tree is not hand-edited. Other route and page source remains editable.

## Navigation

Convert an anchor to `Link` only when its captured target maps to a known local route. Preserve URL components separately:

```tsx
<Link to="/about" search={{ tab: "team" }} hash="bio">About</Link>
```

Keep ordinary anchors for unknown paths, downloads, explicit targets, mail, telephone, blobs, and external destinations.

## URL State

Use validated search parameters only when captured behavior proves that UI state is URL-backed. Do not invent schemas from static HTML.

## Data Loading

Generate loaders only for known local data contracts. Static captured content belongs in components or typed content modules. Remote APIs must first receive explicit offline semantics.

## Deployment

Browser-history hosting requires SPA fallback to `index.html`. Configure Vite `base` and host rewrites together for subpath deployment.

## Common Failures

- plugin after React plugin
- query/hash dropped during mirror path resolution
- unknown route redirected to home
- global click interception replacing native anchor behavior
- direct captured HTML remaining in `public` and bypassing React
- `routeTree.gen.ts` type registration missing before typecheck
