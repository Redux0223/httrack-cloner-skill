# Source-Local Proof Protocol

## Ordering

Proof is forbidden before source generation, build, and legacy elimination pass. The original site is read-only evidence and never a code-generation input.

The built-in runner enables WebGL2 with SwiftShader and normalizes the reported GPU vendor/renderer equally for source and local contexts. This avoids source-side `swiftshader` blocklists without changing source bytes or proof thresholds. An `/unsupported` redirect is not source unavailability until the built-in runner has been tried.

If the live source is repeatedly unavailable during proof, create a proof-only local source oracle from untouched captured source bytes under `RUN/.cloner/oracle/site`, serve it on loopback, and register it with `scripts/register-source-oracle.mjs`. Registration verifies every oracle file against captured SHA-256 evidence and records an integrity fingerprint. Never edit `.cloner/invocation.json` or replace its source preview. The oracle may retain the original bootstrap because it is test evidence, but it must never enter `RUN/react`, influence reconstruction before code landing, or remain a delivery-time dependency.

## Locked Environment

Use the built-in fixed desktop and mobile environments. Lock viewport, scale, locale, timezone, color scheme, reduced motion, storage seed, random seed, and action sequence. Record the threshold fingerprint. Run source and local captures in parallel so continuous engines receive equivalent action timing.

## Deterministic Actions

Default `goto` and network-idle actions are sufficient only when `interactionFamilies` is empty. Otherwise the orchestrator runs deterministic profile synthesis from behavior evidence and `react-owned-ui.json`. Refine the generated profile only after a concrete action or checkpoint failure. Supported actions are `wait-for-selector`, `wait-for-time`, `click`, `tap`, `fill`, `press`, `media-play`, repeated `wheel`, `pointer-circle`, `pointer-hold`, and `checkpoint`.

Choose a reproducible observable checkpoint, such as a completed loader, opened dialog, submitted local form, or stable stage. Do not capture arbitrary animation time. Profiles select scenarios and actions only; threshold overrides are ignored.

Cover every detected interaction family in both locked desktop and mobile environments. Profiles may not drop either environment. Put checkpoints before and after every wheel segment and blocking stage gate. A wheel or hold action requires the before checkpoint immediately before the action. The after checkpoint must observe the same selector and require change from the before checkpoint, but stabilization waits may occur between the action and after checkpoint. Scroll snapshots include scroll position, maximum depth, and effective HTML/body overflow so a local scroll lock is explicit. Wait for the source-visible transition to settle before comparing; an immediate post-release sample is not proof of the final state. Compare source/local checkpoint snapshots and independently fail a local flow that does not progress.

Profile synthesis maps scroll to repeated wheel input, click/touch to a tap with desktop click fallback, pointer drag to a canvas gesture, forms to a visible control fill, keyboard to a focused press, media to `media-play`, navigation to route actions, and every hold gate to before/after checkpoints. Generic fallback selectors are only a first probe; replace them with a source-visible stable selector when proof reports ambiguity or absence.

For deep-scroll or staged experiences, name each gate explicitly in the profile rather than collapsing the flow into one terminal screenshot. The `why.zero.university` evidence required a pointer-circle loader-clear action, repeated wheel segments, two separate hold gates, and a final checkpoint proving stage-5 progression. Checkpoints must prove each gate changed state, not just that the end route eventually rendered.

When responsive controls differ, capture both ownership and progression for each environment. In `why.zero.university`, desktop proof had to observe the segment-based `scroll-ruler`, while mobile proof had to observe the separate `mobile-timeline`; one environment cannot stand in for the other when the mounted controls differ.

## Signals

- route, search, hash, and title
- normalized rendered text after ancestor opacity, clipping, display, visibility, and viewport intersection checks
- landmarks and roles
- geometry and computed styles
- local and external network requests
- console and page errors
- screenshots and pixel mismatch ratio
- phase-aligned-frame ratio, temporal-mean ratio, selected comparison mode, and matched frame indexes for dynamic visuals
- canvas dimensions and nonblank variation
- interaction state snapshots
- scroll position, maximum document depth, and effective overflow state at checkpoints
- cleanup after route unmount

## Repair

Classify each failure as route, content, layout, behavior, asset, network, lifecycle, or nondeterministic checkpoint. Checkpoint findings must name the differing field, such as body class, visible text, target display, or geometry; do not collapse all fields into a serialized-object mismatch. Apply one strategy, add a named regression test, record before/after hashes, and rerun. Repair a nondeterministic checkpoint with a code-derived action sequence, never with a looser threshold.

For canvas, video, stochastic particles, or continuous animation, capture a bounded frame sequence with deterministic random seeding. Compute both the best phase-aligned real-frame mismatch and the temporal-mean mismatch. Use the lower ratio at the existing locked threshold and retain both metrics plus the matched real frames. If persistent controls, text, or geometry remain different, the aggregate diff will still expose them; repair those differences rather than treating all red pixels as GPU noise.

Treat one live-source timeout as transient and retry. Use the local oracle only after repeated source navigation failures and only when the captured bytes are complete enough to reproduce the proof scenario. A changed oracle byte, non-loopback preview, or edited invocation invalidates proof. Missing source bytes remain an external impossibility, not permission to invent evidence.

## Platform Tolerance

Pixel-byte equality is not portable across GPU and font rasterization environments. Use fixed explicit ratio thresholds plus exact content, route, asset, network, and interaction gates. Report phase-aligned and temporal metrics separately rather than claiming unsupported single-frame precision.
