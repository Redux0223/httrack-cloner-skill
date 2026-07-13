# Contributing

Thank you for improving HTTrack Cloner Skill.

## Good contributions

- Small, legally redistributable fixtures that reproduce a general capture problem.
- Runtime asset discovery and content-signature fixes.
- React, TanStack Router, WebGL, media, worker, and WASM migration improvements.
- Browser proof actions and deterministic comparison improvements.
- Documentation corrections with verified commands.

Do not submit copied production websites, private assets, credentials, cookies, access tokens, or material you cannot redistribute.

## Development setup

```bash
npm ci --prefix scripts
npx --prefix scripts playwright install chromium
npm test
```

HTTrack must be available on `PATH` for capture tests.

## Pull requests

1. Add a focused regression test that fails before the fix.
2. Implement the smallest general solution.
3. Run `npm run validate`.
4. Update `SKILL.md` or a reference only when agent behavior changes.
5. Describe whether the change affects delivery gates or diagnostics.

Keep generated website runs and `node_modules` out of commits.
