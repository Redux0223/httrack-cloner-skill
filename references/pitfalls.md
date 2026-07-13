# Capture And Conversion Pitfalls

## Bounded Runtime Waiting

- Never assume `networkidle` will occur. Video, SSE, streaming fetches, and persistent application channels can remain open indefinitely.
- Treat a network-idle timeout as the end of the settling window, not as a proof execution crash. Continue after a short deterministic delay.
- Apply multi-frame sampling only to scenarios that need canvas or continuous-animation comparison; keep static routes on one frame.

## Captured Error Documents

- HTTrack can save a failed asset response as `path/to/asset.html` and rewrite CSS to that file.
- When an HTML document has Error/404 markers and a canonical route different from its captured path, exclude it from route generation.
- Remove HTML, JSX, `srcSet`, and CSS URL references to the rejected document so the browser never requests it as an asset.

## Why HTTrack Alone Is Insufficient

HTTrack follows discoverable document links. Modern production bundles commonly discover assets only after JavaScript executes or after user interaction.

In the `why.zero.university` case, a default successful mirror captured 11 of 116 statically identified live resources. The missing set included lazy JavaScript chunks, KTX2 atlases, GLB models, audio, video, origami assets, company/tool logos, Draco files, and Basis files. A wider crawl depth did not solve runtime path discovery.

General rule: zero HTTrack errors means the crawler completed its known queue, not that the runtime dependency graph is complete.

## Dynamic Asset Discovery

Inspect all downloaded runtime text, not only HTML:

- JavaScript string literals and template fragments
- CSS `url()` and `@import`
- JSON and SVG references
- dynamic `import()` paths
- decoder and transcoder prefixes
- arrays of names later converted to paths
- file names concatenated with `/assets`, `/vendor`, locale, breakpoint, or device suffixes

Use `asset-hints.txt` for paths that static extraction cannot concretize. Common examples:

```text
/assets/origami/cat.glb
/assets/origami/ao/cat.webp
/vendor/draco/draco_decoder.wasm
/vendor/basis/basis_transcoder.wasm
```

Do not accept HTTP 200 alone as proof of a valid asset. Record bytes and SHA-256, then exercise the asset after the code is landed.

Path provenance alone is also insufficient. A three-byte placeholder written over a captured image, JSON, model, font, or media path is still fake. Compare captured and delivered byte length plus SHA-256 for every non-transformable public asset. Uncaptured empty JSON, no-op JavaScript, and fake build metadata must fail.

Order extension alternatives longest-first. A scanner that tests `js` before `json` silently turns `config.json` into `config.js`, misses the real asset, and creates route-fallback noise.

For final local-asset verification, scan JavaScript runtime sinks rather than every quoted path. Webpack/CommonJS module table keys such as `./backend/backend.js` are bundled identifiers, not browser file requests. Conversely, constant paths passed to `fetch`, dynamic import, Worker, `src`/`poster`, `setAttribute`, loader methods, asset manifests, and Emscripten `locateFile` are runtime evidence and must resolve locally.

## HTML Misfiled As A Runtime Asset

Servers often return a route fallback with status 200 for a missing chunk. If a `.js` response starts with an HTML doctype, `<html>`, or a document shell, classify it as `html-misfiled-as-javascript`. Record response content type, byte count, source reference, first-line sample, and hash. Reject it during dynamic capture or quarantine it outside `public/`; never send it to the JavaScript parser.

If the bad path is a required script reference, fail asset closure and trace the real chunk path. If it was only a heuristic false positive, record the rejection and continue. JSON bytes under a `.js` extension may remain at the same local path when runtime code fetches them as data, but they must never be loaded as an executable script.

## Absolute Paths

A bundle loaded from `/source/example.com/assets/main.js` may still request `/assets/model.glb`. Copying the mirror under a nested prefix breaks absolute paths even though the entry script loads.

The generated runtime must preserve the original root layout under `public/`:

- `/assets/*` -> `public/assets/*`
- `/vendor/*` -> `public/vendor/*`
- sibling capture hosts -> `public/_external/<host>/*`

Relative dynamic imports must remain beside their importing bundle.

## Sibling Hosts And Fonts

HTTrack often stores allowed font/CDN hosts as sibling directories. Consolidate the CSS into local source CSS and rewrite font URLs to the sibling-host copy. Do not ship HTTrack's generated host error pages or top-level navigation scaffold as runtime assets.

Check font weight, style, format, and `unicode-range`; a single downloaded font file is not necessarily equivalent to the original family request.

## Minified Bundles And Remote Requests

Remote calls are often indirect:

```js
const base = "https://api.example.com";
const endpoint = `${base}/functions/v1/submit`;
fetch(endpoint);
```

Literal grep misses this. Parse JavaScript, resolve top-level constants and templates, identify network sinks, rewrite the base, and then parse the sanitized result again.

Relevant sinks include:

- `fetch`
- `XMLHttpRequest.open`
- `WebSocket`
- `EventSource`
- `Worker` and `SharedWorker`
- `navigator.sendBeacon`
- dynamic imports
- remote `src`, `poster`, stylesheet, and form-action values

Keep outbound user navigation separate from automatic requests. Report it for compliance review, but do not confuse an anchor click with an automatic runtime dependency.

Protocol-relative URLs such as `//cdn.example.com/file.js` are remote too. Match only plausible host syntax; arbitrary `//` sequences are common inside base64/WASM payload strings and must not be rewritten.

## Origin-Only URL Rewriting

Preserve whether the original base literal ended with `/`.

Bad:

```js
const base = "/__offline__/api.example.com/";
const endpoint = `${base}/v1/submit`; // double slash
```

Good:

```js
const base = "/__offline__/api.example.com";
const endpoint = `${base}/v1/submit`;
```

Offline route matching can silently fail if this detail is lost.

## Credentials In Public Bundles

Public production bundles may contain JWTs, Supabase anon keys, analytics identifiers, or API keys. A request rewrite does not remove the credential. Redact credential-like values from the runnable copy and record only a short hash fingerprint in reports.

Never copy a secret into offline rules.

## WebGL, WASM, Workers, And Strict Mode

Three.js, GSAP, Howler, decoders, and Emscripten modules are imperative runtimes. Mount them once, keep them behind an adapter, and tear them down deliberately. React Strict Mode can double-run effects in development and initialize a WebGL engine twice; generated adapter projects therefore avoid Strict Mode until the engine is made idempotent.

CSP must permit required local capabilities such as `blob:` workers/media and WASM evaluation while keeping `connect-src` same-origin.

Some source sites reject headless Chrome because `WEBGL_debug_renderer_info` reports SwiftShader even though WebGL2 works. The proof runner enables WebGL2 and normalizes only vendor/renderer strings for both source and local contexts. Do not patch source detection code or accept the site's unsupported page as the oracle.

## Style Replacement

An opaque bootstrap often tempts an Agent to discard the experience and write a conventional landing page. This produces valid React and invalid reconstruction. Lock generated captured styles in `.cloner/style-baseline.json`; `source.css` may not be edited, appended, or replaced, and an extra stylesheet is not evidence-backed merely because it looks plausible. Reuse original class names and reconstruct the original DOM/engine ownership.

## Stale Run Reuse

Do not write or follow `current-<host>.json`, latest-run symlinks, sibling output pointers, or prior proof profiles. `run-url.mjs` allocates a unique run and signs immutable invocation fields. Editing URL, source preview, paths, or options invalidates resume provenance.

## Remote Forms

Removing a form endpoint is not enough. Determine what the UI expects:

- response status
- JSON fields
- duplicate-user behavior
- loading and retry states
- local storage mutations
- referral/profile follow-up calls

Model only the minimum deterministic response needed for the approved local demo. Mark the response as offline in data when the UI contract permits it.

## Routing And Error Pages

HTTrack may capture only `/` while the bundle creates menu links or assumes server routes. Verify linked routes independently. A link can lead to a custom 404 that itself loads remote scripts or assets.

Create explicit React routes only for captured/approved pages. Report broken source links instead of inventing content.

## Flaky Source During Proof

A live source can time out after reconstruction succeeds. Do not weaken proof, switch to screenshots as generation input, or treat the generated project as its own oracle.

After source generation, build, and legacy elimination pass, a complete untouched capture may be copied to `RUN/.cloner/oracle/site` and served on loopback as proof-only evidence. Register it with `register-source-oracle.mjs`; the script rejects non-loopback URLs, changed bytes, and files absent from capture evidence. Preserve its original bootstrap there. Exclude the oracle from the React project, delivery manifest, runtime dependency graph, and clean reproduction.

## Hosting Contract

Root-absolute `/assets` and `/vendor` paths intentionally preserve the source runtime contract. The generated adapter therefore requires a root-hosted HTTP server with correct MIME types and byte-range responses. It is not a `file://` artifact and is not subpath-portable until every absolute path and runtime base assumption is migrated.

## Filesystem Safety

Reject symbolic links in captured input so a mirror cannot copy files from outside its root. Keep input and output directories disjoint, and never clean the filesystem root, user home, or current working directory.

## Fidelity Claims

Without original source maps, a production bundle cannot be reliably restored to the author's component boundaries, names, state model, or tests. A faithful local runtime adapter can preserve behavior while remaining non-maintainable.

Use the ownership levels in `SKILL.md`. Do not use visual similarity to conceal unresolved code ownership.
