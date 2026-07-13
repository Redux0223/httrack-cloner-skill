# Component Reconstruction Rules

## Evidence-Backed Boundaries

Create a component when at least one is true:

- the normalized subtree repeats with the same responsibility
- the region has independent state or lifecycle
- the region is a semantic landmark or form
- the region is reused by multiple routes
- the region mounts an imperative engine

Do not split components solely because markup is long or visually small.

## Exact Content

Preserve text, whitespace significance, element order, attributes, accessibility labels, source dimensions, and local asset selection. Extract content to typed modules only when rendered output stays exact.

Never substitute a brochure, generic marketing page, shortened document, arbitrary card grid, or newly written copy for an opaque application bootstrap. Missing captured stages, forms, media, canvas surfaces, or blocking interactions are deleted behavior, not acceptable simplification.

## CSS

Treat `.cloner/style-baseline.json` as the fidelity baseline. Reuse captured selectors, classes, declarations, breakpoints, font faces, and dimensions first. React migration may add or reorganize styles when required for maintainable ownership, but browser proof must show that rendered layout and responsive behavior stay equivalent. Keep font files local and preserve font metrics.

## Shared Components

Use structural hashes to identify repeated trees. Parameterize only differing text, assets, destinations, or explicit variants. Do not merge similar-looking blocks with different behavior.

## Ownership

- React: page DOM, controls, state, forms, overlays, route lifecycle
- services: local data and API semantics
- engine: canvas internals only
- TanStack Router: URL and navigation

Direct DOM mutation outside an engine integration file is a finding.

Verifier reports are generated diagnostics. Repair source and rerun the owning script instead of editing report JSON.

Content provenance checks rendered JSX text and visually exposed static attributes such as `alt`, `title`, `placeholder`, and `value`. It does not treat component names, CSS classes, `data-*`, test IDs, engine constants, or nonvisual ARIA helpers as invented marketing copy. Never delete accessibility or test metadata merely to satisfy provenance.
