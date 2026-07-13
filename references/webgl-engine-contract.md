# WebGL Engine Contract

## Interface

```ts
export interface Experience {
  start(): Promise<void>
  resize(viewport: Viewport): void
  dispatch(event: ExperienceEvent): void
  snapshot(): ExperienceSnapshot
  destroy(): void
}
```

## Allowed Ownership

- renderer and render targets
- scenes, cameras, meshes, materials, textures, shaders
- loaders and decoder configuration
- animation mixers and engine timelines
- engine-specific audio synchronized with the scene
- canvas-local input interpretation

## Forbidden Ownership

- page navigation or browser history
- forms, dialogs, menus, and overlays
- unknown remote requests
- page DOM outside the mount
- persistent global listeners after unmount

## Cleanup Checklist

`destroy()` must cancel RAF, timers, tweens, and animation loops; remove window/document/canvas listeners; disconnect observers; terminate workers; stop media and audio; dispose geometries, materials, textures, render targets, composers, and renderer state; release the WebGL context when appropriate; and restore modified body/global state.

Machine evidence must record localized worker URLs, context-lost/restored handling when present in the source, body/global restoration, released scroll and pointer locks, stopped audio/media, and worker termination. Runtime canvas or worker evidence with no contract is `runtime-engine-present-but-unisolated` even when the generated React shell contains no `<canvas>` yet.

The contract must prove real output. Calling `getContext()`, advancing an RAF counter, writing `canvas.dataset`, or starting an echo worker does not render the captured experience. A source-derived renderer path must issue canvas/WebGL drawing operations and preserve captured stage, asset, interaction, or shader behavior. Otherwise report `engine-runtime-placeholder` and `captured-bootstrap-replacement-unproven`.

Do not retain the old application bundle under a non-executable-looking suffix. `.reconstructed`, `.disabled`, `.old`, `.bak`, and equivalent renamed copies remain captured bootstrap ownership inside the delivered project.

## React Mount

Create the engine once in an effect, pass typed events from React, resize through an observer, and always call `destroy()` in cleanup. Route remount must create one fresh engine without duplicate listeners or cached stale DOM.
