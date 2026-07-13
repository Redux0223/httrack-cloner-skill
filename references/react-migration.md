# React Ownership Migration

## The Generated Boundary

The deterministic converter can safely reconstruct:

- route components from captured HTML bodies
- React-owned static DOM
- local CSS and asset URLs
- page titles and body classes
- local script lifecycle adapters
- navigation between captured pages
- CSP, offline rules, and network policy

It cannot recover the original authoring repository from a minified bundle. The practical task is to decompile the deployed bundle, identify its route/UI/state/engine responsibilities, and rewrite those responsibilities into maintainable React modules without changing rendered behavior.

Use this order: captured HTML and CSS for the first React surface, decompiled bundle for behavior and state, typed React ownership for visible UI, a narrow engine adapter for canvas/WebGL, then browser proof and repair.

## Migration Levels

### Level 1: React Adapter

React renders the captured body and mounts sanitized local legacy modules after the DOM exists.

Exit criteria:

- every legacy module is listed in `conversion-manifest.json`
- all assets are local
- no external runtime requests or credentials remain
- build and browser behavior are stable

This is a valid fidelity-first delivery when browser proof passes and the runtime is fully local. Label it `React adapter`. It is not the maintainability endpoint, so keep the decompiled source and migration diagnostics available for later ownership work.

### Level 2: Hybrid Reconstruction

Move user-facing DOM and state into React while retaining complex imperative engines behind adapters.

Recommended order:

1. forms, menus, dialogs, HUD, and overlays
2. route and URL state
3. audio/media state
4. analytics removal and local event telemetry
5. WebGL scene controls and asset loaders
6. engine internals only when replacement value exceeds risk

Each migration removes one legacy DOM ownership area and adds tests before deleting the old path.

Do not inventory only constructors and bridge methods. Recover the source bootstrap sequence and account for every top-level activation call. Custom cursor installers, glass/decorator observers, responsive mounts, sound wiring, body-class synchronization, and global pointer listeners are visible behavior even when their helper functions survive extraction. Missing invocation is missing functionality.

Do not leave completion or progress UI under mixed ownership. If a stage gate depends on visible prompts, counters, rulers, hold buttons, or completion dialogs, React must own that UI even when a WebGL engine remains. The `why.zero.university` run only met the reconstruction bar after React owned `DRAW A ZERO`, `SCROLL`, XP/BZ progress, stage gates, and the waitlist completion path.

### Level 3: Pure React/Module Rewrite

No generated page imports a legacy bootstrap bundle. Imperative libraries may still exist, but they are ordinary project dependencies or local modules with explicit React adapters.

Required evidence:

- `legacyScripts: []`
- named, maintainable source modules
- tests for interaction/state contracts
- deterministic teardown and remount behavior
- no duplicate engine initialization in development
- route, error, loading, and offline states owned by React

## Imperative Engine Adapter

Use a narrow adapter for WebGL/canvas engines:

```jsx
import { useEffect, useRef } from "react";
import { createExperience } from "../engine/createExperience.js";

export function ExperienceCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const experience = createExperience({ canvas: canvasRef.current });
    return () => experience.destroy();
  }, []);

  return <canvas ref={canvasRef} aria-label="Interactive experience" />;
}
```

The engine must own only the canvas/scene surface. React should own surrounding controls, dialogs, form state, route state, custom cursors, decorative glass layers, and global theme/body-class state that affects visible UI. If the runtime still flips body classes such as `frame-open` or nav theme markers, React must synchronize that state deliberately and restore it on cleanup. Preserve source DOM order for runtime-created overlays and global controls because text snapshots, stacking, and event targeting depend on append order.

## Migration Tests

For every ownership transfer:

- write an interaction/state test before changing implementation
- verify the old legacy path fails the new ownership expectation
- implement the React path
- remove the old listeners/DOM creation
- run build, local-assets, and no-external gates
- run post-landing browser verification

Do not migrate multiple tightly coupled interaction systems at once unless tests cover their shared state.

## Visible Ownership Evidence

Run `extract-bootstrap-contract.mjs` and `extract-react-owned-ui.mjs` before editing a bootstrap-owned route. The reports must account for each legacy loader target, top-level activation, runtime engine signal, reachable React file, visible intrinsic element, interactive selector, form control, media element, canvas mount, body-class write, and overflow write.

`react-owned-ui.json` is route-specific. Visible elements on a fallback or unsupported route do not prove that the legacy home route was reconstructed. HTML-looking text inside a JavaScript string, JSON script, `noscript`, hidden resource mount, or captured bootstrap does not count as React-owned UI.

The combined component and engine stages must fail when:

- a legacy route has zero reachable visible React elements
- runtime evidence contains canvas or workers but no isolated engine contract exists
- the conversion mode still names a legacy adapter while ownership is reported as complete
- source-visible controls, forms, media, canvas mounts, or global UI state have no React-owned counterpart

Component reconstruction checks visible route ownership only. Canvas and worker findings belong to engine isolation, which runs immediately afterward.

## Claim Discipline

Use precise delivery language:

- "React adapter" when local legacy bundles still bootstrap the experience
- "hybrid reconstruction" when React owns UI but an isolated engine remains
- "React rewrite" only after legacy bootstrap removal and test coverage

Visual parity is independent of code ownership. Passing one does not prove the other. A project that still ships a local runtime adapter may be delivered as `React adapter`, but it remains below the `React rewrite` bar even if screenshots match.
