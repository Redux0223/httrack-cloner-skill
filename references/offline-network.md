# Offline Network Policy

## Threat Model

The final browser runtime must not automatically contact third-party origins. Enforce this with three layers:

1. static AST/resource analysis
2. source rewriting and credential redaction
3. browser CSP plus a runtime fetch/beacon boundary

No single layer is sufficient.

## Classify Every Remote Reference

| Class | Example | Action |
|---|---|---|
| Same-origin runtime request | absolute source-site JSON or asset URL | rewrite to local path |
| Third-party service | Supabase function, analytics endpoint | rewrite to `/__offline__/...` or owned same-origin API |
| Automatic resource load | script, stylesheet, image, media, worker | capture and localize, otherwise block final delivery |
| User navigation | anchor or `window.open` | neutralize and report in the strict no-external profile |
| Identifier or documentation | SVG namespace, warning URL | report as inert/unknown; CSP remains the backstop |

## Offline Rules Schema

Rules are evaluated in order. `match` compares pathname exactly. `prefix` compares pathname prefixes. Method matching is case-sensitive after normalization to uppercase.

```json
{
  "routes": [
    {
      "match": "/__offline__/api.example.com/v1/join",
      "methods": ["POST"],
      "status": 200,
      "json": {
        "success": true,
        "offline": true,
        "id": "offline-user"
      },
      "headers": {
        "x-clone-mode": "offline"
      }
    },
    {
      "prefix": "/__offline__/analytics.example.com/",
      "methods": ["POST"],
      "status": 204,
      "json": null
    }
  ]
}
```

Unmatched offline routes return JSON with status 503. Prefer that explicit failure over an accidental Vite HTML fallback.

Statuses 204, 205, and 304 must use an empty response body even when the rule's `json` value is present.

## Response Design

For each endpoint, inspect all response consumers before creating a rule. Preserve only the fields and status transitions the local flow needs.

Do not emulate:

- real authentication or authorization
- payment approval
- production persistence
- user enumeration
- sensitive personal data
- analytics delivery

For demo forms, use stable local identifiers and synthetic positions/counts. Avoid implying that data was submitted to the real service.

## Same-Origin Replacement APIs

If the local project owns a backend, replace the remote base with that same-origin API rather than an offline rule. The API must still pass the external-runtime gate and have its own privacy/security review.

## CSP

The generated CSP keeps network connections same-origin while allowing local media, fonts, WASM, and blob workers:

- `connect-src 'self' blob:`
- `img-src 'self' data: blob:`
- `media-src 'self' data: blob:`
- `font-src 'self' data:`
- `worker-src 'self' blob:`

Do not add broad `https:` or `*` sources to make a broken clone appear functional. Localize the dependency or document the blocker.

## Verification

`verify-no-external.mjs` scans source, public assets, and built output. A pass requires:

- zero automatic remote requests
- zero remote resource attributes/CSS URLs
- zero JavaScript parse errors
- zero credential findings
- zero unresolved references in the conversion manifest

A tracker literal edited only in memory still fails. Reparse the exact emitted file and count sink-level findings after literal, template, and credential rewrites. The sanitizer's `changed` result must reflect every emitted-byte change, not only AST request edits.

Outbound navigation and unknown remote literals fail the final gate. Localize them, neutralize them, or implement an explicit local unavailable outcome before delivery.

Capture authorization is not a runtime exception. A host may be authorized for acquisition and still be forbidden as an automatic dependency in the final project.
