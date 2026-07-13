# Behavior Extraction SOP

## Inputs

Read the behavior contracts, site inspection, conversion manifest, captured scripts, source maps, and relevant HTML selectors.

Behavior extraction starts only after each analyzed file is classified as parseable JavaScript or intentional inert data. HTML masquerading as JavaScript is a capture failure, not behavior evidence. Raw JSON or other inert payloads served from a `.js` path are content-signature failures to quarantine or relabel before analysis, as seen in the `santionispirits.com` `uil...js` data artifact.

## Contract Fields

For each behavior record:

- trigger and target
- preconditions
- state before and after
- visible effect
- engine effect
- network effect
- storage/history effect
- cleanup requirement

## Migration Order

1. forms and validation
2. links and navigation
3. dialogs, menus, HUD, and overlays
4. local storage and URL state
5. media and audio controls
6. pointer, touch, keyboard, and resize behavior
7. WebGL stage controls
8. engine internals

Write a failing test before moving each behavior area. Remove old ownership only after the replacement test passes.

## Interaction Depth Inventory

Derive `interactionFamilies` from captured events and behavior: scroll/wheel, click/tap, pointer drag, press-and-hold, forms, keyboard, navigation/stage transitions, media, and touch. Treat down/up plus timer or RAF progress as press-and-hold evidence. Every detected family must appear in the proof profile on each applicable desktop or mobile environment.

## Engine-To-React Bridges

List every bridge property and method read or called by the retained runtime. Map each item to its React implementation, mounted element/ref, state transition, and regression test. A member is incomplete when it is `null`, returns constant `null` geometry, is an empty callback, points into an invisible resource mount, or drops callbacks/options supplied by the runtime.

Controls with captured `display:none`, zero opacity, or disabled pointer events require explicit visible-state overrides. For blocking gates, test callback preservation, pointer lifecycle, cancel/resume behavior, completion, and the next state. In deep-scroll flows like `why.zero.university`, React must own the visible completion UI around the gate, not just forward pointer events into the retained runtime.

When desktop and mobile mount different progress controls, inventory and migrate both trees explicitly. The `why.zero.university` evidence required a segment-based desktop ruler and a separate mobile timeline, both driven by the same state progression rather than one hidden legacy copy.

## AST Evidence

Inspect event registration, selectors, timers, RAF, observers, storage, history, forms, media, canvas, workers, dynamic imports, and request construction. Trace constants and template strings before classifying unknown behavior.

## Bundle Decompilation

Prefer source-map `sourcesContent` when it is complete. Otherwise run the bundled `decompile-bundle.mjs` and retain its SHA-256 provenance report.

Use readable output to locate top-level systems, UI constructors, stage controllers, service endpoints, dynamic chunks, and bootstrap order. Then reconstruct explicit modules. The decompiler output may seed an isolated engine only after all of these transformations are real and reviewable:

- bootstrap is callable rather than import-time global execution
- canvas and temporary-resource mounts are injected
- visible UI constructors are replaced by React bridges
- remote services are replaced by local contracts
- listener, RAF, timer, observer, worker, media, and GPU cleanup is complete
- a typed engine entry exposes `start`, `resize`, `dispatch`, `snapshot`, and `destroy`

Do not copy the readable bundle wholesale into `src`, add a thin wrapper, and call that reconstruction.

## Prohibited Shortcuts

- renaming the captured bundle
- deleting manifest findings
- keeping a hidden script tag
- full-page reload to recreate state
- treating a successful build as behavior proof
- moving the minified application unchanged into `src/engines`
